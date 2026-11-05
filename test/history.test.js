import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecap } from '../src/services/history.js';
import { pickReleases } from '../src/services/discovery.js';

test('recap diffs current counts against the newest snapshot at least N days old', () => {
  const snapshots = [
    { date: '2026-10-01', counts: { a: 1 } },
    { date: '2026-10-29', counts: { a: 10, b: 2 } },
    { date: '2026-11-04', counts: { a: 15, b: 2 } }
  ];
  const tracks = [
    { persistentID: 'a', name: 'A', artist: 'X', playedCount: 16, duration: 120 },
    { persistentID: 'b', name: 'B', artist: 'Y', playedCount: 5, duration: 60 },
    { persistentID: 'c', name: 'C', artist: 'X', playedCount: 1, duration: 60 },
    { persistentID: 'd', name: 'D', artist: 'Z', playedCount: 0 }
  ];
  const now = new Date('2026-11-05T12:00:00');
  const week = buildRecap(snapshots, tracks, 7, now);
  assert.equal(week.from, '2026-10-29');
  assert.deepEqual(week.topSongs.map((s) => [s.name, s.plays]), [['A', 6], ['B', 3], ['C', 1]]);
  assert.equal(week.totalPlays, 10);
  assert.equal(week.minutes, 16); // 6*2 + 3*1 + 1*1
  assert.deepEqual(week.topArtists, [{ name: 'X', plays: 7 }, { name: 'Y', plays: 3 }]);
  assert.deepEqual(week.firstListens.map((s) => s.name), ['C']);
  // younger history than asked for: falls back to the oldest snapshot
  assert.equal(buildRecap(snapshots, tracks, 365, now).from, '2026-10-01');
  assert.equal(buildRecap([], tracks, 7, now).totalPlays, 0);
});

test('releases: recent, not owned, deluxe/standard collapsed, newest first', () => {
  const r = (collectionId, collectionName, releaseDate, artistId = 1, artistName = 'Artist') => ({
    wrapperType: 'collection', collectionId, collectionName, releaseDate, artistId, artistName, trackCount: 1
  });
  const out = pickReleases(
    [
      { wrapperType: 'artist', artistId: 1 },
      r(1, 'Old Album', '2020-01-01T00:00:00Z'),
      r(2, 'New Song - Single', '2026-10-01T00:00:00Z'),
      r(3, 'Big Album (Deluxe)', '2026-09-02T00:00:00Z'),
      r(4, 'Big Album', '2026-09-01T00:00:00Z'),
      r(5, 'Owned EP - EP', '2026-08-01T00:00:00Z'),
      r(6, 'Collab - Single', '2026-10-05T00:00:00Z', 99, 'Other feat. Artist')
    ],
    {
      since: '2026-05-01T00:00:00Z',
      ownedAlbums: new Set(['owned ep|artist']),
      playsByArtistId: new Map([[1, { name: 'Artist', plays: 40 }]])
    }
  );
  assert.deepEqual(out.map((x) => [x.catalogId, x.name, x.kind]), [
    ['6', 'Collab', 'Single'],
    ['2', 'New Song', 'Single'],
    ['3', 'Big Album (Deluxe)', 'Album']
  ]);
  assert.match(out[1].reason, /played Artist 40×/);
  assert.match(out[0].reason, /played Artist 40×/, 'a collab under your artist is credited to them');
  const loved = pickReleases([{ wrapperType: 'artist', artistId: 7 }, r(8, 'X - Single', '2026-10-01T00:00:00Z', 7)], {
    since: '2026-05-01T00:00:00Z', ownedAlbums: new Set(), playsByArtistId: new Map([[7, { name: 'Quiet', plays: 0, loved: 3 }]])
  });
  assert.match(loved[0].reason, /you loved 3 Quiet songs/);
});
