const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const setlistFmApiKey = defineSecret('SETLISTFM_API_KEY');
const MCR_MBID = 'c07f0676-9143-4217-8a9f-4c26bd636f13';
const TARGET_YEARS = [2025, 2026];
const TOUR_FILTER = 'Black Parade';
const NO_TOUR = 'Other / no tour listed';
let cachedSetlists = null;
let cacheExpiresAt = 0;
let pendingSetlists = null;

function toISODate(eventDate) {
  const parts = String(eventDate || '').split('-');
  if (parts.length !== 3) return '';
  const [day, month, year] = parts;
  if (!/^\d{1,2}$/.test(day) || !/^\d{1,2}$/.test(month) || !/^\d{4}$/.test(year)) return '';
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

async function getAllMcrSetlists(apiKey) {
  if (cachedSetlists && Date.now() < cacheExpiresAt) return cachedSetlists;
  if (pendingSetlists) return pendingSetlists;

  pendingSetlists = (async () => {
    const found = [];
    for (let yearIndex = 0; yearIndex < TARGET_YEARS.length; yearIndex += 1) {
      const year = TARGET_YEARS[yearIndex];
      let page = 1;
      let total = Number.POSITIVE_INFINITY;
      let perPage = 20;
      while (true) {
        let response;
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const url = new URL('https://api.setlist.fm/rest/1.0/search/setlists');
          url.searchParams.set('artistMbid', MCR_MBID);
          url.searchParams.set('year', String(year));
          url.searchParams.set('tourName', TOUR_FILTER);
          url.searchParams.set('p', String(page));
          response = await fetch(url, {
            headers: { Accept: 'application/json', 'x-api-key': apiKey }
          });
          if (response.status !== 429) break;
          if (attempt === 4) {
            throw new HttpsError('resource-exhausted', 'setlist.fm is rate-limiting requests. Wait a few minutes and try again.');
          }
          const retryAfter = Number(response.headers.get('retry-after'));
          const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 5000 * (2 ** attempt);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        if (!response.ok) throw new HttpsError('unavailable', `setlist.fm returned ${response.status}.`);
        const payload = await response.json();
        const entries = Array.isArray(payload.setlist) ? payload.setlist : (payload.setlist ? [payload.setlist] : []);
        found.push(...entries.filter((event) => {
          const eventYear = toISODate(event.eventDate).slice(0, 4);
          return eventYear === String(year) && eventTour(event).toLowerCase().includes(TOUR_FILTER.toLowerCase());
        }));
        total = Number(payload.total ?? entries.length);
        perPage = Number(payload.itemsPerPage || perPage);
        if (!entries.length || page * perPage >= total) break;
        // Keep requests comfortably below the upstream rate limit.
        await new Promise((resolve) => setTimeout(resolve, 1250));
        page += 1;
      }
      if (yearIndex < TARGET_YEARS.length - 1) await new Promise((resolve) => setTimeout(resolve, 1250));
    }
    const unique = new Map();
    found.forEach((item) => { if (item.id) unique.set(item.id, item); });
    const complete = [...unique.values()];
    // Search results can omit their song sets. Fetch the canonical setlist record
    // only for those entries so imported 2025 shows include their track lists.
    for (let index = 0; index < complete.length; index += 1) {
      if (readSongs(complete[index]).length) continue;
      const detailUrl = new URL(`https://api.setlist.fm/rest/1.0/setlist/${encodeURIComponent(complete[index].id)}`);
      const detailResponse = await fetch(detailUrl, {
        headers: { Accept: 'application/json', 'x-api-key': apiKey }
      });
      if (detailResponse.status === 429) {
        const retryAfter = Number(detailResponse.headers.get('retry-after'));
        await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000));
        const retryResponse = await fetch(detailUrl, {
          headers: { Accept: 'application/json', 'x-api-key': apiKey }
        });
        if (retryResponse.ok) complete[index] = { ...complete[index], ...await retryResponse.json() };
      } else if (detailResponse.ok) {
        const detail = await detailResponse.json();
        complete[index] = { ...complete[index], ...detail };
      }
      if (index < complete.length - 1) await new Promise((resolve) => setTimeout(resolve, 1100));
    }
    cachedSetlists = complete;
    cacheExpiresAt = Date.now() + 6 * 60 * 60 * 1000;
    return cachedSetlists;
  })();
  try {
    return await pendingSetlists;
  } finally {
    pendingSetlists = null;
  }
}

function eventTour(event) { return String(event.tour?.name || NO_TOUR); }

function readSongs(event) {
  // setlist.fm nests the song sets under `sets.set` in its API response.
  // Accept the old/direct `set` shape too, so cached or alternate responses work.
  const rawSets = event.sets?.set ?? event.sets ?? event.set;
  const sets = Array.isArray(rawSets) ? rawSets : (rawSets ? [rawSets] : []);
  return sets.flatMap((set) => {
    const entries = Array.isArray(set.song) ? set.song : (set.song ? [set.song] : []);
    const section = String(set.name || set.encore || '').trim();
    const isBStage = /\bb[\s-]*stage\b/i.test(section);
    return entries.map((song) => ({ title: String(song.name || '').trim(), section, isBStage })).filter((song) => song.title);
  });
}

function showRecord(event) {
  const city = event.venue?.city || {};
  return {
    setlistId: event.id,
    url: event.url,
    date: toISODate(event.eventDate),
    place: event.venue?.name || '',
    city: city.name || '',
    country: city.country?.name || '',
    tour: eventTour(event),
    songs: readSongs(event)
  };
}

exports.listMcrTours = onCall({
  region: 'us-central1',
  timeoutSeconds: 180,
  secrets: [setlistFmApiKey]
}, async (request) => {
  const events = await getAllMcrSetlists(setlistFmApiKey.value());
  const shows = events.map(showRecord).filter((show) => show.date);
  const counts = new Map();
  shows.forEach((show) => {
    const name = show.tour;
    const summary = counts.get(name) || { name, count: 0, newestDate: '' };
    summary.count += 1;
    const eventDate = show.date;
    if (eventDate > summary.newestDate) summary.newestDate = eventDate;
    counts.set(name, summary);
  });
  const tours = [...counts.values()].sort((a, b) => b.newestDate.localeCompare(a.newestDate) || a.name.localeCompare(b.name));
  return { tours, shows };
});

