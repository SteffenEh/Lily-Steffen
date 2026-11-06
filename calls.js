// =============================================================
// Lily & Steffen – Call-Planer
// Nutzt aus app.js/questions.js: sb, me, partner, COLORS, cfg, $, toast, sendPush, switchTab, el
// =============================================================

const TZ = { steffen: 'America/Chicago', lily: 'Europe/Berlin' };
const AUS = 'America/Chicago';
const MUC = 'Europe/Berlin';

const cState = {
  calls: [],
  editing: null,   // null = Formular zu; {} = neuer Termin; Termin-Objekt = bearbeiten
  token: null,     // geheimer Kalender-Link
  confirmDelete: null
};

// ---------- Zeitzonen-Helfer (ohne Zusatzbibliothek) ----------
function tzOffsetMs(ts, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(ts));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - ts;
}

// "2026-11-08" + "12:00" in Zeitzone tz → echter Zeitpunkt
function zonedToUtc(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  let ts = naive;
  for (let i = 0; i < 3; i++) ts = naive - tzOffsetMs(ts, tz);
  return new Date(ts);
}

// Zeitpunkt → { date: "2026-11-08", time: "12:00" } in Zeitzone tz
function zonedParts(date, tz) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).formatToParts(date);
  const g = (t) => p.find((x) => x.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
}

const fmtTimeTz = (d, tz) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: tz });
const fmtDateTz = (d, tz) => d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });
const fmtShortTz = (d, tz) => d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz });

function callTitle(c) {
  return c.title || (c.kind === 'date_night' ? 'Date Night' : 'Call');
}

function relTime(start, end) {
  const now = Date.now();
  if (now >= start && now < end) return 'läuft gerade';
  const diff = start - now;
  if (diff < 0) return 'vorbei';
  const min = Math.round(diff / 60000);
  if (min < 60) return `in ${Math.max(1, min)} Min`;
  const h = Math.round(diff / 3600000);
  if (h < 24) return `in ${h} Std`;
  const days = Math.round(diff / 86400000);
  return days === 1 ? 'in 1 Tag' : `in ${days} Tagen`;
}

function timesLine(start, durationMin) {
  const line = el('div', 'call-times');
  const a = el('span', 'who');
  const ad = el('span', 'pdot'); ad.style.background = COLORS.steffen;
  a.append(ad, document.createTextNode(`${fmtTimeTz(start, AUS)} Austin`));
  const m = el('span', 'who');
  const md = el('span', 'pdot'); md.style.background = COLORS.lily;
  m.append(md, document.createTextNode(`${fmtTimeTz(start, MUC)} München`));
  line.append(a, m);
  if (durationMin) line.append(el('span', 'who', `${durationMin} Min`));
  return line;
}

const ICON_VIDEO = 'm22 8-6 4 6 4V8ZM4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z';
const ICON_HEART = 'M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z';

function kindChip(kind) {
  const chip = el('span', 'kind-chip' + (kind === 'date_night' ? ' date' : ''));
  chip.append(svgIcon(kind === 'date_night' ? ICON_HEART : ICON_VIDEO), document.createTextNode(kind === 'date_night' ? 'Date Night' : 'Call'));
  return chip;
}

// ---------- Daten laden ----------
async function loadCalls() {
  if (!me) return;
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const [c, s] = await Promise.all([
    sb.from('calls').select('id, starts_at, duration_min, kind, title, note, created_by').gte('starts_at', since).order('starts_at'),
    cState.token ? Promise.resolve({ data: { value: cState.token } }) : sb.from('app_settings').select('value').eq('key', 'calendar_token').maybeSingle()
  ]);
  if (c.error) { console.error(c.error); return; }
  cState.calls = c.data || [];
  if (s && s.data) cState.token = s.data.value;
  renderCalls();
  renderHomeCall();
}

function splitCalls() {
  const now = Date.now();
  const upcoming = [];
  const past = [];
  cState.calls.forEach((c) => {
    const start = new Date(c.starts_at);
    const end = start.getTime() + c.duration_min * 60000;
    (end > now ? upcoming : past).push(c);
  });
  return { upcoming, past: past.reverse().slice(0, 10) };
}

// ---------- Ansicht "Calls" ----------
function callCard(c, isPast) {
  const start = new Date(c.starts_at);
  const end = new Date(start.getTime() + c.duration_min * 60000);
  const card = el('section', 'glass call-card' + (isPast ? ' past' : ''));

  const head = el('div', 'card-head');
  head.append(kindChip(c.kind), el('span', 'who', relTime(start, end)));
  card.append(head);
  card.append(el('div', 'call-title', callTitle(c)));
  card.append(el('div', 'call-date', fmtDateTz(start, TZ[me.person])));
  card.append(timesLine(start, c.duration_min));
  if (c.note) card.append(el('p', 'call-note', c.note));

  if (!isPast) {
    const actions = el('div', 'call-actions');
    const edit = el('button', 'link-btn', 'Bearbeiten');
    edit.type = 'button';
    edit.addEventListener('click', () => openForm(c));
    const del = el('button', 'link-btn danger', cState.confirmDelete === c.id ? 'Wirklich löschen?' : 'Löschen');
    del.type = 'button';
    del.addEventListener('click', () => deleteCall(c));
    actions.append(edit, del);
    card.append(actions);
  }
  return card;
}

