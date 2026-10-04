# Musictrix

A multi-source Discord music bot designed for Replit.

## Features

- Searches and streams YouTube using yt-dlp
- Uses YouTube Music album artwork for track embeds when a matching song is found, with colors sampled from the cover
- Adds interactive volume-down, mute, and volume-up buttons to track announcements (0–100%, 10% steps)
- Formats playback command confirmations, queue listings, and playback errors as embeds
- Queues up to 500 tracks per server
- Sends timestamped, log-style queued and now-playing embeds to the configured playback channel
- Supports pause, resume, skip, stop, and leave
- Replies to users when mentioned, using Google's Gemini API
- Offers text and Discord slash commands
- Keeps secrets out of Git by using `.env` or Replit Secrets

## Setup

1. Copy `.env.example` to `.env`
2. Put your real Discord bot token in `.env` or Replit Secrets
3. Fill in `CLIENT_ID` and `GUILD_ID`
4. Create a Gemini API key at https://aistudio.google.com/apikey and set `GEMINI_API_KEY` in Replit Secrets or `.env`. Mention chat uses Gemini 3 Flash Preview through Google's native Gemini API; the free tier has usage limits. Set `GEMINI_MODEL` to choose another Gemini model or `GEMINI_SYSTEM_PROMPT` to customize the assistant.
5. Install dependencies:

   npm install

   Installing the yt-dlp binary requires Python 3.9+ to be available.

6. Register slash commands:

   npm run deploy

7. Start the bot:

   npm start

## Commands

Text commands use `-` as the prefix:
- `-play <song name or YouTube link>`
- `-ping`
- `-invite`
- `-server`
- `-join`
- `-pause`
- `-resume`
- `-skip`
- `-queue`
- `-remove <queue number or song title>`
- `-kick <member> [reason]`
- `-ki <member> [reason]` (alias for `-kick`)
- `-ban <member> [reason]`
- `-ba <member> [reason]` (alias for `-ban`)
- `-unban <user ID> [reason]`
- `-ub <user ID> [reason]` (alias for `-unban`)
- `-timeout <member> <duration> [reason]`
- `-to <member> <duration> [reason]` (alias for `-timeout`)
- `-untimeout <member> [reason]`
- `-uto <member> [reason]` (alias for `-untimeout`)
- `-purge <1-100>`
- `-pu <1-100>` (alias for `-purge`)
- `-antimessage add <word or phrase>`
- `-antimessage remove <word or phrase>`
- `-antimessage list`
- `-am add/remove/list` (alias for `-antimessage`)
- `-stop`
- `-leave`
- `-help`

Slash commands are available for music and help: `/play`, `/join`, `/pause`, `/resume`, `/skip`, `/queue`, `/stop`, `/leave`, `/help`. Moderation commands are text-only.

Send `-<message>` (for example, `-what songs are in the queue?`) or mention the bot with a message to get an AI reply as regular Discord text. Existing commands such as `-play` and `-ping` continue to work normally; a lone `-` asks you to add a message. The assistant receives a maintained summary of implemented features and commands plus the current server's queue/playback status. It cannot run music commands itself; use the listed text or slash commands. Chat replies require the API settings above.

Moderation commands are text-only and permission-gated by Discord: kick, ban, and unban require their matching server permissions; timeout and untimeout require Moderate Members; purge and anti-message list management require Manage Messages. The short aliases (`-ki`, `-ba`, `-ub`, `-to`, `-uto`, `-pu`, and `-am`) run the same permission checks and behavior as their full commands. Unban accepts a Discord user ID because banned users cannot be mentioned from the server. Timeout durations accept `s`, `m`, `h`, `d`, or `w` (up to 28 days). The bot also needs the corresponding moderation permission and a role above the target.

Use `-antimessage add <word or phrase>` to auto-delete messages containing a case-insensitive whole-word or exact-phrase match; use `remove` to stop filtering a term and `list` to view the server's terms. Each server has its own persisted list (up to 100 entries), and the bot needs Manage Messages permission to delete matches.

Successful moderation actions (including shorthand aliases), auto-purged messages, and auto-purge list changes are logged in Discord channel `1473349548670976183`. The bot needs permission to view and send messages in that channel.

## Notes

- Do not commit your actual Discord token to Git.
- YouTube is the only supported playback source.
- Queue capacity is 500 tracks, including imported playlists.
- Playback announcements are routed to the Discord channel configured in `index.js`; the bot needs permission to view and send messages there.
