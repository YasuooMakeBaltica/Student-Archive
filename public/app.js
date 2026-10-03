const SCHEMAS = {
  records: [
    ['title', 'Title'], ['author', 'Author'], ['type', 'Type (paper, book, source…)'],
    ['year', 'Year'], ['tags', 'Tags (comma separated)'], ['summary', 'Summary', true],
  ],
  cases: [
    ['title', 'Title'], ['category', 'Category'], ['year', 'Year'],
    ['tags', 'Tags (comma separated)'], ['summary', 'Summary', true], ['outcome', 'Outcome', true],
  ],
};

let tab = 'records';
let admin = false;
const $ = (s) => document.querySelector(s);
const results = $('#results');
const search = $('#search');
const tagInput = $('#tag');

function el(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter((k) => k !== null && k !== undefined));
  return n;
}

function render(items) {
  results.replaceChildren();
  if (!items.length) {
    results.append(el('p', { className: 'empty', textContent: 'Nothing found in the archive.' }));
    return;
  }
  for (const it of items) {
    const meta = [it.author, it.type, it.category, it.year].filter(Boolean).join(' · ');
    const entry = el('article', { className: 'entry' },
      el('h2', { textContent: it.title }),
      el('p', { className: 'meta', textContent: meta }),
      it.summary ? el('p', { textContent: it.summary }) : null,
      it.outcome ? el('p', {}, el('strong', { textContent: 'Outcome: ' }), it.outcome) : null,
      ...it.tags.map((t) => el('button', {
        className: 'tag', textContent: t, type: 'button',
        onclick: () => { tagInput.value = t; load(); },
      })),
    );
    if (admin) {
      entry.classList.toggle('is-hidden', !!it.hidden);
      entry.append(el('div', {}, el('button', {
        className: it.hidden ? 'admin-btn restore' : 'admin-btn',
        type: 'button',
        textContent: it.hidden ? 'Restore' : 'Hide entry',
        onclick: () => moderate(it),
      })));
    }
    results.append(entry);
  }
}

async function load() {
  const params = new URLSearchParams({ q: search.value, tag: tagInput.value });
  if (admin && $('#showHidden').checked) params.set('hidden', '1');
  try {
    const res = await fetch(`/api/${tab}?${params}`);
    render(await res.json());
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

async function loadAccount() {
  const box = $('#account');
  try {
    const me = await (await fetch('/api/me')).json();
    admin = me.admin;
    $('#hiddenToggle').hidden = !admin;
    box.replaceChildren();
    if (admin) {
      box.append(`Admin: ${me.name} · `, el('button', {
        type: 'button', textContent: 'Log out',
        onclick: async () => { await fetch('/auth/logout', { method: 'POST' }); location.reload(); },
      }));
    } else if (me.loginEnabled) {
      box.append(el('a', { href: '/auth/login', textContent: 'Admin login with Discord' }));
    }
  } catch { /* leave account area empty */ }
  load();
}

function buildForm() {
  const form = $('#form');
  form.replaceChildren(
    ...SCHEMAS[tab].map(([name, label, long]) => el('label', {},
      label,
      el(long ? 'textarea' : 'input', { name, rows: 3, required: name === 'title' }),
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

document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => {
  tab = b.dataset.tab;
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('active', x === b));
  search.value = ''; tagInput.value = '';
  buildForm(); load();
}));
search.addEventListener('input', load);
tagInput.addEventListener('input', load);
$('#showHidden').addEventListener('change', load);

buildForm();
loadAccount();
