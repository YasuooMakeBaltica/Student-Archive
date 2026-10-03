const $ = (s) => document.querySelector(s);

function el(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter((k) => k !== null && k !== undefined && k !== false));
  return n;
}

function section(heading, text, empty) {
  return el('section', { className: 'case-section' },
    el('h2', { textContent: heading }),
    text ? el('p', { textContent: text }) : el('p', { className: 'muted', textContent: empty }));
}

function row(label, value) {
  return value ? [el('dt', { textContent: label }), el('dd', {}, value)] : [];
}

(async () => {
  const id = new URLSearchParams(location.search).get('id');
  const body = $('#caseBody');
  try {
    const res = await fetch(`/api/cases/${encodeURIComponent(id || '')}`);
    if (!res.ok) throw new Error('not found');
    const c = await res.json();
    document.title = `${c.title} — Student Archive`;
    $('#caseTitle').textContent = c.title;
    $('#caseCitation').textContent = c.citation;
    body.replaceChildren(...[
      c.example ? el('p', { className: 'notice', textContent: 'Example case: a made-up scenario for study, not a real ruling of the Redmont courts.' }) : null,
      el('dl', { className: 'case-details' },
        ...row('Plaintiff', c.plaintiff),
        ...row('Defendant', c.defendant),
        ...row('Court', c.court),
        ...row('Case type', c.caseType),
        ...row('Status', c.status),
        ...row('Year', c.year ? String(c.year) : ''),
        ...row('Laws cited', c.laws.length ? c.laws.join(', ') : '')),
      section('Facts', c.summary, 'No facts recorded.'),
      section('Arguments', c.arguments, 'No arguments recorded.'),
      section('Verdict', c.verdict, c.status === 'Pending' || c.status === 'In Session' ? 'Awaiting verdict.' : 'No verdict recorded.'),
      c.link ? el('p', {}, el('a', { href: c.link, target: '_blank', rel: 'noopener noreferrer', textContent: 'Read the original case thread ↗' })) : null,
    ].filter(Boolean));
  } catch {
    $('#caseTitle').textContent = 'Case not found';
    body.replaceChildren(el('p', { className: 'empty', textContent: 'This case file does not exist or has been removed.' }));
  }
})();
