import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

const $ = (id) => document.getElementById(id);
const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const TARGET_TOUR_YEARS = new Set(['2025', '2026']);
let currentUniverse = 'mcr';
let listBtsToursAPI = null;
const WRAPPED_BSTAGE_EXCLUDED_SONGS = new Set(['from a to b', 'it s over']);
const configured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('REPLACE_') && firebaseConfig.projectId && !firebaseConfig.projectId.startsWith('REPLACE_');
let auth, db, listMcrToursAPI, user = null, demoMode = false, catalogData = { albums: [], dates: [], songs: [] }, availableShows = [], shows = [], attended = [], setlists = {}, selectedId = null, activeTourName = '', toastTimer;

function dateLabel(date) {
  if (!date) return 'FECHA POR DEFINIR';
  return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)).toLocaleUpperCase('es-AR');
}

function archiveStorageKey() { return currentUniverse === 'bts' ? 'bts-show-archive-demo' : 'mcr-show-archive-demo'; }
function showId(show) { return show.id || `show-${show.date}`; }
function isTargetTourShow(show) {
  const tour = String(show.tour || '').toLowerCase();
  return currentUniverse === 'bts' ? tour.includes('arirang') : (!show.tour || (TARGET_TOUR_YEARS.has(String(show.date || '').slice(0, 4)) && tour.includes('black parade')));
}
function songsFor(show) { return setlists[showId(show)] || catalogData.songs.filter((song) => song.date === show.date).map((song) => ({ title: song.title, songId: song.id, album: song.album })); }

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2600);
}

function updateStats() {
  const mine = shows.filter((show) => isTargetTourShow(show) && attended.includes(showId(show)));
  const uniqueSongs = new Set(mine.flatMap((show) => songsFor(show).map((song) => song.songId || song.title)));
  $('show-total').textContent = mine.length;
  $('song-total').textContent = uniqueSongs.size;
}

function renderMemory() {
  const query = $('memory-search').value.trim().toLocaleLowerCase('es');
  const seen = new Map();
  shows.filter((show) => attended.includes(showId(show))).forEach((show) => {
    songsFor(show).forEach((entry) => {
      const key = entry.songId || entry.title;
      if (!seen.has(key)) seen.set(key, { title: entry.title, album: catalogData.songs.find((song) => song.id === entry.songId)?.album || 'Otras canciones', shows: [] });
      seen.get(key).shows.push(show);
    });
  });
  const albums = [...new Set(catalogData.albums.concat('Otras canciones'))];
  const groups = albums.map((album) => {
    const songs = [...seen.values()].filter((song) => song.album === album && song.title.toLocaleLowerCase('es').includes(query));
    if (!songs.length) return '';
    return `<section class="memory-album"><h4>${escapeHTML(album)}</h4>${songs.map((song) => `<div class="memory-song"><span>${escapeHTML(song.title)}</span><span class="memory-stamps">${song.shows.map((show) => `<i style="--show-color:${escapeHTML(show.color || '#c83c4a')}" title="${escapeHTML(dateLabel(show.date))} · ${escapeHTML(show.country || show.place)}"></i>`).join('')}</span></div>`).join('')}</section>`;
  }).join('');
  $('memory-songs').innerHTML = groups || `<div class="memory-empty">${attended.length ? 'No hay canciones para esa búsqueda.' : 'Todavía no hay sellos. Marcá “I was there” en un show para empezar tu colección.'}</div>`;
}

