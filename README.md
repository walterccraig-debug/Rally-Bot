# Kingshot Rally Bot

Discord voice bot that plays a bell into your alliance voice channel when the [Rally Coordinator](../) tells it to. Designed for AVG.

## What it does

- Connects to a designated voice channel during scheduled windows (e.g. KE/SVS event days)
- Plays a sharp bell (~0.45s) when the Rally Coordinator app POSTs to its webhook
- Disconnects when the window ends, to keep hosting costs near zero
- Slash commands (`/rally-bot wake`, `extend`, `sleep`, `test`, `status`) for ad-hoc control

## Setup (~15 min total)

### 1. Create the Discord bot account (3 min)

1. Go to https://discord.com/developers/applications
2. Click **New Application** → name it "Rally Bot" (or whatever)
3. Left sidebar → **Bot** → click **Reset Token** → copy the token (you'll paste this into Railway later)
4. Same page, **enable**: Server Members Intent (off by default — toggle on, save)
5. Left sidebar → **General Information** → copy the **Application ID** (this is your `DISCORD_CLIENT_ID`)
6. Left sidebar → **OAuth2** → URL Generator
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Connect`, `Speak`, `Use Voice Activity`
   - Copy the generated URL at the bottom, paste into a browser, choose your AVG server, **Authorize**

### 2. Get IDs from your Discord server (2 min)

You need three IDs. To copy IDs, enable Developer Mode in Discord: User Settings → Advanced → Developer Mode → ON.

- **Server (Guild) ID**: right-click your server name → Copy Server ID
- **Voice Channel ID**: right-click the voice channel the bot should join → Copy Channel ID
- **Bot Token**: from step 1.3 above
- **Client ID**: from step 1.5 above

### 3. Generate a webhook secret (10 sec)

This prevents random people POSTing fake bell triggers to your bot.

- macOS/Linux: open Terminal, run `openssl rand -hex 32` — copy the output
- Or use any random 40+ character string you make up

### 4. Deploy to Railway (5 min)

1. Push this folder to a private GitHub repo (or fork from a public one if I publish it)
2. Go to https://railway.app — sign in with GitHub
3. **New Project** → **Deploy from GitHub repo** → select your repo
4. Once it builds, click **Variables** tab and add:
   - `DISCORD_TOKEN` = your bot token from step 1.3
   - `DISCORD_CLIENT_ID` = your client ID from step 1.5
   - `DISCORD_GUILD_ID` = your server ID
   - `VOICE_CHANNEL_ID` = your voice channel ID
   - `WEBHOOK_SECRET` = your random secret from step 3
   - `SCHEDULE_WINDOWS` = e.g. `1 19 1, 15 19 1` (1st and 15th of month, 19:00–01:00 UTC)
5. **Settings** tab → **Networking** → **Generate Domain** — Railway gives you a public HTTPS URL like `kingshot-rally-bot-production.up.railway.app`

### 5. Register the slash commands (1 min, one-time)

In Railway's deployment view, open the **Shell** tab (or use Railway CLI locally):

```
npm run register
```

You should see `✓ Registered`. The `/rally-bot` commands will appear in your Discord server immediately.

### 6. Hook up the Rally Coordinator app

In your Rally Coordinator (the HTML app), there's a Discord settings card on the Plan tab. Enter:

- **Webhook URL**: `https://your-railway-domain/cue`
- **Secret**: same value as `WEBHOOK_SECRET` above

Toggle Discord cues ON. When you generate a call order, each player's deploy moment will fire a webhook to the bot, which rings the bell in voice.

## Schedule format

`SCHEDULE_WINDOWS` is a comma-separated list of `DAY HOUR_START HOUR_END` entries in UTC.

Examples:

- `1 19 1, 15 19 1` → 1st of month 19:00–01:00 UTC AND 15th of month 19:00–01:00 UTC
- `5 14 22` → 5th of month, 14:00–22:00 UTC
- (blank) → no scheduled windows; bot only joins via slash command or webhook wake

When end < start, the window wraps past midnight. So `19 1` means "19:00 today through 01:00 tomorrow".

## Slash commands

- `/rally-bot wake [minutes]` — connect to voice for N minutes (default 60). Use this for unscheduled events.
- `/rally-bot extend [minutes]` — extend the current wake window
- `/rally-bot sleep` — disconnect immediately and clear override
- `/rally-bot test` — play one bell to verify everything works
- `/rally-bot status` — show schedule, connection state, override expiry

## Webhook protocol

If you want to integrate something else with the bot:

```
POST https://your-bot-domain/cue
Headers:
  X-Rally-Secret: <WEBHOOK_SECRET>
Body: {} (no payload required)

Response:
  200 { "played": true }   — bell rang
  200 { "played": false }  — debounced (too soon after last bell, < 250ms)
  403                       — bad secret
  503                       — voice connection failed
```

A `GET /status` endpoint returns connection state for monitoring.

## Costs

Railway free tier gives ~500 hours of execution + $5 of usage credits per month. An always-on bot uses ~720 hours/month — but with scheduled windows of, say, 2 events × 6 hours = 12 hours/month, you're well under any limit.

If you exceed the free tier, expect ~$3–5/month.

## Troubleshooting

**Bot shows online in Discord but doesn't join voice**
- Check that the bot has Connect + Speak permissions on the voice channel
- Run `/rally-bot status` to see what state it thinks it's in

**Webhook returns 200 but no bell plays**
- The bot may be outside its scheduled window. Webhooks auto-wake the bot for 30 min — try again.
- Check Railway logs for "Player error" or "Connect failed"

**`/rally-bot` commands don't appear in Discord**
- Run `npm run register` again. If still missing, double-check `DISCORD_GUILD_ID` matches the server.

**Audio sounds glitchy or robotic**
- Discord voice quality depends on bot host. Railway's network is good. If you see this, try Fly.io as an alternative host.
