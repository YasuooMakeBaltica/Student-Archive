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
3. Deploy. The archive is seeded from `data/seed.json` on first request and entries persist in Redis.

Without those variables (local development) the app falls back to `data/db.json`.
