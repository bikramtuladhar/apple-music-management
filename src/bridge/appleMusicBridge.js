import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const STORE_PATH = process.env.CRATE_STORE_PATH || path.join(DATA_DIR, 'library-store.json'); // env override is for tests

/**
 * Default starter sample tracks used ONLY if macOS Music.app library is completely empty
 * or if the user enables Demo Mode to test sorting/TikTok categorization.
 */
const SAMPLE_TRACKS = [
  {
    id: 'demo-101',
    persistentID: 'DEMO000101',
    name: 'Montagem Coral (Sped Up)',
    artist: 'DJ Holanda & MC GW',
    album: 'TikTok Phonk Edits Vol. 4',
    genre: 'Brazilian Phonk',
    duration: 114,
    playedCount: 64,
    skippedCount: 2,
    playedDate: '2026-11-04T19:20:00.000Z',
    dateAdded: '2026-07-12T10:00:00.000Z',
    year: 2024,
    favorited: true,
    disliked: false,
    comment: 'viral tiktok gym edit',
    source: 'demo'
  },
  {
    id: 'demo-102',
    persistentID: 'DEMO000102',
    name: 'Million Dollar Baby (VHS)',
    artist: 'Tommy Richman',
    album: 'COYOTE',
    genre: 'R&B/Soul',
    duration: 155,
    playedCount: 89,
    skippedCount: 3,
    playedDate: '2026-11-05T04:15:00.000Z',
    dateAdded: '2026-05-02T14:30:00.000Z',
    year: 2024,
    favorited: true,
    disliked: false,
    comment: 'tiktok viral sound',
    source: 'demo'
  },
  {
    id: 'demo-103',
    persistentID: 'DEMO000103',
    name: 'Nasty',
    artist: 'Tinashe',
    album: 'Quantum Baby',
    genre: 'Pop',
    duration: 176,
    playedCount: 41,
    skippedCount: 5,
    playedDate: '2026-10-29T18:10:00.000Z',
    dateAdded: '2026-06-01T08:12:00.000Z',
    year: 2024,
    favorited: false,
    disliked: false,
    comment: 'tiktok dance trend',
    source: 'demo'
  },
  {
    id: 'demo-104',
    persistentID: 'DEMO000104',
    name: '360',
    artist: 'Charli xcx',
    album: 'BRAT',
    genre: 'Pop / Hyperpop',
    duration: 133,
    playedCount: 112,
    skippedCount: 1,
    playedDate: '2026-11-05T06:40:00.000Z',
    dateAdded: '2026-06-07T00:00:00.000Z',
    year: 2024,
    favorited: true,
    disliked: false,
    comment: '',
    source: 'demo'
  },
  {
    id: 'demo-105',
    persistentID: 'DEMO000105',
    name: 'Midnight City',
    artist: 'M83',
    album: "Hurry Up, We're Dreaming",
    genre: 'Electronic',
    duration: 243,
    playedCount: 145,
    skippedCount: 4,
    playedDate: '2026-11-03T22:15:00.000Z',
    dateAdded: '2024-02-11T16:00:00.000Z',
    year: 2011,
    favorited: true,
    disliked: false,
    comment: 'night drive classic',
    source: 'demo'
  },
  {
    id: 'demo-106',
    persistentID: 'DEMO000106',
    name: 'Tell Ur Girlfriend (Slowed + Reverb)',
    artist: 'Lay Bankz',
    album: 'Tell Ur Girlfriend - Single',
    genre: 'Hip-Hop/Rap',
    duration: 142,
    playedCount: 27,
    skippedCount: 11,
    playedDate: '2026-08-14T11:20:00.000Z',
    dateAdded: '2026-04-19T09:00:00.000Z',
    year: 2024,
    favorited: false,
    disliked: false,
    comment: 'tiktok edit',
    source: 'demo'
  },
  {
    id: 'demo-107',
    persistentID: 'DEMO000107',
    name: 'METAMORPHOSIS',
    artist: 'INTERWORLD',
    album: 'METAMORPHOSIS - Single',
    genre: 'Drift Phonk',
    duration: 142,
    playedCount: 53,
    skippedCount: 2,
    playedDate: '2026-10-30T15:00:00.000Z',
    dateAdded: '2025-11-10T12:00:00.000Z',
    year: 2021,
    favorited: true,
    disliked: false,
    comment: 'tiktok edit gym',
    source: 'demo'
  },
  {
    id: 'demo-108',
    persistentID: 'DEMO000108',
    name: 'Ambient Study Tape #9',
    artist: 'Kiasmos',
    album: 'Blurred EP',
    genre: 'Ambient / Electronic',
    duration: 318,
    playedCount: 0,
    skippedCount: 0,
    playedDate: null,
    dateAdded: '2025-09-01T10:00:00.000Z',
    year: 2017,
    favorited: false,
    disliked: false,
    comment: '',
    source: 'demo'
  },
  {
    id: 'demo-109',
    persistentID: 'DEMO000109',
    name: 'Boring Interlude Track',
    artist: 'The Overplayed Collective',
    album: 'Filler Deluxe',
    genre: 'Indie Rock',
    duration: 210,
    playedCount: 2,
    skippedCount: 19,
    playedDate: '2026-03-10T12:00:00.000Z',
    dateAdded: '2025-01-15T12:00:00.000Z',
    year: 2023,
    favorited: false,
    disliked: true,
    comment: '',
    source: 'demo'
  },
  {
    id: 'demo-110',
    persistentID: 'DEMO000110',
    name: 'Unopened Vinyl B-Side',
    artist: 'Khruangbin',
    album: 'A La Sala',
    genre: 'Psychedelic Funk',
    duration: 248,
    playedCount: 0,
    skippedCount: 0,
    playedDate: null,
    dateAdded: '2026-01-20T18:30:00.000Z',
    year: 2024,
    favorited: false,
    disliked: false,
    comment: '',
    source: 'demo'
  },
  {
    id: 'demo-111',
    persistentID: 'DEMO000111',
    name: 'Veridis Quo',
    artist: 'Daft Punk',
    album: 'Discovery',
    genre: 'Electronic',
    duration: 345,
    playedCount: 38,
    skippedCount: 0,
    playedDate: '2026-04-02T23:00:00.000Z',
    dateAdded: '2023-11-05T20:00:00.000Z',
    year: 2001,
    favorited: true,
    disliked: false,
    comment: 'forgotten gem',
    source: 'demo'
  },
  {
    id: 'demo-112',
    persistentID: 'DEMO000112',
    name: 'Espresso',
    artist: 'Sabrina Carpenter',
    album: "Short n' Sweet",
    genre: 'Pop',
    duration: 175,
    playedCount: 6,
    skippedCount: 14,
    playedDate: '2026-09-12T09:30:00.000Z',
    dateAdded: '2026-05-15T09:30:00.000Z',
    year: 2024,
    favorited: false,
    disliked: false,
    comment: 'overplayed radio/tiktok',
    source: 'demo'
  },
  {
    id: 'demo-113',
    persistentID: 'DEMO000113',
    name: 'Apple',
    artist: 'Charli xcx',
    album: 'BRAT',
    genre: 'Pop / Hyperpop',
    duration: 151,
    playedCount: 52,
    skippedCount: 2,
    playedDate: '2026-11-02T17:45:00.000Z',
    dateAdded: '2026-06-07T00:00:00.000Z',
    year: 2024,
    favorited: true,
    disliked: false,
    comment: 'tiktok apple dance',
    source: 'demo'
  },
  {
    id: 'demo-114',
    persistentID: 'DEMO000114',
    name: 'Resonance',
    artist: 'HOME',
    album: 'Odyssey',
    genre: 'Synthwave',
    duration: 212,
    playedCount: 95,
    skippedCount: 1,
    playedDate: '2026-11-04T23:50:00.000Z',
    dateAdded: '2024-08-19T14:20:00.000Z',
    year: 2014,
    favorited: true,
    disliked: false,
    comment: 'vaporwave tiktok nostalgia',
    source: 'demo'
  },
  {
    id: 'demo-115',
    persistentID: 'DEMO000115',
    name: 'Untouched Album Cut #4',
    artist: 'Bonobo',
    album: 'Fragments',
    genre: 'Downtempo',
    duration: 264,
    playedCount: 0,
    skippedCount: 0,
    playedDate: null,
    dateAdded: '2025-12-01T08:00:00.000Z',
    year: 2022,
    favorited: false,
    disliked: false,
    comment: '',
    source: 'demo'
  },
  {
    id: 'demo-116',
    persistentID: 'DEMO000116',
    name: 'ecstacy (slowed)',
    artist: 'SUICIDAL-IDOL',
    album: 'ecstacy - Single',
    genre: 'Hyperpop / Sigilkore',
    duration: 134,
    playedCount: 33,
    skippedCount: 3,
    playedDate: '2026-10-25T21:10:00.000Z',
    dateAdded: '2026-03-11T16:40:00.000Z',
    year: 2023,
    favorited: false,
    disliked: false,
    comment: 'tiktok viral audio',
    source: 'demo'
  }
];