function getWrappedData() {
  const nights = shows
    .filter((show) => show.date >= '2021-01-01' && attended.includes(showId(show)))
    .sort((a, b) => a.date.localeCompare(b.date));
  const songs = new Map();
  const cities = new Set();
  const tours = new Map();
  const years = new Set();
  const bStageSongs = new Map();
  nights.forEach((show) => {
    years.add(show.date.slice(0, 4));
    cities.add((show.city || show.country || show.place || '').toLocaleLowerCase('es'));
    tours.set(show.tour || 'Shows especiales', (tours.get(show.tour || 'Shows especiales') || 0) + 1);
    const heardThisNight = new Set();
    const bStageHeardThisNight = new Set();
    songsFor(show).forEach((song) => {
      const key = song.songId || normalizeTitle(song.title);
      const normalizedSongTitle = normalizeTitle(song.title);
      if ((song.isBStage === true || /\bb[\s-]*stage\b/i.test(String(song.section || '')))
        && !WRAPPED_BSTAGE_EXCLUDED_SONGS.has(normalizedSongTitle)
        && !bStageHeardThisNight.has(key)) {
        const bStageEntry = bStageSongs.get(key) || { title: song.title, count: 0 };
        bStageEntry.count += 1;
        bStageSongs.set(key, bStageEntry);
        bStageHeardThisNight.add(key);
      }
      if (heardThisNight.has(key)) return;
      heardThisNight.add(key);
      const entry = songs.get(key) || { title: song.title, count: 0 };
      entry.count += 1;
      songs.set(key, entry);
    });
  });
  const rankedSongs = [...songs.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
  const rankedBStageSongs = [...bStageSongs.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
  const rankedTours = [...tours.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { nights, songs: rankedSongs, cityCount: [...cities].filter(Boolean).length, years, topTour: rankedTours[0], topSong: rankedBStageSongs[0] };
}

function renderWrapped() {
  const { nights, songs, cityCount, years, topTour, topSong } = getWrappedData();
  const redStamps = [['#7c1521', '#b62030'], ['#a81828', '#d53846'], ['#c32434', '#ec5964'], ['#931522', '#d12c3c']];
  $('wrapped-content').innerHTML = `
    <header class="wrapped-header">
      <div><p class="wrapped-kicker">OUR LIVES IN BLACK &amp; RED <span>✳</span> DESDE 2021</p><h2 id="wrapped-title">TU LLTBP<br /><em>WRAPPED</em></h2><p class="wrapped-intro">Un pequeño resumen de las noches que siguen con vos.</p></div>
      <div class="wrapped-orbit" aria-hidden="true"><span>MY CHEMICAL<br />ROMANCE</span><b>${String(nights.length).padStart(2, '0')}</b><small>NOCHES</small></div>
    </header>
    <div class="wrapped-stats">
      <article><span>SHOWS</span><b>${nights.length}</b><small>desde 2021</small></article>
      <article><span>CANCIONES</span><b>${songs.length}</b><small>distintas en vivo</small></article>
      <article><span>CIUDADES</span><b>${cityCount}</b><small>con recuerdos</small></article>
      <article><span>AÑOS</span><b>${years.size}</b><small>${[...years].join(' · ') || 'tu próxima noche espera'}</small></article>
    </div>
    <div class="wrapped-highlights">
      <article class="wrapped-highlight wrapped-favorite"><span class="wrapped-label">LA CANCIÓN B-STAGE QUE MÁS TE ENCONTRÓ</span><strong>${escapeHTML(topSong?.title || 'Todavía está por sonar')}</strong><small>${topSong ? `La viviste en ${topSong.count} ${topSong.count === 1 ? 'show' : 'shows'}.` : 'Volvé a cargar los shows para actualizar las secciones B-stage.'}</small></article>
      <article class="wrapped-highlight"><span class="wrapped-label">TU ERA MÁS VIVIDA</span><strong>${escapeHTML(topTour?.[0] || 'La historia continúa')}</strong><small>${topTour ? `${topTour[1]} ${topTour[1] === 1 ? 'noche' : 'noches'} guardadas` : 'Las fechas que marques van a aparecer acá.'}</small></article>
    </div>
    <div class="wrapped-night-heading"><div><span class="wrapped-label">TU MAPA DE NOCHES</span><h3>Y ESTUVISTE AHÍ.</h3></div><button type="button" class="wrapped-share" data-share-wrapped>COPIAR MI RESUMEN ↗</button></div>
    ${nights.length ? `<ol class="wrapped-nights">${nights.map((show, index) => { const [dark, light] = redStamps[index % redStamps.length]; return `<li><span class="wrapped-stamp" style="--stamp-dark:${dark};--stamp-light:${light}">${String(index + 1).padStart(2, '0')}</span><div class="wrapped-night-copy"><time>${dateLabel(show.date)}</time><strong>${escapeHTML(show.city || show.country || show.place || 'MCR SHOW')}</strong><small>${escapeHTML(show.place || show.country || 'A NIGHT TO REMEMBER')}${show.tour ? ` · ${escapeHTML(show.tour)}` : ''}</small></div><span class="wrapped-night-star">✳</span></li>`; }).join('')}</ol>` : '<div class="wrapped-empty"><span>✳</span><strong>Tu próxima noche empieza acá.</strong><p>Marcá como asistido un show desde 2021 y vas a ver crecer tu Wrapped.</p></div>'}
    <footer class="wrapped-footer"><span>HEARTS STILL BEAT IN RED</span><span>LLTBP · 2021—NOW</span></footer>`;
}

function renderShows() {
  const visibleShows = shows.filter((show) => isTargetTourShow(show) && (!activeTourName || show.tour === activeTourName));
  $('show-cards').innerHTML = visibleShows.length ? visibleShows.map((show) => {
    const id = showId(show), wasThere = attended.includes(id), selected = selectedId === id;
    const count = songsFor(show).length;
    return `<article class="show-card ${selected ? 'selected' : ''}" style="--show-color:${escapeHTML(show.color || '#c83c4a')}" data-show="${escapeHTML(id)}"><button class="show-card-main" data-open="${escapeHTML(id)}"><span class="show-date">${dateLabel(show.date)}</span><strong>${escapeHTML(show.city || show.country || show.place || 'MCR SHOW')}</strong><small>${escapeHTML(show.place || show.country || 'TOUR DATE')} <i>·</i> ${count} CANCIONES</small></button><button class="attendance-stamp ${wasThere ? 'is-attending' : ''}" data-attend="${escapeHTML(id)}" aria-label="${wasThere ? 'Quitar marca de asistí' : 'Marcar que asistí'}">${wasThere ? 'I WAS<br>THERE' : 'MARCAR<br>ASISTÍ'}</button></article>`;
  }).join('') : '<p class="section-note">Todavía no hay fechas en el archivo.</p>';
  $('show-cards').querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => { selectedId = button.dataset.open; renderShows(); renderDetail(); }));
  $('show-cards').querySelectorAll('[data-attend]').forEach((button) => button.addEventListener('click', async (event) => {
    event.stopPropagation();
    const id = button.dataset.attend;
    const previous = [...attended];
    attended = attended.includes(id) ? attended.filter((item) => item !== id) : [...attended, id];
    renderShows(); updateStats(); renderMemory(); renderWrapped();
    try { await saveArchive(); toast(attended.includes(id) ? 'Esta noche ya es parte de tu historia.' : 'Marca de asistencia quitada.'); }
    catch (error) { attended = previous; renderShows(); updateStats(); renderMemory(); renderWrapped(); showError(error); }
  }));
}

function renderDetail() {
  const show = shows.find((item) => showId(item) === selectedId);
  if (!show) {
    $('show-detail').innerHTML = '<div class="detail-empty"><span>✳</span><p>ELEGÍ UNA NOCHE<br />DE TU ARCHIVO</p><small>El setlist va a aparecer acá.</small></div>';
    return;
  }
  const list = songsFor(show), id = showId(show), wasThere = attended.includes(id);
  $('show-detail').innerHTML = `<div class="detail-top" style="--show-color:${escapeHTML(show.color || '#c83c4a')}"><p class="eyebrow">${wasThere ? 'YOU WERE THERE' : 'FROM THE TOUR ARCHIVE'}</p><h3>${escapeHTML(show.city || show.country || show.place || 'MY CHEMICAL ROMANCE')}</h3><div class="detail-place">${escapeHTML(show.place || show.country || '')} <span>·</span> ${dateLabel(show.date)}</div><div class="detail-seal ${wasThere ? 'active' : ''}">${wasThere ? 'I WAS THERE' : 'WERE YOU THERE?'}</div></div><div class="detail-list-head"><div><span class="step">02</span><h4>LA NOCHE EN CANCIONES</h4></div><span class="tiny-label">${list.length} TRACKS</span></div><p class="color-note"><i style="background:${escapeHTML(show.color || '#c83c4a')}"></i> El sello de este show colorea las canciones que sonaron esa noche.</p>${show.setlistUrl ? `<p class="source-link">FUENTE · <a href="${escapeHTML(show.setlistUrl)}" target="_blank" rel="noreferrer">VER EN SETLIST.FM ↗</a></p>` : ''}<ol class="night-setlist">${list.length ? list.map((song, index) => `<li><span class="track-number">${String(index + 1).padStart(2, '0')}</span><span class="track-name">${escapeHTML(song.title)}${song.album ? `<small>${escapeHTML(song.album)}</small>` : ''}</span><span class="track-mark" title="Show: ${escapeHTML(show.country || show.place)}" style="--show-color:${wasThere ? escapeHTML(show.color || '#c83c4a') : '#574a58'}">✳</span></li>`).join('') : '<li class="no-setlist">No hay canciones asociadas a esta fecha todavía.</li>'}</ol><details class="import-setlist"><summary>＋ PEGAR O CORREGIR SETLIST A MANO</summary><p>Como alternativa, pegá las canciones, una por línea.</p><textarea id="setlist-input" rows="7" placeholder="The Foundations of Decay&#10;Welcome to the Black Parade&#10;Famous Last Words"></textarea><div class="import-actions"><span>Las canciones se cruzan con el catálogo por título.</span><button id="import-button" class="button button-red" type="button">GUARDAR LISTA ↗</button></div></details>`;
  $('import-button').addEventListener('click', async () => {
    const lines = $('setlist-input').value.split(/\r?\n/).map((line) => line.replace(/^\s*(\d+[.)-]?\s*)/, '').trim()).filter(Boolean);
    if (!lines.length) { toast('Pegá las canciones, una por línea.'); return; }
    const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const byTitle = new Map(catalogData.songs.map((song) => [normalize(song.title), song]));
    const previous = setlists[id];
    setlists[id] = lines.map((title) => { const match = byTitle.get(normalize(title)); return { title: match?.title || title, songId: match?.id || null, album: match?.album || null }; });
    try { await saveArchive(); renderDetail(); renderShows(); updateStats(); renderMemory(); renderWrapped(); toast(`${lines.length} canciones guardadas para esta noche.`); }
    catch (error) { if (previous) setlists[id] = previous; else delete setlists[id]; showError(error); }
  });
}

