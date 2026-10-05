// Class Tracker: a personal timetable and checklist, saved to the student's Discord login.
(() => {
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const COLOURS = ['#6b4a2b', '#3e5468', '#6e3434', '#4f6a3e', '#6a5a2e', '#5a4a6a', '#2f6260', '#7a4a3a'];
  const $ = (s) => document.querySelector(s);

  function el(tag, props = {}, ...kids) {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.filter((k) => k !== null && k !== undefined && k !== false));
    return n;
  }

  // --- storage: saved to the student's Discord login on the server ----------
  const LEGACY_KEY = 'classTracker'; // where earlier versions kept data in the browser
  let data = { classes: [], tasks: [], attended: {} };
  let state = 'loading'; // loading | out | in | error
  let me = null;
  let saveTimer = null;
  let saving = false;
  let dirty = false;

  function setStatus(text, warn = false) {
    const s = $('#trackerStatus');
    s.textContent = text;
    s.classList.toggle('warn', warn);
  }

  async function push(keepalive = false) {
    clearTimeout(saveTimer);
    if (state !== 'in' || saving || !dirty) return;
    saving = true;
    dirty = false;
    setStatus('Saving…');
    try {
      const res = await fetch('/api/tracker', {
        method: 'PUT', keepalive, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      });
      if (res.status === 401) { state = 'out'; showState(); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus(`Saved to your Discord account (${me.name}). Only you can see this.`);
    } catch {
      dirty = true;
      setStatus("Couldn't save your changes. They'll be saved again on your next change, or check your connection.", true);
    } finally {
      saving = false;
      if (dirty && !keepalive) saveTimer = setTimeout(push, 3000);
    }
  }

  // Changes are saved shortly after the last edit, so ticking several boxes sends one request.
  function save() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(push, 600);
  }
  addEventListener('pagehide', () => { if (dirty) push(true); });
  // After the Discord login round-trip, come back to this tab instead of the library.
  $('#trackerLoginBtn').addEventListener('click', () => {
    try { sessionStorage.setItem('afterLogin', '#tracker'); } catch { /* ignore */ }
  });

  async function init() {
    try {
      me = await (await fetch('/api/me')).json();
      if (!me.loggedIn) { state = 'out'; return; }
      const res = await fetch('/api/tracker');
      if (res.status === 401) { state = 'out'; return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved = await res.json();
      data = { classes: saved.classes || [], tasks: saved.tasks || [], attended: saved.attended || {} };
      state = 'in';
      // One-time move of a tracker kept in this browser by the earlier version.
      try {
        const local = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
        if (local && !data.classes.length && !data.tasks.length && (local.classes?.length || local.tasks?.length)) {
          data = { classes: local.classes || [], tasks: local.tasks || [], attended: local.attended || {} };
          dirty = true;
          await push();
        }
        if (local && !dirty) localStorage.removeItem(LEGACY_KEY);
      } catch { /* storage blocked: nothing to move */ }
      setStatus(`Saved to your Discord account (${me.name}). Only you can see this.`);
    } catch {
      state = 'error';
    }
  }

  function showState() {
    $('#trackerLogin').hidden = state !== 'out';
    $('#trackerBody').hidden = state !== 'in';
    if (state === 'loading') setStatus('Loading your tracker…');
    if (state === 'out') {
      setStatus('');
      $('#trackerLoginBtn').hidden = !(me && me.loginEnabled);
    }
    if (state === 'error') setStatus("Couldn't load your tracker. Please refresh the page.", true);
  }

  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const todayIndex = () => (new Date().getDay() + 6) % 7; // Monday = 0
  const todayKey = () => new Date().toISOString().slice(0, 10);
  const classById = (id) => data.classes.find((c) => c.id === id);
  const byStart = (a, b) => a.start.localeCompare(b.start);

  // --- timetable -------------------------------------------------------------
  function renderTimetable() {
    const box = $('#timetable');
    if (!data.classes.length) {
      box.replaceChildren(el('p', { className: 'muted', textContent: 'No classes yet. Add your first class under "My classes" and it will appear here.' }));
      return;
    }
    const today = todayIndex();
    box.replaceChildren(el('div', { className: 'week' }, ...DAYS.map((day, i) => {
      const classes = data.classes.filter((c) => c.days.includes(i)).sort(byStart);
      return el('div', { className: `day${i === today ? ' today' : ''}` },
        el('h3', { textContent: i === today ? `${day} · today` : day }),
        ...(classes.length ? classes.map((c) => slot(c, i === today)) : [el('p', { className: 'day-empty', textContent: 'Free' })]));
    })));
  }

  function slot(c, isToday) {
    const key = `${todayKey()}:${c.id}`;
    const card = el('div', { className: 'slot' },
      el('strong', { textContent: c.name }),
      el('span', { className: 'slot-time', textContent: `${c.start}–${c.end}` }),
      c.location ? el('span', { className: 'slot-room', textContent: c.location }) : null);
    card.style.setProperty('--c', c.colour);
    if (isToday) {
      const box = el('input', { type: 'checkbox', checked: !!data.attended[key] });
      box.addEventListener('change', () => {
        if (box.checked) data.attended[key] = true; else delete data.attended[key];
        save();
        card.classList.toggle('done', box.checked);
      });
      card.classList.toggle('done', box.checked);
      card.append(el('label', { className: 'attend' }, box, ' Attended'));
    }
    return card;
  }

  // --- checklist -------------------------------------------------------------
  function renderTasks() {
    const list = $('#taskList');
    const select = $('#taskForm').elements.classId;
    const chosen = select.value;
    select.replaceChildren(el('option', { value: '', textContent: 'General' }),
      ...data.classes.map((c) => el('option', { value: c.id, textContent: c.name })));
    select.value = classById(chosen) ? chosen : '';

    $('#clearDone').hidden = !data.tasks.some((t) => t.done);
    if (!data.tasks.length) {
      list.replaceChildren(el('p', { className: 'muted', textContent: 'Nothing to do yet. Add homework, readings or reminders above.' }));
      return;
    }
    const groups = [...data.classes.map((c) => ({ id: c.id, name: c.name, colour: c.colour })), { id: '', name: 'General', colour: '#8a7a62' }];
    const today = todayKey();
    list.replaceChildren(...groups.map((g) => {
      const tasks = data.tasks.filter((t) => (classById(t.classId) ? t.classId : '') === g.id)
        .sort((a, b) => a.done - b.done || (a.due || '9999').localeCompare(b.due || '9999'));
      if (!tasks.length) return null;
      const done = tasks.filter((t) => t.done).length;
      const group = el('div', { className: 'task-group' },
        el('div', { className: 'task-head' },
          el('strong', { textContent: g.name }),
          el('span', { textContent: `${done}/${tasks.length} done` })),
        el('div', { className: 'progress' }, el('span', { style: `width:${(done / tasks.length) * 100}%` })),
        el('ul', {}, ...tasks.map((t) => taskItem(t, today))));
      group.style.setProperty('--c', g.colour);
      return group;
    }).filter(Boolean));
  }

  function taskItem(t, today) {
    const box = el('input', { type: 'checkbox', checked: t.done });
    box.addEventListener('change', () => { t.done = box.checked; save(); renderTasks(); });
    const overdue = t.due && !t.done && t.due < today;
    return el('li', { className: t.done ? 'done' : '' },
      el('label', {}, box, el('span', { className: 'task-text', textContent: t.text })),
      t.due ? el('span', { className: `due${overdue ? ' overdue' : ''}`, textContent: overdue ? `overdue · ${t.due}` : `due ${t.due}` }) : null,
      el('button', {
        type: 'button', className: 'icon-btn', title: 'Delete task', textContent: '×',
        onclick: () => { data.tasks = data.tasks.filter((x) => x !== t); save(); renderTasks(); },
      }));
  }

  // --- classes ---------------------------------------------------------------
  function renderClasses() {
    const list = $('#classList');
    $('#classAdd').open = !data.classes.length || $('#classAdd').open;
    if (!data.classes.length) {
      list.replaceChildren(el('li', { className: 'muted', textContent: 'No classes added yet.' }));
      return;
    }
    list.replaceChildren(...[...data.classes].sort((a, b) => a.name.localeCompare(b.name)).map((c) => {
      const li = el('li', {},
        el('span', { className: 'dot' }),
        el('span', { className: 'class-info' },
          el('strong', { textContent: c.name }),
          el('span', { textContent: `${c.days.map((d) => DAYS[d]).join(', ')} · ${c.start}–${c.end}${c.location ? ` · ${c.location}` : ''}` })),
        el('button', {
          type: 'button', className: 'icon-btn', title: 'Remove class', textContent: '×',
          onclick: () => removeClass(c),
        }));
      li.style.setProperty('--c', c.colour);
      return li;
    }));
  }

  function removeClass(c) {
    const tasks = data.tasks.filter((t) => t.classId === c.id).length;
    if (!confirm(`Remove ${c.name}${tasks ? ` and its ${tasks} task${tasks === 1 ? '' : 's'}` : ''}?`)) return;
    data.classes = data.classes.filter((x) => x !== c);
    data.tasks = data.tasks.filter((t) => t.classId !== c.id);
    save();
    render();
  }

  // --- forms -------------------------------------------------------------------
  $('#classForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const days = [...f.querySelectorAll('input[name=days]:checked')].map((b) => +b.value);
    if (!days.length) { alert('Pick at least one day.'); return; }
    if (f.elements.end.value <= f.elements.start.value) { alert('The class must end after it starts.'); return; }
    data.classes.push({
      id: uid(),
      name: f.elements.name.value.trim(),
      days,
      start: f.elements.start.value,
      end: f.elements.end.value,
      location: f.elements.location.value.trim(),
      colour: COLOURS[data.classes.length % COLOURS.length],
    });
    save();
    f.reset();
    render();
  });

  $('#taskForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const text = f.elements.text.value.trim();
    if (!text) return;
    data.tasks.push({ id: uid(), text, classId: f.elements.classId.value, due: f.elements.due.value, done: false });
    save();
    f.elements.text.value = '';
    f.elements.due.value = '';
    renderTasks();
  });

  $('#clearDone').addEventListener('click', () => {
    data.tasks = data.tasks.filter((t) => !t.done);
    save();
    renderTasks();
  });

  function render() {
    showState();
    if (state !== 'in') return;
    renderTimetable();
    renderTasks();
    renderClasses();
  }

  const ready = init();
  window.renderTracker = () => { showState(); ready.then(render); };
  if (!$('#trackerView').hidden) window.renderTracker();
})();
