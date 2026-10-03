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

async function readDb() {
  if (redis) return (await redis.get(DB_KEY)) || null;
  return fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : null;
}

async function loadDb() {
  let db = await readDb();
  if (!db) {
    db = seed();
    await saveDb(db);
  } else if (migrate(db)) {
    await saveDb(db);
  }
  return db;
}

// Version 1 stored case studies as simple title/category/outcome entries.
// Version 2 stores them as court case files; old sample cases are replaced
// by the new examples and any cases admins added are carried over.
const V1_SAMPLE_CASES = new Set([
  'The Great Tax Reform Dispute', 'Land Claim Boundary Ruling', 'Emergency Powers During a Server Outage',
]);

function migrate(db) {
  if (db.version >= 2) return false;
  const carried = db.cases
    .filter((c) => !V1_SAMPLE_CASES.has(c.title))
    .map((c) => ({
      ...cleanCase({ plaintiff: c.title, year: c.year, summary: c.summary, verdict: c.outcome }),
      ...(c.hidden ? { hidden: true, hiddenBy: c.hiddenBy, hiddenAt: c.hiddenAt } : {}),
    }));
  db.cases = [...seed().cases, ...carried].map((c, i) => ({ ...c, id: i + 1 }));
  db.version = 2;
  return true;
}

async function saveDb(db) {
  if (redis) return redis.set(DB_KEY, db);
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const RECORD_FIELDS = ['title', 'author', 'type', 'year', 'tags', 'summary'];

const CASE_OPTIONS = {
  court: ['District Court', 'Federal Court', 'Supreme Court'],
  caseType: ['Civil', 'Criminal', 'Constitutional', 'Appeal'],
  status: ['Pending', 'In Session', 'Adjourned', 'Dismissed'],
};

const str = (v, max) => String(v ?? '').trim().slice(0, max);

function year(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= 1000 && n <= 9999 ? n : null;
}

function list(v, max) {
  return (Array.isArray(v) ? v : String(v || '').split(','))
    .map((t) => str(t, 80))
    .filter(Boolean)
    .slice(0, max);
}

function cleanRecord(body) {
  const out = {};
  for (const f of RECORD_FIELDS) {
    let v = body[f];
    if (f === 'tags') v = list(v, 10).map((t) => t.toLowerCase());
    else if (f === 'year') v = year(v);
    else v = str(v, f === 'summary' ? 1000 : 200);
    out[f] = v;
  }
  return out.title ? out : null;
}

/** A case file. The title is derived as "Plaintiff v. Defendant" (or just the plaintiff, e.g. "In re …"). */
function cleanCase(body) {
  const pick = (f) => (CASE_OPTIONS[f].includes(body[f]) ? body[f] : '');
  const link = str(body.link, 300);
  const out = {
    plaintiff: str(body.plaintiff, 120),
    defendant: str(body.defendant, 120),
    citation: str(body.citation, 60),
    court: pick('court'),
    caseType: pick('caseType'),
    status: pick('status'),
    year: year(body.year),
    laws: list(body.laws, 10),
    summary: str(body.summary, 4000),
    arguments: str(body.arguments, 4000),
    verdict: str(body.verdict, 4000),
    link: /^https?:\/\//i.test(link) ? link : '',
  };
  out.title = out.defendant ? `${out.plaintiff} v. ${out.defendant}` : out.plaintiff;
  return out.plaintiff ? out : null;
}

const has = (value, needle) => String(value || '').toLowerCase().includes(needle);
const normCitation = (c) => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function matchesRecord(it, query) {
  const q = String(query.q || '').toLowerCase();
  const tag = String(query.tag || '').toLowerCase();
  if (tag && !it.tags.includes(tag)) return false;
  return !q || [it.title, it.author, it.type, it.summary, ...it.tags].some((s) => has(s, q));
}

function matchesCase(it, query) {
  const q = String(query.q || '').toLowerCase();
  const parties = String(query.parties || '').toLowerCase();
  const law = String(query.law || '').toLowerCase();
  const citation = normCitation(query.citation);
  const from = year(query.yearFrom);
  const to = year(query.yearTo);
  for (const f of Object.keys(CASE_OPTIONS)) {
    if (query[f] && it[f] !== query[f]) return false;
  }
  if (parties && !has(it.plaintiff, parties) && !has(it.defendant, parties)) return false;
  if (law && !it.laws.some((l) => has(l, law))) return false;
  if (citation && !normCitation(it.citation).includes(citation)) return false;
  if (from && !(it.year >= from)) return false;
  if (to && !(it.year <= to)) return false;
  return !q || [it.title, it.citation, it.summary, it.arguments, it.verdict, ...it.laws].some((s) => has(s, q));
}

const KINDS = {
  records: { clean: cleanRecord, matches: matchesRecord, required: 'A title is required.' },
  cases: { clean: cleanCase, matches: matchesCase, required: 'A plaintiff (or case name) is required.' },
};

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  res.status(500).json({ error: 'Storage error.' });
});

const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(authRouter);

app.get('/api/options', (req, res) => res.json({ cases: CASE_OPTIONS }));

for (const [kind, { clean, matches, required }] of Object.entries(KINDS)) {
  app.get(`/api/${kind}`, wrap(async (req, res) => {
    // Hidden (soft-deleted) entries are only visible to admins who ask for them.
    const showHidden = req.query.hidden === '1' && !!getAdmin(req);
    const items = (await loadDb())[kind]
      .filter((it) => (!it.hidden || showHidden) && matches(it, req.query))
      .sort((a, b) => (b.year || 0) - (a.year || 0) || b.id - a.id);
    res.json(items);
  }));

  app.get(`/api/${kind}/:id`, wrap(async (req, res) => {
    const item = (await loadDb())[kind].find((i) => i.id === parseInt(req.params.id, 10));
    if (!item || (item.hidden && !getAdmin(req))) return res.status(404).json({ error: 'Not found.' });
    res.json(item);
  }));

  app.post(`/api/${kind}`, requireAdmin, wrap(async (req, res) => {
    const item = clean(req.body || {});
    if (!item) return res.status(400).json({ error: required });
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
