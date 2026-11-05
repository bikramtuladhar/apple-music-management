import { getAiConfig, generateJson, withRetry, paced } from './ai.js';
import { loadStore, saveStore } from '../bridge/appleMusicBridge.js';

export const LISTENING_TIERS = {
  'heavy-rotation': {
    id: 'heavy-rotation',
    label: 'Heavy Rotation',
    description: 'High play count, low skip ratio — tracks you genuinely love and replay'
  },
  'casual-rotation': {
    id: 'casual-rotation',
    label: 'Casual Rotation',
    description: 'Moderately played tracks in your regular rotation'
  },
  'not-in-playlist': {
    id: 'not-in-playlist',
    label: 'Listened (No Playlist)',
    description: 'Tracks with listening history (playedCount > 0) that are not yet saved in any playlist'
  },
  'forgotten-gems': {
    id: 'forgotten-gems',
    label: 'Forgotten Gems',
    description: 'Loved in the past (15+ plays, low skips) but untouched for 60+ days'
  },
  'skip-magnet': {
    id: 'skip-magnet',
    label: "Skip Magnets (Don't Listen)",
    description: 'Skipped more than played or high skip ratio — prime candidates to remove or quarantine'
  },
  'unplayed-backlog': {
    id: 'unplayed-backlog',
    label: 'Never Listened (0 Plays)',
    description: 'Added to your library but never played once'
  }
};

export const SMART_CATEGORIES = [
  'TikTok / Viral',
  'Gym / Phonk / Hype',
  'Late Night Drive',
  'Chill / Focus',
  'Pop / Club',
  'Throwback / Nostalgia',
  'Indie / Alternative'
];

const TIKTOK_PATTERNS = [
  /sped\s*up/i,
  /slowed/i,
  /reverb/i,
  /tiktok/i,
  /viral/i,
  /phonk/i,
  /montagem/i,
  /sigilkore/i,
  /hyperpop/i,
  /nightcore/i,
  /\bvhs\b/i,
  /(?<!radio )\bedit\b/i // "Phonk Edit", not "Radio Edit" or "credit"
];


/**
 * Compute deterministic listening metrics + heuristic categories for a track
 */
