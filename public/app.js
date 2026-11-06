const state = {
  tracks: [],
  playlists: [],
  analytics: null,
  activeTier: 'all',
  activeCategory: 'all',
  activePlaylistId: null,
  selectedIds: new Set(),
  mcpConfigPath: '',
  projectRoot: ''
};

// Mandatory Fallback for browsers without <dialog closedby="any"> support (modern-web-guidance `light-dismiss-a-dialog`)
function initDialogLightDismissFallbacks() {
  const dialogs = document.querySelectorAll('dialog');
  dialogs.forEach((dialog) => {
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (isDialogContent) return;
        dialog.close();
      });
    }
  });

  document.querySelectorAll('[data-close-dialog]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-close-dialog');
      const dlg = document.getElementById(targetId);
      if (dlg) dlg.close();
    });
  });
}

function showToast(message) {
  const region = document.getElementById('toastRegion');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  region.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 3800);
}

function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const mins = Math.floor(s / 60);
  const rem = String(s % 60).padStart(2, '0');
  return `${mins}:${rem}`;
}

function formatRelativeDate(isoStr, daysAgo) {
  if (!isoStr) return 'Never played';
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  if (typeof daysAgo === 'number') return `${daysAgo}d ago`;
  return new Date(isoStr).toLocaleDateString();
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

async function loadInitialData() {
  const statusData = await fetchJson('/api/status');
  state.analytics = statusData.analytics;
  state.mcpConfigPath = statusData.mcpConfigPath;
  state.projectRoot = statusData.projectRoot;

  state.aiConfigured = statusData.aiConfigured;
  state.ai = statusData.ai;
  state.aiProviders = statusData.aiProviders || [];
  updateBridgeHeader(statusData.bridgeStatus, statusData.aiConfigured);
  renderMcpConfigSnippet();
  renderAiSettings();

  await Promise.all([refreshTracks(), refreshPlaylists()]);
  renderAnalyticsAndSidebars();
  if (!state.activePlaylistId && state.activeTier === 'all' && state.activeCategory === 'all') {
    updateActiveViewHeader('Entire Library', 'Real-time play counts, skips & listening telemetry from macOS Music.app');
  }
}

// Live now-playing dock: polls Music.app via the bridge
async function pollPlayer() {
  try {
    const res = await fetchJson('/api/player/status', { method: 'POST', body: '{}' });
    renderPlayerDock(res);
  } catch {
    // bridge unavailable (not macOS / Music.app permission) — keep last state
  }
}

function renderPlayerDock(res = {}) {
  const playerState = (res.playerState || 'stopped').toLowerCase();
  state.playerState = playerState;
  document.getElementById('playerStateBadge').textContent = playerState.toUpperCase();
  updatePlayPauseButtonState(playerState === 'playing');

  const np = res.nowPlaying;
  if (np && np.name) {
    state.currentPlayingTrack = np;
    document.getElementById('nowPlayingText').textContent = np.name;
    document.getElementById('nowPlayingArtist').textContent = np.artist || 'Apple Music';
    document.getElementById('nowPlayingHeartBtn').classList.toggle('active', Boolean(np.favorited));
    const dur = np.duration || 0;
    const pos = Math.min(dur, np.playerPosition || 0);
    document.getElementById('playbackCurrentTime').textContent = formatDuration(pos);
    document.getElementById('playbackTotalTime').textContent = formatDuration(dur);
    document.getElementById('playbackProgressFill').style.width = dur ? `${(pos / dur) * 100}%` : '0%';
    state.currentDuration = dur;
  }
  if (typeof res.shuffle === 'boolean') {
    document.getElementById('shuffleBtn').classList.toggle('active', res.shuffle);
  }
  if (res.repeat) {
    const repeatBtn = document.getElementById('repeatBtn');
    repeatBtn.classList.toggle('active', res.repeat !== 'off');
    repeatBtn.title = `Repeat: ${res.repeat}`;
  }
  syncNowPlayingRows();
  if (!document.getElementById('discoverView').hidden) loadNowRecs();
  const vol = document.getElementById('volumeSlider');
  if (typeof res.volume === 'number' && vol && document.activeElement !== vol) {
    vol.value = res.volume;
  }
}

async function playerAction(action, target) {
  try {
    const res = await fetchJson(`/api/player/${action}`, {
      method: 'POST',
      body: JSON.stringify(target === undefined ? {} : { target })
    });
    renderPlayerDock(res);
    return res;
  } catch (err) {
    showToast(`Player error: ${err.message}`);
  }
}

function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function updatePlayPauseButtonState(isPlaying) {
  const icon = document.getElementById('playPauseIcon');
  if (!icon) return;
  if (isPlaying) {
    icon.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
  } else {
    icon.innerHTML = '<path d="M8 5v14l11-7z"/>';
  }
}

function updateBridgeHeader(bridgeStatus = {}, aiConfigured = false) {
  const led = document.getElementById('bridgeLed');
  const statusText = document.getElementById('bridgeStatusText');
  const stateBadge = document.getElementById('playerStateBadge');
  const nowPlayingText = document.getElementById('nowPlayingText');
  const nowPlayingArtist = document.getElementById('nowPlayingArtist');

  if (bridgeStatus.connected) {
    led.classList.add('online');
  } else {
    led.classList.remove('online');
  }

  const modeLabel =
    bridgeStatus.mode === 'live'
      ? `macOS Music.app Live (${bridgeStatus.musicAppTrackCount} tracks)`
      : `macOS Music.app Bridge Ready · Sample Crate Loaded`;
  const aiLabel = aiConfigured && state.ai ? `${state.ai.label} · ${state.ai.model}` : 'Rule-based tags (no AI key)';
  statusText.textContent = `${modeLabel} · ${aiLabel}`;

  const stateStr = (bridgeStatus.playerState || 'READY').toUpperCase();
  stateBadge.textContent = stateStr;
  updatePlayPauseButtonState(stateStr === 'PLAYING');

  if (bridgeStatus.nowPlaying && bridgeStatus.nowPlaying.name) {
    if (nowPlayingText) nowPlayingText.textContent = bridgeStatus.nowPlaying.name;
    if (nowPlayingArtist) nowPlayingArtist.textContent = bridgeStatus.nowPlaying.artist || 'Apple Music';
    state.currentPlayingTrack = bridgeStatus.nowPlaying;
  }
}

// AI provider form: reflects the saved provider; switching provider asks for that provider's key
function renderAiSettings(providerId) {
  const select = document.getElementById('aiProviderSelect');
  if (!select.options.length) {
    select.innerHTML = state.aiProviders.map((p) => `<option value="${p.id}">${escapeHtml(p.label)}</option>`).join('');
  }
  const id = providerId || state.ai?.provider || 'gemini';
  select.value = id;
  const p = state.aiProviders.find((x) => x.id === id) || {};
  const isSaved = state.ai?.provider === id;
  const key = document.getElementById('aiKeyInput');
  key.value = '';
  key.placeholder = isSaved ? 'Key saved — leave blank to keep' : `${p.label} API key`;
  const model = document.getElementById('aiModelInput');
  model.value = isSaved && state.ai.model !== p.defaultModel ? state.ai.model : '';
  model.placeholder = p.defaultModel ? `Default: ${p.defaultModel}` : 'e.g. gpt-4o-mini';
  document.getElementById('aiBaseUrlField').hidden = id !== 'custom';
  document.getElementById('aiBaseUrlInput').value = isSaved && id === 'custom' ? state.ai.baseUrl : '';
}

function renderMcpConfigSnippet() {
  const codeEl = document.getElementById('mcpConfigCode');
  if (!codeEl) return;
  const snippet = {
    mcpServers: {
      'apple-music-manager': {
        command: 'node',
        args: [state.mcpConfigPath || '/absolute/path/to/apple-music-management/src/mcp/server.js']
      }
    }
  };
  codeEl.textContent = JSON.stringify(snippet, null, 2);
}

async function refreshTracks() {
  const params = new URLSearchParams();
  if (state.activePlaylistId) {
    params.set('playlistId', state.activePlaylistId);
  }
  if (state.activeTier && state.activeTier !== 'all') {
    params.set('tier', state.activeTier);
  }
  if (state.activeCategory && state.activeCategory !== 'all') {
    params.set('category', state.activeCategory);
  }

  const searchVal = document.getElementById('searchInput').value.trim();
  const minPlays = document.getElementById('minPlaysInput').value.trim();
  const maxPlays = document.getElementById('maxPlaysInput').value.trim();
  const sortVal = document.getElementById('sortSelect').value;

  if (searchVal) params.set('search', searchVal);
  if (minPlays !== '') params.set('minPlays', minPlays);
  if (maxPlays !== '') params.set('maxPlays', maxPlays);
  if (sortVal) params.set('sort', sortVal);

  const data = await fetchJson(`/api/tracks?${params.toString()}`);
  state.tracks = data.tracks || [];
  renderTracksTable();
  syncNowPlayingRows();
}

async function refreshPlaylists() {
  const data = await fetchJson('/api/playlists');
  state.playlists = data.playlists || [];
  state.totalPlaylistHours = data.totalPlaylistHours || 0;
  state.totalPlaylistListenedHours = data.totalPlaylistListenedHours || 0;
  renderPlaylistsSidebar();
  renderKpiCards();
}

function renderKpiCards() {
  const a = state.analytics;
  if (!a) return;

  const kpiListening = document.getElementById('kpiListeningHours');
  if (kpiListening) kpiListening.textContent = `${a.totalListenedHours || 0}h`;

  const kpiPlHours = document.getElementById('kpiPlaylistHours');
  if (kpiPlHours) {
    const plHours = state.totalPlaylistHours || a.totalPlaylistHours || 0;
    kpiPlHours.textContent = `${plHours}h`;
  }

  const kpiPlSub = document.getElementById('kpiPlaylistsSub');
  if (kpiPlSub) {
    const count = state.playlists.length || a.totalPlaylistsCount || 0;
    kpiPlSub.textContent = `across ${count} playlists`;
  }

  const kpiUnplaylisted = document.getElementById('kpiUnplaylistedCount');
  if (kpiUnplaylisted) kpiUnplaylisted.textContent = a.unplaylistedListenedCount || 0;

  const kpiActive = document.getElementById('kpiActiveRotations');
  if (kpiActive) kpiActive.textContent = a.activelyListenedCount || 0;
}

function renderAnalyticsAndSidebars() {
  const a = state.analytics;
  if (!a) return;

  document.getElementById('count-tier-all').textContent = a.totalTracks;
  for (const [tierKey, count] of Object.entries(a.byTier || {})) {
    const badge = document.getElementById(`count-tier-${tierKey}`);
    if (badge) badge.textContent = count;
  }

  const unplaylistedBadge = document.getElementById('count-tier-not-in-playlist');
  if (unplaylistedBadge) unplaylistedBadge.textContent = a.unplaylistedListenedCount || 0;

  const unplaylistedStat = document.getElementById('unplaylistedStatCount');
  if (unplaylistedStat) unplaylistedStat.textContent = a.unplaylistedListenedCount || 0;

  renderKpiCards();

  document.getElementById('telemetrySummaryText').textContent =
    `${a.activelyListenedCount} listened (${a.totalListenedHours}h) · ${a.dontListenCount} unplayed/skipped`;
  document.getElementById('tikTokStatCount').textContent = a.tikTokCount || 0;

  const total = Math.max(1, a.totalTracks);
  const heavyPct = Math.round(((a.byTier['heavy-rotation'] || 0) / total) * 100);
  const casualPct = Math.round(
    (((a.byTier['casual-rotation'] || 0) + (a.byTier['forgotten-gems'] || 0)) / total) * 100
  );
  const unplayedPct = Math.round(((a.byTier['unplayed-backlog'] || 0) / total) * 100);
  const skipPct = Math.max(0, 100 - heavyPct - casualPct - unplayedPct);

  document.getElementById('meterHeavy').style.width = `${heavyPct}%`;
  document.getElementById('meterCasual').style.width = `${casualPct}%`;
  document.getElementById('meterUnplayed').style.width = `${unplayedPct}%`;
  document.getElementById('meterSkip').style.width = `${skipPct}%`;

  // Category sidebar: fixed crates, then the AI's own vibe groups
  const crateButton = (catName, label, count) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `crate-item ${state.activeCategory === catName ? 'active' : ''}`;
    btn.setAttribute('data-category', catName);
    btn.innerHTML = `<span>${escapeHtml(label)}</span><span class="mono-count">${count}</span>`;
    btn.addEventListener('click', () => {
      state.activePlaylistId = null;
      state.activeTier = 'all';
      state.activeCategory = state.activeCategory === catName ? 'all' : catName;
      syncSidebarActiveStates();
      updateActiveViewHeader(
        state.activeCategory === 'all' ? 'Entire Library' : label,
        catName === 'ai-sorted' ? 'Songs classified by AI Sort' : `Filtered by AI & metadata category`
      );
      refreshTracks();
    });
    li.appendChild(btn);
    return li;
  };
  const catList = document.getElementById('categoryNavList');
  catList.replaceChildren(...Object.entries(a.byCategory || {}).map(([c, n]) => crateButton(c, c, n)));
  const vibeList = document.getElementById('aiVibeNavList');
  document.getElementById('aiVibeSection').hidden = !a.aiSortedCount;
  vibeList.replaceChildren(
    ...(a.aiSortedCount ? [crateButton('ai-sorted', 'All AI-sorted', a.aiSortedCount)] : []),
    ...Object.entries(a.byAiVibe || {}).map(([c, n]) => crateButton(c, c, n))
  );

  // Smart Recipe Cards
  const strip = document.getElementById('smartRecipeStrip');
  strip.innerHTML = '';
  for (const recipe of a.smartRecipes || []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'recipe-card';
    btn.innerHTML = `
      <div class="recipe-card-top">
        <span class="recipe-name">${recipe.name}</span>
        <span class="recipe-count">${recipe.matchingCount} trk</span>
      </div>
      <span class="recipe-desc">${recipe.description}</span>
    `;
    btn.addEventListener('click', () => handleSmartRecipeClick(recipe));
    strip.appendChild(btn);
  }
}