async function loadTourOptions() {
  const select = $('tour-select');
  $('import-tour-button').disabled = true;
  select.disabled = true;
  select.innerHTML = `<option value="">Cargando giras de ${currentUniverse === 'bts' ? 'BTS' : 'MCR'}…</option>`;
  $('tour-import-status').textContent = currentUniverse === 'bts' ? 'Buscando fechas pasadas de ARIRANG con setlist publicado…' : 'Buscando Black Parade 2025 y 2026…';
  const tourApi = currentUniverse === 'bts' ? listBtsToursAPI : listMcrToursAPI;
  if (!tourApi) {
    document.getElementById("tour-import-status").textContent = "La importacion automatica requiere Firebase Functions. Podes cargar fechas y setlists a mano.";
    return;
  }
  try {
    const result = await tourApi();
    const options = result.data.tours || [];
    availableShows = result.data.shows || [];
    select.innerHTML = '';
    if (!options.length) {
      select.add(new Option(currentUniverse === 'bts' ? 'No hay setlists ARIRANG disponibles' : 'No hay giras Black Parade disponibles', ''));
      select.disabled = true;
      $('import-tour-button').disabled = true;
      $('tour-import-status').textContent = currentUniverse === 'bts'
        ? 'No encontramos fechas pasadas de ARIRANG con setlist publicado. Revisá que la función listBtsTours esté desplegada en Firebase.'
        : 'No encontramos fechas Black Parade de 2025–2026. Revisá Firebase Functions y la clave de setlist.fm.';
      renderShows();
      return;
    }
    options.forEach((tour) => select.add(new Option(tour.name + ' · ' + tour.count + ' shows', tour.name)));
    if (!activeTourName || !options.some((tour) => tour.name === activeTourName)) activeTourName = options[0].name;
    select.value = activeTourName;
    select.disabled = false;
    $('import-tour-button').disabled = false;
    $('tour-import-status').textContent = currentUniverse === 'bts'
      ? options.length + ' giras ARIRANG disponibles. Cargando fechas pasadas…'
      : options.length + ' giras Black Parade de 2025/2026 disponibles. Cargando fechas…';
    const hasSelectedTour = shows.some((show) => show.tour === activeTourName && isTargetTourShow(show));
    if (!hasSelectedTour) await importSelectedTour();
    else renderAll();
  } catch (error) {
    console.error(error);
    select.innerHTML = '<option value="">No se pudieron cargar las giras</option>';
    const code = String(error.code || "");
    const message = String(error.message || "");
    let status;
    if (code.includes("not-found") || message.includes("NOT_FOUND")) {
      status = "Falta publicar listMcrTours. Configurá SETLISTFM_API_KEY y ejecutá firebase.cmd deploy --only functions.";
    } else if (code.includes("resource-exhausted") || /returned 429/i.test(message)) {
      status = "setlist.fm limitó las consultas. Esperá unos minutos y volvé a intentar; la carga se comparte y reintenta automáticamente.";
    } else if (/returned (401|403)/i.test(message)) {
      status = "setlist.fm rechazó la clave. Revisá SETLISTFM_API_KEY y volvé a desplegar Functions.";
    } else {
      status = "Error " + (code || "de conexión") + ": " + message.slice(0, 150) + ". Revisá Firebase Functions y SETLISTFM_API_KEY.";
    }
    document.getElementById("tour-import-status").textContent = status;
  }
}

