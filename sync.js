// Imports court cases from the Democracy Craft court forums.
//
// Only thread titles are read: every case thread is titled like
//   "Etco v. mvchrelle [2026] DCR 102"  with a prefix label such as "Lawsuit: Dismissed",
// which gives the parties, citation, court, year and status. Post contents are not copied;
// each case links back to its thread.
const cheerio = require('cheerio');

const FORUM_BASE = process.env.FORUM_BASE_URL || 'https://www.democracycraft.net';
const COURTS = [
  { key: 'district', name: 'District Court', code: 'DCR', path: process.env.FORUM_DISTRICT_PATH || '/forums/courts-district/' },
  { key: 'federal', name: 'Federal Court', code: 'FCR', path: process.env.FORUM_FEDERAL_PATH || '/forums/courts-federal/' },
  { key: 'supreme', name: 'Supreme Court', code: 'SCR', path: process.env.FORUM_SUPREME_PATH || '/forums/courts-supreme/' },
];
const USER_AGENT = 'StudentArchiveBot/1.0 (+https://student-archive-lilac.vercel.app; Democracy Craft case index)';
const RECENT_PAGES = 2; // pages re-read every run to pick up new cases and status changes
const REQUEST_GAP_MS = 1500; // be gentle with the forum

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CITATION = /\[(\d{4})\]\s*(DCR|FCR|SCR)\s*(\d+)/gi;

/** Turns a thread title + prefix label into case fields. Returns null for non-case threads. */
function parseTitle(title, prefix, court) {
  const citations = [...title.matchAll(CITATION)]
    .map((m) => ({ year: +m[1], code: m[2].toUpperCase(), num: +m[3], index: m.index }));
  if (!citations.length) return null;
  const own = citations.find((c) => c.code === court.code) || citations[citations.length - 1];

  // Everything before this court's citation names the case; for appeals that keeps the
  // lower-court citation, e.g. "In re [2025] FCR 123".
  const name = title.slice(0, own.index).replace(/[\s\-–—:,]+$/, '').trim();
  const [plaintiff, ...rest] = name.split(/\s+(?:v\.?|vs\.?)\s+/i);
  const [kind = '', status = ''] = prefix.split(':').map((s) => s.trim());

  return {
    plaintiff: plaintiff || name,
    defendant: rest.join(' v. '),
    citation: `[${own.year}] ${own.code} ${own.num}`,
    court: court.name,
    caseType: /^appeal/i.test(kind) || /^in re\b/i.test(name) ? 'Appeal' : '',
    status: kind && status ? status : '',
    year: own.year,
    laws: [],
    summary: '',
    arguments: '',
    verdict: '',
  };
}

