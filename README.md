# ai-horde-irc

An IRC bot that lets people generate images on the [AI Horde](https://aihorde.net) from any channel it's in. Logged-in users authenticate via NickServ and a DM `LOGIN` command storing their own API key; everyone else falls back to the horde anonymous key. Status updates DM the requester, and the final image URL — hosted on [catbox.moe](https://catbox.moe) by default, or on a Cloudflare R2 bucket you control if you'd rather own the storage — gets posted back to the channel.

A small basic-auth-gated web dashboard tracks logins, request history, kudos spent, and lets you click through to generated images.

> **Try it live:** an instance is running as **AIHorde** on **irc.libera.chat** — join `#aihorde` and try it out.

## Quick example

```
<amiantos> AIHorde: an idyllic babbling brook --style sdxl-landscape --negative blurry
<AIHorde> amiantos: an idyllic babbling brook https://files.catbox.moe/gexa02.webp
```

## Commands

All non-image commands are sent as DM (matching IRC service convention — `/msg AIHorde …`).

| Command | Where | What it does |
|---|---|---|
| `LOGIN <api-key>` | DM | Validates the key against the horde and stores it against your NickServ account. You must be identified with NickServ. |
| `LOGOUT` | DM | Removes your stored key. |
| `USERINFO` | DM | Reports your horde username, kudos balance, total requests, worker count. |
| `STYLES <query>` | DM | Searches available style and category names by substring. Returns up to 8 matches with preview-image links from [AI-Horde-Styles-Previews](https://github.com/amiantos/AI-Horde-Styles-Previews). `SEARCH` is an alias. |
| `STATUS` | DM | Reports your in-flight request's current state, horde id, and elapsed time. |
| `CANCEL` | DM | Aborts your in-flight request and tells the horde to drop it. |
| `HELP` | DM | Prints the command list. |
| `AIHorde: <prompt> [--style <name>] [--negative <text>]` | Channel or DM | Generates an image. The `--style` flag accepts any name from [haidra-org/AI-Horde-Styles](https://github.com/Haidra-Org/AI-Horde-Styles) (style names can have spaces). When `--style` is omitted, the deployment-default style configured in `horde.default_style` is applied; pass `--style raw` to opt out and let the horde pick everything. |

While a generation is in progress the bot DMs queue-position updates whenever they change. Only one generation per user can be in flight at a time.

## Setup

You need:

- An IRC nick registered with NickServ on libera.chat (the bot's nick, default `AIHorde`)
- A place to host generated images. The default is anonymous uploads to [catbox.moe](https://catbox.moe) — no account needed. If you'd rather own the storage you can swap to a Cloudflare R2 bucket; see the "Image hosting" section below.
- Docker + docker-compose, with an existing `proxy-network` external network if you're using the homelab pattern. (Adjust `docker-compose.yml` if not.)

```bash
git clone https://github.com/amiantos/ai-horde-irc
cd ai-horde-irc
cp conf/config.json.example conf/config.json
# edit conf/config.json
docker compose up -d --build
docker compose logs -f bot
```

The dashboard listens on the port from `web.port` in your config (default 3243).

## Configuration

`conf/config.json` (see `conf/config.json.example`):

```json
{
  "irc": {
    "host": "irc.libera.chat",
    "port": 6697,
    "tls": true,
    "nick": "AIHorde",
    "password": "<NickServ password>",
    "sasl": true,
    "channels": ["#aihorde", "#amiantos"],
    "max_line_length": 350
  },
  "horde": {
    "base_url": "https://aihorde.net/api/v2",
    "client_agent": "AIHorde-IRC:0.1:https://github.com/amiantos/ai-horde-irc",
    "poll_interval_seconds": 10,
    "heartbeat_interval_seconds": 60,
    "request_timeout_seconds": 600,
    "default_style": "sdxl-landscape"
  },
  "r2": {
    "endpoint": "https://<account>.r2.cloudflarestorage.com",
    "bucket": "ai-horde-irc",
    "access_key_id": "...",
    "secret_access_key": "...",
    "key_prefix": "",
    "public_base_url": "https://your-cdn.example"
  },
  "catbox": {
    "enabled": false,
    "userhash": ""
  },
  "web": {
    "enabled": true,
    "port": 3243,
    "auth": { "username": "admin", "password": "..." }
  }
}
```

`conf/config.json` is gitignored. The bot expects a NickServ-registered nick — without `password`/`sasl` set, libera will let you connect but most channels will refuse to let you join.

### Image hosting

Two backends are supported. Pick one — if `catbox.enabled` is true the `r2` block is ignored, otherwise the bot uses R2.

- **catbox.moe** (default in `config.json.example`): zero-setup hosting on [catbox.moe](https://catbox.moe). Anonymous uploads work with `userhash` left blank; supplying the userhash from a catbox account links uploads to it so you can manage/delete them later. The horde's image URLs are presigned R2 links that catbox refuses to fetch directly, so the bot downloads each image and re-uploads it as a `fileupload` — adds a brief extra hop but keeps everything else identical.
- **Cloudflare R2**: set `catbox.enabled` to `false` and fill in the `r2` block. Images get uploaded to your bucket under short 5-char IDs and served from `public_base_url`. A 24-hour lifecycle rule on the bucket is recommended for garbage collection.

## Architecture

- `irc-framework` for the IRC connection (TLS + SASL)
- `better-sqlite3` for persistence (users, requests)
- `axios` for the AI Horde REST API and image download
- a multipart POST to `catbox.moe/user/api.php` to host generated images (default), or `@aws-sdk/client-s3` when R2 is selected
- `express` for the web dashboard

The image-request pipeline is a port of the request-builder + style-application logic from [dreamers-guild](https://github.com/amiantos/dreamers-guild) — it fetches the upstream styles catalog from haidra-org at startup (refreshed every 6 hours, with a disk fallback), applies `{p}` / `{np}` template substitution to the user's prompt, copies whitelisted style params (steps, sampler, cfg, dimensions, loras, etc.) onto a base request, and submits to `/api/v2/generate/async`. Polling fires every 10 seconds; status DMs go out when queue position or processing state changes, plus a heartbeat at `heartbeat_interval_seconds` (default 60s) so a stuck request never silently goes dark. After 12 consecutive check failures the bot bails with the underlying error rather than waiting for the hard timeout. On startup, any rows still in `submitted` / `processing` state from a prior run are swept to `failed` since their polling loops no longer exist.

## Running locally without Docker

```bash
npm install
cp conf/config.json.example conf/config.json
# edit conf/config.json
npm start
```

Tests:

```bash
npm test
```

## License

[MIT](LICENSE)
