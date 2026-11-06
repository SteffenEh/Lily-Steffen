// =============================================================
// Lily & Steffen – Foto des Tages
// Nutzt aus app.js/questions.js: sb, me, partner, COLORS, $, toast, sendPush, switchTab, el, whoBadge
// =============================================================

const pState = {
  day: null,          // aktueller Foto-Tag, z. B. "2026-11-05"
  postedToday: [],    // wer heute gepostet hat (nur IDs)
  photos: [],         // alle Fotos, die ich sehen darf
  hearts: [],         // Herzen zu diesen Fotos
  urls: new Map(),    // path -> { url, at }
  draft: null         // { blob, previewUrl } während des Postens
};

const HEART_PATH = 'M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z';

function svgIcon(pathD, className) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  if (className) s.setAttribute('class', className);
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', pathD);
  s.append(p);
  return s;
}
const LOCK_PATH = 'M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z';
const PLUS_PATH = 'M12 5v14M5 12h14';

function fmtDay(day) {
  return new Date(day + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ---------- Daten laden ----------
async function loadPhotos() {
  if (!me) return;

  const dayRes = await sb.rpc('current_photo_day');
  if (dayRes.error) { console.error(dayRes.error); return; }
  pState.day = dayRes.data;

  const [posted, photos, hearts] = await Promise.all([
    sb.rpc('posted_on_day', { d: pState.day }),
    sb.from('photos').select('id, user_id, day, path, caption, created_at').order('day', { ascending: false }),
    sb.from('photo_hearts').select('photo_id, user_id')
  ]);
  if (photos.error || hearts.error) { console.error(photos.error || hearts.error); return; }

  pState.postedToday = (posted.data || []).map((x) => (typeof x === 'string' ? x : x.posted_on_day));
  pState.photos = photos.data || [];
  pState.hearts = hearts.data || [];

  await signUrls(pState.photos.map((p) => p.path));
  renderPhotos();
  renderHomePhoto();
}

// Private Bilder brauchen zeitlich begrenzte Links (1 Stunde)
async function signUrls(paths) {
  const now = Date.now();
  const missing = paths.filter((p) => {
    const e = pState.urls.get(p);
    return !e || now - e.at > 50 * 60 * 1000;
  });
  if (missing.length === 0) return;
  const { data, error } = await sb.storage.from('photos').createSignedUrls(missing, 3600);
  if (error) { console.error(error); return; }
  (data || []).forEach((d) => {
    if (d.signedUrl) pState.urls.set(d.path, { url: d.signedUrl, at: now });
  });
}

function urlOf(photo) {
  const e = pState.urls.get(photo.path);
  return e ? e.url : '';
}

function photoOf(day, userId) {
  return pState.photos.find((p) => p.day === day && p.user_id === userId) || null;
}

function heartedBy(photoId, userId) {
  return pState.hearts.some((h) => h.photo_id === photoId && h.user_id === userId);
}

// ---------- Bausteine ----------
function photoTile(photo, { withHeart } = {}) {
  const wrap = el('figure', 'ptile');

  const imgBtn = el('button', 'ptile-img');
  imgBtn.type = 'button';
  imgBtn.setAttribute('aria-label', 'Foto groß anzeigen');
  const img = el('img');
  img.src = urlOf(photo);
  img.alt = photo.caption || 'Foto des Tages';
  img.loading = 'lazy';
  imgBtn.append(img);
  imgBtn.addEventListener('click', () => openLightbox(photo));
  wrap.append(imgBtn);

  const cap = el('figcaption', 'ptile-cap');
  cap.append(whoBadge(photo.user_id, photo.user_id === me.id ? 'Du' : partner.name));
  if (photo.caption) cap.append(el('p', null, photo.caption));
  wrap.append(cap);

  if (withHeart) {
    const on = heartedBy(photo.id, me.id);
    const hb = el('button', 'heart-btn' + (on ? ' on' : ''));
    hb.type = 'button';
    hb.setAttribute('aria-label', on ? 'Herz zurücknehmen' : 'Herz geben');
    hb.setAttribute('aria-pressed', on ? 'true' : 'false');
    hb.append(svgIcon(HEART_PATH));
    hb.addEventListener('click', () => toggleHeart(photo, on));
    wrap.append(hb);
  } else if (photo.user_id === me.id && heartedBy(photo.id, partner.id)) {
    const badge = el('span', 'heart-badge');
    badge.append(svgIcon(HEART_PATH), document.createTextNode(partner.name));
    wrap.append(badge);
  }
  return wrap;
}

function placeholderTile(text, iconPath, color, asLabel) {
  const t = el(asLabel ? 'label' : 'div', 'ptile ptile-empty');
  if (asLabel) t.htmlFor = 'photoInput';
  if (color) t.style.borderColor = color;
  t.append(svgIcon(iconPath, 'ptile-icon'), el('span', null, text));
  return t;
}

// ---------- Ansicht "Album" ----------
function renderPhotos() {
  const today = $('pToday');
  today.replaceChildren();

  const card = el('section', 'glass');
  const head = el('div', 'card-head');
  head.append(el('span', 'label', 'HEUTE'));
  head.append(el('span', 'who', fmtDay(pState.day)));
  card.append(head);

  const mine = photoOf(pState.day, me.id);
  const theirs = photoOf(pState.day, partner.id);
  const partnerPosted = pState.postedToday.includes(partner.id);

  if (pState.draft) {
    // Vorschau + Bildunterschrift
    const prev = el('img', 'draft-img');
    prev.src = pState.draft.previewUrl;
    prev.alt = 'Vorschau';
    const ta = el('textarea', 'input');
    ta.id = 'captionInput';
    ta.placeholder = 'Bildunterschrift (optional)';
    ta.maxLength = 300;
    ta.setAttribute('aria-label', 'Bildunterschrift');
    const post = el('button', 'btn-primary', 'Posten');
    post.type = 'button';
    post.style.width = '100%';
    post.addEventListener('click', () => postPhoto(ta, post));
    const cancel = el('button', 'link-btn', 'Abbrechen');
    cancel.type = 'button';
    cancel.addEventListener('click', clearDraft);
    card.append(prev, ta, post, cancel);
  } else {
    const grid = el('div', 'pgrid');
    grid.append(mine ? photoTile(mine) : placeholderTile('Dein Foto', PLUS_PATH, COLORS[me.person], true));
    if (theirs) {
      grid.append(photoTile(theirs, { withHeart: true }));
    } else if (partnerPosted) {
      grid.append(placeholderTile(`${partner.name} hat gepostet`, LOCK_PATH, COLORS[partner.person]));
    } else {
      grid.append(placeholderTile(`${partner.name} noch nicht`, LOCK_PATH, null));
    }
    card.append(grid);
    if (!mine) {
      card.append(el('p', 'hint', partnerPosted
        ? `Poste dein Foto, um das von ${partner.name} zu sehen.`
        : `Das Foto von ${partner.name} siehst du nur, wenn du heute selbst postest.`));
    }
  }
  today.append(card);

  // Album: frühere Tage, an denen ich gepostet habe
  const album = $('pAlbum');
  album.replaceChildren();
  const days = [...new Set(pState.photos.map((p) => p.day))].filter((d) => d !== pState.day);
  $('pAlbumTitle').classList.toggle('hidden', days.length === 0);
  days.forEach((day) => {
    const c = el('section', 'glass');
    c.append(el('div', 'label', fmtDay(day).toUpperCase()));
    const grid = el('div', 'pgrid');
    const m = photoOf(day, me.id);
    const t = photoOf(day, partner.id);
    if (m) grid.append(photoTile(m));
    if (t) grid.append(photoTile(t, { withHeart: true }));
    else if (m) grid.append(placeholderTile('Kein Foto', LOCK_PATH, null));
    c.append(grid);
    album.append(c);
  });

  $('pBadge').classList.toggle('hidden', !!mine);
}

// ---------- Karte auf der Startseite ----------
function homeThumb(photo, fallbackText, color) {
  const t = el('span', 'home-tile');
  if (photo) {
    const img = el('img');
    img.src = urlOf(photo);
    img.alt = '';
    t.append(img);
  } else {
    if (color) t.style.borderColor = color;
    t.classList.add('home-tile-empty');
    t.append(el('span', null, fallbackText));
  }
  return t;
}

function renderHomePhoto() {
  const mine = photoOf(pState.day, me.id);
  const theirs = photoOf(pState.day, partner.id);
  const partnerPosted = pState.postedToday.includes(partner.id);

  const tiles = $('homePhotoTiles');
  tiles.replaceChildren(
    homeThumb(mine, '+ Du', COLORS[me.person]),
    homeThumb(theirs, partnerPosted ? `${partner.name} · gesperrt` : partner.name, partnerPosted ? COLORS[partner.person] : null)
  );

  let action;
  if (!mine && partnerPosted) action = `${partner.name} hat gepostet – poste deins →`;
  else if (!mine) action = 'Foto posten →';
  else if (!theirs) action = `Warte auf ${partner.name} …`;
  else action = 'Ansehen →';
  $('homePhotoAction').textContent = action;
}

$('homePhoto').addEventListener('click', () => switchTab('photos'));

// ---------- Foto auswählen, verkleinern, posten ----------
function resizeImage(file, max = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht umgewandelt werden'))), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht geladen werden')); };
    img.src = url;
  });
}