export function enrichTrack(track, customTag = {}, nowMs = Date.now()) {
  const plays = Number(track.playedCount || 0);
  const skips = Number(track.skippedCount || 0);
  const totalInteractions = plays + skips;
  const skipRatio = totalInteractions > 0 ? Number((skips / totalInteractions).toFixed(2)) : 0;

  const lastPlayedMs = track.playedDate ? new Date(track.playedDate).getTime() : null;
  const daysSinceLastPlayed =
    lastPlayedMs && !Number.isNaN(lastPlayedMs)
      ? Math.max(0, Math.floor((nowMs - lastPlayedMs) / (1000 * 60 * 60 * 24)))
      : null;

  // Determine Listening Tier
  let listeningTier = 'casual-rotation';
  if (customTag.manualTier && LISTENING_TIERS[customTag.manualTier]) {
    listeningTier = customTag.manualTier;
  } else if (track.disliked || (skips >= 3 && (skips > plays || skipRatio >= 0.45))) {
    listeningTier = 'skip-magnet';
  } else if (plays === 0) {
    listeningTier = 'unplayed-backlog';
  } else if (plays >= 15 && daysSinceLastPlayed !== null && daysSinceLastPlayed >= 60 && skipRatio < 0.25) {
    listeningTier = 'forgotten-gems';
  } else if (plays >= 25 && skipRatio < 0.25) {
    listeningTier = 'heavy-rotation';
  }

  // Detect TikTok / Viral & Vibe categories (merging heuristic + AI/custom tags)
  const hay = `${track.name} ${track.artist} ${track.album} ${track.genre} ${track.comment || ''}`;
  const genreLower = (track.genre || '').toLowerCase();

  // AI labels arrive in mixed case ("emotional" vs "Emotional"); Title Case merges them
  const autoCategories = new Set((customTag.categories || []).map((c) => String(c).trim().replace(/\b\w/g, (m) => m.toUpperCase())));

  const matchesTikTokPattern = TIKTOK_PATTERNS.some((rx) => rx.test(hay));

  // Saved isTikTok only comes from a manual toggle or the AI sort; otherwise rules decide live
  const isTikTok =
    typeof customTag.isTikTok === 'boolean'
      ? customTag.isTikTok
      : matchesTikTokPattern || autoCategories.has('TikTok / Viral');

  if (isTikTok) {
    autoCategories.add('TikTok / Viral');
  } else {
    autoCategories.delete('TikTok / Viral');
  }

  if (/phonk|montagem|interworld|gym|hype|drift|trap/i.test(hay)) {
    autoCategories.add('Gym / Phonk / Hype');
  }
  if (/synthwave|electronic|night|midnight|resonance|drive|m83|daft punk/i.test(hay)) {
    autoCategories.add('Late Night Drive');
  }
  if (/ambient|downtempo|study|chill|bonobo|kiasmos|khruangbin|funk|lo-fi/i.test(hay)) {
    autoCategories.add('Chill / Focus');
  }
  if (/pop|dance|club|brat|charli|sabrina|tinashe/i.test(hay)) {
    autoCategories.add('Pop / Club');
  }
  if (track.year > 0 && track.year <= 2015) {
    autoCategories.add('Throwback / Nostalgia');
  }
  if (/indie|alternative|rock/i.test(genreLower)) {
    autoCategories.add('Indie / Alternative');
  }

  // Engagement score (0 - 100)
  const rawScore = Math.min(
    100,
    Math.max(
      0,
      Math.round(
        Math.min(60, plays * 1.1) +
          (track.favorited ? 20 : 0) -
          skips * 3.5 -
          (track.disliked ? 45 : 0) +
          (daysSinceLastPlayed !== null && daysSinceLastPlayed <= 14 ? 15 : 0)
      )
    )
  );

  return {
    ...track,
    skipRatio,
    daysSinceLastPlayed,
    listeningTier,
    listeningTierLabel: LISTENING_TIERS[listeningTier]?.label || listeningTier,
    isTikTok,
    categories: Array.from(autoCategories),
    engagementScore: rawScore,
    aiReason: customTag.aiReason || null,
    aiSorted: ['ai', 'gemini'].includes(customTag.source)
  };
}

/**
 * Enrich all tracks from the store
 */
