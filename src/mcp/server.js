#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  syncLibrary,
  loadStore,
  createAppleMusicPlaylist,
  modifyPlaylistTracks,
  deleteAppleMusicPlaylist,
  updateTrackMetadata,
  controlPlayback
} from '../bridge/appleMusicBridge.js';
import {
  getEnrichedTracks,
  getLibraryAnalytics,
  categorizeLibraryWithAI,
  resolveSmartRecipeTracks
} from '../services/categorizer.js';
import { getDiscovery } from '../services/discovery.js';

const server = new McpServer({
  name: 'crate-music-manager',
  version: '1.0.0'
});

async function ensureInitialized() {
  const store = await loadStore();
  if (!store.tracks || store.tracks.length === 0) {
    await syncLibrary();
  }
}

server.tool(
  'get_listening_analytics',
  'Get full Apple Music listening analytics: played vs never-played track counts, TikTok/viral track counts, skip magnets, listening tiers, and recommended smart playlists.',
  {
    resync_from_music_app: z
      .boolean()
      .optional()
      .describe('Set to true to force a fresh sync from macOS Music.app before computing stats.')
  },
  async ({ resync_from_music_app }) => {
    if (resync_from_music_app) {
      await syncLibrary();
    } else {
      await ensureInitialized();
    }
    const analytics = await getLibraryAnalytics();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(analytics, null, 2)
        }
      ]
    };
  }
);

server.tool(
  'search_and_filter_tracks',
  'Search and filter Apple Music tracks by listening history (play count, skip count, never played, not played in X days), listening tier (heavy-rotation, skip-magnet, unplayed-backlog, forgotten-gems), or category (TikTok / Viral, Gym / Phonk / Hype, Late Night Drive, etc.).',
  {
    tier: z
      .enum(['all', 'heavy-rotation', 'casual-rotation', 'forgotten-gems', 'skip-magnet', 'unplayed-backlog', 'not-in-playlist'])
      .optional()
      .describe('Filter by listening tier (use "not-in-playlist" for songs with play history not in any playlist)'),
    category: z
      .string()
      .optional()
      .describe('Filter by category, e.g. "TikTok / Viral", "tiktok", "Gym / Phonk / Hype", "Late Night Drive"'),
    search: z.string().optional().describe('Search by song title, artist, album, genre, or comment'),
    min_plays: z.number().optional().describe('Minimum play count'),
    max_plays: z.number().optional().describe('Maximum play count (set to 0 for never-played tracks)'),
    min_skips: z.number().optional().describe('Minimum skip count'),
    not_played_in_days: z.number().optional().describe('Tracks not played in at least N days'),
    sort: z
      .enum(['engagement-desc', 'plays-desc', 'plays-asc', 'skips-desc', 'skip-ratio-desc', 'recent-desc', 'name-asc'])
      .optional()
      .describe('Sort order'),
    limit: z.number().optional().default(50).describe('Max tracks to return')
  },
  async (args) => {
    await ensureInitialized();
    const tracks = await getEnrichedTracks({
      tier: args.tier,
      category: args.category,
      search: args.search,
      minPlays: args.min_plays,
      maxPlays: args.max_plays,
      minSkips: args.min_skips,
      notPlayedInDays: args.not_played_in_days,
      sort: args.sort,
      limit: args.limit
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              count: tracks.length,
              tracks: tracks.map((t) => ({
                persistentID: t.persistentID,
                name: t.name,
                artist: t.artist,
                album: t.album,
                genre: t.genre,
                playedCount: t.playedCount,
                skippedCount: t.skippedCount,
                skipRatio: t.skipRatio,
                listeningTier: t.listeningTier,
                isTikTok: t.isTikTok,
                inPlaylist: t.inPlaylist,
                categories: t.categories,
                playedDate: t.playedDate
              }))
            },
            null,
            2
          )
        }
      ]
    };
  }
);