function renderPlaylistsSidebar() {
  const list = document.getElementById('playlistNavList');
  list.innerHTML = '';

  for (const pl of state.playlists) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    const isActive = state.activePlaylistId === pl.persistentID;
    btn.className = `cr-playlist-item ${isActive ? 'active' : ''}`;
    btn.setAttribute('data-playlist-id', pl.persistentID);
    const count = pl.trackCount ?? (pl.trackIds ? pl.trackIds.length : 0);
    const hours = pl.durationHours ? ` • ${pl.durationHours}h` : '';
    const initials = (pl.name || 'PL').slice(0, 2).toUpperCase();

    btn.innerHTML = `
      <div class="cr-pl-thumb">${initials}</div>
      <div class="cr-pl-meta">
        <span class="cr-pl-name" title="${escapeHtml(pl.name)}">${escapeHtml(pl.name)}</span>
        <span class="cr-pl-sub">Playlist • ${count} songs${hours}</span>
      </div>
    `;
    btn.addEventListener('click', () => {
      state.activePlaylistId = pl.persistentID;
      state.activeTier = 'all';
      state.activeCategory = 'all';
      const searchEl = document.getElementById('searchInput');
      if (searchEl) searchEl.value = '';
      const minEl = document.getElementById('minPlaysInput');
      if (minEl) minEl.value = '';
      const maxEl = document.getElementById('maxPlaysInput');
      if (maxEl) maxEl.value = '';
      syncSidebarActiveStates();
      updateActiveViewHeader(
        pl.name,
        pl.description || 'Apple Music playlist with live play counts and skip telemetry.',
        true,
        pl
      );
      refreshTracks();
    });
    li.appendChild(btn);
    list.appendChild(li);
  }
}

