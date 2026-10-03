# Student Archive

An academic archive for the **Democracy Craft** Minecraft server.

- **Library Database** – searchable catalogue of papers, books and primary sources
- **Case Study Finder** – browse and filter case studies by topic or tag

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

## Admin moderation (Discord login)

Admins can hide (soft delete) and restore entries. Hidden entries disappear from the public site but stay in the database.

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