server.tool(
  'categorize_tracks_ai',
  'Classify the Apple Music library with Gemini (needs a key) in batches of 60 to detect TikTok/viral tracks and vibe categories. Skips songs already classified or tagged manually. Without a key, rule-based tags already apply live.',
  {
    track_ids: z.array(z.string()).optional().describe('Optional track persistentIDs to limit categorization to'),
    custom_prompt: z
      .string()
      .optional()
      .describe('Optional instructions for how to sort or categorize tracks (e.g. "Highlight sped up TikTok songs and gym phonk")')
  },
  async ({ track_ids, custom_prompt }) => {
    await ensureInitialized();
    const result = await categorizeLibraryWithAI({ trackIds: track_ids, customPrompt: custom_prompt || '' });
    const tracks = await getEnrichedTracks();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ok: result.ok,
              engine: result.engine,
              categorizedCount: result.categorizedCount,
              total: result.total,
              errors: result.errors,
              note: result.note,
              tikTokTracksFound: tracks.filter((t) => t.isTikTok).map((t) => `${t.name} — ${t.artist}`)
            },
            null,
            2
          )
        }
      ]
    };
  }
);

server.tool(
  'list_playlists',
  'List all playlists in Apple Music (macOS Music.app) and local smart playlists.',
  {},
  async () => {
    await ensureInitialized();
    const store = await loadStore();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ playlists: store.playlists || [] }, null, 2)
        }
      ]
    };
  }
);

server.tool(
  'create_playlist_from_tracks',
  'Create a new playlist in macOS Apple Music (Music.app) from a list of track persistentIDs.',
  {
    name: z.string().describe('Name of the playlist to create in Apple Music'),
    description: z.string().optional().describe('Description of the playlist'),
    track_persistent_ids: z.array(z.string()).describe('Array of track persistentIDs to add to the playlist')
  },
  async ({ name, description, track_persistent_ids }) => {
    await ensureInitialized();
    const created = await createAppleMusicPlaylist({
      name,
      description: description || '',
      trackPersistentIds: track_persistent_ids
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ok: true, playlist: created }, null, 2)
        }
      ]
    };
  }
);

server.tool(
  'create_smart_playlist',
  'Automatically create a playlist in Apple Music based on a smart recipe (tiktok-viral, heavy-rotation, never-listened, skip-magnets, forgotten-gems, late-night, unplaylisted-listened) OR custom filter criteria.',
  {
    recipe_id: z
      .enum(['tiktok-viral', 'heavy-rotation', 'never-listened', 'skip-magnets', 'forgotten-gems', 'late-night', 'unplaylisted-listened', 'custom'])
      .describe('Smart recipe preset or "custom" to use custom filter parameters below'),
    custom_name: z.string().optional().describe('Optional custom playlist name'),
    custom_description: z.string().optional().describe('Optional playlist description'),
    category: z.string().optional().describe('If recipe_id is "custom", filter by category (e.g. "TikTok / Viral")'),
    min_plays: z.number().optional().describe('If recipe_id is "custom", minimum play count'),
    max_plays: z.number().optional().describe('If recipe_id is "custom", maximum play count'),
    min_skips: z.number().optional().describe('If recipe_id is "custom", minimum skip count')
  },
  async (args) => {
    await ensureInitialized();
    let plName = args.custom_name;
    let plDesc = args.custom_description;
    let matchedTracks = [];

    if (args.recipe_id !== 'custom') {
      const resolved = await resolveSmartRecipeTracks(args.recipe_id);
      plName = plName || resolved.name;
      plDesc = plDesc || resolved.description;
      matchedTracks = resolved.tracks;
    } else {
      matchedTracks = await getEnrichedTracks({
        category: args.category,
        minPlays: args.min_plays,
        maxPlays: args.max_plays,
        minSkips: args.min_skips
      });
      plName = plName || `Smart Crate (${new Date().toLocaleDateString()})`;
      plDesc = plDesc || 'Generated by Apple Music Manager MCP';
    }

    const created = await createAppleMusicPlaylist({
      name: plName,
      description: plDesc,
      trackPersistentIds: matchedTracks.map((t) => t.persistentID)
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ok: true,
              playlist: created,
              tracksIncluded: matchedTracks.map((t) => ({
                persistentID: t.persistentID,
                name: t.name,
                artist: t.artist,
                playedCount: t.playedCount,
                skippedCount: t.skippedCount
              }))
            },
            null,
            2
          )
        }
      ]
    };
  }
);