function syncSidebarActiveStates() {
  document.querySelectorAll('#tierNavList .cr-nav-item[data-tier]').forEach((btn) => {
    const tier = btn.getAttribute('data-tier');
    btn.classList.toggle(
      'active',
      !state.activePlaylistId && state.activeCategory === 'all' && state.activeTier === tier
    );
  });

  document.querySelectorAll('#categoryNavList .crate-item, #aiVibeNavList .crate-item').forEach((btn) => {
    const isCatActive = !state.activePlaylistId && state.activeCategory === btn.getAttribute('data-category');
    btn.classList.toggle('active', isCatActive);
  });

  document.querySelectorAll('#playlistNavList .cr-playlist-item').forEach((btn) => {
    const plId = btn.getAttribute('data-playlist-id');
    btn.classList.toggle('active', state.activePlaylistId === plId);
  });
}

function updateActiveViewHeader(title, subtitle, isPlaylist = false, plObj = null) {
  setDiscoverMode(false);
  document.getElementById('activeViewTitle').textContent = title;
  document.getElementById('activeViewSubtitle').textContent = subtitle;
  document.getElementById('activePlaylistActions').hidden = !isPlaylist;
  const telem = document.getElementById('spTelemetryContainer');
  if (telem) telem.hidden = isPlaylist;
  const typeEl = document.getElementById('spHeroType');
  if (typeEl) {
    typeEl.textContent = isPlaylist ? 'PLAYLIST' : 'LIBRARY CRATE';
  }

  const countEl = document.getElementById('heroMetaTrackCount');
  const durEl = document.getElementById('heroMetaDuration');
  if (countEl) {
    const count = plObj ? (plObj.trackCount ?? plObj.trackIds?.length ?? 0) : state.tracks.length;
    countEl.textContent = `${count} songs`;
  }
  if (durEl) {
    if (plObj && plObj.durationHours) {
      durEl.textContent = `about ${plObj.durationHours} hr runtime`;
    } else {
      durEl.textContent = `${state.analytics?.totalListenedHours || 0} hrs listened`;
    }
  }

  // Dynamic gradient based on title hash
  const hero = document.getElementById('spHeroHeader');
  if (hero) {
    const gradients = [
      'linear-gradient(180deg, #1b382b 0%, #121212 100%)',
      'linear-gradient(180deg, #372348 0%, #121212 100%)',
      'linear-gradient(180deg, #233446 0%, #121212 100%)',
      'linear-gradient(180deg, #3d301b 0%, #121212 100%)',
      'linear-gradient(180deg, #3b1f2e 0%, #121212 100%)'
    ];
    const hash = Math.abs(title.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0));
    hero.style.background = gradients[hash % gradients.length];
  }
}

const PLAY_GLYPH = '&#9654;';
const PAUSE_GLYPH = '&#10073;&#10073;';

// Reflect Music.app's current track + play state on visible rows without re-rendering the table
function syncNowPlayingRows() {
  const pid = state.currentPlayingTrack?.persistentID;
  const playing = state.playerState === 'playing';
  document.querySelectorAll('#tracksTableBody tr[data-track-id]').forEach((tr) => {
    const isCurrent = tr.getAttribute('data-track-id') === pid;
    const isPlaying = isCurrent && playing;
    if (tr.classList.contains('is-current') === isCurrent && tr.classList.contains('is-playing') === isPlaying) return;
    tr.classList.toggle('is-current', isCurrent);
    tr.classList.toggle('is-playing', isPlaying);
    const btn = tr.querySelector('.row-play-icon');
    if (btn) {
      btn.innerHTML = isPlaying ? PAUSE_GLYPH : PLAY_GLYPH;
      btn.title = isPlaying ? 'Pause' : 'Play';
    }
  });
  // Big play button mirrors the state when the playing track belongs to the open crate
  const heroBtn = document.getElementById('playCurrentPlaylistBtn');
  const crateIsPlaying = playing && state.tracks.some((t) => t.persistentID === pid);
  heroBtn.querySelector('path').setAttribute('d', crateIsPlaying ? 'M6 19h4V5H6v14zm8-14v14h4V5h-4z' : 'M8 5v14l11-7z');
  heroBtn.setAttribute('aria-label', crateIsPlaying ? 'Pause' : 'Play');
}

