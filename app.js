// Landung in München: 9. Dezember 2026, 13:15 Uhr (MEZ, UTC+1)
const TARGET = new Date('2026-12-09T13:15:00+01:00');
// Start der Fernbeziehung: 13. August 2026 (MESZ, UTC+2)
const START = new Date('2026-08-13T00:00:00+02:00');

// Zum Testen der Herz-Ansicht: index.html?vorschau=wiedersehen
const PREVIEW_REUNITED = new URLSearchParams(location.search).get('vorschau') === 'wiedersehen';

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');

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

  const progress = Math.min(1, Math.max(0, (now - START) / (TARGET - START)));
  const pct = progress * 100;
  $('fill').style.width = pct + '%';
  $('knob').style.left = pct + '%';
  $('percent').textContent = Math.floor(pct) + ' %';

  return true;
}

if (tick()) {
  const timer = setInterval(() => {
    if (!tick()) clearInterval(timer);
  }, 1000);
}
