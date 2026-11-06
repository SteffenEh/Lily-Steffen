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
}

function showApp() {
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
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
  await sb.auth.signOut();
  showLogin();
});

$('thinkBtn').addEventListener('click', sendThought);

// Beim Zurückkehren in die App Zähler aktualisieren
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadCounts();
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

init();