function createTrackRow(track, idx) {
  const tr = document.createElement('tr');
  tr.setAttribute('data-track-id', track.persistentID);
  const isCurrent = state.currentPlayingTrack?.persistentID === track.persistentID;
  const isPlaying = isCurrent && state.playerState === 'playing';
  tr.classList.toggle('is-current', isCurrent);
  tr.classList.toggle('is-playing', isPlaying);
  const isChecked = state.selectedIds.has(track.persistentID);
  const skipPct = Math.round((track.skipRatio || 0) * 100);
  const tagsHtml = (track.categories || [])
    .map((cat) => {
      const isTt = cat.toLowerCase().includes('tiktok');
      return `<span class="tag-chip ${isTt ? 'tiktok' : ''}">${escapeHtml(cat)}</span>`;
    })
    .join('');

  tr.innerHTML = `
    <td class="col-num">
      <span class="row-idx">${idx + 1}</span>
      <button type="button" class="row-play-icon" data-action="play" data-id="${track.persistentID}" title="${isPlaying ? 'Pause' : 'Play'}" aria-label="${isPlaying ? 'Pause' : 'Play'} ${escapeHtml(track.name)}">${isPlaying ? PAUSE_GLYPH : PLAY_GLYPH}</button>
    </td>
    <th scope="row" class="col-title">
      <div class="track-cell">
        <input type="checkbox" class="track-checkbox" data-track-id="${track.persistentID}" aria-label="Select ${escapeHtml(track.name)}" ${isChecked ? 'checked' : ''} />
        <div class="track-thumb">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
        </div>
        <div class="track-info">
          <span class="track-title" title="${escapeHtml(track.name)}">${escapeHtml(track.name)}</span>
          <span class="track-meta">${escapeHtml(track.artist)}</span>
        </div>
      </div>
    </th>
    <td class="col-album"><span class="track-meta" title="${escapeHtml(track.album || '')}">${escapeHtml(track.album || '—')}</span></td>
    <td class="col-tier"><span class="tier-pill tier-${track.listeningTier}">${escapeHtml(track.listeningTierLabel || track.listeningTier || 'General')}</span></td>
    <td class="col-stats">
      <span class="stats-mono">${track.playedCount || 0}p · ${track.skippedCount || 0}s</span>
      <span class="skip-sub">Skip: ${skipPct}% · Score ${track.engagementScore || 0}</span>
    </td>
    <td class="col-date">
      <span class="stats-mono">${formatRelativeDate(track.playedDate, track.daysSinceLastPlayed)}</span>
    </td>
    <td class="col-tags" title="${escapeHtml(track.aiReason || '')}">
      <div class="tag-cluster">${tagsHtml || '<span class="tag-chip">Uncategorized</span>'}</div>
      ${track.aiReason ? `<span class="skip-sub">${escapeHtml(track.aiReason)}</span>` : ''}
    </td>
    <td class="col-actions">
      <div class="row-actions">
        <button type="button" class="mini-btn icon-btn ${track.isTikTok ? 'active-flag' : ''}" data-action="toggle-tiktok" data-id="${track.persistentID}" title="TikTok / Viral" aria-label="Toggle TikTok / Viral" aria-pressed="${Boolean(track.isTikTok)}"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M16.6 5.8A4.3 4.3 0 0 1 15.5 3h-3.1v12.4a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.7a5.7 5.7 0 1 0 4.9 5.7V9a7.4 7.4 0 0 0 4.3 1.4V7.3a4.3 4.3 0 0 1-3.2-1.5z"/></svg></button>
        <button type="button" class="mini-btn icon-btn ${track.favorited ? 'active-flag' : ''}" data-action="toggle-love" data-id="${track.persistentID}" title="Love" aria-label="Toggle Love in Apple Music" aria-pressed="${Boolean(track.favorited)}"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 21.4l-1.4-1.3C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.6 11.6L12 21.4z"/></svg></button>
        <button type="button" class="mini-btn icon-btn ${track.disliked ? 'active-flag' : ''}" data-action="toggle-dislike" data-id="${track.persistentID}" title="Dislike / skip" aria-label="Toggle Dislike" aria-pressed="${Boolean(track.disliked)}"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M15 3H6c-.8 0-1.5.5-1.8 1.2l-3 7.1c-.1.2-.2.5-.2.7v2c0 1.1.9 2 2 2h6.3l-1 4.6v.3c0 .4.2.8.4 1.1l1.1 1L16 16.6c.4-.4.6-.9.6-1.4V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/></svg></button>
      </div>
    </td>
  `;
  return tr;
}