function renderCalls() {
  const { upcoming, past } = splitCalls();

  const list = $('cUpcoming');
  list.replaceChildren();
  if (upcoming.length === 0) list.append(el('p', 'empty', 'Noch nichts geplant. Tragt euren nächsten Call oder eure nächste Date Night ein.'));
  upcoming.forEach((c) => list.append(callCard(c, false)));

  const pastBox = $('cPast');
  pastBox.replaceChildren();
  $('cPastTitle').classList.toggle('hidden', past.length === 0);
  past.forEach((c) => pastBox.append(callCard(c, true)));

  $('cNewBtn').classList.toggle('hidden', !!cState.editing);
  renderForm();
  renderCalendarCard();
}

// ---------- Formular ----------
function segmented(options, value, onChange, label) {
  const wrap = el('div', 'segmented');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', label);
  options.forEach(([val, text]) => {
    const b = el('button', 'seg' + (val === value ? ' on' : ''), text);
    b.type = 'button';
    b.setAttribute('aria-pressed', val === value ? 'true' : 'false');
    b.addEventListener('click', () => onChange(val));
    wrap.append(b);
  });
  return wrap;
}

function field(labelText, input) {
  const id = 'f-' + Math.random().toString(36).slice(2, 8);
  input.id = id;
  const lab = el('label', 'field-label', labelText);
  lab.htmlFor = id;
  return [lab, input];
}

