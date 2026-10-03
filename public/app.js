// Admin "add entry" form fields: [name, label, kind] where kind is 'text', 'long' or 'select'.
const SCHEMAS = {
  records: [
    ['title', 'Title'], ['author', 'Author'], ['type', 'Type (paper, book, source…)'],
    ['year', 'Year'], ['tags', 'Tags (comma separated)'], ['summary', 'Summary', 'long'],
    ['link', 'Link to the forum post where it was found'],
  ],
  cases: [
    ['plaintiff', 'Plaintiff (or "In re …" for appeals)'], ['defendant', 'Defendant'],
    ['citation', 'Citation, e.g. [2026] DCR 1'], ['court', 'Court', 'select'],
    ['caseType', 'Case type', 'select'], ['status', 'Status', 'select'], ['year', 'Year'],
    ['laws', 'Laws cited (comma separated)'], ['summary', 'Facts', 'long'],
    ['arguments', 'Arguments', 'long'], ['verdict', 'Verdict & reasoning', 'long'],
    ['link', 'Link to the forum thread'],
  ],
};
const REQUIRED = { records: 'title', cases: 'plaintiff' };

let tab = 'records';
let admin = false;
let options = { cases: {} };
const $ = (s) => document.querySelector(s);
const results = $('#results');
const search = $('#search');
const tagInput = $('#tag');
const caseSearch = $('#caseSearch');

function el(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter((k) => k !== null && k !== undefined));
  return n;
}

function adminControls(entry, it) {
  if (!admin) return;
  entry.classList.toggle('is-hidden', !!it.hidden);
  entry.append(el('div', {}, el('button', {
    className: it.hidden ? 'admin-btn restore' : 'admin-btn',
    type: 'button',
    textContent: it.hidden ? 'Restore' : 'Hide entry',
    onclick: () => moderate(it),
  })));
}

function recordCard(it) {
  const meta = [it.author, it.type, it.year].filter(Boolean).join(' · ');
  return el('article', { className: 'entry' },
    el('h2', { textContent: it.title }),
    el('p', { className: 'meta', textContent: meta }),
    it.summary ? el('p', { textContent: it.summary }) : null,
    ...it.tags.map((t) => el('button', {
      className: 'tag', textContent: t, type: 'button',
      onclick: () => { tagInput.value = t; $('#bookDialog').close(); load(); },
    })),
    forumLink(it, 'View the forum post ↗'),
  );
}

function forumLink(it, text) {
  if (!it.link) return null;
  return el('p', {}, el('a', { className: 'forum-link', href: it.link, target: '_blank', rel: 'noopener noreferrer', textContent: text }));
}

function caseCard(it) {
  const meta = [it.court, it.caseType, it.year].filter(Boolean).join(' · ');
  return el('article', { className: 'entry case' },
    el('div', { className: 'case-head' },
      el('h2', {}, el('a', { href: `case.html?id=${encodeURIComponent(it.id)}`, textContent: it.title })),
      it.status ? el('span', { className: `status status-${it.status.toLowerCase().replace(/\s+/g, '-')}`, textContent: it.status }) : null),
    el('p', { className: 'meta' },
      it.citation ? el('span', { className: 'citation', textContent: it.citation }) : null,
      it.citation && meta ? ' · ' : '', meta,
      it.example ? el('span', { className: 'example', textContent: 'Example' }) : null),
    it.summary ? el('p', { className: 'excerpt', textContent: it.summary }) : null,
    ...it.laws.map((l) => el('button', {
      className: 'tag', textContent: l, type: 'button', title: 'Find cases citing this law',
      onclick: () => { caseSearch.elements.law.value = l; $('#bookDialog').close(); load(); },
    })),
    el('p', { className: 'case-links' },
      el('a', { className: 'open-case', href: `case.html?id=${encodeURIComponent(it.id)}`, textContent: 'Open case file →' }),
      it.link ? el('a', { className: 'forum-link', href: it.link, target: '_blank', rel: 'noopener noreferrer', textContent: 'Forum thread ↗' }) : null),
  );
}

const PAGE_SIZE = 20;
let currentPage = 1;

// Page links: first, last, and two either side of the current page, with gaps as "…".
function pageList(page, pages) {
  const out = [];
  for (let n = 1; n <= pages; n += 1) {
    if (n === 1 || n === pages || Math.abs(n - page) <= 2) out.push(n);
    else if (out[out.length - 1] !== '…') out.push('…');
  }
  return out;
}

