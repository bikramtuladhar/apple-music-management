import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  syncLibrary,
  loadStore,
  saveStore,
  createAppleMusicPlaylist,
  modifyPlaylistTracks,
  deleteAppleMusicPlaylist,
  updateTrackMetadata,
  controlPlayback,
  openInMusic
} from './bridge/appleMusicBridge.js';
import { getDiscovery, dismissPick, getNowPlayingPicks, getNewReleases } from './services/discovery.js';
import { recordSnapshot, lastSnapshotDate, getRecap } from './services/history.js';
import { AI_PROVIDERS, getAiConfig, describeAi } from './services/ai.js';
import {
  getEnrichedTracks,
  getLibraryAnalytics,
  categorizeLibraryWithAI,
  resolveSmartRecipeTracks,
  LISTENING_TIERS,
  SMART_CATEGORIES
} from './services/categorizer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const PROJECT_ROOT = path.resolve(__dirname, '..');

const app = express();
const PORT = Number(process.env.PORT || 4321);
// Local-only: bound to loopback, no CORS, so other sites/devices can't drive Music.app
const HOST = process.env.HOST || '127.0.0.1';

app.use(express.json({ limit: '5mb' }));
app.use(express.static(PUBLIC_DIR));

// Ensure store is initialized on startup
async function initStore() {
  const store = await loadStore();
  if (!store.tracks || store.tracks.length === 0) {
    await syncLibrary();
  }
}

// Play history: snapshot counts after every live sync (never the sample library)
async function snapshotIfLive() {
  const store = await loadStore();
  if (store.bridgeStatus?.mode === 'live') await recordSnapshot(store.tracks || []);
}

// Once a day, sync and snapshot on our own so the recap has history even if you never click Sync
async function dailySnapshot() {
  try {
    if ((await lastSnapshotDate()) === new Date().toLocaleDateString('sv')) return;
    await syncLibrary();
    await snapshotIfLive();
  } catch (err) {
    console.error('daily snapshot failed:', err.message);
  }
}