function renderTracksTable() {
  const tbody = document.getElementById('tracksTableBody');
  tbody.innerHTML = '';

  const heroCountEl = document.getElementById('heroMetaTrackCount');
  if (heroCountEl) {
    heroCountEl.textContent = `${state.tracks.length} songs`;
  }

  if (!state.tracks || state.tracks.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td colspan="8" style="text-align: center; padding: 48px 16px; color: var(--cr-text-sub);">
        <strong>No matching tracks in this crate</strong><br/>
        <span style="font-size: 0.8rem; color: var(--cr-text-muted);">Clear search filters or click "Sync Music.app" to reload your library.</span>
      </td>
    `;
    tbody.appendChild(tr);
    updateSelectionCounter();
    return;
  }

  // Fast single-pass DocumentFragment render for immediate UI responsiveness
  const initialBatch = 150;
  const fragment = document.createDocumentFragment();
  const firstSlice = state.tracks.slice(0, initialBatch);
  firstSlice.forEach((t, i) => fragment.appendChild(createTrackRow(t, i)));
  tbody.appendChild(fragment);

  // Smooth background chunking for large crates (>150 tracks)
  if (state.tracks.length > initialBatch) {
    let currIdx = initialBatch;
    function renderNext() {
      if (currIdx >= state.tracks.length) return;
      const chunkFrag = document.createDocumentFragment();
      const end = Math.min(state.tracks.length, currIdx + 150);
      for (let i = currIdx; i < end; i++) {
        chunkFrag.appendChild(createTrackRow(state.tracks[i], i));
      }
      tbody.appendChild(chunkFrag);
      currIdx = end;
      if (currIdx < state.tracks.length) {
        requestAnimationFrame(renderNext);
      }
    }
    requestAnimationFrame(renderNext);
  }

  updateSelectionCounter();
}

function updateSelectionCounter() {
  document.getElementById('selectedTrackCount').textContent = state.selectedIds.size;
}

async function handleTrackQuickAction(action, persistentID) {
  const track = state.tracks.find((t) => t.persistentID === persistentID);
  if (!track) return;

  try {
    if (action === 'play') {
      if (state.currentPlayingTrack?.persistentID === persistentID) {
        await playerAction(state.playerState === 'playing' ? 'pause' : 'play');
        return;
      }
      const res = await playerAction('play-track', persistentID);
      if (res) showToast(`Playing "${track.name}" in Music.app`);
      return;
    }

    let updates = {};
    if (action === 'toggle-tiktok') {
      const nextVal = !track.isTikTok;
      const nextCats = nextVal
        ? Array.from(new Set([...(track.categories || []), 'TikTok / Viral']))
        : (track.categories || []).filter((c) => c !== 'TikTok / Viral');
      updates = { isTikTok: nextVal, categories: nextCats };
    } else if (action === 'toggle-love') {
      updates = { favorited: !track.favorited };
    } else if (action === 'toggle-dislike') {
      updates = { disliked: !track.disliked };
    }

    const res = await fetchJson(`/api/tracks/${encodeURIComponent(persistentID)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    });
    state.analytics = res.analytics;
    await refreshTracks();
    renderAnalyticsAndSidebars();
    showToast(`Updated "${track.name}"`);
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

function playlistResultMessage(pl, wanted) {
  if (!pl.syncedToMusicApp) return `Saved "${pl.name}" here only — Music.app failed: ${pl.syncError}`;
  const already = wanted - pl.addedInMusicApp;
  return `"${pl.name}" in Apple Music: added ${pl.addedInMusicApp} song${pl.addedInMusicApp === 1 ? '' : 's'}${already > 0 ? ` (${already} already there or not found)` : ''}`;
}

async function handleSmartRecipeClick(recipe) {
  try {
    const res = await fetchJson('/api/playlists/smart-generate', {
      method: 'POST',
      body: JSON.stringify({ recipeId: recipe.id })
    });
    await refreshPlaylists();
    showToast(playlistResultMessage(res.playlist, res.matchedTrackCount));
  } catch (err) {
    showToast(`Could not generate playlist: ${err.message}`);
  }
}

function openPlaylistBuilderModal() {
  const dialog = document.getElementById('playlistDialog');
  const selectedTracks =
    state.selectedIds.size > 0
      ? state.tracks.filter((t) => state.selectedIds.has(t.persistentID))
      : state.tracks;

  const defaultName =
    state.activeCategory !== 'all'
      ? `${state.activeCategory} Crate`
      : state.activeTier !== 'all'
        ? `${state.activeTier.replace('-', ' ').toUpperCase()} Crate`
        : `Sorted Crate (${selectedTracks.length} Tracks)`;

  document.getElementById('playlistNameInput').value = defaultName;
  document.getElementById('playlistDescInput').value =
    `Sorted by CRATE // 01 from ${selectedTracks.length} matching tracks`;
  document.getElementById('dialogTrackCountBadge').textContent = `${selectedTracks.length} tracks`;

  const previewList = document.getElementById('dialogTrackPreviewList');
  previewList.innerHTML = '';
  for (const t of selectedTracks.slice(0, 40)) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span>${escapeHtml(t.name)} — <small>${escapeHtml(t.artist)}</small></span>
      <span class="mono-count">${t.playedCount}p / ${t.skippedCount}s</span>
    `;
    previewList.appendChild(li);
  }

  // MANDATORY per modern-web-guidance `light-dismiss-a-dialog`: always open with showModal()
  dialog.showModal();
}

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function bindEvents() {
  // Tier Navigation (Left Sidebar)
  document.querySelectorAll('#tierNavList .cr-nav-item[data-tier]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activePlaylistId = null;
      state.activeCategory = 'all';
      state.activeTier = btn.getAttribute('data-tier') || 'all';
      syncSidebarActiveStates();
      const label = btn.querySelector('span')?.textContent || 'Library';
      const subtitle =
        state.activeTier === 'not-in-playlist'
          ? 'Tracks you have played in Music.app that are not saved in any of your playlists'
          : 'Filtered by listening history & skip ratio';
      updateActiveViewHeader(label, subtitle);
      refreshTracks();
    });
  });

  const unplaylistedCard = document.getElementById('kpiUnplaylistedCard');
  if (unplaylistedCard) {
    unplaylistedCard.addEventListener('click', () => {
      state.activePlaylistId = null;
      state.activeCategory = 'all';
      state.activeTier = 'not-in-playlist';
      syncSidebarActiveStates();
      updateActiveViewHeader(
        'Listened (No Playlist)',
        'Tracks you have played in Music.app that are not saved in any of your playlists'
      );
      refreshTracks();
    });
  }

  // Search & Filter controls
  const debouncedRefresh = debounce(() => refreshTracks());
  document.getElementById('searchInput').addEventListener('input', debouncedRefresh);
  document.getElementById('minPlaysInput').addEventListener('input', debouncedRefresh);
  document.getElementById('maxPlaysInput').addEventListener('input', debouncedRefresh);
  document.getElementById('sortSelect').addEventListener('change', () => refreshTracks());

  // Select All Filtered
  document.getElementById('selectAllFilteredBtn').addEventListener('click', () => {
    const allSelected = state.tracks.length > 0 && state.tracks.every((t) => state.selectedIds.has(t.persistentID));
    if (allSelected) {
      state.tracks.forEach((t) => state.selectedIds.delete(t.persistentID));
    } else {
      state.tracks.forEach((t) => state.selectedIds.add(t.persistentID));
    }
    renderTracksTable();
  });

  // Table Event Delegation (Lightning-fast 0ms interaction for all rows)
  const tbody = document.getElementById('tracksTableBody');
  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        const action = actionBtn.getAttribute('data-action');
        const id = actionBtn.getAttribute('data-id');
        handleTrackQuickAction(action, id);
        return;
      }

      const cb = e.target.closest('.track-checkbox');
      if (cb) {
        const id = cb.getAttribute('data-track-id');
        if (cb.checked) state.selectedIds.add(id);
        else state.selectedIds.delete(id);
        updateSelectionCounter();
        return;
      }
    });

    tbody.addEventListener('dblclick', (e) => {
      const tr = e.target.closest('tr[data-track-id]');
      if (tr) {
        const id = tr.getAttribute('data-track-id');
        handleTrackQuickAction('play', id);
      }
    });
  }

  // Open Playlist Builder Dialog
  document.getElementById('createPlaylistFromSelectionBtn').addEventListener('click', openPlaylistBuilderModal);
  document.getElementById('newPlaylistSidebarBtn').addEventListener('click', openPlaylistBuilderModal);

  // Submit Playlist Dialog
  document.getElementById('playlistDialogForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('playlistNameInput').value.trim();
    const description = document.getElementById('playlistDescInput').value.trim();
    const targetTracks =
      state.selectedIds.size > 0
        ? state.tracks.filter((t) => state.selectedIds.has(t.persistentID))
        : state.tracks;

    try {
      const res = await fetchJson('/api/playlists', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description,
          trackPersistentIds: targetTracks.map((t) => t.persistentID)
        })
      });
      document.getElementById('playlistDialog').close();
      state.selectedIds.clear();
      await refreshPlaylists();
      renderTracksTable();
      showToast(playlistResultMessage(res.playlist, targetTracks.length));
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  });

  // Sync Library Button
  document.getElementById('syncLibraryBtn').addEventListener('click', async () => {
    showToast('Syncing library from macOS Music.app...');
    try {
      const res = await fetchJson('/api/sync', { method: 'POST', body: JSON.stringify({}) });
      state.analytics = res.analytics;
      await Promise.all([refreshTracks(), refreshPlaylists()]);
      renderAnalyticsAndSidebars();
      showToast(`Synced ${res.analytics.totalTracks} tracks`);
    } catch (err) {
      showToast(`Sync failed: ${err.message}`);
    }
  });

  // AI Sort: Gemini classification as a background job with live progress
  const startAiSort = async (redo = false) => {
    if (!state.aiConfigured) {
      showToast('Add an AI API key first');
      document.getElementById('mcpDialog').showModal();
      document.getElementById('aiKeyInput').focus();
      return;
    }
    if (redo && !confirm('Re-sort every song from scratch? Existing AI tags are replaced (manual tags are kept).')) return;
    try {
      const customPrompt = document.getElementById('customAiPromptInput')?.value.trim() || '';
      await fetchJson('/api/categorize', { method: 'POST', body: JSON.stringify({ customPrompt, redo }) });
      showToast(redo ? 'AI sort restarted from scratch' : 'AI sort started');
      watchCategorizeJob(true);
    } catch (err) {
      showToast(`AI sort: ${err.message}`);
    }
  };
  document.getElementById('runAiCategorizeBtn').addEventListener('click', () => startAiSort(false));
  document.getElementById('aiSortRedoBtn').addEventListener('click', () => startAiSort(true));
  const sortControl = async (action) => {
    try {
      await fetchJson(`/api/categorize/${action}`, { method: 'POST' });
      if (action === 'stop') showToast('Stopping after the current batch…');
      watchCategorizeJob();
      categorizeTick?.();
    } catch (err) {
      showToast(`AI sort: ${err.message}`);
    }
  };
  document.getElementById('aiSortPauseBtn').addEventListener('click', (e) =>
    sortControl(e.currentTarget.dataset.paused === '1' ? 'resume' : 'pause')
  );
  document.getElementById('aiSortStopBtn').addEventListener('click', () => sortControl('stop'));

  // Open MCP & AI Settings Dialog (always via showModal())
  document.getElementById('openMcpDialogBtn').addEventListener('click', () => {
    document.getElementById('mcpDialog').showModal();
  });

  // Copy MCP JSON
  document.getElementById('copyMcpConfigBtn').addEventListener('click', async () => {
    const text = document.getElementById('mcpConfigCode').textContent;
    await navigator.clipboard.writeText(text);
    showToast('Copied MCP Server JSON configuration');
  });

  // Save AI Settings
  document.getElementById('aiSettingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await fetchJson('/api/settings', {
        method: 'POST',
        body: JSON.stringify({
          aiProvider: document.getElementById('aiProviderSelect').value,
          aiApiKey: document.getElementById('aiKeyInput').value.trim(),
          aiModel: document.getElementById('aiModelInput').value.trim(),
          aiBaseUrl: document.getElementById('aiBaseUrlInput').value.trim()
        })
      });
      document.getElementById('mcpDialog').close();
      showToast('Saved AI settings');
      await loadInitialData();
    } catch (err) {
      showToast(`Error saving settings: ${err.message}`);
    }
  });

  document.getElementById('aiProviderSelect').addEventListener('change', (e) => renderAiSettings(e.target.value));

  // Load Sample Tracks button
  document.getElementById('loadDemoLibraryBtn').addEventListener('click', async () => {
    const res = await fetchJson('/api/sync', {
      method: 'POST',
      body: JSON.stringify({ forceDemo: true })
    });
    state.analytics = res.analytics;
    document.getElementById('mcpDialog').close();
    await Promise.all([refreshTracks(), refreshPlaylists()]);
    renderAnalyticsAndSidebars();
    showToast('Loaded sample library with TikTok & listening history tracks');
  });

  // Big Play Button (Playlist or First Track)
  document.getElementById('playCurrentPlaylistBtn').addEventListener('click', async () => {
    const npId = state.currentPlayingTrack?.persistentID;
    if (npId && state.playerState !== 'stopped' && state.tracks.some((t) => t.persistentID === npId)) {
      await playerAction(state.playerState === 'playing' ? 'pause' : 'play');
      return;
    }
    if (state.activePlaylistId) {
      const pl = state.playlists.find((p) => p.persistentID === state.activePlaylistId);
      if (pl) {
        if (await playerAction('play-playlist', pl.persistentID)) {
          showToast(`Playing playlist "${pl.name}" in Music.app`);
        }
        return;
      }
    }
    if (state.tracks.length > 0) {
      const first = state.tracks[0];
      await handleTrackQuickAction('play', first.persistentID);
      return;
    }
    showToast('No tracks to play in this crate');
  });

  document.getElementById('deleteCurrentPlaylistBtn').addEventListener('click', async () => {
    if (!state.activePlaylistId) return;
    const pl = state.playlists.find((p) => p.persistentID === state.activePlaylistId);
    if (!confirm(`Delete playlist "${pl ? pl.name : ''}" from Music.app? This cannot be undone.`)) return;
    try {
      await fetchJson(`/api/playlists/${encodeURIComponent(state.activePlaylistId)}`, {
        method: 'DELETE'
      });
      state.activePlaylistId = null;
      updateActiveViewHeader('Entire Library', 'Showing all tracks');
      await Promise.all([refreshPlaylists(), refreshTracks()]);
      showToast(`Deleted playlist "${pl ? pl.name : ''}"`);
    } catch (err) {
      showToast(`Error deleting playlist: ${err.message}`);
    }
  });

  // Bottom Transport Controls
  document.getElementById('playPauseBtn').addEventListener('click', () => playerAction('toggle'));
  // Space = play/pause, unless you're typing or on a button
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat || e.target.closest('input, textarea, select, button, [contenteditable], dialog[open]')) return;
    e.preventDefault();
    playerAction('toggle');
  });
  document.getElementById('prevBtn').addEventListener('click', () => playerAction('previous'));
  document.getElementById('nextBtn').addEventListener('click', () => playerAction('next'));
  document.getElementById('shuffleBtn').addEventListener('click', () => playerAction('shuffle'));
  document.getElementById('repeatBtn').addEventListener('click', () => playerAction('repeat'));
  document
    .getElementById('volumeSlider')
    .addEventListener('change', (e) => playerAction('volume', e.target.value));
  document.getElementById('playbackScrubberRail').addEventListener('click', (e) => {
    if (!state.currentDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    playerAction('seek', Math.round(ratio * state.currentDuration));
  });

  const nowPlayingHeart = document.getElementById('nowPlayingHeartBtn');
  if (nowPlayingHeart) {
    nowPlayingHeart.addEventListener('click', async () => {
      const np = state.currentPlayingTrack;
      if (np?.persistentID) {
        try {
          await fetchJson(`/api/tracks/${encodeURIComponent(np.persistentID)}`, {
            method: 'PATCH',
            body: JSON.stringify({ favorited: !np.favorited })
          });
          np.favorited = !np.favorited;
          nowPlayingHeart.classList.toggle('active', np.favorited);
          await refreshTracks();
        } catch (err) {
          showToast(`Error: ${err.message}`);
        }
      } else {
        showToast('No active track playing');
      }
    });
  }
}

// ---------- AI Sort progress ----------
let categorizeTimer = null;
let categorizeTick = null;
function watchCategorizeJob(startedHere = false) {
  if (categorizeTimer) return;
  const btn = document.getElementById('runAiCategorizeBtn');
  const label = document.getElementById('runAiCategorizeLabel');
  const controls = document.getElementById('aiSortControls');
  const pauseBtn = document.getElementById('aiSortPauseBtn');
  const redoBtn = document.getElementById('aiSortRedoBtn');
  let sawRunning = startedHere;
  const tick = async () => {
    let job;
    try {
      ({ job } = await fetchJson('/api/categorize/status'));
    } catch {
      return;
    }
    if (job.running) {
      sawRunning = true;
      btn.disabled = true;
      redoBtn.hidden = true;
      controls.hidden = false;
      pauseBtn.textContent = job.paused ? 'Resume' : 'Pause';
      pauseBtn.dataset.paused = job.paused ? '1' : '';
      document.getElementById('aiSortStopBtn').disabled = Boolean(job.stopped);
      const progress = job.total ? ` ${job.done}/${job.total}` : '';
      label.textContent = job.stopped ? 'Stopping…' : job.paused ? `AI sort paused${progress}` : `AI sorting${progress}…`;
      btn.title = job.note || '';
      if (job.note && !job.stopped && !job.paused) label.textContent = `AI sort waiting${progress} · ${job.note.match(/retrying in \d+s/)?.[0] || 'retrying'}`;
      return;
    }
    clearInterval(categorizeTimer);
    categorizeTimer = null;
    categorizeTick = null;
    btn.disabled = false;
    controls.hidden = true;
    redoBtn.hidden = false;
    label.textContent = 'AI Sort & Detect TikTok';
    if (!sawRunning) return; // an old run finished before this page loaded
    const r = job.result;
    if (job.error) showToast(`AI sort failed: ${job.error}`);
    else if (!r.ok && r.errors.length) showToast(`AI sort failed: ${r.errors[0].replace(/^Batch \d+: /, '')}`);
    else if (r.stopped) showToast(`AI sort stopped · ${r.categorizedCount} songs sorted. Click AI Sort to continue.`);
    else if (r.total === 0) showToast('Every song is already AI-sorted');
    else showToast(`AI sorted ${r.categorizedCount}/${r.total} songs${r.errors.length ? ` · ${r.errors.length} batch error(s): ${r.errors[0]}` : ''}`);
    const status = await fetchJson('/api/status');
    state.analytics = status.analytics;
    await refreshTracks();
    renderAnalyticsAndSidebars();
  };
  categorizeTick = tick;
  tick();
  categorizeTimer = setInterval(tick, 2000);
}

// ---------- Discover ----------
const previewAudio = new Audio();
previewAudio.addEventListener('ended', () => setPreviewButton(null));
let previewingId = null;

function setDiscoverMode(on) {
  document.getElementById('mainWorkspace').classList.toggle('discover-mode', on);
  document.getElementById('discoverView').hidden = !on;
  document.getElementById('discoverNavBtn').classList.toggle('active', on);
  if (on) {
    document.querySelectorAll('#tierNavList .cr-nav-item[data-tier], #categoryNavList .crate-item, #aiVibeNavList .crate-item, #playlistNavList .cr-playlist-item')
      .forEach((b) => b.classList.remove('active'));
  } else {
    previewAudio.pause();
    setPreviewButton(null);
  }
}

function setPreviewButton(id) {
  previewingId = id;
  document.querySelectorAll('#discoverView [data-dact="preview"]').forEach((b) => {
    const on = b.getAttribute('data-id') === id;
    b.innerHTML = on ? PAUSE_GLYPH : PLAY_GLYPH;
    b.setAttribute('aria-label', on ? 'Stop preview' : 'Play preview');
    b.closest('.cr-pick')?.classList.toggle('previewing', on);
  });
}

// "Because you're playing X": refreshed whenever Music.app moves to a new song
let nowRecsFor = null;
async function loadNowRecs(force = false) {
  const pid = state.currentPlayingTrack?.persistentID;
  const section = document.getElementById('nowRecs');
  if (!pid || state.playerState === 'stopped') {
    section.hidden = true;
    return;
  }
  if (!force && pid === nowRecsFor) return;
  nowRecsFor = pid;
  section.hidden = false;
  const grid = document.getElementById('nowRecsGrid');
  document.getElementById('nowRecsTitle').textContent = `Because you're playing "${state.currentPlayingTrack.name}"`;
  grid.innerHTML = '<p class="cr-discover-empty">Finding songs like this…</p>';
  try {
    const d = await fetchJson('/api/discover/now-playing');
    if (nowRecsFor !== pid) return; // song changed mid-request
    state.discoverPicks ||= new Map();
    d.picks.forEach((p) => state.discoverPicks.set(p.catalogId, p));
    grid.innerHTML = d.picks.length
      ? d.picks.map(pickCard).join('')
      : '<p class="cr-discover-empty">No new songs found for this one. Add a Gemini key in MCP Config for similar artists.</p>';
    setPreviewButton(previewingId);
  } catch (err) {
    grid.innerHTML = `<p class="cr-discover-empty">Couldn't load: ${escapeHtml(err.message)}</p>`;
  }
}

async function showDiscover(refresh = false) {
  setDiscoverMode(true);
  loadNowRecs(refresh);
  loadRecap();
  loadReleases(refresh);
  const grid = document.getElementById('discoverGrid');
  grid.innerHTML = `<p class="cr-discover-empty">${refresh ? 'Searching the Apple Music catalog…' : 'Loading your picks…'}</p>`;
  try {
    const d = await fetchJson(`/api/discover${refresh ? '?refresh=1' : ''}`);
    state.discoverPicks ||= new Map();
    d.picks.forEach((p) => state.discoverPicks.set(p.catalogId, p));
    renderDiscover(d);
  } catch (err) {
    grid.innerHTML = `<p class="cr-discover-empty">Couldn't load picks: ${escapeHtml(err.message)}</p>`;
  }
}

// ---------- Recap (from daily play-count snapshots) ----------
let recapDays = 7;
async function loadRecap(days = recapDays) {
  recapDays = days;
  document.querySelectorAll('[data-recap-days]').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.recapDays) === days));
  const body = document.getElementById('recapBody');
  try {
    const r = await fetchJson(`/api/recap?days=${days}`);
    if (!r.totalPlays) {
      body.innerHTML = `<p class="cr-discover-empty">${
        r.firstSnapshot
          ? `Tracking plays since ${escapeHtml(r.firstSnapshot)}. Nothing new played yet — your recap fills in as you listen (synced hourly).`
          : 'Play history starts with your first sync. Click Sync Music.app, then check back after some listening.'
      }</p>`;
      return;
    }
    const partial = r.from && r.firstSnapshot === r.from && r.snapshotCount > 0 && days > 1;
    const song = (s, i) => `<li><button type="button" class="cr-recap-song" data-recap-play="${escapeHtml(s.persistentID)}" title="Play">
        <span class="cr-recap-rank">${i + 1}</span><span class="cr-recap-name">${escapeHtml(s.name)}</span>
        <span class="cr-recap-artist">${escapeHtml(s.artist)}</span><span class="mono-count">${s.plays}×</span></button></li>`;
    body.innerHTML = `
      <p class="cr-recap-stats"><strong>${r.totalPlays}</strong> plays · <strong>${r.minutes}</strong> min since ${escapeHtml(r.from)}${
        partial ? ' <span class="cr-recap-note">(history is younger than this period)</span>' : ''
      }</p>
      <div class="cr-recap-cols">
        <div><span class="cr-chip-label">Top songs</span><ol class="cr-recap-list">${r.topSongs.map(song).join('')}</ol></div>
        <div>
          <span class="cr-chip-label">Top artists</span>
          <div class="cr-taste">${r.topArtists.map((a) => `<span class="cr-taste-chip">${escapeHtml(a.name)} · ${a.plays}</span>`).join('')}</div>
          ${r.firstListens.length ? `<span class="cr-chip-label">First listens</span><ol class="cr-recap-list">${r.firstListens.map(song).join('')}</ol>` : ''}
        </div>
      </div>`;
  } catch (err) {
    body.innerHTML = `<p class="cr-discover-empty">Couldn't load recap: ${escapeHtml(err.message)}</p>`;
  }
}