function renderPager(page, total) {
  const pager = $('#pager');
  const pages = Math.ceil(total / PAGE_SIZE);
  pager.hidden = pages <= 1;
  if (pager.hidden) return pager.replaceChildren();
  const go = (n) => () => { load(n); results.scrollIntoView({ block: 'start' }); };
  pager.replaceChildren(
    el('button', { type: 'button', className: 'page-btn', textContent: '‹ Prev', disabled: page <= 1, onclick: go(page - 1) }),
    ...pageList(page, pages).map((n) => (n === '…'
      ? el('span', { className: 'page-gap', textContent: '…' })
      : el('button', {
        type: 'button', className: n === page ? 'page-btn current' : 'page-btn', textContent: String(n),
        disabled: n === page, onclick: go(n),
      }))),
    el('button', { type: 'button', className: 'page-btn', textContent: 'Next ›', disabled: page >= pages, onclick: go(page + 1) }),
  );
}

function render(items, total, page) {
  results.replaceChildren();
  currentPage = page;
  if (tab === 'cases') {
    const pages = Math.ceil(total / PAGE_SIZE);
    $('#caseCount').textContent = `${total} case${total === 1 ? '' : 's'} found${pages > 1 ? ` · page ${page} of ${pages}` : ''}`;
  }
  renderPager(page, total);
  if (!total) {
    results.append(el('p', { className: 'empty', textContent: 'Nothing found in the archive.' }));
    return;
  }
  if (view === 'books') {
    results.append(bookshelf(items));
    return;
  }
  for (const it of items) {
    const entry = tab === 'cases' ? caseCard(it) : recordCard(it);
    adminControls(entry, it);
    results.append(entry);
  }
}

// --- Books / list view toggle (remembered per browser) -----------------------
let view = 'books';
try { if (localStorage.getItem('view') === 'list') view = 'list'; } catch { /* storage unavailable */ }