const SAMPLE_PLAYLISTS = [
  {
    id: 'pl-demo-1',
    persistentID: 'PLDEMO001',
    name: 'Heavy Rotation 2026',
    description: 'Most listened tracks with low skip rate',
    trackCount: 5,
    trackIds: ['DEMO000102', 'DEMO000104', 'DEMO000105', 'DEMO000114', 'DEMO000101'],
    smart: false,
    source: 'demo'
  },
  {
    id: 'pl-demo-2',
    persistentID: 'PLDEMO002',
    name: 'TikTok & Viral Sounds',
    description: 'Auto-sorted viral edits, sped-up tracks, and TikTok audio',
    trackCount: 7,
    trackIds: ['DEMO000101', 'DEMO000102', 'DEMO000103', 'DEMO000106', 'DEMO000107', 'DEMO000113', 'DEMO000116'],
    smart: false,
    source: 'demo'
  }
];


/**
 * JXA helpers shared by write scripts. Prefer persistentID, fall back to name.
 * ponytail: playlist-only (cloud) tracks are found by scanning user playlists, O(playlists) per lookup.
 */
const JXA_HELPERS = `
  function findTrack(music, pid) {
    let m = music.libraryPlaylists[0].tracks.whose({ persistentID: pid })();
    if (m.length) return m[0];
    const pls = music.userPlaylists();
    for (let i = 0; i < pls.length; i++) {
      try {
        m = pls[i].tracks.whose({ persistentID: pid })();
        if (m.length) return m[0];
      } catch (e) {}
    }
    return null;
  }
  function findPlaylist(music, idOrName) {
    let m = music.userPlaylists.whose({ persistentID: idOrName })();
    if (!m.length) m = music.userPlaylists.whose({ name: idOrName })();
    return m.length ? m[0] : null;
  }
`;

