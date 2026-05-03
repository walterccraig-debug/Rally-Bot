// Kingshot Rally Bot
// Plays a bell into a designated Discord voice channel when the rally app POSTs to /cue.
// Joins the channel on a recurring schedule, plus on-demand via slash commands.

import { Client, GatewayIntentBits, Events } from 'discord.js';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
  NoSubscriberBehavior,
} from '@discordjs/voice';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BELL_PATH = join(__dirname, '..', 'assets', 'bell.wav');

// ── Config from env ────────────────────────────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const SCHEDULE_WINDOWS_RAW = process.env.SCHEDULE_WINDOWS || '';
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!TOKEN || !GUILD_ID || !VOICE_CHANNEL_ID || !WEBHOOK_SECRET) {
  console.error('Missing required env vars. Need: DISCORD_TOKEN, DISCORD_GUILD_ID, VOICE_CHANNEL_ID, WEBHOOK_SECRET');
  process.exit(1);
}
if (!existsSync(BELL_PATH)) {
  console.error('Missing bell.wav at', BELL_PATH);
  process.exit(1);
}

// ── Schedule parsing ───────────────────────────────────────────────
// Format: "DAY HOUR_START HOUR_END, DAY HOUR_START HOUR_END"
// HOUR_END can wrap past midnight: "19 1" means 19:00 to 01:00 next day
function parseSchedule(raw) {
  if (!raw.trim()) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean).map(part => {
    const [day, start, end] = part.split(/\s+/).map(n => parseInt(n, 10));
    if (isNaN(day) || isNaN(start) || isNaN(end)) {
      console.warn('Bad schedule entry, skipping:', part);
      return null;
    }
    return { day, start, end };
  }).filter(Boolean);
}

const SCHEDULE = parseSchedule(SCHEDULE_WINDOWS_RAW);
console.log('Schedule windows (UTC):', SCHEDULE);

// Returns true if current UTC time falls inside any scheduled window.
// `now` is optional override (for testing).
function isInScheduledWindow(now = new Date()) {
  const day = now.getUTCDate();
  const hour = now.getUTCHours();
  for (const w of SCHEDULE) {
    if (w.start < w.end) {
      // Same-day window
      if (w.day === day && hour >= w.start && hour < w.end) return true;
    } else {
      // Wraps midnight: e.g. start=19, end=1 means 19-23 on day, 0-0 on day+1
      if (w.day === day && hour >= w.start) return true;
      // Get yesterday's UTC date to check the wrap-over
      const yesterday = new Date(now);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      if (w.day === yesterday.getUTCDate() && hour < w.end) return true;
    }
  }
  return false;
}

// ── Voice connection management ────────────────────────────────────
let connection = null;
let player = null;
let manualOverrideUntil = null;  // Date — when set, bot stays connected past schedule until this time
let lastBellAt = 0;
const BELL_DEBOUNCE_MS = 250;  // Drop bells closer than this together to avoid audio overlap

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

async function ensureConnected() {
  if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) return connection;

  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(VOICE_CHANNEL_ID);
  if (!channel || !channel.isVoiceBased()) {
    throw new Error('VOICE_CHANNEL_ID does not point to a voice channel');
  }

  connection = joinVoiceChannel({
    channelId: VOICE_CHANNEL_ID,
    guildId: GUILD_ID,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Play },
  });
  connection.subscribe(player);

  player.on('error', err => console.error('Player error:', err.message));
  player.on(AudioPlayerStatus.Playing, () => console.log('[player] now playing'));
  player.on(AudioPlayerStatus.Idle, () => console.log('[player] idle'));
  connection.on('error', err => console.error('Connection error:', err.message));
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      console.log('Voice connection lost — destroying.');
      try { connection.destroy(); } catch {}
      connection = null;
      player = null;
    }
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
  console.log(`✓ Connected to voice channel ${channel.name}`);
  return connection;
}

function disconnect() {
  if (player) { try { player.stop(); } catch {} }
  if (connection) {
    try { connection.destroy(); } catch {}
    connection = null;
    player = null;
    console.log('Disconnected from voice');
  }
}

function playBell() {
  const now = Date.now();
  if (now - lastBellAt < BELL_DEBOUNCE_MS) {
    console.log('[bell] debounced (too soon after last)');
    return false;
  }
  lastBellAt = now;
  if (!player) {
    console.log('[bell] no player available');
    return false;
  }
  const resource = createAudioResource(BELL_PATH, { inputType: StreamType.Arbitrary });
  player.play(resource);
  console.log('[bell] played');
  return true;
}