export async function getEnrichedTracks(filters = {}) {
  const store = await loadStore();
  const nowMs = Date.now();

  const playlistedIds = new Set();
  (store.playlists || []).forEach((pl) => {
    (pl.trackIds || []).forEach((id) => playlistedIds.add(id));
  });

  let list = (store.tracks || []).map((t) => {
    const enriched = enrichTrack(t, store.customTags?.[t.persistentID], nowMs);
    return {
      ...enriched,
      inPlaylist: playlistedIds.has(t.persistentID)
    };
  });

  if (filters.playlistId) {
    const pl = (store.playlists || []).find(
      (p) =>
        p.persistentID === filters.playlistId ||
        p.id === filters.playlistId ||
        p.name === filters.playlistId
    );
    if (pl) {
      const plSet = new Set(pl.trackIds || []);
      list = list.filter((t) => plSet.has(t.persistentID));
    }
  }

  if (
    filters.tier === 'not-in-playlist' ||
    filters.unplaylistedOnly === true ||
    filters.unplaylistedOnly === 'true' ||
    filters.unplaylistedListenedOnly === true ||
    filters.unplaylistedListenedOnly === 'true'
  ) {
    list = list.filter((t) => t.playedCount > 0 && !playlistedIds.has(t.persistentID));
  } else if (filters.tier && filters.tier !== 'all') {
    list = list.filter((t) => t.listeningTier === filters.tier);
  }
  if (filters.category && filters.category !== 'all') {
    if (filters.category === 'ai-sorted') {
      list = list.filter((t) => t.aiSorted);
    } else if (filters.category === 'tiktok') {
      list = list.filter((t) => t.isTikTok || t.categories.includes('TikTok / Viral'));
    } else {
      list = list.filter((t) =>
        t.categories.some((c) => c.toLowerCase() === String(filters.category).toLowerCase())
      );
    }
  }
  if (filters.unplayedOnly === true || filters.unplayedOnly === 'true') {
    list = list.filter((t) => t.playedCount === 0);
  }
  if (filters.listenedOnly === true || filters.listenedOnly === 'true') {
    list = list.filter((t) => t.playedCount > 0 && t.listeningTier !== 'skip-magnet');
  }
  if (filters.minPlays !== undefined && filters.minPlays !== '') {
    list = list.filter((t) => t.playedCount >= Number(filters.minPlays));
  }
  if (filters.maxPlays !== undefined && filters.maxPlays !== '') {
    list = list.filter((t) => t.playedCount <= Number(filters.maxPlays));
  }
  if (filters.minSkips !== undefined && filters.minSkips !== '') {
    list = list.filter((t) => t.skippedCount >= Number(filters.minSkips));
  }
  if (filters.notPlayedInDays !== undefined && filters.notPlayedInDays !== '') {
    const minDays = Number(filters.notPlayedInDays);
    list = list.filter((t) => t.daysSinceLastPlayed === null || t.daysSinceLastPlayed >= minDays);
  }
  if (filters.search) {
    const q = String(filters.search).toLowerCase().trim();
    list = list.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q) ||
        t.genre.toLowerCase().includes(q) ||
        t.categories.some((c) => c.toLowerCase().includes(q)) ||
        (t.comment && t.comment.toLowerCase().includes(q))
    );
  }

  // Sort
  const sortBy = filters.sort || 'engagement-desc';
  list.sort((a, b) => {
    switch (sortBy) {
      case 'plays-desc':
        return b.playedCount - a.playedCount;
      case 'plays-asc':
        return a.playedCount - b.playedCount;
      case 'skips-desc':
        return b.skippedCount - a.skippedCount;
      case 'skip-ratio-desc':
        return b.skipRatio - a.skipRatio;
      case 'recent-desc':
        return (b.playedDate || '').localeCompare(a.playedDate || '');
      case 'name-asc':
        return a.name.localeCompare(b.name);
      case 'engagement-desc':
      default:
        return b.engagementScore - a.engagementScore || b.playedCount - a.playedCount;
    }
  });

  if (filters.limit) {
    list = list.slice(0, Number(filters.limit));
  }

  return list;
}

/**
 * Compute full library analytics & smart playlist suggestions
 */