async function importSelectedTour() {
  const tourName = $('tour-select').value;
  if (!tourName) { toast('Elegí una gira primero.'); return; }
  const tourApi = currentUniverse === 'bts' ? listBtsToursAPI : listMcrToursAPI;
  if (!tourApi) { toast('La importación automática requiere Firebase Functions.'); return; }
  const button = $('import-tour-button');
  button.disabled = true;
  button.textContent = 'LOADING SHOWS...';
  try {
    const byTitle = new Map(catalogData.songs.map((song) => [normalizeTitle(song.title), song]));
    const importedShows = availableShows.filter((event) => event.tour === tourName);
    if (!importedShows.length) { toast('No shows found for this tour.'); return; }
    importedShows.forEach((event, index) => {
      const existing = shows.find((show) => show.date === event.date);
      const id = existing ? showId(existing) : 'show-' + event.date;
      const songs = event.songs.map((entry) => {
        const title = typeof entry === 'string' ? entry : entry.title;
        const match = byTitle.get(normalizeTitle(title));
        return { title: match?.title || title, songId: match?.id || null, album: match?.album || null, section: typeof entry === 'string' ? '' : entry.section, isBStage: typeof entry !== 'string' && entry.isBStage === true };
      });
      const show = {
        ...(existing || {}), id, date: event.date, place: event.place, city: event.city,
        country: event.country, color: existing?.color || paletteColor(index),
        tour: tourName, setlistUrl: event.url, setlistId: event.setlistId
      };
      shows = existing ? shows.map((item) => showId(item) === id ? show : item) : [...shows, show];
      setlists[id] = songs;
    });
    activeTourName = tourName;
    const firstTourShow = shows.find((show) => isTargetTourShow(show) && show.tour === activeTourName);
    selectedId = firstTourShow ? showId(firstTourShow) : null;
    await saveArchive();
    renderAll();
    $('tour-import-status').textContent = importedShows.length + ' shows de ' + tourName + ' cargados. Marcá las fechas a las que fuiste.';
    toast(importedShows.length + ' fechas importadas.');
  } catch (error) {
    console.error(error);
    toast(error.message || 'No se pudo importar esta gira.');
  } finally {
    button.disabled = false;
    button.textContent = 'CARGAR TODOS LOS SHOWS \u2197';
  }
}

