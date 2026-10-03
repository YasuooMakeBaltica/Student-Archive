const express = require('express');
const fs = require('fs');
const path = require('path');

const { router: authRouter, getAdmin, requireAdmin } = require('./auth');
const { runSync, inspect } = require('./sync');

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

// Without Redis on a read-only host (e.g. Vercel with no database connected) the
// archive is served from memory so it can still be browsed; saving changes fails.
let memoryDb = null;

class StorageUnavailable extends Error {}

async function readDb() {
  if (redis) return (await redis.get(DB_KEY)) || null;
  if (memoryDb) return structuredClone(memoryDb); // callers mutate; failed saves must not stick
  return fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : null;
}

async function loadDb() {
  let db = await readDb();
  if (!db) {
    db = seed();
    await saveDb(db, { required: false });
  } else if (migrate(db)) {
    await saveDb(db, { required: false });
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

async function saveDb(db, { required = true } = {}) {
  if (redis) return redis.set(DB_KEY, db);
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (err) {
    if (required) throw new StorageUnavailable(err.message);
    console.warn(`Could not write ${DB_FILE} (${err.code}); serving the archive from memory.`);
    memoryDb = structuredClone(db);
  }
}

const RECORD_FIELDS = ['title', 'author', 'type', 'year', 'tags', 'summary', 'link'];
const httpLink = (v) => { const l = str(v, 300); return /^https?:\/\//i.test(l) ? l : ''; };

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
    else if (f === 'link') v = httpLink(v);
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
  if (err instanceof StorageUnavailable) {
    return res.status(503).json({ error: 'Saving is not set up on this server: connect an Upstash Redis database.' });
  }
  res.status(500).json({ error: 'Storage error.' });
});

// --- Imported forum cases -------------------------------------------------
// Stored apart from the main document (a Redis hash, one field per case) because
// a full import holds thousands of cases.
const FORUM_KEY = 'student-archive-forum-cases';
let forumCache = null; // { at, list } — per-instance cache, refreshed every minute

async function getForumCases() {
  if (forumCache && Date.now() - forumCache.at < 60000) return forumCache.list;
  let list;
  if (redis) list = Object.values((await redis.hgetall(FORUM_KEY)) || {});
  else list = Object.values((await loadDb()).forumCases || {});
  forumCache = { at: Date.now(), list };
  return list;
}

async function putForumCases(cases) {
  if (!cases.length) return;
  // Keep admin moderation (hidden flags) when a case is re-imported.
  const existing = new Map((await getForumCases()).map((c) => [c.id, c]));
  const merged = cases.map((c) => {
    const old = existing.get(c.id);
    return old && old.hidden ? { ...c, hidden: true, hiddenBy: old.hiddenBy, hiddenAt: old.hiddenAt } : c;
  });
  const entries = Object.fromEntries(merged.map((c) => [c.id, c]));
  if (redis) {
    await redis.hset(FORUM_KEY, entries);
  } else {
    const db = await loadDb();
    db.forumCases = { ...(db.forumCases || {}), ...entries };
    await saveDb(db);
  }
  forumCache = null;
}

const citationNumber = (c) => +((String(c.citation || '').match(/(\d+)\s*$/) || [])[1] || 0);
const newestFirst = (a, b) => (b.year || 0) - (a.year || 0) || citationNumber(b) - citationNumber(a)
  || String(b.id).localeCompare(String(a.id), undefined, { numeric: true });
const ACTIVE_STATUSES = ['Pending', 'In Session'];

async function allEntries(kind) {
  const db = await loadDb();
  return kind === 'cases' ? [...db.cases, ...(await getForumCases())] : db[kind];
}

const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(authRouter);

app.get('/api/options', wrap(async (req, res) => {
  // Imported cases can carry statuses beyond the defaults (e.g. "Accepted" on appeals).
  const seen = new Set((await allEntries('cases')).map((c) => c.status).filter(Boolean));
  const status = [...CASE_OPTIONS.status, ...[...seen].filter((s) => !CASE_OPTIONS.status.includes(s)).sort()];
  res.json({ cases: { ...CASE_OPTIONS, status } });
}));

// The few most recently active open cases, shown on the finder without searching.
app.get('/api/cases/active', wrap(async (req, res) => {
  const active = (await allEntries('cases'))
    .filter((c) => !c.hidden && ACTIVE_STATUSES.includes(c.status))
    .sort((a, b) => (b.activityAt || 0) - (a.activityAt || 0) || newestFirst(a, b))
    .slice(0, 3);
  res.json(active);
}));

// --- Forum sync ----------------------------------------------------------
const SYNC_OFF = 'Forum sync is switched off. Set SYNC_ENABLED=true in the environment once Democracy Craft staff have agreed.';

async function syncBatch() {
  const db = await loadDb();
  const state = db.sync || {};
  const result = await runSync({
    state,
    budgetMs: 45000,
    upsert: putForumCases,
    saveState: async (s) => {
      const fresh = await loadDb();
      fresh.sync = s;
      // The made-up example cases go once real cases have been imported.
      if ((await getForumCases()).length) fresh.cases = fresh.cases.filter((c) => !c.example);
      await saveDb(fresh);
    },
  });
  return { ...result, backfillDone: !!state.backfillDone, listings: state.listings };
}

// Daily Vercel cron job. Vercel sends "Authorization: Bearer <CRON_SECRET>".
app.get('/api/cron/sync', wrap(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized.' });
  if (process.env.SYNC_ENABLED !== 'true') return res.status(503).json({ error: SYNC_OFF });
  res.json(await syncBatch());
}));