async function loadReleases(refresh = false) {
  const grid = document.getElementById('releasesGrid');
  grid.innerHTML = `<p class="cr-discover-empty">Checking your artists for new music…</p>`;
  try {
    const d = await fetchJson(`/api/releases${refresh ? '?refresh=1' : ''}`);
    state.discoverPicks ||= new Map();
    d.releases.forEach((p) => state.discoverPicks.set(p.catalogId, p));
    grid.innerHTML = d.releases.length
      ? d.releases.map(pickCard).join('')
      : `<p class="cr-discover-empty">Nothing new from your top ${d.artistsChecked} artists in the last 6 months${
          d.errors?.length ? ` (${escapeHtml(d.errors[0])})` : ''
        }.</p>`;
  } catch (err) {
    grid.innerHTML = `<p class="cr-discover-empty">Couldn't load releases: ${escapeHtml(err.message)}</p>`;
  }
}

document.querySelector('.cr-recap-range').addEventListener('click', (e) => {
  const b = e.target.closest('[data-recap-days]');
  if (b) loadRecap(Number(b.dataset.recapDays));
});
document.getElementById('recapBody').addEventListener('click', (e) => {
  const b = e.target.closest('[data-recap-play]');
  if (b) playerAction('play-track', b.dataset.recapPlay);
});