/**
 * Run a JavaScript for Automation (JXA) script via macOS `osascript`
 */
async function runJXA(script, args = [], timeoutMs = 45000) {
  const fullArgs = ['-l', 'JavaScript', '-e', JXA_HELPERS + script, ...args.map(String)];
  let stdout;
  try {
    ({ stdout } = await execFileAsync('/usr/bin/osascript', fullArgs, {
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024
    }));
  } catch (err) {
    // Surface osascript's own message (e.g. Automation permission denied) instead of the full script
    const reason = err.killed ? `timed out after ${timeoutMs}ms` : String(err.stderr || err.message).trim();
    throw new Error(`osascript: ${reason}`);
  }
  const trimmed = stdout.trim();
  return trimmed ? JSON.parse(trimmed) : null;
}

/**
 * Ensure `data/library-store.json` exists and load it
 */
export async function loadStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    const initial = {
      lastSyncedAt: null,
      bridgeMode: 'auto', // 'live' | 'demo' | 'auto'
      tracks: [],
      playlists: [],
      customTags: {}, // persistentID -> { categories: [], isTikTok: bool, notes: '', manualTier: null }
      categorizationHistory: []
    };
    await saveStore(initial);
    return initial;
  }
}

export async function saveStore(store) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

/**
 * Fetch live tracks and playlists from macOS Music.app using fast batch property reads
 */
