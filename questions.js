// =============================================================
// Lily & Steffen – Tagesfrage
// Nutzt aus app.js: sb, me, partner, COLORS, $, toast, sendPush, switchTab
// =============================================================

const qState = {
  questions: [],   // neueste zuerst
  answers: [],     // nur die, die ich sehen darf
  answeredBy: []   // wer die aktuelle Frage schon beantwortet hat
};

// ---------- kleine DOM-Helfer (Texte immer als textContent = sicher) ----------
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

function personOf(userId) {
  return userId === me.id ? me : partner;
}

function whoBadge(userId, label) {
  const p = personOf(userId);
  const w = el('span', 'who');
  const d = el('span', 'pdot');
  d.style.background = COLORS[p.person];
  w.append(d, document.createTextNode(label));
  return w;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
}

function answerOf(questionId, userId) {
  return qState.answers.find((a) => a.question_id === questionId && a.user_id === userId) || null;
}

function answerBlock(userId, answer, emptyText) {
  const box = el('div', 'answer');
  box.append(whoBadge(userId, userId === me.id ? 'Du' : partner.name));
  box.append(answer ? el('p', null, answer.text) : el('p', 'muted', emptyText));
  return box;
}

// ---------- Daten laden ----------
async function loadQuestions() {
  if (!me) return;

  const [q, a] = await Promise.all([
    sb.from('questions').select('id, asked_by, text, created_at').order('created_at', { ascending: false }),
    sb.from('answers').select('id, question_id, user_id, text, created_at')
  ]);
  if (q.error || a.error) {
    console.error(q.error || a.error);
    return;
  }
  qState.questions = q.data || [];
  qState.answers = a.data || [];
  qState.answeredBy = [];

  const current = qState.questions[0];
  if (current) {
    const r = await sb.rpc('answered_by', { qid: current.id });
    if (!r.error && Array.isArray(r.data)) {
      qState.answeredBy = r.data.map((x) => (typeof x === 'string' ? x : x.answered_by));
    }
  }

  renderQuestions();
  renderHomeQuestion();
}

function canAsk() {
  const current = qState.questions[0];
  if (!current) return true;
  return current.asked_by !== me.id && qState.answeredBy.length >= 2;
}

// ---------- Ansicht "Fragen" ----------
function renderQuestions() {
  const current = qState.questions[0];
  const box = $('qCurrent');
  box.replaceChildren();

  if (!current) {
    const c = el('section', 'glass');
    c.append(el('div', 'label', 'NOCH KEINE FRAGE'));
    c.append(el('p', 'hint', 'Stellt euch abwechselnd eine Frage. Die Antwort des anderen seht ihr erst, wenn ihr selbst geantwortet habt.'));
    box.append(c);
  } else {
    const myAnswer = answerOf(current.id, me.id);
    const partnerAnswer = answerOf(current.id, partner.id);
    const partnerDone = qState.answeredBy.includes(partner.id);

    const c = el('section', 'glass');
    const head = el('div', 'card-head');
    head.append(whoBadge(current.asked_by, current.asked_by === me.id ? 'Deine Frage' : `${partner.name} fragt`));
    head.append(el('span', 'who', fmtDate(current.created_at)));
    c.append(head);
    c.append(el('div', 'q-text', current.text));

    if (!myAnswer) {
      const ta = el('textarea', 'input');
      ta.id = 'answerInput';
      ta.placeholder = 'Deine Antwort …';
      ta.maxLength = 2000;
      ta.setAttribute('aria-label', 'Deine Antwort');
      const btn = el('button', 'btn-primary', 'Antworten');
      btn.type = 'button';
      btn.style.width = '100%';
      btn.addEventListener('click', () => submitAnswer(current.id, ta, btn));
      c.append(ta, btn);
      c.append(el('p', 'hint', partnerDone
        ? `${partner.name} hat schon geantwortet. Antworte, um es zu sehen.`
        : `Die Antwort von ${partner.name} siehst du, sobald du geantwortet hast.`));
    } else {
      const answers = el('div', 'answers');
      answers.append(answerBlock(me.id, myAnswer));
      answers.append(answerBlock(partner.id, partnerAnswer, `${partner.name} hat noch nicht geantwortet.`));
      c.append(answers);
    }
    box.append(c);
  }

  // Neue Frage stellen
  const ask = $('qAsk');
  ask.replaceChildren();
  if (canAsk()) {
    const c = el('section', 'glass');
    c.append(el('div', 'label', current ? 'DU BIST DRAN' : 'ERSTE FRAGE'));
    const ta = el('textarea', 'input');
    ta.placeholder = `Deine Frage an ${partner.name} …`;
    ta.maxLength = 500;
    ta.setAttribute('aria-label', 'Neue Frage');
    const btn = el('button', 'btn-primary', 'Frage stellen');
    btn.type = 'button';
    btn.style.width = '100%';
    btn.addEventListener('click', () => submitQuestion(ta, btn));
    c.append(ta, btn);
    ask.append(c);
  } else if (current) {
    const text = current.asked_by === me.id
      ? `${partner.name} stellt die nächste Frage, sobald ihr beide geantwortet habt.`
      : 'Du stellst die nächste Frage, sobald ihr beide geantwortet habt.';
    ask.append(el('p', 'empty', text));
  }

  // Archiv
  const archive = $('qArchive');
  archive.replaceChildren();
  const older = qState.questions.slice(1);
  $('qArchiveTitle').classList.toggle('hidden', older.length === 0);
  older.forEach((q) => {
    const item = el('section', 'glass');
    const head = el('div', 'card-head');
    head.append(whoBadge(q.asked_by, q.asked_by === me.id ? 'Deine Frage' : `${partner.name} fragte`));
    head.append(el('span', 'who', fmtDate(q.created_at)));
    item.append(head, el('div', 'q-text', q.text));

    const mine = answerOf(q.id, me.id);
    const answers = el('div', 'answers');
    if (mine) {
      answers.append(answerBlock(me.id, mine));
      answers.append(answerBlock(partner.id, answerOf(q.id, partner.id), 'Keine Antwort'));
    } else {
      answers.append(el('p', 'muted', 'Du hast diese Frage nicht beantwortet.'));
    }
    item.append(answers);
    archive.append(item);
  });

  // Punkt am Tab, wenn ich etwas zu tun habe
  const needsMe = (current && !answerOf(current.id, me.id)) || canAsk();
  $('qBadge').classList.toggle('hidden', !needsMe);
}

