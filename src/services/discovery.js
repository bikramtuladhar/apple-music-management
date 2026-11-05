import { getAiConfig, generateJson, paced } from './ai.js';
import { loadStore, saveStore } from '../bridge/appleMusicBridge.js';
import { getEnrichedTracks } from './categorizer.js';

// Apple's public catalog search: no key, ~20 req/min, so calls are capped and results cached.
const SEARCH_URL = 'https://itunes.apple.com/search';
const CACHE_MS = 12 * 60 * 60 * 1000;
const TOP_ARTISTS = 6;
const SIMILAR_ARTISTS = 8;

export const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]\s*/g, ' ') // drop "(feat. x)", "[Remastered]", "(Sped Up)"
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

// First credited artist: "A & B", "A, B", "A feat. B" -> "A"
const firstArtist = (s) => String(s || '').split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b|\bwith\b)\s*/i)[0].trim();
export const leadArtist = (s) => norm(firstArtist(s));

/**
 * Weight each artist/genre by how much you actually listen: plays, love, recency; skips count against.
 */
export function buildTasteProfile(tracks) {
  const artists = new Map();
  const genres = new Map();
  for (const t of tracks) {
    if (t.disliked) continue;
    // Plays drive taste; a love boosts a played song, and counts a little on its own
    const plays = t.playedCount || 0;
    const w =
      plays * (t.favorited ? 1.5 : 1) -
      2 * (t.skippedCount || 0) +
      (t.favorited ? 2 : 0) +
      (plays > 0 && t.daysSinceLastPlayed != null && t.daysSinceLastPlayed <= 30 ? 5 : 0);
    if (w <= 0) continue;
    const key = leadArtist(t.artist);
    if (key) {
      const a = artists.get(key) || { name: firstArtist(t.artist), score: 0, plays: 0, loved: 0 };
      a.score += w;
      a.plays += plays;
      if (t.favorited) a.loved++;
      artists.set(key, a);
    }
    if (t.genre && t.genre !== 'Uncategorized') genres.set(t.genre, (genres.get(t.genre) || 0) + w);
  }
  const byScore = (a, b) => b.score - a.score;
  return {
    topArtists: [...artists.values()].sort(byScore).slice(0, 20),
    topGenres: [...genres.entries()]
      .map(([name, score]) => ({ name, score }))
      .sort(byScore)
      .slice(0, 8)
  };
}

export function toPick(r, reason, source) {
  return {
    catalogId: String(r.trackId),
    name: r.trackName,
    artist: r.artistName,
    album: r.collectionName || '',
    genre: r.primaryGenreName || '',
    durationSec: Math.round((r.trackTimeMillis || 0) / 1000),
    artworkUrl: (r.artworkUrl100 || '').replace('100x100bb', '300x300bb'),
    previewUrl: r.previewUrl || null,
    url: r.trackViewUrl || null,
    reason,
    source
  };
}