export async function fetchFromMusicApp() {
  const jxaScript = `
    function run() {
      try {
        const music = Application('Music');
        const isRunning = music.running();
        let playerState = 'stopped';
        let nowPlaying = null;

        if (isRunning) {
          try {
            playerState = music.playerState();
            if (playerState === 'playing' || playerState === 'paused') {
              const ct = music.currentTrack;
              nowPlaying = {
                name: ct.name(),
                artist: ct.artist(),
                album: ct.album(),
                duration: ct.duration(),
                playerPosition: music.playerPosition(),
                persistentID: ct.persistentID()
              };
            }
          } catch (e) {}
        }

        const trackMap = new Map();
        function ingestTracks(trList) {
          try {
            const count = trList.length;
            if (!count) return;
            const ids = trList.id();
            const persistentIDs = trList.persistentID();
            const names = trList.name();
            const artists = trList.artist();
            const albums = trList.album();
            const genres = trList.genre();
            const durations = trList.duration();
            const playedCounts = trList.playedCount();
            const skippedCounts = trList.skippedCount();
            const playedDates = trList.playedDate();
            const datesAdded = trList.dateAdded();
            const years = trList.year();
            const favoriteds = trList.favorited();
            const dislikeds = trList.disliked();
            const comments = trList.comment();

            for (let i = 0; i < count; i++) {
              const pid = String(persistentIDs[i]);
              if (trackMap.has(pid)) continue;
              trackMap.set(pid, {
                id: String(ids[i]),
                persistentID: pid,
                name: names[i] || 'Unknown Title',
                artist: artists[i] || 'Unknown Artist',
                album: albums[i] || '',
                genre: genres[i] || 'Uncategorized',
                duration: Math.round(durations[i] || 0),
                playedCount: Number(playedCounts[i] || 0),
                skippedCount: Number(skippedCounts[i] || 0),
                playedDate: playedDates[i] ? new Date(playedDates[i]).toISOString() : null,
                dateAdded: datesAdded[i] ? new Date(datesAdded[i]).toISOString() : null,
                year: Number(years[i] || 0),
                favorited: Boolean(favoriteds[i]),
                disliked: Boolean(dislikeds[i]),
                comment: comments[i] || '',
                source: 'music.app'
              });
            }
          } catch (e) {}
        }

        try {
          ingestTracks(music.libraryPlaylists[0].tracks);
        } catch (e) {}

        const userPls = music.userPlaylists();
        const playlists = [];
        for (let p = 0; p < userPls.length; p++) {
          const pl = userPls[p];
          try {
            const specialKind = pl.specialKind();
            if (specialKind && specialKind !== 'none') continue;
            let pTrackIds = [];
            try {
              pTrackIds = pl.tracks.persistentID() || [];
              ingestTracks(pl.tracks);
            } catch (e) {}
            playlists.push({
              id: String(pl.id()),
              persistentID: String(pl.persistentID()),
              name: pl.name(),
              description: (() => { try { return pl.description() || ''; } catch (e) { return ''; } })(),
              trackCount: pTrackIds.length,
              trackIds: pTrackIds.map(String),
              smart: Boolean(pl.smart()),
              source: 'music.app'
            });
          } catch (e) {}
        }

        const tracks = Array.from(trackMap.values());

        return JSON.stringify({
          ok: true,
          isRunning,
          playerState,
          nowPlaying,
          trackCount: tracks.length,
          tracks,
          playlists
        });
      } catch (err) {
        return JSON.stringify({
          ok: false,
          error: String(err && err.message ? err.message : err)
        });
      }
    }
  `;

  try {
    const result = await runJXA(jxaScript);
    return result || { ok: false, error: 'Empty response from osascript' };
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err)
    };
  }
}

/**
 * Sync library with Music.app (or seed demo tracks if Music.app has 0 tracks and mode !== 'live-empty')
 */