// ---------- Karte auf der Startseite ----------
function renderHomeQuestion() {
  const current = qState.questions[0];
  const who = $('homeQuestionWho');
  who.replaceChildren();

  if (!current) {
    $('homeQuestionText').textContent = 'Noch keine Frage gestellt.';
    $('homeQuestionAction').textContent = 'Erste Frage stellen →';
    return;
  }

  const p = personOf(current.asked_by);
  const d = el('span', 'pdot');
  d.style.background = COLORS[p.person];
  who.append(d, document.createTextNode(current.asked_by === me.id ? 'Du' : partner.name));
  $('homeQuestionText').textContent = current.text;

  const mine = answerOf(current.id, me.id);
  const partnerDone = qState.answeredBy.includes(partner.id);
  let action;
  if (!mine) action = 'Antworten →';
  else if (!partnerDone) action = `Warte auf ${partner.name} …`;
  else if (canAsk()) action = 'Beide Antworten ansehen · du bist dran →';
  else action = 'Beide Antworten ansehen →';
  $('homeQuestionAction').textContent = action;
}

$('homeQuestion').addEventListener('click', () => switchTab('questions'));

// ---------- Aktionen ----------
async function submitAnswer(questionId, textarea, btn) {
  const text = textarea.value.trim();
  if (!text) { textarea.focus(); return; }
  btn.disabled = true;
  const { error } = await sb.from('answers').insert({ question_id: questionId, text });
  btn.disabled = false;
  if (error) {
    console.error(error);
    toast(error.code === '23505' ? 'Du hast schon geantwortet.' : 'Antwort konnte nicht gespeichert werden.');
    return;
  }
  toast('Antwort gespeichert');
  sendPush('answer');
  await loadQuestions();
}

async function submitQuestion(textarea, btn) {
  const text = textarea.value.trim();
  if (!text) { textarea.focus(); return; }
  btn.disabled = true;
  const { error } = await sb.from('questions').insert({ text });
  btn.disabled = false;
  if (error) {
    console.error(error);
    toast('Du bist gerade nicht mit Fragen dran.');
    await loadQuestions();
    return;
  }
  toast(`Frage an ${partner.name} gestellt`);
  sendPush('question');
  await loadQuestions();
  // Gleich selbst beantworten
  const input = $('answerInput');
  if (input) input.focus();
}