// ── Schedule loop ──────────────────────────────────────────────────
async function tickSchedule() {
  const inWindow = isInScheduledWindow();
  const overrideActive = manualOverrideUntil && manualOverrideUntil > new Date();
  const shouldBeConnected = inWindow || overrideActive;

  if (shouldBeConnected && !connection) {
    try { await ensureConnected(); } catch (e) { console.error('Connect failed:', e.message); }
  } else if (!shouldBeConnected && connection) {
    disconnect();
  }
  if (manualOverrideUntil && manualOverrideUntil <= new Date()) manualOverrideUntil = null;
}

setInterval(tickSchedule, 60 * 1000);  // Check every minute

// ── Webhook server ─────────────────────────────────────────────────
const app = express();

// CORS — allow webhook calls from any origin. The X-Rally-Secret header is the security gate.
// Set headers as the FIRST middleware, before json parser, before any route.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Rally-Secret');
  res.header('Access-Control-Max-Age', '86400');
  next();
});

// Explicit handler for preflight on every path, returns immediately
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Rally-Secret');
  res.header('Access-Control-Max-Age', '86400');
  res.sendStatus(204);
});

app.use(express.json({ limit: '4kb' }));

app.get('/', (_req, res) => res.json({ ok: true, name: 'kingshot-rally-bot' }));

app.get('/status', (_req, res) => res.json({
  ok: true,
  connected: !!connection,
  inScheduledWindow: isInScheduledWindow(),
  manualOverrideUntil: manualOverrideUntil ? manualOverrideUntil.toISOString() : null,
}));

app.post('/cue', async (req, res) => {
  const provided = req.get('X-Rally-Secret') || '';
  if (provided !== WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  if (!connection) {
    // If outside scheduled window, allow webhook to wake the bot for the next 30 minutes
    manualOverrideUntil = new Date(Date.now() + 30 * 60 * 1000);
    try { await ensureConnected(); }
    catch (e) {
      return res.status(503).json({ error: 'voice connect failed', detail: e.message });
    }
  }
  const ok = playBell();
  res.json({ played: ok });
});

app.listen(PORT, () => console.log(`Webhook listening on :${PORT}`));

// ── Slash command handler ─────────────────────────────────────────
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.guildId !== GUILD_ID) return;

  try {
    if (interaction.commandName === 'rally-bot') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'wake') {
        const minutes = interaction.options.getInteger('minutes') || 60;
        manualOverrideUntil = new Date(Date.now() + minutes * 60 * 1000);
        await interaction.deferReply({ ephemeral: true });
        try {
          await ensureConnected();
          await interaction.editReply(`✓ Bot active for ${minutes} min`);
        } catch (e) {
          await interaction.editReply(`✗ Failed to connect: ${e.message}`);
        }
      } else if (sub === 'extend') {
        const minutes = interaction.options.getInteger('minutes') || 60;
        const base = manualOverrideUntil && manualOverrideUntil > new Date() ? manualOverrideUntil : new Date();
        manualOverrideUntil = new Date(base.getTime() + minutes * 60 * 1000);
        await interaction.reply({ content: `✓ Active until ${manualOverrideUntil.toUTCString()}`, ephemeral: true });
      } else if (sub === 'sleep') {
        manualOverrideUntil = null;
        if (!isInScheduledWindow()) disconnect();
        await interaction.reply({ content: '✓ Bot sleeping (will wake on schedule or webhook)', ephemeral: true });
      } else if (sub === 'test') {
        if (!connection) {
          await interaction.reply({ content: 'Not connected. Try /rally-bot wake first.', ephemeral: true });
          return;
        }
        playBell();
        await interaction.reply({ content: '🔔 Test bell sent', ephemeral: true });
      } else if (sub === 'status') {
        const lines = [
          `In scheduled window: **${isInScheduledWindow() ? 'yes' : 'no'}**`,
          `Connected: **${connection ? 'yes' : 'no'}**`,
          `Override until: ${manualOverrideUntil ? manualOverrideUntil.toUTCString() : 'none'}`,
          `Schedule: ${SCHEDULE.length ? SCHEDULE.map(w => `day ${w.day} ${String(w.start).padStart(2, '0')}:00–${String(w.end).padStart(2, '0')}:00 UTC`).join(', ') : '(none)'}`,
        ];
        await interaction.reply({ content: lines.join('\n'), ephemeral: true });
      }
    }
  } catch (e) {
    console.error('Interaction error:', e);
    if (!interaction.replied && !interaction.deferred) {
      try { await interaction.reply({ content: 'Error handling command', ephemeral: true }); } catch {}
    }
  }
});

// ── Boot ──────────────────────────────────────────────────────────
client.once(Events.ClientReady, c => {
  console.log(`✓ Logged in as ${c.user.tag}`);
  tickSchedule();
});

client.login(TOKEN);

// Graceful shutdown
process.on('SIGTERM', () => { disconnect(); process.exit(0); });
process.on('SIGINT', () => { disconnect(); process.exit(0); });