export async function syncLibrary({ forceDemo = false } = {}) {
  const store = await loadStore();
  const live = await fetchFromMusicApp();

  if (!forceDemo && live.ok && live.tracks && live.tracks.length > 0) {
    store.tracks = live.tracks;
    // Keep any local demo playlists if none exist, or replace with live playlists
    store.playlists = live.playlists;
    store.bridgeStatus = {
      connected: true,
      mode: 'live',
      musicAppTrackCount: live.tracks.length,
      playerState: live.playerState,
      nowPlaying: live.nowPlaying,
      error: null
    };
  } else {
    // Music.app has 0 local tracks or is not signed in yet: preserve live connection info + seed rich sample tracks so UI & MCP work immediately
    // Also merge any user playlists created in Music.app!
    const existingDemoTracks = store.tracks?.length > 0 ? store.tracks : SAMPLE_TRACKS;
    store.tracks = forceDemo ? SAMPLE_TRACKS : existingDemoTracks;

    const livePlaylists = live.ok && Array.isArray(live.playlists) ? live.playlists : [];
    const storedDemo = (store.playlists || []).filter((p) => p.source === 'demo');
    const demoPlaylists = forceDemo || storedDemo.length === 0 ? SAMPLE_PLAYLISTS : storedDemo;
    const mergedMap = new Map();
    for (const p of [...livePlaylists, ...demoPlaylists]) {
      mergedMap.set(p.persistentID || p.name, p);
    }
    store.playlists = Array.from(mergedMap.values());
    store.bridgeStatus = {
      connected: Boolean(live.ok),
      mode: 'demo-hybrid',
      musicAppTrackCount: live.ok ? live.trackCount : 0,
      playerState: live.ok ? live.playerState : 'stopped',
      nowPlaying: live.ok ? live.nowPlaying : null,
      note:
        live.ok && live.trackCount === 0
          ? 'Connected to macOS Music.app (0 local library tracks found; showing interactive sample library + live playlist creation in Music.app).'
          : live.error || 'Using sample library.'
    };
  }

  store.lastSyncedAt = new Date().toISOString();
  await saveStore(store);
  return store;
}

/**
 * Create a playlist in macOS Music.app (and persist in local store)
 */
export async function createAppleMusicPlaylist({ name, description = '', trackPersistentIds = [] }) {
  const store = await loadStore();
  const cleanName = String(name || 'Untitled Playlist').trim();

  const jxaCreate = `
    function run(argv) {
      const playlistName = argv[0];
      const playlistDesc = argv[1] || '';
      const trackIdsJson = argv[2] || '[]';
      const targetIds = JSON.parse(trackIdsJson);

      try {
        const music = Application('Music');
        let targetPl = null;
        const existing = music.userPlaylists.whose({ name: playlistName })();
        if (existing && existing.length > 0) {
          targetPl = existing[0];
        } else {
          targetPl = music.make({
            new: 'userPlaylist',
            withProperties: { name: playlistName }
          });
        }
        try {
          if (playlistDesc) targetPl.description = playlistDesc;
        } catch (e) {}

        let addedCount = 0;
        const present = new Set((targetPl.tracks.persistentID() || []).map(String));
        for (let i = 0; i < targetIds.length; i++) {
          const pid = targetIds[i];
          if (present.has(pid)) continue;
          try {
            const tr = findTrack(music, pid);
            if (tr) {
              music.duplicate(tr, { to: targetPl });
              present.add(pid);
              addedCount++;
            }
          } catch (e) {}
        }

        return JSON.stringify({
          ok: true,
          id: String(targetPl.id()),
          persistentID: String(targetPl.persistentID()),
          name: targetPl.name(),
          addedInMusicApp: addedCount
        });
      } catch (err) {
        return JSON.stringify({
          ok: false,
          error: String(err && err.message ? err.message : err)
        });
      }
    }
  `;

  let osResult = { ok: false };
  try {
    osResult = await runJXA(jxaCreate, [cleanName, description, JSON.stringify(trackPersistentIds)]);
  } catch (err) {
    osResult = { ok: false, error: err.message };
  }

  const persistentID = osResult?.ok ? osResult.persistentID : `PLLOCAL_${Date.now()}`;
  const existingIdx = store.playlists.findIndex(
    (p) => p.persistentID === persistentID || p.name.toLowerCase() === cleanName.toLowerCase()
  );

  const mergedTrackIds = Array.from(
    new Set([
      ...(existingIdx >= 0 ? store.playlists[existingIdx].trackIds || [] : []),
      ...trackPersistentIds
    ])
  );

  const playlistRecord = {
    id: osResult?.ok ? osResult.id : `local-${Date.now()}`,
    persistentID,
    name: cleanName,
    description,
    trackCount: mergedTrackIds.length,
    trackIds: mergedTrackIds,
    smart: false,
    syncedToMusicApp: Boolean(osResult?.ok),
    addedInMusicApp: osResult?.addedInMusicApp ?? 0,
    source: osResult?.ok ? 'music.app' : 'demo',
    createdAt: new Date().toISOString()
  };

  if (existingIdx >= 0) {
    store.playlists[existingIdx] = playlistRecord;
  } else {
    store.playlists.unshift(playlistRecord);
  }

  await saveStore(store);
  return playlistRecord;
}