$('photoInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const blob = await resizeImage(file);
    clearDraft(false);
    pState.draft = { blob, previewUrl: URL.createObjectURL(blob) };
    switchTab('photos');
    renderPhotos();
  } catch (err) {
    console.error(err);
    toast('Dieses Foto konnte nicht geladen werden.');
  }
});

function clearDraft(render = true) {
  if (pState.draft) URL.revokeObjectURL(pState.draft.previewUrl);
  pState.draft = null;
  if (render) renderPhotos();
}

async function postPhoto(textarea, btn) {
  if (!pState.draft) return;
  btn.disabled = true;
  btn.textContent = 'Wird hochgeladen …';

  const path = `${me.id}/${Date.now()}.jpg`;
  const up = await sb.storage.from('photos').upload(path, pState.draft.blob, {
    contentType: 'image/jpeg',
    upsert: false
  });
  if (up.error) {
    console.error(up.error);
    toast('Hochladen hat nicht geklappt.');
    btn.disabled = false;
    btn.textContent = 'Posten';
    return;
  }

  const caption = textarea.value.trim();
  const ins = await sb.from('photos').insert({ path, caption: caption || null });
  if (ins.error) {
    console.error(ins.error);
    await sb.storage.from('photos').remove([path]);
    toast(ins.error.code === '23505' ? 'Du hast heute schon ein Foto gepostet.' : 'Foto konnte nicht gespeichert werden.');
    btn.disabled = false;
    btn.textContent = 'Posten';
    return;
  }

  clearDraft(false);
  toast('Foto gepostet');
  sendPush('photo');
  await loadPhotos();
}

async function toggleHeart(photo, isOn) {
  const res = isOn
    ? await sb.from('photo_hearts').delete().eq('photo_id', photo.id).eq('user_id', me.id)
    : await sb.from('photo_hearts').insert({ photo_id: photo.id });
  if (res.error) { console.error(res.error); toast('Hat nicht geklappt.'); return; }
  await loadPhotos();
}

// ---------- Vollbild ----------
function openLightbox(photo) {
  $('lightboxImg').src = urlOf(photo);
  $('lightboxImg').alt = photo.caption || 'Foto des Tages';
  $('lightboxCaption').textContent = photo.caption || '';
  $('lightbox').classList.remove('hidden');
}
function closeLightbox() {
  $('lightbox').classList.add('hidden');
  $('lightboxImg').removeAttribute('src');
}
$('lightbox').addEventListener('click', (e) => {
  if (e.target.id !== 'lightboxImg') closeLightbox();
});