app.get('/api/status', async (_req, res) => {
  try {
    const store = await loadStore();
    const analytics = await getLibraryAnalytics();
    res.json({
      ok: true,
      lastSyncedAt: store.lastSyncedAt,
      bridgeStatus: store.bridgeStatus || { connected: false, mode: 'demo-hybrid' },
      aiConfigured: Boolean(getAiConfig(store)),
      ai: describeAi(store),
      aiProviders: Object.entries(AI_PROVIDERS).map(([id, p]) => ({ id, label: p.label, defaultModel: p.defaultModel, baseUrl: p.baseUrl || '' })),
      mcpConfigPath: path.join(PROJECT_ROOT, 'src/mcp/server.js'),
      projectRoot: PROJECT_ROOT,
      analytics,
      tiers: LISTENING_TIERS,
      categories: SMART_CATEGORIES
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/sync', async (req, res) => {
  try {
    const { forceDemo } = req.body || {};
    await syncLibrary({ forceDemo: Boolean(forceDemo) });
    await snapshotIfLive();
    const analytics = await getLibraryAnalytics();
    const tracks = await getEnrichedTracks();
    const store = await loadStore();
    res.json({
      ok: true,
      analytics,
      tracks,
      playlists: store.playlists || []
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/tracks', async (req, res) => {
  try {
    const tracks = await getEnrichedTracks({
      playlistId: req.query.playlistId,
      tier: req.query.tier,
      category: req.query.category,
      search: req.query.search,
      minPlays: req.query.minPlays,
      maxPlays: req.query.maxPlays,
      minSkips: req.query.minSkips,
      notPlayedInDays: req.query.notPlayedInDays,
      unplayedOnly: req.query.unplayedOnly,
      listenedOnly: req.query.listenedOnly,
      unplaylistedListenedOnly: req.query.unplaylistedListenedOnly || req.query.tier === 'not-in-playlist',
      sort: req.query.sort,
      limit: req.query.limit
    });
    res.json({ ok: true, count: tracks.length, tracks });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch('/api/tracks/:id', async (req, res) => {
  try {
    const result = await updateTrackMetadata(req.params.id, req.body || {});
    const enriched = await getEnrichedTracks();
    const updatedTrack = enriched.find(
      (t) => t.persistentID === req.params.id || t.id === req.params.id
    );
    const analytics = await getLibraryAnalytics();
    res.json({ ok: true, track: updatedTrack || result.track, analytics });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/analytics', async (_req, res) => {
  try {
    const analytics = await getLibraryAnalytics();
    res.json({ ok: true, analytics });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Gemini classification runs in the background (a full library is ~30 batches); poll the status route
let categorizeJob = { running: false };

app.post('/api/categorize', async (req, res) => {
  try {
    if (categorizeJob.running) return res.status(409).json({ ok: false, error: 'AI sort is already running', job: categorizeJob });
    const store = await loadStore();
    if (!getAiConfig(store)) {
      return res.status(400).json({ ok: false, error: 'Add an AI API key in MCP Config first' });
    }
    const { trackIds, customPrompt, redo } = req.body || {};
    categorizeJob = { running: true, paused: false, stopped: false, done: 0, total: 0, startedAt: new Date().toISOString() };
    const job = categorizeJob;
    categorizeLibraryWithAI({
      trackIds,
      customPrompt,
      redo: Boolean(redo),
      signal: job,
      onProgress: (done, total) => Object.assign(job, { done, total, note: '' }),
      onRetry: (ms, err) => (job.note = `${String(err.message).slice(0, 80)} · retrying in ${Math.round(ms / 1000)}s`)
    })
      .then((result) => Object.assign(job, { running: false, paused: false, result }))
      .catch((err) => Object.assign(job, { running: false, paused: false, error: err.message }));
    res.status(202).json({ ok: true, job });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// pause | resume | stop the running AI sort (takes effect between batches)
app.post('/api/categorize/:action', (req, res) => {
  if (!['pause', 'resume', 'stop'].includes(req.params.action)) return res.status(404).json({ ok: false, error: 'Unknown action' });
  if (!categorizeJob.running) return res.status(409).json({ ok: false, error: 'AI sort is not running' });
  const { action } = req.params;
  if (action === 'stop') categorizeJob.stopped = true;
  else categorizeJob.paused = action === 'pause';
  res.json({ ok: true, job: categorizeJob });
});

app.get('/api/categorize/status', (_req, res) => {
  res.json({ ok: true, job: categorizeJob });
});

app.get('/api/playlists', async (_req, res) => {
  try {
    const store = await loadStore();
    const allTracks = await getEnrichedTracks();
    const trackMap = new Map(allTracks.map((t) => [t.persistentID, t]));

    let totalPlaylistDurationSec = 0;
    let totalPlaylistListenedSec = 0;

    const playlists = (store.playlists || []).map((pl) => {
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

      return {
        ...pl,
        resolvedTracksCount: resolved.length,
        durationHours: Number((dur / 3600).toFixed(1)),
        listenedHours: Number((listened / 3600).toFixed(1)),
        ...(_req.query.includeTracks === 'true' ? { tracks: resolved } : {})
      };
    });

    res.json({
      ok: true,
      count: playlists.length,
      totalPlaylistHours: Number((totalPlaylistDurationSec / 3600).toFixed(1)),
      totalPlaylistListenedHours: Number((totalPlaylistListenedSec / 3600).toFixed(1)),
      playlists
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/playlists', async (req, res) => {
  try {
    const { name, description, trackPersistentIds } = req.body || {};
    if (!name) {
      return res.status(400).json({ ok: false, error: 'Playlist name is required' });
    }
    const created = await createAppleMusicPlaylist({
      name,
      description: description || '',
      trackPersistentIds: Array.isArray(trackPersistentIds) ? trackPersistentIds : []
    });
    const store = await loadStore();
    res.json({ ok: true, playlist: created, playlists: store.playlists });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/playlists/smart-generate', async (req, res) => {
  try {
    const { recipeId, customName, customDescription, filters } = req.body || {};
    let name = customName;
    let description = customDescription;
    let tracks = [];

    if (recipeId && recipeId !== 'custom') {
      const resolved = await resolveSmartRecipeTracks(recipeId);
      name = name || resolved.name;
      description = description || resolved.description;
      tracks = resolved.tracks;
    } else if (filters) {
      tracks = await getEnrichedTracks(filters);
      name = name || `Smart Crate (${tracks.length} tracks)`;
      description = description || 'Generated from listening history & AI filters';
    } else {
      return res.status(400).json({ ok: false, error: 'Provide recipeId or filters' });
    }

    const created = await createAppleMusicPlaylist({
      name,
      description,
      trackPersistentIds: tracks.map((t) => t.persistentID)
    });

    const store = await loadStore();
    res.json({
      ok: true,
      playlist: created,
      matchedTrackCount: tracks.length,
      playlists: store.playlists
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/playlists/:id/tracks', async (req, res) => {
  try {
    const { trackPersistentIds } = req.body || {};
    const updated = await modifyPlaylistTracks({
      playlistId: req.params.id,
      action: 'add',
      trackPersistentIds: Array.isArray(trackPersistentIds) ? trackPersistentIds : []
    });
    const store = await loadStore();
    res.json({ ok: true, playlist: updated, playlists: store.playlists });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.delete('/api/playlists/:id/tracks', async (req, res) => {
  try {
    const { trackPersistentIds } = req.body || {};
    const updated = await modifyPlaylistTracks({
      playlistId: req.params.id,
      action: 'remove',
      trackPersistentIds: Array.isArray(trackPersistentIds) ? trackPersistentIds : []
    });
    const store = await loadStore();
    res.json({ ok: true, playlist: updated, playlists: store.playlists });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.delete('/api/playlists/:id', async (req, res) => {
  try {
    const deleted = await deleteAppleMusicPlaylist(req.params.id);
    const store = await loadStore();
    res.json({ ok: true, deleted, playlists: store.playlists });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/player/:action', async (req, res) => {
  try {
    const { target } = req.body || {};
    const result = await controlPlayback({
      action: req.params.action,
      target
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/discover', async (req, res) => {
  try {
    res.json({ ok: true, ...(await getDiscovery({ refresh: req.query.refresh === '1' })) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/releases', async (req, res) => {
  try {
    res.json({ ok: true, ...(await getNewReleases({ refresh: req.query.refresh === '1' })) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/recap', async (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 7));
    res.json({ ok: true, ...(await getRecap(await getEnrichedTracks(), days)) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Recommendations seeded by whatever Music.app is playing right now
app.get('/api/discover/now-playing', async (_req, res) => {
  try {
    const status = await controlPlayback({ action: 'status' });
    if (!status?.ok) throw new Error(status?.error || 'Music.app unavailable');
    res.json({ ok: true, playerState: status.playerState, ...(await getNowPlayingPicks(status.nowPlaying)) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/discover/:catalogId/dismiss', async (req, res) => {
  try {
    res.json({ ok: true, dismissedCount: await dismissPick(req.params.catalogId) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/discover/open', async (req, res) => {
  try {
    res.json(await openInMusic(req.body?.url));
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// AI provider settings. An empty key keeps the saved one (same provider); clearAiKey removes it.
app.post('/api/settings', async (req, res) => {
  try {
    const b = req.body || {};
    const store = await loadStore();
    const cur = getAiConfig(store);
    if (b.clearAiKey === true || b.clearGeminiApiKey === true) {
      store.ai = {};
      store.geminiApiKey = '';
    } else {
      const provider = b.aiProvider || cur?.provider || 'gemini';
      if (!AI_PROVIDERS[provider]) return res.status(400).json({ ok: false, error: `Unknown AI provider: ${provider}` });
      const key = String(b.aiApiKey ?? b.geminiApiKey ?? '').trim();
      const providerChanged = provider !== cur?.provider;
      if (providerChanged && !key) {
        return res.status(400).json({ ok: false, error: `Enter your ${AI_PROVIDERS[provider].label} API key` });
      }
      const baseUrl = String(b.aiBaseUrl ?? store.ai?.baseUrl ?? '').trim();
      const model = String(b.aiModel ?? (providerChanged ? '' : store.ai?.model) ?? '').trim();
      if (provider === 'custom' && (!/^https?:\/\//.test(baseUrl) || !model)) {
        return res.status(400).json({ ok: false, error: 'A custom provider needs a base URL (https://…/v1) and a model' });
      }
      store.ai = { provider, apiKey: key || cur?.apiKey || '', model, baseUrl };
      store.geminiApiKey = ''; // legacy field, now lives in store.ai
    }
    await saveStore(store);
    res.json({ ok: true, aiConfigured: Boolean(getAiConfig(store)), ai: describeAi(store) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

await initStore();
dailySnapshot();
setInterval(dailySnapshot, 60 * 60 * 1000);

app.listen(PORT, HOST, () => {
  console.log(`CRATE console listening on http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
});