export async function getLibraryAnalytics() {
  const store = await loadStore();
  const tracks = await getEnrichedTracks();

  const totalTracks = tracks.length;
  const totalPlays = tracks.reduce((acc, t) => acc + t.playedCount, 0);
  const totalSkips = tracks.reduce((acc, t) => acc + t.skippedCount, 0);
  const totalListenedSeconds = tracks.reduce((acc, t) => acc + t.playedCount * (t.duration || 180), 0);

  const byTier = {};
  for (const key of Object.keys(LISTENING_TIERS)) {
    byTier[key] = tracks.filter((t) => t.listeningTier === key).length;
  }

  const byCategory = {};
  for (const cat of SMART_CATEGORIES) {
    byCategory[cat] = tracks.filter((t) => t.categories.includes(cat)).length;
  }

  // The AI's own vibe labels, beyond the fixed crates; ponytail: top 15 groups of 3+ songs only, the rest is noise
  const aiTracks = tracks.filter((t) => t.aiSorted);
  const vibeCounts = {};
  for (const t of aiTracks) for (const c of t.categories) if (!SMART_CATEGORIES.includes(c)) vibeCounts[c] = (vibeCounts[c] || 0) + 1;
  const byAiVibe = Object.fromEntries(Object.entries(vibeCounts).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 15));

  const tikTokCount = tracks.filter((t) => t.isTikTok).length;
  const activelyListenedCount = tracks.filter(
    (t) => t.playedCount > 0 && t.listeningTier !== 'skip-magnet'
  ).length;
  const dontListenCount = byTier['unplayed-backlog'] + byTier['skip-magnet'];

  const playlistedIds = new Set();
  (store.playlists || []).forEach((pl) => {
    (pl.trackIds || []).forEach((id) => playlistedIds.add(id));
  });

  const unplaylistedListenedCount = tracks.filter(
    (t) => t.playedCount > 0 && !playlistedIds.has(t.persistentID)
  ).length;
  byTier['not-in-playlist'] = unplaylistedListenedCount;

  let totalPlaylistDurationSec = 0;
  let totalPlaylistListenedSec = 0;
  const trackMap = new Map(tracks.map((t) => [t.persistentID, t]));

  (store.playlists || []).forEach((pl) => {
    const resolved = (pl.trackIds || []).map((id) => trackMap.get(id)).filter(Boolean);
    const dur =
      resolved.reduce((acc, t) => acc + (t.duration || 195), 0) +
      Math.max(0, (pl.trackCount || 0) - resolved.length) * 195;
    const listened = resolved.reduce(
      (acc, t) => acc + (t.playedCount || 0) * (t.duration || 195),
      0
    );
    totalPlaylistDurationSec += dur;
    totalPlaylistListenedSec += listened;
  });

  const smartRecipes = [
    {
      id: 'unplaylisted-listened',
      name: 'Unplaylisted Listened Songs',
      description: 'Songs you actually play that are missing from all playlists — clean up & organize',
      matchingCount: unplaylistedListenedCount,
      badge: 'Unsaved Listened'
    },
    {
      id: 'tiktok-viral',
      name: 'TikTok & Viral Rotation',
      description: 'Sped-up edits, viral hooks, phonk & TikTok sounds you actually replay',
      matchingCount: tracks.filter((t) => t.isTikTok && t.listeningTier !== 'skip-magnet').length,
      badge: 'Viral Sort'
    },
    {
      id: 'heavy-rotation',
      name: 'Certified Heavy Rotation',
      description: 'Your highest-played, lowest-skipped core tracks (25+ plays)',
      matchingCount: byTier['heavy-rotation'],
      badge: 'Most Listened'
    },
    {
      id: 'never-listened',
      name: 'Unplayed Crate (Zero Plays)',
      description: 'Tracks sitting in your library with 0 plays — listen & triage',
      matchingCount: byTier['unplayed-backlog'],
      badge: '0 Plays'
    },
    {
      id: 'skip-magnets',
      name: 'Skip Magnets (Quarantine)',
      description: 'Tracks you consistently skip or disliked — review or clean up',
      matchingCount: byTier['skip-magnet'],
      badge: "Don't Listen"
    },
    {
      id: 'forgotten-gems',
      name: 'Forgotten Gems Vault',
      description: '15+ plays with almost zero skips, not played in 60+ days',
      matchingCount: byTier['forgotten-gems'],
      badge: 'Rediscover'
    },
    {
      id: 'late-night',
      name: 'Late Night Drive',
      description: 'Synthwave, electronic, and atmospheric night tracks',
      matchingCount: byCategory['Late Night Drive'] || 0,
      badge: 'Vibe'
    }
  ];

  return {
    totalTracks,
    totalPlays,
    totalSkips,
    totalListenedHours: Number((totalListenedSeconds / 3600).toFixed(1)),
    activelyListenedCount,
    dontListenCount,
    tikTokCount,
    byTier,
    byCategory,
    byAiVibe,
    aiSortedCount: aiTracks.length,
    smartRecipes,
    unplaylistedListenedCount,
    totalPlaylistsCount: (store.playlists || []).length,
    totalPlaylistHours: Number((totalPlaylistDurationSec / 3600).toFixed(1)),
    totalPlaylistListenedHours: Number((totalPlaylistListenedSec / 3600).toFixed(1)),
    lastSyncedAt: store.lastSyncedAt,
    bridgeStatus: store.bridgeStatus || { connected: false, mode: 'demo-hybrid' },
    aiConfigured: Boolean(getAiConfig(store))
  };
}

