import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTasteProfile, filterNew, norm, leadArtist, playlistNeighbours } from '../src/services/discovery.js';

test('taste is driven by plays; loves boost, skips and dislikes count against', () => {
  const { topArtists } = buildTasteProfile([
    { artist: 'Loved Unplayed', playedCount: 0, favorited: true },
    { artist: 'Loved Unplayed', playedCount: 0, favorited: true },
    { artist: 'Heavy & Friend', playedCount: 40 },
    { artist: 'Skipped', playedCount: 5, skippedCount: 10 },
    { artist: 'Disliked', playedCount: 99, disliked: true }
  ]);
  assert.deepEqual(topArtists.map((a) => a.name), ['Heavy', 'Loved Unplayed']);
});

test('names normalise across versions and features', () => {
  assert.equal(norm('Song (feat. X) [Remastered]'), 'song');
  assert.equal(leadArtist('Post Malone & Swae Lee'), 'post malone');
  assert.equal(leadArtist('Daft Punk feat. Pharrell'), 'daft punk');
});

test('filterNew drops owned, dismissed and duplicate songs', () => {
  const r = (trackId, trackName, artistName) => ({ kind: 'song', trackViewUrl: 'u', trackId, trackName, artistName });
  const ctx = { ownedKeys: new Set(['owned song|artist']), dismissed: new Set(['3']), seen: new Set() };
  const kept = filterNew(
    [r(1, 'Owned Song (Live)', 'Artist'), r(2, 'New Song', 'Artist'), r(3, 'Dismissed', 'Artist'), r(4, 'New Song', 'Artist feat. Y')],
    ctx
  );
  assert.deepEqual(kept.map((x) => x.trackId), [2]);
});

test('playlistNeighbours ranks artists by shared playlists, excluding the seed artist', () => {
  const tracks = new Map(
    [['s', 'Seed'], ['a1', 'Alpha'], ['a2', 'Alpha & Co'], ['b', 'Beta'], ['c', 'Gamma']].map(([id, artist]) => [id, { artist, playedCount: 1 }])
  );
  const playlists = [{ trackIds: ['s', 'a1', 'b'] }, { trackIds: ['s', 'a2'] }, { trackIds: ['c'] }];
  const n = playlistNeighbours(new Set(['s']), playlists, tracks, 'seed');
  assert.deepEqual(n.map((x) => [x.name, x.shared]), [['Alpha', 2], ['Beta', 1]]);
});