function pickCard(p) {
  return `
      <article class="cr-pick ${p.source === 'similar' ? 'is-new-artist' : ''}" data-id="${escapeHtml(p.catalogId)}">
        <div class="cr-pick-art">
          ${p.artworkUrl ? `<img src="${escapeHtml(p.artworkUrl)}" alt="" loading="lazy" />` : ''}
          ${p.previewUrl ? `<button type="button" class="cr-pick-play" data-dact="preview" data-id="${escapeHtml(p.catalogId)}" aria-label="Play preview">${PLAY_GLYPH}</button>` : ''}
        </div>
        <div class="cr-pick-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
        <div class="cr-pick-artist" title="${escapeHtml(p.artist)}">${escapeHtml(p.artist)}</div>
        <div class="cr-pick-reason" title="${escapeHtml(p.reason)}">${escapeHtml(p.reason)}</div>
        <div class="cr-pick-actions">
          <button type="button" class="mini-btn" data-dact="open" data-id="${escapeHtml(p.catalogId)}">Open in Music</button>
          <button type="button" class="mini-btn" data-dact="dismiss" data-id="${escapeHtml(p.catalogId)}" title="Not interested" aria-label="Not interested in ${escapeHtml(p.name)}">&times;</button>
        </div>
      </article>`;
}