const AI_BATCH = 60;
export { withRetry }; // re-exported for older imports

const CLASSIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    tracks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          persistentID: { type: 'string' },
          isTikTok: {
            type: 'boolean',
            description: 'True if this song is a TikTok viral sound, sped-up/slowed edit, phonk trend, or viral social audio.'
          },
          categories: {
            type: 'array',
            items: { type: 'string' },
            description: '1 to 3 categories from: TikTok / Viral, Gym / Phonk / Hype, Late Night Drive, Chill / Focus, Pop / Club, Throwback / Nostalgia, Indie / Alternative, or a custom vibe.'
          },
          reason: { type: 'string', description: 'Short 4-10 word explanation of the categories.' }
        },
        required: ['persistentID', 'isTikTok', 'categories', 'reason']
      }
    }
  },
  required: ['tracks']
};

async function classifyBatch(cfg, batch, customPrompt, onRetry) {
  const payload = batch.map((t) => ({
    persistentID: t.persistentID,
    name: t.name,
    artist: t.artist,
    album: t.album,
    genre: t.genre,
    durationSec: t.duration,
    year: t.year,
    playedCount: t.playedCount,
    skippedCount: t.skippedCount,
    comment: t.comment
  }));
  const prompt = `Classify these Apple Music library tracks for playlist sorting. Identify which tracks are TikTok/viral sounds (sped up, slowed+reverb, phonk edits, viral dance trends, hyperpop), and assign 1-3 vibe categories. ${
    customPrompt ? `User preference: ${customPrompt}` : ''
  }\n\nTracks JSON:\n${JSON.stringify(payload)}`;
  const parsed = await withRetry(() =>
    paced(cfg, () => generateJson(cfg, { prompt, schema: CLASSIFICATION_SCHEMA, name: 'track_classification' })),
    { onRetry }
  );
  if (!Array.isArray(parsed?.tracks)) throw new Error('AI returned no tracks');
  return parsed.tracks;
}

/**
 * Classify the library with the configured AI provider (Gemini, OpenRouter, OpenCode…) in batches of 60.
 * Rule-based tags are computed live in enrichTrack and never saved; only AI and manual tags persist.
 * Songs already done by AI or tagged manually are skipped unless `redo` (manual tags always win).
 */
