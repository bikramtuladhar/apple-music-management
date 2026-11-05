import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichTrack } from '../src/services/categorizer.js';

const NOW = Date.parse('2026-11-05T00:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();
const base = { name: 'Song', artist: 'Someone', album: '', genre: 'Jazz', duration: 240, year: 2010, comment: '' };
const tier = (t, tag) => enrichTrack({ ...base, ...t }, tag, NOW).listeningTier;

test('listening tiers', () => {
  assert.equal(tier({ playedCount: 0, skippedCount: 0 }), 'unplayed-backlog');
  assert.equal(tier({ playedCount: 2, skippedCount: 10 }), 'skip-magnet');
  assert.equal(tier({ playedCount: 50, skippedCount: 0, disliked: true }), 'skip-magnet');
  assert.equal(tier({ playedCount: 30, skippedCount: 1, playedDate: daysAgo(2) }), 'heavy-rotation');
  assert.equal(tier({ playedCount: 30, skippedCount: 1, playedDate: daysAgo(90) }), 'forgotten-gems');
  assert.equal(tier({ playedCount: 5, skippedCount: 1, playedDate: daysAgo(3) }), 'casual-rotation');
  assert.equal(tier({ playedCount: 0 }, { manualTier: 'heavy-rotation' }), 'heavy-rotation');
});

test('TikTok detection and manual override', () => {
  const sped = enrichTrack({ ...base, name: 'Song (Sped Up)', playedCount: 1 }, {}, NOW);
  assert.equal(sped.isTikTok, true);
  assert.ok(sped.categories.includes('TikTok / Viral'));
  assert.equal(enrichTrack({ ...base, name: 'Song (Sped Up)' }, { isTikTok: false }, NOW).isTikTok, false);
  assert.equal(enrichTrack(base, {}, NOW).isTikTok, false);
  // short + recent alone is not viral; neither is a radio edit
  assert.equal(enrichTrack({ ...base, duration: 150, year: 2025 }, {}, NOW).isTikTok, false);
  assert.equal(enrichTrack({ ...base, name: 'Song (Radio Edit)' }, {}, NOW).isTikTok, false);
  // a manual "not TikTok" also removes the category
  assert.ok(!enrichTrack({ ...base, name: 'x (Sped Up)' }, { isTikTok: false, categories: ['TikTok / Viral'] }, NOW).categories.includes('TikTok / Viral'));
});

test('withRetry retries 429/503 using the retry hint, and gives up on other errors', async () => {
  const { withRetry } = await import('../src/services/categorizer.js');
  const waits = [];
  const wait = async (ms) => waits.push(ms);
  let calls = 0;
  const out = await withRetry(
    async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error('429 Rate limit. Please retry in 21s'), { status: 429 });
      if (calls === 2) throw Object.assign(new Error('503 high demand'), { status: 503 });
      return 'ok';
    },
    { wait, baseMs: 100 }
  );
  assert.equal(out, 'ok');
  assert.deepEqual(waits, [22000, 200]);

  let badCalls = 0;
  await assert.rejects(
    withRetry(async () => {
      badCalls++;
      throw Object.assign(new Error('400 API key not valid'), { status: 400 });
    }, { wait }),
    /API key not valid/
  );
  assert.equal(badCalls, 1);
});

test('withRetry fails fast on a used-up quota, but still waits on a per-minute limit', async () => {
  const { withRetry } = await import('../src/services/categorizer.js');
  const waits = [];
  const wait = async (ms) => waits.push(ms);
  let calls = 0;
  const err = await withRetry(async () => {
    calls++;
    throw Object.assign(new Error('429 Free usage limit reached. Subscribe to keep going'), { status: 429 });
  }, { wait }).catch((e) => e);
  assert.equal(calls, 1);
  assert.equal(err.fatal, true);
  assert.deepEqual(waits, []);
  // Gemini free tier: "exceeded your current quota ... retry in 21s" is per-minute, so it retries
  let n = 0;
  await withRetry(async () => {
    if (n++ === 0) throw Object.assign(new Error('429 You exceeded your current quota. Please retry in 21s'), { status: 429 });
    return 'ok';
  }, { wait });
  assert.deepEqual(waits, [22000]);
});
