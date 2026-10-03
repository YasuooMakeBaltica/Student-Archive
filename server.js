const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SEED_FILE = path.join(DATA_DIR, 'seed.json');

function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.copyFileSync(SEED_FILE, DB_FILE);
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDb(db) {
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

const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

for (const kind of ['records', 'cases']) {
  app.get(`/api/${kind}`, (req, res) => {
    const q = String(req.query.q || '').toLowerCase();
    const tag = String(req.query.tag || '').toLowerCase();
    const items = loadDb()[kind].filter((it) => {
      if (tag && !it.tags.includes(tag)) return false;
      if (!q) return true;
      return [it.title, it.author, it.category, it.type, it.summary, it.outcome, ...it.tags]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q));
    });
    res.json(items);
  });

  app.post(`/api/${kind}`, (req, res) => {
    const item = clean(kind, req.body || {});
    if (!item) return res.status(400).json({ error: 'A title is required.' });
    const db = loadDb();
    item.id = db[kind].reduce((m, i) => Math.max(m, i.id), 0) + 1;
    db[kind].push(item);
    saveDb(db);
    res.status(201).json(item);
  });
}

app.listen(PORT, () => console.log(`Student Archive running at http://localhost:${PORT}`));