export async function categorizeLibraryWithAI({ trackIds = null, customPrompt = '', redo = false, onProgress = () => {}, onRetry = () => {}, signal = {} } = {}) {
  const store = await loadStore();
  const cfg = getAiConfig(store);
  if (!cfg) {
    return { ok: true, engine: 'smart-heuristic', categorizedCount: 0, total: 0, errors: [], note: 'No AI key: rule-based tags are applied live.' };
  }

  const tags = store.customTags || {};
  const isManual = (pid) => tags[pid]?.source === 'manual';
  const target =
    Array.isArray(trackIds) && trackIds.length > 0
      ? store.tracks.filter((t) => (trackIds.includes(t.persistentID) || trackIds.includes(t.id)) && !isManual(t.persistentID))
      : store.tracks.filter((t) => !isManual(t.persistentID) && (redo || !['ai', 'gemini'].includes(tags[t.persistentID]?.source)));

  const errors = [];
  let categorizedCount = 0;
  let failuresInARow = 0;
  onProgress(0, target.length);

  let stopped = false;
  for (let i = 0; i < target.length; i += AI_BATCH) {
    // ponytail: pause/stop are checked between batches, so an in-flight batch always finishes and saves
    while (signal.paused && !signal.stopped) await new Promise((r) => setTimeout(r, 500));
    if (signal.stopped) {
      stopped = true;
      break;
    }
    const batch = target.slice(i, i + AI_BATCH);
    const batchIds = new Set(batch.map((t) => t.persistentID));
    try {
      const items = await classifyBatch(cfg, batch, customPrompt, onRetry);
      // Re-read before writing so edits made during a long run (loves, manual tags) aren't overwritten
      const fresh = await loadStore();
      fresh.customTags ||= {};
      for (const item of items) {
        const pid = item.persistentID;
        if (!batchIds.has(pid) || fresh.customTags[pid]?.source === 'manual') continue;
        fresh.customTags[pid] = {
          ...(fresh.customTags[pid] || {}),
          isTikTok: Boolean(item.isTikTok),
          categories: [...new Set([...(item.isTikTok ? ['TikTok / Viral'] : []), ...(Array.isArray(item.categories) ? item.categories : [])])],
          aiReason: item.reason || `Classified by ${cfg.model}`,
          source: 'ai'
        };
        categorizedCount++;
      }
      await saveStore(fresh);
      failuresInARow = 0;
    } catch (err) {
      errors.push(`Batch ${i / AI_BATCH + 1}: ${err.message}`);
      // a bad key or used-up quota fails every batch; stop instead of burning through the rest
      if (err.fatal || ++failuresInARow >= 2) break;
    }
    onProgress(Math.min(i + AI_BATCH, target.length), target.length);
  }

  const engine = categorizedCount > 0 ? `${cfg.provider}:${cfg.model}` : `smart-heuristic (${cfg.label} failed)`;
  const fresh = await loadStore();
  fresh.categorizationHistory = [
    { timestamp: new Date().toISOString(), engine, categorizedCount, errors: errors.length },
    ...(fresh.categorizationHistory || []).slice(0, 9)
  ];
  await saveStore(fresh);
  return { ok: stopped || categorizedCount > 0 || target.length === 0, engine, categorizedCount, total: target.length, errors, stopped };
}

/**
 * Resolve tracks for a smart recipe ID
 */
export async function resolveSmartRecipeTracks(recipeId) {
  const all = await getEnrichedTracks();
  switch (recipeId) {
    case 'unplaylisted-listened':
      return {
        name: 'Unplaylisted Listened Songs',
        description: 'Songs you actually play that are not saved in any of your playlists',
        tracks: all.filter((t) => t.playedCount > 0 && !t.inPlaylist)
      };
    case 'tiktok-viral':
      return {
        name: 'TikTok & Viral Rotation',
        description: 'Auto-curated TikTok sounds, sped-up/slowed edits & viral tracks from your library',
        tracks: all.filter((t) => t.isTikTok && t.listeningTier !== 'skip-magnet')
      };
    case 'heavy-rotation':
      return {
        name: 'Certified Heavy Rotation',
        description: 'Your most listened tracks (25+ plays, low skip ratio)',
        tracks: all.filter((t) => t.listeningTier === 'heavy-rotation')
      };
    case 'never-listened':
      return {
        name: 'Unplayed Crate (Zero Plays)',
        description: 'Tracks in your Apple Music library that you have never played (0 plays)',
        tracks: all.filter((t) => t.listeningTier === 'unplayed-backlog')
      };
    case 'skip-magnets':
      return {
        name: 'Skip Magnets (Quarantine)',
        description: 'Tracks you skip more than you listen to',
        tracks: all.filter((t) => t.listeningTier === 'skip-magnet')
      };
    case 'forgotten-gems':
      return {
        name: 'Forgotten Gems Vault',
        description: 'High play count tracks with low skips that you have not played in 60+ days',
        tracks: all.filter((t) => t.listeningTier === 'forgotten-gems')
      };
    case 'late-night':
      return {
        name: 'Late Night Drive',
        description: 'Atmospheric, electronic & synthwave tracks from your library',
        tracks: all.filter((t) => t.categories.includes('Late Night Drive'))
      };
    default:
      throw new Error(`Unknown smart recipe: ${recipeId}`);
  }
}