/** Parses one XenForo forum listing page (its case threads, page count and sub-forums). */
function parseListing(html, court, listingPath = court.path) {
  const $ = cheerio.load(html);
  const cases = [];
  const skipped = [];
  let threads = 0;
  $('.structItem--thread').each((_, el) => {
    threads += 1;
    const item = $(el);
    const titleBox = item.find('.structItem-title').first();
    let link = titleBox.find('a[data-tp-primary="on"]').first();
    if (!link.length) link = titleBox.find('a').not('.labelLink').last();
    const href = link.attr('href') || '';
    const threadId = (href.match(/\.(\d+)\/?(?:$|[?#])/) || href.match(/\/(\d+)\/?$/) || [])[1];
    const title = link.text().trim();
    const parsed = threadId && parseTitle(title, titleBox.find('.label').first().text().trim(), court);
    if (!parsed) { skipped.push(title); return; }
    const latest = item.find('.structItem-latestDate').attr('data-time')
      || item.find('.structItem-cell--latest time').attr('data-time');
    const started = item.find('.structItem-startDate time').attr('data-time');
    cases.push({
      ...parsed,
      id: `t${threadId}`,
      title: parsed.defendant ? `${parsed.plaintiff} v. ${parsed.defendant}` : parsed.plaintiff,
      link: new URL(href, FORUM_BASE).href,
      source: 'forum',
      startedAt: started ? +started * 1000 : null,
      activityAt: latest ? +latest * 1000 : null,
    });
  });

  // Page count: the pager's numbers, or any link to ".../page-N" of this listing.
  const pages = $('.pageNav-main a').map((_, a) => parseInt($(a).text(), 10)).get();
  $('a[href*="page-"]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const m = href.match(/\/page-(\d+)/);
    if (m && href.includes(listingPath.replace(/\/$/, ''))) pages.push(+m[1]);
  });
  const known = pages.filter(Number.isInteger);
  const lastPage = known.length ? Math.max(...known) : null; // null = no pager found

  // Sub-forums (e.g. archives of closed cases) listed on the forum page.
  const subforums = new Set();
  $('.node-title a, .subNodeLink').each((_, a) => {
    const href = ($(a).attr('href') || '').replace(/^https?:\/\/[^/]+/, '');
    if (/^\/forums\/[^/?#]+\/?$/.test(href) && href !== listingPath) subforums.add(href.endsWith('/') ? href : `${href}/`);
  });

  return { cases, threads, skipped, lastPage, subforums: [...subforums] };
}

async function fetchListing(court, path, page) {
  const url = new URL(page > 1 ? `${path}page-${page}` : path, FORUM_BASE).href;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  // XenForo redirects pages past the end back to the last page.
  if (page > 1 && !res.url.includes(`page-${page}`)) {
    return { cases: [], threads: 0, skipped: [], lastPage: page - 1, subforums: [], pastEnd: true, url };
  }
  return { ...parseListing(await res.text(), court, path), url: res.url };
}

/** Fetches page 1 of one court forum and reports what the parser saw (admin diagnostics). */
async function inspect(courtKey) {
  const court = COURTS.find((c) => c.key === courtKey) || COURTS[0];
  const r = await fetchListing(court, court.path, 1);
  return {
    court: court.name, url: r.url, threadsOnPage: r.threads, casesParsed: r.cases.length,
    lastPage: r.lastPage, subforums: r.subforums,
    sampleCases: r.cases.slice(0, 5).map((c) => `${c.citation} ${c.status} ${c.title}`),
    skippedTitles: r.skipped.slice(0, 10),
  };
}

/**
 * Runs one sync batch within `budgetMs`. Each court forum and any sub-forums found inside it
 * (archives of closed cases, for example) is a "listing". Every run re-reads the newest pages
 * of each listing, then continues the one-time backfill of older pages where the last run
 * stopped. Progress is saved after every page, so a run cut off by the host loses nothing.
 */
async function runSync({ state, saveState, upsert, budgetMs = 45000 }) {
  const deadline = Date.now() + budgetMs;
  const timeLeft = () => Date.now() < deadline - 5000;
  const summary = { pages: 0, cases: 0, errors: [] };
  if (!state.listings) { // first run, or state from the older single-listing version
    state.listings = {};
    delete state.courts;
  }
  for (const court of COURTS) {
    if (!state.listings[court.path]) state.listings[court.path] = { court: court.key, nextPage: 1, done: false };
  }
  let first = true;

  async function read(path, page) {
    const listing = state.listings[path];
    const court = COURTS.find((c) => c.key === listing.court);
    if (!first) await sleep(REQUEST_GAP_MS);
    first = false;
    const result = await fetchListing(court, path, page);
    summary.pages += 1;
    summary.cases += result.cases.length;
    if (result.cases.length) await upsert(result.cases);
    if (result.lastPage) listing.lastPage = Math.max(listing.lastPage || 0, result.lastPage);
    for (const sub of result.subforums) {
      if (!state.listings[sub]) state.listings[sub] = { court: listing.court, nextPage: 1, done: false, parent: path };
    }
    return result;
  }

  // 1. Newest pages of every listing: new cases and status changes.
  for (const path of Object.keys(state.listings)) {
    const listing = state.listings[path];
    try {
      for (let page = 1; page <= RECENT_PAGES && timeLeft(); page += 1) {
        const r = await read(path, page);
        if (r.pastEnd || !r.threads || (listing.lastPage && page >= listing.lastPage)) break;
      }
      if (listing.nextPage <= RECENT_PAGES) listing.nextPage = RECENT_PAGES + 1;
    } catch (err) {
      summary.errors.push(`${path}: ${err.message}`);
    }
  }
  await saveState(state);

  // 2. Backfill older pages, listing by listing (new sub-forums join as they are found).
  for (let progressed = true; progressed && timeLeft();) {
    progressed = false;
    for (const path of Object.keys(state.listings)) {
      const listing = state.listings[path];
      while (!listing.done && timeLeft()) {
        if (listing.lastPage && listing.nextPage > listing.lastPage) { listing.done = true; break; }
        try {
          const r = await read(path, listing.nextPage);
          // An empty or past-the-end page means we have reached the oldest threads.
          if (r.pastEnd || !r.threads) listing.done = true; else listing.nextPage += 1;
          progressed = true;
        } catch (err) {
          summary.errors.push(`${path} page ${listing.nextPage}: ${err.message}`);
          break;
        }
        await saveState(state);
      }
    }
  }

  state.lastRun = { at: Date.now(), ...summary };
  state.backfillDone = Object.values(state.listings).every((l) => l.done);
  await saveState(state);
  return state.lastRun;
}

module.exports = { runSync, parseListing, parseTitle, inspect, COURTS };
