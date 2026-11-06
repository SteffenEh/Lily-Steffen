// =============================================================
// Lily & Steffen – App-Logik
// =============================================================

// Landung in München: 9. Dezember 2026, 13:15 Uhr (MEZ, UTC+1)
const TARGET = new Date('2026-12-09T13:15:00+01:00');
// Start der Fernbeziehung: 13. August 2026 (MESZ, UTC+2)
const START = new Date('2026-08-13T00:00:00+02:00');

const COLORS = { lily: '#4C8DFF', steffen: '#34A374' };

// Zum Testen der Herz-Ansicht: index.html?vorschau=wiedersehen
const PREVIEW_REUNITED = new URLSearchParams(location.search).get('vorschau') === 'wiedersehen';

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');

// ---------------- Countdown ----------------
function showReunited() {
  $('countdown').classList.add('hidden');
  $('reunited').classList.remove('hidden');
}

function tick() {
  const now = new Date();
  if (PREVIEW_REUNITED || now >= TARGET) {
    showReunited();
    return false;
  }

  const diff = TARGET - now;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);

  $('days').textContent = days;
  $('daysLabel').textContent = days === 1 ? 'Tag' : 'Tage';
  $('hours').textContent = pad(hours);
  $('minutes').textContent = pad(minutes);

  const pct = Math.min(1, Math.max(0, (now - START) / (TARGET - START))) * 100;
  $('fill').style.width = pct + '%';
  $('knob').style.left = pct + '%';
  $('percent').textContent = Math.floor(pct) + ' %';
  return true;
}

function startCountdown() {
  if (tick()) {
    const timer = setInterval(() => { if (!tick()) clearInterval(timer); }, 1000);
  }
}

// ---------------- Hinweis-Toast ----------------
let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------------- Supabase ----------------
const cfg = window.APP_CONFIG || {};
const sb = window.supabase
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    })
  : null;

let me = null;       // eigenes Profil
let partner = null;  // Profil des anderen
let channel = null;  // Live-Verbindung

function showLogin() {
  me = partner = null;
  if (channel) { sb.removeChannel(channel); channel = null; }
  document.querySelectorAll('.avatar').forEach((a) => a.classList.remove('me'));
  $('app').classList.add('hidden');
  $('login').classList.remove('hidden');
  $('tabs').classList.add('hidden');
  document.body.classList.remove('has-tabs');
  switchTab('home');
}

function showApp() {
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('tabs').classList.remove('hidden');
  document.body.classList.add('has-tabs');
}

// ---------------- Tabs ----------------
const VIEWS = ['home', 'questions', 'photos'];
function switchTab(name) {
  VIEWS.forEach((v) => {
    const view = $('view-' + v);
    if (view) view.classList.toggle('hidden', v !== name);
  });
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

// Push an den Partner auslösen (läuft im Hintergrund)
function sendPush(type) {
  sb.functions.invoke('notify', { body: { type } })
    .then(({ error }) => { if (error) console.error('Push:', error); });
}

async function enterApp(session) {
  const { data: profiles, error } = await sb.from('profiles').select('id, person, name');
  if (error) {
    toast('Profile konnten nicht geladen werden.');
    console.error(error);
    return;
  }

  me = profiles.find((p) => p.id === session.user.id) || null;
  partner = profiles.find((p) => p.id !== session.user.id) || null;

  if (!me || !partner) {
    showLogin();
    $('loginError').textContent = 'Dein Konto ist noch keinem Profil zugeordnet. Bitte Teil 3 im SQL ausführen.';
    await sb.auth.signOut();
    return;
  }

  document.documentElement.style.setProperty('--me-color', COLORS[me.person]);
  document.documentElement.style.setProperty('--partner-color', COLORS[partner.person]);
  $('avatar-' + me.person).classList.add('me');

  showApp();
  await loadCounts();
  subscribeLive();
  updatePushCard();
  loadQuestions();
  loadPhotos();
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

async function loadCounts() {
  if (!me) return;
  const { data, error } = await sb
    .from('thoughts')
    .select('sender')
    .gte('created_at', startOfToday());
  if (error) { console.error(error); return; }

  const mine = data.filter((t) => t.sender === me.id).length;
  const theirs = data.filter((t) => t.sender === partner.id).length;

  $('partnerText').textContent = theirs > 0
    ? `${partner.name} hat heute ${theirs}× an dich gedacht`
    : `Heute noch kein Signal von ${partner.name}`;
  $('myText').textContent = mine > 0 ? `Du: ${mine}× heute` : '';
}

function subscribeLive() {
  if (channel) sb.removeChannel(channel);
  channel = sb
    .channel('thoughts-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'thoughts' }, (payload) => {
      if (payload.new && partner && payload.new.sender === partner.id) {
        toast(`${partner.name} denkt gerade an dich`);
        const status = document.querySelector('.status');
        status.classList.remove('glow');
        void status.offsetWidth; // Animation neu starten
        status.classList.add('glow');
      }
      loadCounts();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'questions' }, (payload) => {
      if (payload.new && partner && payload.new.asked_by === partner.id) {
        toast(`${partner.name} hat eine neue Frage gestellt`);
      }
      loadQuestions();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'answers' }, () => {
      loadQuestions();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'photos' }, (payload) => {
      if (payload.new && partner && payload.new.user_id === partner.id) {
        toast(`${partner.name} hat das Foto des Tages gepostet`);
      }
      loadPhotos();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'photo_hearts' }, () => {
      loadPhotos();
    })
    .subscribe();
}

async function sendThought() {
  if (!me) return;
  const btn = $('thinkBtn');
  btn.disabled = true;
  const { error } = await sb.from('thoughts').insert({});
  btn.disabled = false;

  if (error) {
    toast('Konnte nicht gesendet werden.');
    console.error(error);
    return;
  }
  btn.classList.add('sent');
  setTimeout(() => btn.classList.remove('sent'), 900);
  toast(`An ${partner.name} gesendet`);
  loadCounts();
  sendPush('thought');
}

// ---------------- Push-Benachrichtigungen ----------------
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.error('SW:', e));
}