/**
 * Add or remove tracks in an existing playlist
 */
export async function modifyPlaylistTracks({ playlistId, action = 'add', trackPersistentIds = [] }) {
  const store = await loadStore();
  const pl = store.playlists.find(
    (p) => p.persistentID === playlistId || p.id === playlistId || p.name.toLowerCase() === String(playlistId).toLowerCase()
  );
  if (!pl) {
    throw new Error(`Playlist not found: ${playlistId}`);
  }

  if (action === 'add') {
    // createAppleMusicPlaylist merges ids into the stored record and skips tracks already in Music.app
    return createAppleMusicPlaylist({
      name: pl.name,
      description: pl.description,
      trackPersistentIds
    });
  } else if (action === 'remove') {
    const removeSet = new Set(trackPersistentIds);
    pl.trackIds = (pl.trackIds || []).filter((id) => !removeSet.has(id));
    pl.trackCount = pl.trackIds.length;

    const jxaRemove = `
      function run(argv) {
        const plName = argv[0];
        const removeIds = JSON.parse(argv[1] || '[]');
        try {
          const music = Application('Music');
          const targetPl = findPlaylist(music, plName);
          if (!targetPl) return JSON.stringify({ ok: false });
          let removed = 0;
          for (let i = 0; i < removeIds.length; i++) {
            const trs = targetPl.tracks.whose({ persistentID: removeIds[i] })();
            for (let j = trs.length - 1; j >= 0; j--) {
              music.delete(trs[j]);
              removed++;
            }
          }
          return JSON.stringify({ ok: true, removed });
        } catch (err) {
          return JSON.stringify({ ok: false, error: String(err) });
        }
      }
    `;
    try {
      await runJXA(jxaRemove, [pl.persistentID || pl.name, JSON.stringify(trackPersistentIds)]);
    } catch {}
    await saveStore(store);
  }

  return pl;
}

/**
 * Delete a playlist from Music.app and local store
 */
export async function deleteAppleMusicPlaylist(playlistId) {
  const store = await loadStore();
  const idx = store.playlists.findIndex(
    (p) => p.persistentID === playlistId || p.id === playlistId || p.name.toLowerCase() === String(playlistId).toLowerCase()
  );
  if (idx === -1) {
    throw new Error(`Playlist not found: ${playlistId}`);
  }
  const removed = store.playlists[idx];
  store.playlists.splice(idx, 1);
  await saveStore(store);

  const jxaDelete = `
    function run(argv) {
      const plName = argv[0];
      try {
        const music = Application('Music');
        const pl = findPlaylist(music, plName);
        if (pl) {
          music.delete(pl);
          return JSON.stringify({ ok: true });
        }
        return JSON.stringify({ ok: false, reason: 'not_found_in_music_app' });
      } catch (e) {
        return JSON.stringify({ ok: false, error: String(e) });
      }
    }
  `;
  try {
    await runJXA(jxaDelete, [removed.persistentID || removed.name]);
  } catch {}

  return removed;
}

/**
 * Update track metadata in local store AND sync back to Music.app if live track
 */