function updateViewToggle() {
  document.querySelectorAll('#viewToggle button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  $('#shelfLegend').hidden = !(tab === 'cases' && view === 'books');
}

document.querySelectorAll('#viewToggle button').forEach((b) => b.addEventListener('click', () => {
  if (view === b.dataset.view) return;
  view = b.dataset.view;
  try { localStorage.setItem('view', view); } catch { /* storage unavailable */ }
  updateViewToggle();
  load(currentPage);
}));

// --- Bookshelf view for the Library Database --------------------------------
// Each record is a book spine; its colour, width and height come from its id so a
// book always looks the same. Clicking a spine opens the full record.
const SPINE_COLOURS = ['#6b4a2b', '#7d5a3a', '#5a4632', '#8b6b47', '#4f3b2a', '#76603f', '#64503b', '#8a5f3c'];

function spineLook(it) {
  let h = 2166136261; // FNV-1a, so similar titles still get different looks
  for (const ch of `${it.id}${it.title}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return { colour: SPINE_COLOURS[h % SPINE_COLOURS.length], width: 2.6 + (h % 5) * 0.2, height: 9.5 + ((h >> 3) % 6) * 0.45 };
}

// Bottom of the spine: the year for library records, the short citation (e.g. "DCR 102") for cases.
function spineFoot(it) {
  if (tab !== 'cases') return it.year ? String(it.year) : '';
  return String(it.citation || '').replace(/^\[\d{4}\]\s*/, '') || (it.year ? String(it.year) : '');
}

// One long shelf that scrolls sideways. The plank under the books is the scroller:
// a slider kept in step with the shelf's scroll position (works with mouse, touch and keys).
function bookshelf(items) {
  const shelf = el('div', { className: 'shelf' }, ...items.map(spineSlot));
  const scroller = el('input', { type: 'range', className: 'shelf-scroller', min: 0, max: 1000, value: 0, step: 1 });
  scroller.setAttribute('aria-label', 'Scroll the shelf');
  const maxScroll = () => shelf.scrollWidth - shelf.clientWidth;
  const sync = () => {
    const max = maxScroll();
    scroller.disabled = max <= 1;
    scroller.value = max > 1 ? Math.round((shelf.scrollLeft / max) * 1000) : 0;
  };
  shelf.addEventListener('scroll', sync, { passive: true });
  scroller.addEventListener('input', () => { shelf.scrollLeft = (scroller.value / 1000) * maxScroll(); });
  new ResizeObserver(sync).observe(shelf);
  // The diamond book logo from the title sits at each end of the plank.
  const logo = () => {
    const icon = document.querySelector('.title .book').cloneNode(true);
    icon.setAttribute('class', 'book plank-logo');
    return icon;
  };
  return el('div', { className: 'shelf-wrap' }, shelf, el('div', { className: 'plank' }, logo(), scroller, logo()));
}

function spineSlot(it) {
  const look = spineLook(it);
  const spine = el('button', {
    type: 'button',
    className: `book-spine${it.hidden ? ' is-hidden' : ''}`,
    title: [it.title, it.author, it.citation, it.status].filter(Boolean).join(' — '),
    onclick: () => openBook(it),
  },
  el('span', { className: 'spine-title', textContent: it.title }),
  spineFoot(it) ? el('span', { className: 'spine-year', textContent: spineFoot(it) }) : null);
  if (tab === 'cases' && it.status) spine.dataset.status = it.status.toLowerCase().replace(/\s+/g, '-');
  spine.style.setProperty('--spine', look.colour);
  spine.style.width = `${look.width}rem`;
  spine.style.height = `${look.height}rem`;
  return el('div', { className: 'book-slot' }, spine);
}

function openBook(it) {
  const dialog = $('#bookDialog');
  const card = tab === 'cases' ? caseCard(it) : recordCard(it);
  adminControls(card, it);
  $('#bookDialogBody').replaceChildren(card);
  dialog.showModal();
}

function query() {
  if (tab === 'records') return new URLSearchParams({ q: search.value, tag: tagInput.value });
  const params = new URLSearchParams();
  for (const [k, v] of new FormData(caseSearch)) if (String(v).trim()) params.set(k, String(v).trim());
  return params;
}

let loadSeq = 0;
async function load(page = 1) {
  const seq = ++loadSeq;
  const params = query();
  params.set('limit', PAGE_SIZE);
  params.set('offset', (page - 1) * PAGE_SIZE);
  try {
    const res = await fetch(`/api/${tab}?${params}`);
    const data = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(data)) throw new Error((data && data.error) || `Server error (${res.status})`);
    if (seq !== loadSeq) return; // a newer request has started; ignore this one
    const header = parseInt(res.headers.get('X-Total-Count'), 10);
    const total = Number.isInteger(header) ? header : data.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > pages) return load(pages); // e.g. the last entry on the last page was hidden
    render(data, total, page);
  } catch (err) {
    if (seq !== loadSeq) return;
    if (tab === 'cases') $('#caseCount').textContent = '';
    $('#pager').hidden = true;
    results.replaceChildren(el('p', { className: 'empty', textContent: `Could not load the archive: ${err.message}` }));
  }
}

// Wait until typing pauses before searching, instead of sending a request per keystroke.
let typingTimer;
function loadSoon() {
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => load(), 250);
}

async function loadActive() {
  const box = $('#activeCases');
  try {
    const items = await (await fetch('/api/cases/active')).json();
    if (!Array.isArray(items) || !items.length) { box.hidden = true; return; }
    $('#activeList').replaceChildren(...items.map((it) => el('a', { className: 'active-card', href: `case.html?id=${encodeURIComponent(it.id)}` },
      el('span', { className: `status status-${it.status.toLowerCase().replace(/\s+/g, '-')}`, textContent: it.status }),
      el('strong', { textContent: it.title }),
      el('span', { className: 'meta', textContent: [it.citation, it.court].filter(Boolean).join(' · ') }))));
    box.hidden = tab !== 'cases';
  } catch { box.hidden = true; }
}

const ago = (t) => {
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
};

async function loadSyncStatus() {
  const panel = $('#syncPanel');
  panel.hidden = !(admin && tab === 'cases');
  if (panel.hidden) return;
  try {
    const s = await (await fetch('/api/sync')).json();
    const courts = Object.entries(s.byCourt || {}).map(([c, n]) => `${c.replace(' Court', '')} ${n}`).join(', ');
    const parts = [s.enabled ? `Forum sync on · ${s.imported} cases imported${courts ? ` (${courts})` : ''}` : 'Forum sync is off (set SYNC_ENABLED=true)'];
    if (s.listings) parts.push(`${Object.keys(s.listings).length} forum sections`);
    if (s.lastRun) parts.push(`last run ${ago(s.lastRun.at)}`);
    if (s.enabled && !s.backfillDone) parts.push('first full import still in progress');
    if (s.lastRun && s.lastRun.errors && s.lastRun.errors.length) parts.push(`errors: ${s.lastRun.errors.join('; ')}`);
    $('#syncStatus').textContent = parts.join(' · ');
    $('#syncNow').disabled = !s.enabled;
  } catch { $('#syncStatus').textContent = 'Could not read sync status.'; }
}

$('#syncNow').addEventListener('click', async () => {
  const btn = $('#syncNow');
  btn.disabled = true;
  btn.textContent = 'Syncing… (up to a minute)';
  try {
    const res = await fetch('/api/sync', { method: 'POST' });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error || `Sync failed (${res.status})`);
  } finally {
    btn.textContent = 'Sync court forums now';
    btn.disabled = false;
    loadSyncStatus(); loadActive(); load();
  }
});

async function moderate(it) {
  if (!it.hidden && !confirm(`Hide "${it.title}" from the public archive?`)) return;
  const res = await fetch(it.hidden ? `/api/${tab}/${it.id}/restore` : `/api/${tab}/${it.id}`, {
    method: it.hidden ? 'POST' : 'DELETE',
  });
  if (res.ok) { $('#bookDialog').close(); load(currentPage); } else alert((await res.json()).error);
}

function isDark() { return document.documentElement.dataset.theme === 'dark'; }

function setTheme(dark) {
  const root = document.documentElement;
  root.classList.add('theme-fade');
  setTimeout(() => root.classList.remove('theme-fade'), 300);
  if (dark) document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch { /* storage unavailable */ }
}

async function loadAccount() {
  const box = $('#account');
  try {
    const me = await (await fetch('/api/me')).json();
    admin = me.admin;
    $('#addBox').hidden = !admin;
    box.replaceChildren();
    if (me.loggedIn) {
      const themeItem = el('button', {
        className: 'menu-item', type: 'button',
        onclick: () => { setTheme(!isDark()); themeItem.textContent = isDark() ? 'Light mode' : 'Dark mode'; },
      });
      themeItem.textContent = isDark() ? 'Light mode' : 'Dark mode';
      const menu = el('div', { className: 'menu' },
        el('div', { className: 'menu-user' },
          el('span', { className: 'name', textContent: me.name }),
          ...(admin ? [el('span', { className: 'badge', textContent: 'Admin' })] : [])),
        themeItem,
        el('button', {
          className: 'menu-item', type: 'button', textContent: 'Log out',
          onclick: async () => { await fetch('/auth/logout', { method: 'POST' }); location.reload(); },
        }));
      const toggle = el('button', {
        className: 'avatar-btn', type: 'button', title: 'Account menu',
        onclick: (e) => { e.stopPropagation(); menu.classList.toggle('open'); toggle.setAttribute('aria-expanded', String(menu.classList.contains('open'))); },
      }, el('img', { src: me.avatarUrl, alt: `${me.name}'s Discord avatar`, referrerPolicy: 'no-referrer' }));
      toggle.setAttribute('aria-haspopup', 'true');
      toggle.setAttribute('aria-expanded', 'false');
      const close = () => { menu.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); };
      document.addEventListener('click', (e) => { if (!box.contains(e.target)) close(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
      box.append(toggle, menu);
    } else {
      const themeBtn = el('button', { className: 'btn', type: 'button' });
      const label = () => { themeBtn.textContent = isDark() ? 'Light mode' : 'Dark mode'; };
      themeBtn.onclick = () => { setTheme(!isDark()); label(); };
      label();
      box.append(el('div', { className: 'account-out' },
        themeBtn,
        ...(me.loginEnabled ? [el('a', { className: 'btn', href: '/auth/login', textContent: 'Log in with Discord' })] : [])));
    }
  } catch { /* leave account area empty */ }
  load();
  loadSyncStatus();
}

function selectFor(name, blank) {
  return el('select', { name },
    el('option', { value: '', textContent: blank }),
    ...(options[tab]?.[name] || []).map((o) => el('option', { value: o, textContent: o })));
}

function buildForm() {
  $('#form').replaceChildren(
    ...SCHEMAS[tab].map(([name, label, kind]) => el('label', {},
      label,
      kind === 'select' ? selectFor(name, '—')
        : el(kind === 'long' ? 'textarea' : 'input', { name, rows: 4, required: name === REQUIRED[tab] || name === 'link', ...(name === 'link' ? { type: 'url', placeholder: 'https://www.democracycraft.net/threads/…' } : {}) }),
    )),
    el('button', { type: 'submit', textContent: 'Add to archive' }),
  );
}

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  const res = await fetch(`/api/${tab}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) { e.target.reset(); load(); } else { alert((await res.json()).error); }
});

function showTab(name) {
  tab = name;
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
  $('#recordSearch').hidden = name !== 'records';
  caseSearch.hidden = name !== 'cases';
  updateViewToggle();
  $('#activeCases').hidden = name !== 'cases' || !$('#activeList').childElementCount;
  search.value = ''; tagInput.value = ''; caseSearch.reset();
  try { history.replaceState(null, '', name === 'cases' ? '#cases' : location.pathname); } catch { /* ignore */ }
  buildForm(); load(); loadSyncStatus();
}

document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
search.addEventListener('input', loadSoon);
tagInput.addEventListener('input', loadSoon);
caseSearch.addEventListener('input', loadSoon);
caseSearch.addEventListener('submit', (e) => { e.preventDefault(); load(); });
caseSearch.addEventListener('reset', () => setTimeout(() => load()));

(async () => {
  try { options = await (await fetch('/api/options')).json(); } catch { /* selects stay empty */ }
  for (const name of ['court', 'caseType', 'status']) {
    const select = caseSearch.elements[name];
    for (const o of options.cases[name] || []) select.append(el('option', { value: o, textContent: o }));
  }
  if (location.hash === '#cases') showTab('cases'); else { buildForm(); updateViewToggle(); }
  loadAccount();
  loadActive();
})();

$('#bookDialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }); // click outside
$('#bookClose').addEventListener('click', () => $('#bookDialog').close());
