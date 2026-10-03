// Admin "add entry" form fields: [name, label, kind] where kind is 'text', 'long' or 'select'.
const SCHEMAS = {
  records: [
    ['title', 'Title'], ['author', 'Author'], ['type', 'Type (paper, book, source…)'],
    ['year', 'Year'], ['tags', 'Tags (comma separated)'], ['summary', 'Summary', 'long'],
  ],
  cases: [
    ['plaintiff', 'Plaintiff (or "In re …" for appeals)'], ['defendant', 'Defendant'],
    ['citation', 'Citation, e.g. [2026] DCR 1'], ['court', 'Court', 'select'],
    ['caseType', 'Case type', 'select'], ['status', 'Status', 'select'], ['year', 'Year'],
    ['laws', 'Laws cited (comma separated)'], ['summary', 'Facts', 'long'],
    ['arguments', 'Arguments', 'long'], ['verdict', 'Verdict & reasoning', 'long'],
    ['link', 'Link to forum thread'],
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
      onclick: () => { tagInput.value = t; load(); },
    })),
  );
}

function caseCard(it) {
  const meta = [it.court, it.caseType, it.year].filter(Boolean).join(' · ');
  return el('article', { className: 'entry case' },
    el('div', { className: 'case-head' },
      el('h2', {}, el('a', { href: `case.html?id=${it.id}`, textContent: it.title })),
      it.status ? el('span', { className: `status status-${it.status.toLowerCase().replace(/\s+/g, '-')}`, textContent: it.status }) : null),
    el('p', { className: 'meta' },
      it.citation ? el('span', { className: 'citation', textContent: it.citation }) : null,
      it.citation && meta ? ' · ' : '', meta,
      it.example ? el('span', { className: 'example', textContent: 'Example' }) : null),
    it.summary ? el('p', { className: 'excerpt', textContent: it.summary }) : null,
    ...it.laws.map((l) => el('button', {
      className: 'tag', textContent: l, type: 'button', title: 'Find cases citing this law',
      onclick: () => { caseSearch.elements.law.value = l; load(); },
    })),
    el('p', {}, el('a', { className: 'open-case', href: `case.html?id=${it.id}`, textContent: 'Open case file →' })),
  );
}

function render(items) {
  results.replaceChildren();
  if (tab === 'cases') $('#caseCount').textContent = `${items.length} case${items.length === 1 ? '' : 's'} found`;
  if (!items.length) {
    results.append(el('p', { className: 'empty', textContent: 'Nothing found in the archive.' }));
    return;
  }
  for (const it of items) {
    const entry = tab === 'cases' ? caseCard(it) : recordCard(it);
    adminControls(entry, it);
    results.append(entry);
  }
}

function query() {
  if (tab === 'records') return new URLSearchParams({ q: search.value, tag: tagInput.value });
  const params = new URLSearchParams();
  for (const [k, v] of new FormData(caseSearch)) if (String(v).trim()) params.set(k, String(v).trim());
  return params;
}

let loadSeq = 0;
async function load() {
  const seq = ++loadSeq;
  try {
    const res = await fetch(`/api/${tab}?${query()}`);
    const items = await res.json();
    if (seq === loadSeq) render(items); // ignore responses that arrive out of order
  } catch {
    results.replaceChildren(el('p', { className: 'empty', textContent: 'Could not reach the archive.' }));
  }
}

async function moderate(it) {
  if (!it.hidden && !confirm(`Hide "${it.title}" from the public archive?`)) return;
  const res = await fetch(it.hidden ? `/api/${tab}/${it.id}/restore` : `/api/${tab}/${it.id}`, {
    method: it.hidden ? 'POST' : 'DELETE',
  });
  if (res.ok) load(); else alert((await res.json()).error);
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
        : el(kind === 'long' ? 'textarea' : 'input', { name, rows: 4, required: name === REQUIRED[tab] }),
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
  search.value = ''; tagInput.value = ''; caseSearch.reset();
  try { history.replaceState(null, '', name === 'cases' ? '#cases' : location.pathname); } catch { /* ignore */ }
  buildForm(); load();
}

document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
search.addEventListener('input', load);
tagInput.addEventListener('input', load);
caseSearch.addEventListener('input', load);
caseSearch.addEventListener('submit', (e) => { e.preventDefault(); load(); });
caseSearch.addEventListener('reset', () => setTimeout(load));

(async () => {
  try { options = await (await fetch('/api/options')).json(); } catch { /* selects stay empty */ }
  for (const name of ['court', 'caseType', 'status']) {
    const select = caseSearch.elements[name];
    for (const o of options.cases[name] || []) select.append(el('option', { value: o, textContent: o }));
  }
  if (location.hash === '#cases') showTab('cases'); else buildForm();
  loadAccount();
})();