function normalizeTitle(value) { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function paletteColor(index) { return ['#861522', '#a91c2c', '#c42435', '#d94150', '#eb6872'][index % 5]; }
function renderAll() { renderShows(); renderDetail(); updateStats(); renderMemory(); renderWrapped(); }

async function saveArchive() {
  if (demoMode) {
    localStorage.setItem(archiveStorageKey(), JSON.stringify({ shows, attended, setlists, activeTourName }));
    return;
  }
  if (!user || !db) throw new Error('Sign in to save this archive.');
  await setDoc(doc(db, 'users', user.uid, 'archives', currentUniverse), { shows, attended, setlists, activeTourName, updatedAt: new Date().toISOString() });
}
function showError(error) {
  console.error(error);
  toast('No se pudo sincronizar. Revisá la conexión y Firebase.');
}

async function signIn() {
  if (!configured) { $('setup-hint').hidden = false; toast('Falta configurar Firebase. Mirá README.md.'); return; }
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (error) { console.error(error); toast(error.code === 'auth/unauthorized-domain' ? 'Agregá este dominio en Firebase Authentication.' : 'No se pudo iniciar sesión con Google.'); }
}

async function addShow() {
  const date = $('new-show-date').value, place = $('new-show-place').value.trim(), color = $('new-show-color').value;
  if (!date || !place) { toast('Completá la fecha y el lugar del show.'); return; }
  const id = `show-${date}-${Math.random().toString(36).slice(2, 7)}`;
  shows.push({ id, date, place, country: place, color });
  selectedId = id;
  try { await saveArchive(); $('new-show-date').value = ''; $('new-show-place').value = ''; $('new-show-form').hidden = true; renderAll(); toast('Nueva fecha agregada al archivo.'); }
  catch (error) { shows = shows.filter((show) => showId(show) !== id); showError(error); }
}

function startDemo() {
  demoMode = true;
  user = null;
  shows = [];
  attended = [];
  setlists = {};
  activeTourName = '';
  const saved = localStorage.getItem(`${currentUniverse}-show-archive-demo`);
  if (saved) {
    try {
      const data = JSON.parse(saved);
      shows = Array.isArray(data.shows) ? data.shows : shows;
      attended = Array.isArray(data.attended) ? data.attended : [];
      setlists = data.setlists && typeof data.setlists === 'object' ? data.setlists : {};
      activeTourName = typeof data.activeTourName === 'string' ? data.activeTourName : '';
    } catch { localStorage.removeItem(`${currentUniverse}-show-archive-demo`); }
  }
  $('welcome').hidden = true;
  $('app').hidden = false;
  $('sign-in').hidden = false;
  $('sign-out').hidden = true;
  $('greeting').textContent = 'ARCHIVO LOCAL';
  $('sign-in').hidden = !configured;
  const firstVisible = shows.find((show) => isTargetTourShow(show) && (!activeTourName || show.tour === activeTourName));
  selectedId = firstVisible ? showId(firstVisible) : null;
  renderAll();
  loadTourOptions().then(renderAll);
  toast('Sin cuenta: tus cambios se guardan en este navegador.');
}

async function main() {
  const response = await fetch('./data/catalog.json');
  catalogData = await response.json();
  shows = [];
  renderAll();
  $('sign-in').addEventListener('click', signIn);
  $('welcome-sign-in').addEventListener('click', signIn);
  $('demo-mode').addEventListener('click', startDemo);
  $('sign-out').addEventListener('click', () => signOut(auth));
  $('add-show-toggle').addEventListener('click', () => { $('new-show-form').hidden = !$('new-show-form').hidden; });
  $('add-show').addEventListener('click', addShow);
  $('tour-select').addEventListener('change', async () => {
    activeTourName = $('tour-select').value;
    const firstShow = shows.find((show) => isTargetTourShow(show) && (!activeTourName || show.tour === activeTourName));
    selectedId = firstShow ? showId(firstShow) : null;
    renderAll();
    try { await saveArchive(); } catch (error) { showError(error); }
  });
  $('import-tour-button').addEventListener('click', importSelectedTour);
  $('memory-search').addEventListener('input', renderMemory);
  $('wrapped-content').addEventListener('click', async (event) => {
    if (!event.target.closest('[data-share-wrapped]')) return;
    const { nights, songs, cityCount, topSong } = getWrappedData();
    const summary = `${currentUniverse === 'bts' ? 'Mi BTS ARIRANG Wrapped' : 'Mi LLTBP Wrapped desde 2021'}: ${nights.length} shows, ${songs.length} canciones distintas y ${cityCount} ciudades.${topSong ? ` Mi canción más vivida: ${topSong.title}.` : ''}`;
    try {
      await navigator.clipboard.writeText(summary);
      toast('Resumen copiado. Listo para compartir.');
    } catch {
      toast(summary);
    }
  });
  if (!configured) { $('setup-hint').hidden = false; return; }
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app); db = getFirestore(app);
  const functions = getFunctions(app);
  // Use deployed Firebase Functions even when the static app is served from localhost.
  // setlist.fm needs about a minute to return the full MCR archive on a cold cache.
  listMcrToursAPI = httpsCallable(functions, 'listMcrTours', { timeout: 170000 });
  listBtsToursAPI = httpsCallable(functions, 'listBtsTours', { timeout: 170000 });
  onAuthStateChanged(auth, async (nextUser) => {
    user = nextUser;
    demoMode = false;
    $('welcome').hidden = !!user;
    $('app').hidden = !user;
    $('sign-in').hidden = !!user;
    $('sign-out').hidden = !user;
    if (!user) { shows = []; attended = []; setlists = {}; activeTourName = ''; selectedId = null; renderAll(); return; }
    shows = []; attended = []; setlists = {}; activeTourName = ''; selectedId = null;
    $('greeting').textContent = (user.displayName || 'BIENVENIDA').split(' ')[0].toLocaleUpperCase('es');
    try {
      let snapshot = await getDoc(doc(db, 'users', user.uid, 'archives', currentUniverse));
      // Migrate the previous MCR archive location on read, without mixing BTS data.
      if (!snapshot.exists() && currentUniverse === 'mcr') {
        snapshot = await getDoc(doc(db, 'users', user.uid));
      }
      if (snapshot.exists()) {
        const data = snapshot.data();
        shows = Array.isArray(data.shows) ? data.shows : [];
        attended = Array.isArray(data.attended) ? data.attended : [];
        setlists = data.setlists && typeof data.setlists === 'object' ? data.setlists : {};
        activeTourName = typeof data.activeTourName === 'string' ? data.activeTourName : '';
      }
      await loadTourOptions();
      const firstVisible = shows.find((show) => isTargetTourShow(show) && (!activeTourName || show.tour === activeTourName));
      selectedId = firstVisible ? showId(firstVisible) : null;
      renderAll();
    } catch (error) { showError(error); }
  });
}