function base64UrlToUint8(b64) {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function getOrCreateSubscription() {
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToUint8(cfg.VAPID_PUBLIC_KEY)
  });
}

async function saveSubscription(sub) {
  const j = sub.toJSON();
  const { error } = await sb.from('push_subscriptions').upsert(
    { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_id: me.id },
    { onConflict: 'endpoint' }
  );
  if (error) throw error;
}

function setPushCard(text, showButton) {
  $('pushCard').classList.remove('hidden');
  $('pushText').textContent = text;
  $('pushBtn').classList.toggle('hidden', !showButton);
}

async function updatePushCard() {
  if (!me) return;

  if (!pushSupported()) {
    setPushCard(
      isStandalone()
        ? 'Benachrichtigungen werden hier nicht unterstützt. Bitte iOS aktualisieren.'
        : 'Für Benachrichtigungen: In Safari auf Teilen → „Zum Home-Bildschirm“ tippen und die App von dort öffnen.',
      false
    );
    return;
  }

  if (Notification.permission === 'denied') {
    setPushCard('Benachrichtigungen sind blockiert. Erlaube sie in den iPhone-Einstellungen unter Mitteilungen → Lily & Steffen.', false);
    return;
  }

  if (Notification.permission === 'granted') {
    try {
      await saveSubscription(await getOrCreateSubscription());
      $('pushCard').classList.add('hidden');
      return;
    } catch (e) {
      console.error('Push-Abo:', e);
    }
  }

  setPushCard(`Bekomm eine Nachricht, wenn ${partner.name} an dich denkt.`, true);
}

$('pushBtn').addEventListener('click', async () => {
  // Muss direkt durch den Tipp ausgelöst werden (iOS-Vorgabe)
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    updatePushCard();
    return;
  }
  try {
    $('pushBtn').disabled = true;
    await saveSubscription(await getOrCreateSubscription());
    $('pushCard').classList.add('hidden');
    toast('Benachrichtigungen aktiv');
  } catch (e) {
    console.error('Push-Abo:', e);
    toast('Aktivieren hat nicht geklappt.');
  } finally {
    $('pushBtn').disabled = false;
  }
});

async function removeThisDevice() {
  try {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  } catch (e) {
    console.error(e);
  }
}

// ---------------- Login / Logout ----------------
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('email').value.trim();
  const password = $('password').value;
  $('loginError').textContent = '';

  if (!email || !password) {
    $('loginError').textContent = 'Bitte E-Mail und Passwort eingeben.';
    return;
  }

  $('loginBtn').disabled = true;
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  $('loginBtn').disabled = false;

  if (error) {
    $('loginError').textContent = 'E-Mail oder Passwort stimmt nicht.';
    return;
  }
  $('password').value = '';
  await enterApp(data.session);
});

$('logoutBtn').addEventListener('click', async () => {
  await removeThisDevice(); // auf diesem Gerät keine Pushes mehr nach dem Abmelden
  await sb.auth.signOut();
  showLogin();
});

$('thinkBtn').addEventListener('click', sendThought);

// Beim Zurückkehren in die App Zähler aktualisieren
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadCounts();
    loadQuestions();
    loadPhotos();
  }
});

// ---------------- Start ----------------
async function init() {
  startCountdown();
  if (!sb) {
    toast('Keine Verbindung – bitte Internet prüfen.');
    return;
  }
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') showLogin();
  });

  const { data: { session } } = await sb.auth.getSession();
  if (session) await enterApp(session);
  else showLogin();
}

// Erst starten, wenn alle Skripte (auch questions.js) geladen sind
document.addEventListener('DOMContentLoaded', init);
