const express = require('express');
const fs = require('fs');
const path = require('path');

const { router: authRouter, getAdmin, requireAdmin } = require('./auth');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Storage: Upstash Redis (Vercel Marketplace "KV") when its env vars are set,
// otherwise a local JSON file for development.
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const DB_KEY = 'student-archive-db';
// Required (not read at runtime) so Vercel bundles the seed data with the function.
const SEED = require('./data/seed.json');
const seed = () => structuredClone(SEED);

let redis = null;
if (REDIS_URL && REDIS_TOKEN) {
  const { Redis } = require('@upstash/redis');
  redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
}

async function loadDb() {
  if (redis) {
    const db = await redis.get(DB_KEY);
    if (db) return db;
    const fresh = seed();
    await redis.set(DB_KEY, fresh);
    return fresh;
  }
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(seed(), null, 2));
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

async function saveDb(db) {
  if (redis) return redis.set(DB_KEY, db);
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const FIELDS = {
  records: ['title', 'author', 'type', 'year', 'tags', 'summary'],
  cases: ['title', 'category', 'year', 'tags', 'summary', 'outcome'],
};

function clean(kind, body) {
  const out = {};
  for (const f of FIELDS[kind]) {
    let v = body[f];
    if (f === 'tags') {
      v = (Array.isArray(v) ? v : String(v || '').split(','))
        .map((t) => String(t).trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 10);
    } else if (f === 'year') {
      v = parseInt(v, 10);
      if (!Number.isInteger(v) || v < 1000 || v > 9999) v = null;
    } else {
      v = String(v || '').trim().slice(0, f === 'summary' || f === 'outcome' ? 1000 : 200);
    }
    out[f] = v;
  }
  return out.title ? out : null;
}

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  res.status(500).json({ error: 'Storage error.' });
});

const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(authRouter);

for (const kind of ['records', 'cases']) {
  app.get(`/api/${kind}`, wrap(async (req, res) => {
    const q = String(req.query.q || '').toLowerCase();
    const tag = String(req.query.tag || '').toLowerCase();
    // Hidden (soft-deleted) entries are only visible to admins who ask for them.
    const showHidden = req.query.hidden === '1' && !!getAdmin(req);
    const items = (await loadDb())[kind].filter((it) => {
      if (it.hidden && !showHidden) return false;
      if (tag && !it.tags.includes(tag)) return false;
      if (!q) return true;
      return [it.title, it.author, it.category, it.type, it.summary, it.outcome, ...it.tags]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q));
    });
    res.json(items);
  }));

  app.post(`/api/${kind}`, wrap(async (req, res) => {
    const item = clean(kind, req.body || {});
    if (!item) return res.status(400).json({ error: 'A title is required.' });
    const db = await loadDb();
    item.id = db[kind].reduce((m, i) => Math.max(m, i.id), 0) + 1;
    db[kind].push(item);
    await saveDb(db);
    res.status(201).json(item);
  }));

  // Admin moderation: hide (soft delete) or restore an entry.
  const setHidden = (hidden) => wrap(async (req, res) => {
    const db = await loadDb();
    const item = db[kind].find((i) => i.id === parseInt(req.params.id, 10));
    if (!item) return res.status(404).json({ error: 'Not found.' });
    if (hidden) {
      item.hidden = true;
      item.hiddenBy = getAdmin(req).name;
      item.hiddenAt = new Date().toISOString();
    } else {
      delete item.hidden; delete item.hiddenBy; delete item.hiddenAt;
    }
    await saveDb(db);
    res.json(item);
  });
  app.delete(`/api/${kind}/:id`, requireAdmin, setHidden(true));
  app.post(`/api/${kind}/:id/restore`, requireAdmin, setHidden(false));
}

if (require.main === module) {
  app.listen(PORT, () => console.log(`Student Archive running at http://localhost:${PORT}`));
}

module.exports = app;