window.addEventListener('music-universe-change', async (event) => {
  const next = event.detail?.universe;
  if (!['mcr', 'bts'].includes(next)) return;
  currentUniverse = next;
  document.body.dataset.universe = next;
  const bts = next === 'bts';
  document.title = bts ? 'KEEP SWIMMING — BTS Concert Quest' : 'Our Lives in Black & Red — MCR Concert Archive';
  document.querySelector('.brand').innerHTML = bts ? '<span class="brand-mark">BTS</span><span>KEEP<br>SWIMMING</span>' : '<span class="brand-mark">MCR</span><span>OUR LIVES<br>IN BLACK & RED</span>';
  document.querySelector('.archive-heading .eyebrow').innerHTML = bts ? 'YOUR BTS ARIRANG ARCHIVE' : 'YOUR MCR SHOW ARCHIVE <span class="slash">/</span> <span id="greeting">BIENVENIDA</span>';
  document.querySelector('.archive-heading h2').textContent = bts ? 'LAS NOCHES DE ARIRANG.' : 'LAS NOCHES QUE VIVISTE.';
  document.querySelector('.show-library .section-note').textContent = bts ? 'Fechas pasadas de ARIRANG con setlist publicado. Marcá solo los conciertos a los que fuiste.' : 'Elegí una gira Black Parade de 2025 o 2026 y marcá los shows a los que fuiste.';
  document.querySelector('.setlist-source label').textContent = bts ? 'ELEGIR GIRA DE BTS' : 'ELEGIR GIRA DE MY CHEMICAL ROMANCE';
  document.querySelector('.setlist-source small').textContent = bts ? 'Solo aparecen fechas pasadas con setlist publicado en setlist.fm.' : 'Buscando solo giras Black Parade de 2025 y 2026 en setlist.fm.';
  document.querySelector('.memory-board h3').textContent = bts ? 'LAS CANCIONES QUE ESCUCHASTE EN VIVO' : 'LAS CANCIONES QUE VIVISTE';
  const hero = document.querySelector('.hero-copy');
  if (hero) hero.innerHTML = bts ? '<p class="eyebrow">✦ YOUR ARIRANG QUEST</p><h1>KEEP<br><em>SWIMMING.</em></h1><p class="hero-subtitle">Cada concierto, cada canción y cada recuerdo que se queda con vos.</p>' : '<p class="eyebrow"><span class="live-dot"></span> THE NIGHTS THAT NEVER LEFT</p><h1>WHERE THE<br><em>NIGHT HAPPENED.</em></h1><p class="hero-subtitle">Cada show, cada canción, cada recuerdo que quedó en vos.</p>';
  const stamp = document.querySelector('.hero-stamp');
  if (stamp) stamp.innerHTML = bts ? '<span>BTS<br>ARIRANG</span><strong>SWIM</strong><span>KEEP<br>SWIMMING</span>' : '<span>THREE CHEERS<br>FOR ALL THE</span><strong>NIGHTS</strong><span>WE SURVIVED</span>';
  if (demoMode) { startDemo(); return; }
  if (user && db) {
    shows = []; attended = []; setlists = {}; activeTourName = ''; selectedId = null;
    try {
      const snapshot = await getDoc(doc(db, 'users', user.uid, 'archives', currentUniverse));
      if (snapshot.exists()) {
        const data = snapshot.data();
        shows = Array.isArray(data.shows) ? data.shows : [];
        attended = Array.isArray(data.attended) ? data.attended : [];
        setlists = data.setlists && typeof data.setlists === 'object' ? data.setlists : {};
        activeTourName = typeof data.activeTourName === 'string' ? data.activeTourName : '';
      }
    } catch (error) { showError(error); }
    await loadTourOptions();
    const first = shows.find(show => isTargetTourShow(show) && (!activeTourName || show.tour === activeTourName));
    selectedId = first ? showId(first) : null;
    renderAll();
  } else {
    shows = []; attended = []; setlists = {}; activeTourName = ''; selectedId = null;
    $('welcome').hidden = false; $('app').hidden = true;
  }
});

main().catch((error) => { console.error(error); toast('No se pudo cargar el archivo de shows.'); });