// Admins can run a batch by hand (useful while the first full import is in progress).
app.post('/api/sync', requireAdmin, wrap(async (req, res) => {
  if (process.env.SYNC_ENABLED !== 'true') return res.status(503).json({ error: SYNC_OFF });
  res.json(await syncBatch());
}));

app.get('/api/sync', requireAdmin, wrap(async (req, res) => {
  const db = await loadDb();
  const forum = await getForumCases();
  const byCourt = {};
  for (const c of forum) byCourt[c.court] = (byCourt[c.court] || 0) + 1;
  res.json({
    enabled: process.env.SYNC_ENABLED === 'true',
    imported: forum.length,
    byCourt,
    ...(db.sync || {}),
  });
}));

// Diagnostics: fetch page 1 of a court forum and show what the parser made of it.
app.get('/api/sync/inspect', requireAdmin, wrap(async (req, res) => {
  if (process.env.SYNC_ENABLED !== 'true') return res.status(503).json({ error: SYNC_OFF });
  try {
    res.json(await inspect(String(req.query.court || 'district')));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}));

// --- Entries ---------------------------------------------------------------
for (const [kind, { clean, matches, required }] of Object.entries(KINDS)) {
  app.get(`/api/${kind}`, wrap(async (req, res) => {
    // Hidden (soft-deleted) entries are only visible to admins who ask for them.
    const showHidden = req.query.hidden === '1' && !!getAdmin(req);
    const items = (await allEntries(kind))
      .filter((it) => (!it.hidden || showHidden) && matches(it, req.query))
      .sort(newestFirst);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    res.set('X-Total-Count', String(items.length));
    res.json(items.slice(offset, offset + limit));
  }));

  app.get(`/api/${kind}/:id`, wrap(async (req, res) => {
    const item = (await allEntries(kind)).find((i) => String(i.id) === req.params.id);
    if (!item || (item.hidden && !getAdmin(req))) return res.status(404).json({ error: 'Not found.' });
    res.json(item);
  }));

  app.post(`/api/${kind}`, requireAdmin, wrap(async (req, res) => {
    const item = clean(req.body || {});
    if (!item) return res.status(400).json({ error: required });
    // Every new entry must point back to the forum post it came from.
    if (!item.link) return res.status(400).json({ error: 'A link to the forum post where this was found (starting with http) is required.' });
    const db = await loadDb();
    item.id = db[kind].reduce((m, i) => (Number.isInteger(i.id) ? Math.max(m, i.id) : m), 0) + 1;
    db[kind].push(item);
    await saveDb(db);
    res.status(201).json(item);
  }));

  // Admin moderation: hide (soft delete) or restore an entry.
  const setHidden = (hidden) => wrap(async (req, res) => {
    const forum = kind === 'cases' && req.params.id.startsWith('t');
    const db = await loadDb();
    const pool = forum ? await getForumCases() : db[kind];
    const found = pool.find((i) => String(i.id) === req.params.id);
    if (!found) return res.status(404).json({ error: 'Not found.' });
    const item = { ...found };
    if (hidden) {
      item.hidden = true;
      item.hiddenBy = getAdmin(req).name;
      item.hiddenAt = new Date().toISOString();
    } else {
      delete item.hidden; delete item.hiddenBy; delete item.hiddenAt;
    }
    if (forum) {
      const entry = { [item.id]: item };
      if (redis) await redis.hset(FORUM_KEY, entry);
      else { db.forumCases = { ...(db.forumCases || {}), ...entry }; await saveDb(db); }
      forumCache = null;
    } else {
      Object.assign(found, item);
      if (!hidden) { delete found.hidden; delete found.hiddenBy; delete found.hiddenAt; }
      await saveDb(db);
    }
    res.json(item);
  });
  app.delete(`/api/${kind}/:id`, requireAdmin, setHidden(true));
  app.post(`/api/${kind}/:id/restore`, requireAdmin, setHidden(false));
}

if (require.main === module) {
  app.listen(PORT, () => console.log(`Student Archive running at http://localhost:${PORT}`));
}

module.exports = app;