function renderDiscover(d) {
  const when = new Date(d.generatedAt).toLocaleString();
  document.getElementById('discoverSubtitle').textContent =
    `${d.picks.length} songs you don't have yet · ${d.engine === 'top-artists' ? 'from your top artists' : 'from your top artists + similar new artists'} · updated ${when}`;
  const chips = [
    ...d.profile.topArtists.map((a) => `<span class="cr-taste-chip">${escapeHtml(a.name)}</span>`),
    ...d.profile.topGenres.map((g) => `<span class="cr-taste-chip genre">${escapeHtml(g)}</span>`)
  ].join('');
  document.getElementById('discoverTaste').innerHTML = `<span class="cr-chip-label">Your taste</span>${chips}`;

  const grid = document.getElementById('discoverGrid');
  if (!d.picks.length) {
    grid.innerHTML = `<p class="cr-discover-empty">No new picks right now${d.errors?.length ? ` (${escapeHtml(d.errors[0])})` : ''}. Try Refresh later.</p>`;
    return;
  }
  grid.innerHTML = d.picks.map(pickCard).join('');
  setPreviewButton(previewingId);
}

async function handleDiscoverAction(action, id) {
  const pick = state.discoverPicks?.get(id);
  if (!pick) return;
  try {
    if (action === 'preview') {
      if (previewingId === id) {
        previewAudio.pause();
        setPreviewButton(null);
        return;
      }
      previewAudio.src = pick.previewUrl;
      await previewAudio.play();
      setPreviewButton(id);
    } else if (action === 'open') {
      await fetchJson('/api/discover/open', { method: 'POST', body: JSON.stringify({ url: pick.url }) });
      showToast(`Opened "${pick.name}" in Music.app — click + to add it`);
    } else if (action === 'dismiss') {
      await fetchJson(`/api/discover/${encodeURIComponent(id)}/dismiss`, { method: 'POST', body: '{}' });
      if (previewingId === id) previewAudio.pause();
      document.querySelectorAll(`#discoverView .cr-pick[data-id="${CSS.escape(id)}"]`).forEach((el) => el.remove());
      state.discoverPicks.delete(id);
      showToast(`Won't suggest "${pick.name}" again`);
    }
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

document.getElementById('discoverNavBtn').addEventListener('click', () => showDiscover());
document.getElementById('discoverRefreshBtn').addEventListener('click', () => showDiscover(true));
document.getElementById('moreLikeThisBtn').addEventListener('click', () => {
  showDiscover();
  document.getElementById('mainWorkspace').scrollTo({ top: 0, behavior: 'smooth' });
});
document.getElementById('discoverView').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-dact]');
  if (btn) handleDiscoverAction(btn.getAttribute('data-dact'), btn.getAttribute('data-id'));
});

initDialogLightDismissFallbacks();
bindEvents();
loadInitialData().catch((err) => showToast(`Failed to load library: ${err.message}`));
watchCategorizeJob(); // resume the progress label if a run is already going (e.g. after a reload)
pollPlayer();
// ponytail: 3s polling, switch to SSE if the dock needs to feel instant
setInterval(() => {
  if (!document.hidden) pollPlayer();
}, 3000);