export async function updateTrackMetadata(trackId, updates = {}) {
  const store = await loadStore();
  const track = store.tracks.find((t) => t.persistentID === trackId || t.id === trackId);
  if (!track) {
    throw new Error(`Track not found: ${trackId}`);
  }

  const pid = track.persistentID;
  store.customTags ||= {};
  if (!store.customTags[pid]) {
    store.customTags[pid] = { categories: [], isTikTok: false, notes: '' };
  }
  store.customTags[pid].categories ||= [];

  if (Array.isArray(updates.categories)) {
    store.customTags[pid].categories = Array.from(new Set(updates.categories));
  }
  if (typeof updates.isTikTok === 'boolean') {
    store.customTags[pid].isTikTok = updates.isTikTok;
    store.customTags[pid].source = 'manual';
    const cats = store.customTags[pid].categories || [];
    store.customTags[pid].categories = updates.isTikTok
      ? Array.from(new Set([...cats, 'TikTok / Viral']))
      : cats.filter((c) => c !== 'TikTok / Viral');
  }
  if (typeof updates.manualTier === 'string') {
    store.customTags[pid].manualTier = updates.manualTier;
  }
  if (typeof updates.favorited === 'boolean') {
    track.favorited = updates.favorited;
  }
  if (typeof updates.disliked === 'boolean') {
    track.disliked = updates.disliked;
  }
  if (typeof updates.comment === 'string') {
    track.comment = updates.comment;
  }
  if (typeof updates.genre === 'string') {
    track.genre = updates.genre;
  }
  if (typeof updates.playedCount === 'number') {
    track.playedCount = updates.playedCount;
  }
  if (typeof updates.skippedCount === 'number') {
    track.skippedCount = updates.skippedCount;
  }

  await saveStore(store);

  // Sync changes to macOS Music.app if track is in Music.app
  if (track.source === 'music.app') {
    const jxaUpdate = `
      function run(argv) {
        const pid = argv[0];
        const payload = JSON.parse(argv[1] || '{}');
        try {
          const music = Application('Music');
          const t = findTrack(music, pid);
          if (!t) return JSON.stringify({ ok: false });
          if (typeof payload.favorited === 'boolean') t.favorited = payload.favorited;
          if (typeof payload.disliked === 'boolean') t.disliked = payload.disliked;
          if (typeof payload.comment === 'string') t.comment = payload.comment;
          if (typeof payload.genre === 'string') t.genre = payload.genre;
          return JSON.stringify({ ok: true });
        } catch (err) {
          return JSON.stringify({ ok: false, error: String(err) });
        }
      }
    `;
    try {
      await runJXA(jxaUpdate, [pid, JSON.stringify(updates)]);
    } catch {}
  }

  return { track, customTag: store.customTags[pid] };
}

/**
 * Control Music.app playback
 */
export async function controlPlayback({ action, target }) {
  const jxaPlay = `
    function run(argv) {
      const action = argv[0];
      const target = argv[1] || '';
      try {
        const music = Application('Music');
        if (action === 'toggle') {
          music.playpause();
        } else if (action === 'play') {
          music.play();
        } else if (action === 'pause') {
          music.pause();
        } else if (action === 'next') {
          music.nextTrack();
        } else if (action === 'previous') {
          music.previousTrack();
        } else if (action === 'play-track' && target) {
          const tr = findTrack(music, target) || (music.libraryPlaylists[0].tracks.whose({ name: target })()[0] || null);
          if (tr) tr.play();
        } else if (action === 'play-playlist' && target) {
          const pl = findPlaylist(music, target);
          if (pl) pl.play();
        } else if (action === 'shuffle') {
          music.shuffleEnabled = !music.shuffleEnabled();
        } else if (action === 'repeat') {
          const order = ['off', 'all', 'one'];
          music.songRepeat = order[(order.indexOf(music.songRepeat()) + 1) % order.length];
        } else if (action === 'volume' && target !== '') {
          music.soundVolume = Math.max(0, Math.min(100, Number(target)));
        } else if (action === 'seek' && target !== '') {
          music.playerPosition = Math.max(0, Number(target));
        }
        // 'status' falls through and just reports state
        const state = music.playerState();
        let nowPlaying = null;
        if (state === 'playing' || state === 'paused') {
          try {
            const ct = music.currentTrack;
            nowPlaying = {
              name: ct.name(),
              artist: ct.artist(),
              album: ct.album(),
              duration: ct.duration(),
              favorited: ct.favorited(),
              playerPosition: music.playerPosition(),
              persistentID: ct.persistentID()
            };
          } catch (e) {}
        }
        let extras = {};
        try {
          extras = { volume: music.soundVolume(), shuffle: music.shuffleEnabled(), repeat: music.songRepeat() };
        } catch (e) {}
        return JSON.stringify({ ok: true, playerState: state, nowPlaying, ...extras });
      } catch (err) {
        return JSON.stringify({ ok: false, error: String(err) });
      }
    }
  `;

  try {
    return await runJXA(jxaPlay, [action, target ?? '']);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Open an Apple Music catalog link in Music.app (catalog songs can't be added to the library by script).
 */
export async function openInMusic(url) {
  if (!/^https:\/\/music\.apple\.com\//.test(String(url))) {
    throw new Error('Only music.apple.com links can be opened');
  }
  await execFileAsync('/usr/bin/open', ['-a', 'Music', url], { timeout: 15000 });
  return { ok: true };
}