/** Drop songs already in the library (by title + lead artist), dismissed ones, and duplicates. */
export function filterNew(results, { ownedKeys, dismissed, seen }) {
  return results.filter((r) => {
    if (r.kind !== 'song' || !r.trackViewUrl) return false;
    const key = `${norm(r.trackName)}|${leadArtist(r.artistName)}`;
    const id = String(r.trackId);
    if (ownedKeys.has(key) || dismissed.has(id) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function searchSongs(term, country, limit) {
  const url = `${SEARCH_URL}?${new URLSearchParams({ term, entity: 'song', limit: String(limit), country })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`catalog search ${res.status}`);
  return (await res.json()).results || [];
}

async function suggestSimilarArtists(cfg, profile, knownArtists) {
  const prompt = `A listener's taste, from their Apple Music play history.
Top artists (most loved first): ${profile.topArtists.slice(0, 15).map((a) => a.name).join(', ')}
Top genres: ${profile.topGenres.map((g) => g.name).join(', ')}
Suggest ${SIMILAR_ARTISTS} artists they would likely love but are NOT in this list of artists they already have: ${knownArtists.slice(0, 200).join(', ')}.
Match the languages and regional scenes in their taste. Give a short reason (max 10 words) for each.`;
  const out = await paced(cfg, () =>
    generateJson(cfg, {
      prompt,
      name: 'similar_artists',
      schema: {
        type: 'object',
        properties: {
          artists: {
            type: 'array',
            items: {
              type: 'object',
              properties: { name: { type: 'string' }, reason: { type: 'string' } },
              required: ['name', 'reason']
            }
          }
        },
        required: ['artists']
      }
    })
  );
  return Array.isArray(out?.artists) ? out.artists : [];
}

/**
 * Recommend catalog songs you don't own: more from your most-loved artists,
 * plus (with an AI key) artists similar to your taste.
 */
export async function getDiscovery({ refresh = false } = {}) {
  const store = await loadStore();
  store.discovery ||= { dismissed: [], cache: null };
  const country = (process.env.DISCOVERY_COUNTRY || store.discovery.country || 'us').toLowerCase();

  const cache = store.discovery.cache;
  if (!refresh && cache && Date.now() - Date.parse(cache.generatedAt) < CACHE_MS && cache.country === country) {
    const dismissed = new Set(store.discovery.dismissed);
    return { ...cache, picks: cache.picks.filter((p) => !dismissed.has(p.catalogId)), cached: true };
  }

  const tracks = await getEnrichedTracks();
  const profile = buildTasteProfile(tracks);
  const ownedKeys = new Set(tracks.map((t) => `${norm(t.name)}|${leadArtist(t.artist)}`));
  const ctx = { ownedKeys, dismissed: new Set(store.discovery.dismissed), seen: new Set() };
  const picks = [];
  const errors = [];

  for (const a of profile.topArtists.slice(0, TOP_ARTISTS)) {
    try {
      const results = (await searchSongs(a.name, country, 25)).filter((r) => leadArtist(r.artistName) === leadArtist(a.name));
      filterNew(results, ctx)
        .slice(0, 4)
        .forEach((r) => picks.push(toPick(r, `More from ${a.name} · ${a.plays ? `you've played them ${a.plays}×` : `you loved ${a.loved} of their songs`}`, 'top-artist')));
    } catch (err) {
      errors.push(`${a.name}: ${err.message}`);
    }
  }

  let engine = 'top-artists';
  const ai = getAiConfig(store);
  if (ai) {
    try {
      const known = [...new Set(tracks.map((t) => t.artist))];
      const similar = await suggestSimilarArtists(ai, profile, known);
      engine = `top-artists + ${ai.provider}-similar`;
      for (const s of similar.slice(0, SIMILAR_ARTISTS)) {
        try {
          const results = (await searchSongs(s.name, country, 10)).filter((r) => leadArtist(r.artistName) === leadArtist(s.name));
          filterNew(results, ctx)
            .slice(0, 2)
            .forEach((r) => picks.push(toPick(r, `New artist for you · ${s.reason}`, 'similar')));
        } catch (err) {
          errors.push(`${s.name}: ${err.message}`);
        }
      }
    } catch (err) {
      errors.push(`${ai.label}: ${err.message}`);
    }
  }

  const result = {
    generatedAt: new Date().toISOString(),
    country,
    engine,
    profile: {
      topArtists: profile.topArtists.slice(0, 8).map(({ name, plays }) => ({ name, plays })),
      topGenres: profile.topGenres.slice(0, 6).map(({ name }) => name)
    },
    picks,
    errors
  };
  // Only cache a usable result, so a network blip doesn't stick for 12h
  if (picks.length) store.discovery.cache = result;
  await saveStore(store);
  return { ...result, cached: false };
}

export async function dismissPick(catalogId) {
  const store = await loadStore();
  store.discovery ||= { dismissed: [], cache: null };
  store.discovery.dismissed = [...new Set([...store.discovery.dismissed, String(catalogId)])];
  await saveStore(store);
  return store.discovery.dismissed.length;
}

/**
 * Artists that share your playlists with the seed songs (the playing track + your other songs by its artist), ranked by how many playlists they co-occur in.
 * Your own curation is the "people who like X also like Y" signal, no external API needed.
 */
export function playlistNeighbours(seedIds, playlists, tracksById, excludeArtistKey) {
  const counts = new Map();
  for (const pl of playlists) {
    const ids = pl.trackIds || [];
    if (!ids.some((id) => seedIds.has(id))) continue;
    const seenHere = new Set();
    for (const id of ids) {
      const t = tracksById.get(id);
      const key = t && leadArtist(t.artist);
      if (!key || key === excludeArtistKey || seenHere.has(key)) continue;
      seenHere.add(key);
      const c = counts.get(key) || { name: firstArtist(t.artist), shared: 0, plays: 0 };
      c.shared++;
      counts.set(key, c);
    }
    // weight by how much you actually play them
    for (const id of ids) {
      const t = tracksById.get(id);
      const c = t && counts.get(leadArtist(t.artist));
      if (c) c.plays += t.playedCount || 0;
    }
  }
  return [...counts.values()].sort((a, b) => b.shared - a.shared || b.plays - a.plays);
}

// ponytail: in-memory per-track cache, lost on restart; fine for a single local user
const nowCache = new Map();

/**
 * "Because you're playing X": picks seeded by the current song, for shuffle sessions.
 */
export async function getNowPlayingPicks(nowPlaying) {
  if (!nowPlaying?.persistentID) return { seed: null, picks: [], errors: [] };
  const pid = nowPlaying.persistentID;
  const store = await loadStore();
  const country = (process.env.DISCOVERY_COUNTRY || store.discovery?.country || 'us').toLowerCase();
  const dismissed = new Set(store.discovery?.dismissed || []);
  const hit = nowCache.get(pid);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return { ...hit.result, picks: hit.result.picks.filter((p) => !dismissed.has(p.catalogId)) };
  }

  const tracks = await getEnrichedTracks();
  const tracksById = new Map(tracks.map((t) => [t.persistentID, t]));
  const lib = tracksById.get(pid);
  const seed = {
    persistentID: pid,
    name: nowPlaying.name || lib?.name,
    artist: firstArtist(nowPlaying.artist || lib?.artist),
    album: nowPlaying.album || lib?.album || '',
    genre: lib?.genre || ''
  };
  const artistKey = leadArtist(seed.artist);
  const ctx = {
    ownedKeys: new Set(tracks.map((t) => `${norm(t.name)}|${leadArtist(t.artist)}`)),
    dismissed,
    seen: new Set()
  };
  ctx.seen.add(`${norm(seed.name)}|${artistKey}`); // never recommend the song that's playing
  const picks = [];
  const errors = [];
  const add = async (term, limit, keep, take, reason, source) => {
    try {
      const results = (await searchSongs(term, country, limit)).filter(keep);
      filterNew(results, ctx).slice(0, take).forEach((r) => picks.push(toPick(r, reason, source)));
    } catch (err) {
      errors.push(`${term}: ${err.message}`);
    }
  };
  const byArtist = (name) => (r) => leadArtist(r.artistName) === leadArtist(name);

  if (seed.album) {
    await add(`${seed.artist} ${seed.album}`, 25, (r) => byArtist(seed.artist)(r) && norm(r.collectionName) === norm(seed.album), 3, `Same album · ${seed.album}`, 'album');
  }
  await add(seed.artist, 25, byArtist(seed.artist), 3, `More from ${seed.artist}`, 'artist');

  const seedIds = new Set([pid, ...tracks.filter((t) => leadArtist(t.artist) === artistKey).map((t) => t.persistentID)]);
  for (const n of playlistNeighbours(seedIds, store.playlists || [], tracksById, artistKey).slice(0, 4)) {
    await add(n.name, 15, byArtist(n.name), 2, `Shares ${n.shared > 1 ? `${n.shared} playlists` : 'a playlist'} with ${seed.artist}`, 'neighbour');
  }

  const ai = getAiConfig(store);
  if (ai) {
    try {
      const known = [...new Set(tracks.map((t) => t.artist))];
      const similar = await suggestSimilarArtists(
        ai,
        { topArtists: [{ name: `${seed.artist} (song: ${seed.name})` }], topGenres: seed.genre ? [{ name: seed.genre }] : [] },
        known
      );
      for (const s of similar.slice(0, 3)) {
        await add(s.name, 10, byArtist(s.name), 1, `Sounds like ${seed.artist} · ${s.reason}`, 'similar');
      }
    } catch (err) {
      errors.push(`${ai.label}: ${err.message}`);
    }
  }

  const result = { seed, generatedAt: new Date().toISOString(), picks, errors };
  if (picks.length) {
    nowCache.set(pid, { at: Date.now(), result });
    if (nowCache.size > 50) nowCache.delete(nowCache.keys().next().value);
  }
  return result;
}

// ---------- New releases from the artists you play ----------
const LOOKUP_URL = 'https://itunes.apple.com/lookup';
const RELEASE_ARTISTS = 20;
const RELEASE_WINDOW_DAYS = 180;

/** Keep recent releases you don't own, newest first, one per title (deluxe/standard collapse). */
export function pickReleases(results, { since, ownedAlbums, playsByArtistId }) {
  const seen = new Set();
  // Lookup lists each artist row, then that artist's releases; remember whose list each release came from
  let current = null;
  for (const r of results) {
    if (r.wrapperType === 'artist') current = playsByArtistId.get(r.artistId) || null;
    else r._fan = playsByArtistId.get(r.artistId) || current;
  }
  return results
    .filter((r) => r.wrapperType === 'collection' && r.releaseDate && r.releaseDate >= since)
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
    .filter((r) => {
      const key = `${norm(r.collectionName.replace(/ - (Single|EP)$/, ''))}|${leadArtist(r.artistName)}`;
      if (seen.has(key) || ownedAlbums.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((r) => {
      const kind = / - Single$/.test(r.collectionName) ? 'Single' : / - EP$/.test(r.collectionName) ? 'EP' : 'Album';
      const fan = r._fan;
      return {
        catalogId: String(r.collectionId),
        name: r.collectionName.replace(/ - (Single|EP)$/, ''),
        artist: r.artistName,
        kind,
        releaseDate: r.releaseDate.slice(0, 10),
        trackCount: r.trackCount || 0,
        artworkUrl: (r.artworkUrl100 || '').replace('100x100bb', '300x300bb'),
        url: r.collectionViewUrl || null,
        reason: `${kind} · ${new Date(r.releaseDate).toLocaleDateString('en', { month: 'short', day: 'numeric' })} · ${
          !fan ? 'features an artist you play' : fan.plays ? `you've played ${fan.name} ${fan.plays}×` : `you loved ${fan.loved} ${fan.name} songs`
        }`
      };
    });
}

async function findArtistId(name, country) {
  const url = `${SEARCH_URL}?${new URLSearchParams({ term: name, entity: 'musicArtist', limit: '5', country })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`artist search ${res.status}`);
  const hit = ((await res.json()).results || []).find((r) => leadArtist(r.artistName) === leadArtist(name));
  return hit?.artistId || 0; // 0 = not on Apple Music; cached so we don't search again
}

/** Singles, EPs and albums from your top artists released in the last ~6 months. Cached 12h. */
export async function getNewReleases({ refresh = false } = {}) {
  const store = await loadStore();
  store.discovery ||= { dismissed: [], cache: null };
  const d = store.discovery;
  const country = (process.env.DISCOVERY_COUNTRY || d.country || 'us').toLowerCase();
  if (!refresh && d.releases && Date.now() - Date.parse(d.releases.generatedAt) < CACHE_MS && d.releases.country === country) {
    const dismissed = new Set(d.dismissed);
    return { ...d.releases, releases: d.releases.releases.filter((r) => !dismissed.has(r.catalogId)), cached: true };
  }

  const tracks = await getEnrichedTracks();
  const top = buildTasteProfile(tracks).topArtists.slice(0, RELEASE_ARTISTS);
  d.artistIds ||= {};
  const errors = [];
  for (const a of top) {
    const key = leadArtist(a.name);
    if (key in d.artistIds) continue;
    try {
      d.artistIds[key] = await findArtistId(a.name, country);
    } catch (err) {
      errors.push(`${a.name}: ${err.message}`);
    }
  }
  const playsByArtistId = new Map(top.filter((a) => d.artistIds[leadArtist(a.name)]).map((a) => [d.artistIds[leadArtist(a.name)], a]));

  let releases = [];
  if (playsByArtistId.size) {
    try {
      const url = `${LOOKUP_URL}?${new URLSearchParams({ id: [...playsByArtistId.keys()].join(','), entity: 'album', sort: 'recent', limit: '10', country })}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`catalog lookup ${res.status}`);
      const since = new Date(Date.now() - RELEASE_WINDOW_DAYS * 86400000).toISOString();
      const ownedAlbums = new Set(tracks.map((t) => `${norm(t.album)}|${leadArtist(t.artist)}`));
      const dismissed = new Set(d.dismissed);
      releases = pickReleases((await res.json()).results || [], { since, ownedAlbums, playsByArtistId }).filter((r) => !dismissed.has(r.catalogId));
    } catch (err) {
      errors.push(err.message);
    }
  }

  const result = { generatedAt: new Date().toISOString(), country, artistsChecked: playsByArtistId.size, releases, errors };
  if (!errors.length || releases.length) d.releases = result;
  await saveStore(store);
  return { ...result, cached: false };
}
