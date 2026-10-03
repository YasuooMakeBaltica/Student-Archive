# Student Archive

An academic archive for the **Democracy Craft** Minecraft server.

- **Library Database** – searchable catalogue of papers, books and primary sources
- **Case Study Finder** – court case files modelled on the Redmont courts (District, Federal and Supreme Court), with an advanced search by parties, citation, law cited, court, case type, status and year, and a full case page with facts, arguments and verdict

Built with plain HTML/CSS/JS and a small Node + Express backend. Data is stored
in `data/db.json` (created from `data/seed.json` on first run).

## Run

```sh
npm install
npm start
```

Then open http://localhost:3000.

## License

MIT – see [LICENSE](LICENSE).

## Deploy to Vercel

1. Import the repo in Vercel.
2. In the project's **Storage** tab, add an **Upstash Redis** database (Marketplace). This sets
   `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically.
3. Deploy. Vercel runs the root `server.js` Express app directly; no `vercel.json` is needed. The archive is seeded from `data/seed.json` on first request and entries persist in Redis.

Without those variables (local development) the app falls back to `data/db.json`.

## Discord login & admin moderation

Anyone can log in with Discord (a login button sits in the top-right corner and shows their Discord avatar once signed in). Only Discord IDs listed in `ADMIN_DISCORD_IDS` get admin rights. Only admins can add entries. Admins can hide (soft delete) and restore entries. Hidden entries disappear from the public site but stay in the database.

1. Create an app at https://discord.com/developers/applications and add the redirect
   `https://<your-domain>/auth/callback` (and `http://localhost:3000/auth/callback` for local use) under **OAuth2**.
2. Set these environment variables:

| Variable | Purpose |
| --- | --- |
| `DISCORD_CLIENT_ID` | Discord app client ID |
| `DISCORD_CLIENT_SECRET` | Discord app client secret |
| `ADMIN_DISCORD_IDS` | Comma-separated Discord user IDs allowed to moderate |
| `SESSION_SECRET` | Long random string used to sign login cookies (required in production) |
| `DISCORD_REDIRECT_URI` | Optional; overrides the auto-detected callback URL |

Hiding endpoints: `DELETE /api/:kind/:id` and `POST /api/:kind/:id/restore` (admin only).

## Court forum sync

The Case Study Finder imports every case from the Democracy Craft court forums (District, Federal
and Supreme Court) by reading thread titles such as `Etco v. mvchrelle [2026] DCR 102` and their
status label. Only the parties, citation, court, year, status and a link are stored — post contents
are not copied. The three most recently active Pending / In Session cases are shown at the top of the finder.

- A Vercel cron job (`vercel.json`) calls `/api/cron/sync` once a day.
- The first run starts a full import of older pages; it continues on each run (admins can also press
  **Sync court forums now** on the Case Study Finder tab to speed it up). Progress is saved after every page.
- Once real cases are imported, the made-up example cases are removed.
- Requires Upstash Redis (see above) and these variables:

| Variable | Purpose |
| --- | --- |
| `SYNC_ENABLED` | Must be `true` for the sync to run (only enable with Democracy Craft staff's permission) |
| `CRON_SECRET` | Random string; Vercel sends it to authorise the daily cron call |
| `FORUM_BASE_URL`, `FORUM_DISTRICT_PATH`, `FORUM_FEDERAL_PATH`, `FORUM_SUPREME_PATH` | Optional overrides if the forum moves |