server.tool(
  'modify_playlist_tracks',
  'Add or remove tracks from an existing Apple Music playlist.',
  {
    playlist_id_or_name: z.string().describe('Playlist persistentID, id, or exact name'),
    action: z.enum(['add', 'remove']).describe('Whether to add or remove tracks'),
    track_persistent_ids: z.array(z.string()).describe('Track persistentIDs to add or remove')
  },
  async ({ playlist_id_or_name, action, track_persistent_ids }) => {
    await ensureInitialized();
    const updated = await modifyPlaylistTracks({
      playlistId: playlist_id_or_name,
      action,
      trackPersistentIds: track_persistent_ids
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ok: true, playlist: updated }, null, 2)
        }
      ]
    };
  }
);

server.tool(
  'delete_playlist',
  'Delete a playlist from Apple Music and local store.',
  {
    playlist_id_or_name: z.string().describe('Playlist persistentID, id, or exact name')
  },
  async ({ playlist_id_or_name }) => {
    await ensureInitialized();
    const deleted = await deleteAppleMusicPlaylist(playlist_id_or_name);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ok: true, deleted }, null, 2)
        }
      ]
    };
  }
);

server.tool(
  'update_track_tags',
  'Tag a track (e.g., mark as TikTok/viral, assign categories, favorite/love, dislike, or update comment/genre in Apple Music).',
  {
    track_id: z.string().describe('Track persistentID or id'),
    is_tiktok: z.boolean().optional().describe('Mark or unmark track as TikTok / Viral'),
    categories: z.array(z.string()).optional().describe('Categories to assign to the track'),
    favorited: z.boolean().optional().describe('Set Apple Music Favorited/Loved status'),
    disliked: z.boolean().optional().describe('Set Apple Music Disliked status'),
    comment: z.string().optional().describe('Update comment in Apple Music')
  },
  async (args) => {
    await ensureInitialized();
    const res = await updateTrackMetadata(args.track_id, {
      isTikTok: args.is_tiktok,
      categories: args.categories,
      favorited: args.favorited,
      disliked: args.disliked,
      comment: args.comment
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ok: true, ...res }, null, 2)
        }
      ]
    };
  }
);

server.tool(
  'control_playback',
  'Control playback in macOS Music.app (play a track or playlist, toggle play/pause, next, previous, shuffle, repeat, volume, seek, or read status).',
  {
    action: z.enum(['play-track', 'play-playlist', 'toggle', 'play', 'pause', 'next', 'previous', 'shuffle', 'repeat', 'volume', 'seek', 'status']),
    target: z
      .string()
      .optional()
      .describe('Track persistentID/name (play-track), playlist persistentID/name (play-playlist), 0-100 (volume), or seconds (seek)')
  },
  async ({ action, target }) => {
    const res = await controlPlayback({ action, target });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(res, null, 2)
        }
      ]
    };
  }
);

server.tool(
  'discover_music',
  'Recommend Apple Music catalog songs the user does not own yet, based on their listening taste (top artists by plays/loves/skips, plus Gemini-suggested similar artists when a key is set). Returns music.apple.com links.',
  {
    refresh: z.boolean().optional().describe('Ignore the 12h cache and search again')
  },
  async ({ refresh }) => {
    await ensureInitialized();
    const d = await getDiscovery({ refresh: Boolean(refresh) });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              engine: d.engine,
              profile: d.profile,
              picks: d.picks.map(({ name, artist, album, reason, url }) => ({ name, artist, album, reason, url })),
              errors: d.errors
            },
            null,
            2
          )
        }
      ]
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP Server error:', err);
  process.exit(1);
});
