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

/** Parses one XenForo forum listing page. */
function parseListing(html, court) {
  const $ = cheerio.load(html);
  const cases = [];
  $('.structItem--thread').each((_, el) => {
    const item = $(el);
    const titleBox = item.find('.structItem-title').first();
    let link = titleBox.find('a[data-tp-primary="on"]').first();
    if (!link.length) link = titleBox.find('a').not('.labelLink').last();
    const href = link.attr('href') || '';
    const threadId = (href.match(/\.(\d+)\/?(?:$|[?#])/) || href.match(/\/(\d+)\/?$/) || [])[1];
    if (!threadId) return;
    const parsed = parseTitle(link.text().trim(), titleBox.find('.label').first().text().trim(), court);
    if (!parsed) return;
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
  const pages = $('.pageNav-main a').map((_, a) => parseInt($(a).text(), 10)).get().filter(Number.isInteger);
  return { cases, lastPage: pages.length ? Math.max(...pages) : 1 };
}

async function fetchPage(court, page) {
  const url = new URL(page > 1 ? `${court.path}page-${page}` : court.path, FORUM_BASE).href;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  // XenForo redirects pages past the end back to the last page.
  if (page > 1 && !res.url.includes(`page-${page}`)) return { cases: [], lastPage: page - 1 };
  return parseListing(await res.text(), court);
}

/**
 * Runs one sync batch within `budgetMs`. Re-reads the newest pages of each court, then
 * continues the one-time backfill of older pages where the previous run stopped.
 * Progress is saved after every page, so a run cut off by the host loses nothing.
 */
async function runSync({ state, saveState, upsert, budgetMs = 45000 }) {
  const deadline = Date.now() + budgetMs;
  const timeLeft = () => Date.now() < deadline - 5000;
  state.courts = state.courts || {};
  const summary = { pages: 0, cases: 0, errors: [] };
  let first = true;

  async function readPage(court, page) {
    if (!first) await sleep(REQUEST_GAP_MS);
    first = false;
    const result = await fetchPage(court, page);
    summary.pages += 1;
    summary.cases += result.cases.length;
    if (result.cases.length) await upsert(result.cases);
    return result;
  }

  for (const court of COURTS) {
    const cs = (state.courts[court.key] = state.courts[court.key] || { nextPage: RECENT_PAGES + 1, done: false });
    try {
      for (let page = 1; page <= RECENT_PAGES && timeLeft(); page += 1) {
        const { lastPage } = await readPage(court, page);
        cs.lastPage = lastPage;
        if (page >= lastPage) break;
      }
    } catch (err) {
      summary.errors.push(`${court.name}: ${err.message}`);
    }
  }

  for (const court of COURTS) {
    const cs = state.courts[court.key];
    while (!cs.done && timeLeft()) {
      if (cs.lastPage && cs.nextPage > cs.lastPage) { cs.done = true; break; }
      try {
        const { cases, lastPage } = await readPage(court, cs.nextPage);
        cs.lastPage = Math.max(cs.lastPage || 0, lastPage);
        if (!cases.length) cs.done = true; else cs.nextPage += 1;
      } catch (err) {
        summary.errors.push(`${court.name} page ${cs.nextPage}: ${err.message}`);
        break;
      }
      await saveState(state);
    }
  }

  state.lastRun = { at: Date.now(), ...summary };
  state.backfillDone = COURTS.every((c) => state.courts[c.key] && state.courts[c.key].done);
  await saveState(state);
  return state.lastRun;
}

module.exports = { runSync, parseListing, parseTitle, COURTS };