function openForm(call) {
  cState.confirmDelete = null;
  if (call) {
    const tz = TZ[me.person];
    const start = new Date(call.starts_at);
    const parts = zonedParts(start, tz);
    cState.editing = {
      id: call.id, kind: call.kind, tz, date: parts.date, time: parts.time,
      duration: call.duration_min, title: call.title || '', note: call.note || ''
    };
  } else {
    const tz = TZ[me.person];
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    cState.editing = {
      id: null, kind: 'call', tz,
      date: zonedParts(tomorrow, tz).date,
      time: tz === AUS ? '12:00' : '19:00',
      duration: 60, durationTouched: false, title: '', note: ''
    };
  }
  switchTab('calls');
  renderCalls();
  const f = $('cForm');
  if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeForm() {
  cState.editing = null;
  renderCalls();
}

function renderForm() {
  const box = $('cForm');
  box.replaceChildren();
  const f = cState.editing;
  if (!f) return;

  const card = el('section', 'glass call-form');
  card.append(el('div', 'label', f.id ? 'TERMIN BEARBEITEN' : 'NEUER TERMIN'));

  card.append(segmented([['call', 'Call'], ['date_night', 'Date Night']], f.kind, (v) => {
    f.kind = v;
    if (!f.durationTouched && !f.id) f.duration = v === 'date_night' ? 120 : 60;
    renderForm();
  }, 'Art des Termins'));

  const date = el('input', 'field');
  date.type = 'date';
  date.value = f.date;
  date.addEventListener('input', () => { f.date = date.value; updatePreview(); });

  const time = el('input', 'field');
  time.type = 'time';
  time.value = f.time;
  time.addEventListener('input', () => { f.time = time.value; updatePreview(); });

  const row = el('div', 'field-row');
  const c1 = el('div', 'field-col'); c1.append(...field('Datum', date));
  const c2 = el('div', 'field-col'); c2.append(...field('Uhrzeit', time));
  row.append(c1, c2);
  card.append(row);

  card.append(el('div', 'field-label', 'Uhrzeit gilt für'));
  card.append(segmented([[AUS, 'Austin'], [MUC, 'München']], f.tz, (v) => { f.tz = v; renderForm(); }, 'Zeitzone der Uhrzeit'));

  const preview = el('p', 'hint');
  preview.id = 'cPreview';
  card.append(preview);

  const dur = el('select', 'field');
  [30, 45, 60, 90, 120, 180, 240].forEach((m) => {
    const o = el('option', null, m < 60 ? `${m} Min` : `${m / 60} Std`.replace('.5', ',5'));
    o.value = String(m);
    if (m === f.duration) o.selected = true;
    dur.append(o);
  });
  dur.addEventListener('change', () => { f.duration = Number(dur.value); f.durationTouched = true; });
  card.append(...field('Dauer', dur));

  const title = el('input', 'field');
  title.type = 'text';
  title.maxLength = 100;
  title.placeholder = f.kind === 'date_night' ? 'z. B. Kochabend & Film' : 'z. B. Kurzer Check-in';
  title.value = f.title;
  title.addEventListener('input', () => { f.title = title.value; });
  card.append(...field('Titel (optional)', title));

  const note = el('textarea', 'input');
  note.maxLength = 2000;
  note.placeholder = 'Notiz oder Agenda (optional)';
  note.value = f.note;
  note.setAttribute('aria-label', 'Notiz oder Agenda');
  note.addEventListener('input', () => { f.note = note.value; });
  card.append(note);

  const save = el('button', 'btn-primary', f.id ? 'Speichern' : 'Eintragen');
  save.type = 'button';
  save.style.width = '100%';
  save.addEventListener('click', () => saveCall(save));
  const cancel = el('button', 'link-btn', 'Abbrechen');
  cancel.type = 'button';
  cancel.addEventListener('click', closeForm);
  card.append(save, cancel);

  box.append(card);
  updatePreview();
}

function updatePreview() {
  const f = cState.editing;
  const p = $('cPreview');
  if (!f || !p) return;
  if (!f.date || !f.time) { p.textContent = ''; return; }
  const start = zonedToUtc(f.date, f.time, f.tz);
  const other = f.tz === AUS ? MUC : AUS;
  const otherName = other === AUS ? 'Austin' : 'München';
  p.textContent = `Entspricht ${fmtTimeTz(start, other)} Uhr in ${otherName} (${fmtShortTz(start, other)})`;
}

async function saveCall(btn) {
  const f = cState.editing;
  if (!f.date || !f.time) { toast('Bitte Datum und Uhrzeit angeben.'); return; }
  const payload = {
    starts_at: zonedToUtc(f.date, f.time, f.tz).toISOString(),
    duration_min: f.duration,
    kind: f.kind,
    title: f.title.trim() || null,
    note: f.note.trim() || null
  };
  btn.disabled = true;
  const res = f.id
    ? await sb.from('calls').update(payload).eq('id', f.id)
    : await sb.from('calls').insert(payload);
  btn.disabled = false;
  if (res.error) { console.error(res.error); toast('Termin konnte nicht gespeichert werden.'); return; }

  toast(f.id ? 'Termin geändert' : 'Termin eingetragen');
  if (!f.id) sendPush('call');
  cState.editing = null;
  await loadCalls();
}

async function deleteCall(c) {
  if (cState.confirmDelete !== c.id) {
    cState.confirmDelete = c.id;
    renderCalls();
    setTimeout(() => { if (cState.confirmDelete === c.id) { cState.confirmDelete = null; renderCalls(); } }, 4000);
    return;
  }
  cState.confirmDelete = null;
  const { error } = await sb.from('calls').delete().eq('id', c.id);
  if (error) { console.error(error); toast('Löschen hat nicht geklappt.'); return; }
  toast('Termin gelöscht');
  await loadCalls();
}

$('cNewBtn').addEventListener('click', () => openForm(null));

// ---------- Kalender-Abo ----------
function calendarUrl() {
  if (!cState.token) return null;
  const host = cfg.SUPABASE_URL.replace(/^https?:\/\//, '');
  return `webcal://${host}/functions/v1/calendar?token=${cState.token}`;
}

function renderCalendarCard() {
  const box = $('cCalendar');
  box.replaceChildren();
  const url = calendarUrl();
  if (!url) return;

  const card = el('section', 'glass');
  card.append(el('div', 'label', 'IPHONE-KALENDER'));
  card.append(el('p', 'hint', 'Einmal abonnieren – dann erscheinen alle Termine automatisch in deinem Kalender, mit Erinnerung 15 Minuten vorher.'));
  const a = el('a', 'btn-primary btn-link', 'Kalender abonnieren');
  a.href = url;
  const copy = el('button', 'link-btn', 'Link kopieren');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link kopiert');
    } catch (e) {
      toast('Kopieren nicht möglich');
    }
  });
  card.append(a, copy);
  box.append(card);
}

// ---------- Karte auf der Startseite ----------
function renderHomeCall() {
  const { upcoming } = splitCalls();
  const next = upcoming[0];
  const box = $('homeCallBody');
  box.replaceChildren();

  if (!next) {
    box.append(el('div', 'card-title', 'Noch nichts geplant'));
    $('homeCallAction').textContent = 'Termin eintragen →';
    $('homeCallRel').textContent = '';
    return;
  }
  const start = new Date(next.starts_at);
  const end = new Date(start.getTime() + next.duration_min * 60000);
  box.append(el('div', 'card-title', `${callTitle(next)} · ${fmtShortTz(start, TZ[me.person])}`));
  box.append(timesLine(start));
  $('homeCallRel').textContent = relTime(start, end);
  $('homeCallAction').textContent = upcoming.length > 1 ? `Alle ${upcoming.length} Termine →` : 'Ansehen →';
}

$('homeCall').addEventListener('click', () => switchTab('calls'));
