// Run with: npm run register
// One-time registration. If you change command shapes, run again.

import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('Need DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID');
  process.exit(1);
}

const command = new SlashCommandBuilder()
  .setName('rally-bot')
  .setDescription('Kingshot rally bot controls')
  .addSubcommand(s => s
    .setName('wake')
    .setDescription('Wake the bot and have it join the voice channel')
    .addIntegerOption(o => o.setName('minutes').setDescription('Stay awake for N minutes (default 60)').setMinValue(5).setMaxValue(360))
  )
  .addSubcommand(s => s
    .setName('extend')
    .setDescription('Extend the current wake window')
    .addIntegerOption(o => o.setName('minutes').setDescription('Extend by N minutes (default 60)').setMinValue(5).setMaxValue(360))
  )
  .addSubcommand(s => s
    .setName('sleep')
    .setDescription('Disconnect immediately and clear any manual override')
  )
  .addSubcommand(s => s
    .setName('test')
    .setDescription('Play a single test bell into the voice channel')
  )
  .addSubcommand(s => s
    .setName('status')
    .setDescription('Show bot status')
  );

const rest = new REST({ version: '10' }).setToken(TOKEN);

try {
  console.log('Registering /rally-bot to guild', GUILD_ID, '...');
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: [command.toJSON()] }
  );
  console.log('✓ Registered. Commands appear immediately for guild commands.');
} catch (e) {
  console.error('Registration failed:', e);
  process.exit(1);
}
