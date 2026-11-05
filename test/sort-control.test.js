import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Point the store at a temp file before the bridge module loads
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crate-'));
process.env.CRATE_STORE_PATH = path.join(dir, 'store.json');
const tracks = Array.from({ length: 130 }, (_, i) => ({ persistentID: `P${i}`, name: `S${i}`, artist: 'A' }));
await fs.writeFile(process.env.CRATE_STORE_PATH, JSON.stringify({ tracks, customTags: {}, ai: { provider: 'openrouter', apiKey: 'k' } }));
const { categorizeLibraryWithAI } = await import('../src/services/categorizer.js');

test('AI sort stops between batches, and pause holds until resume', async () => {
  process.env.AI_MIN_GAP_MS = '0';
  let calls = 0;
  const signal = { paused: false, stopped: false };
  globalThis.fetch = async (_url, opts) => {
    calls++;
    if (calls === 1) signal.paused = true; // pause during the first batch
    const ids = [...JSON.parse(opts.body).messages[1].content.matchAll(/"persistentID":"(P\d+)"/g)].map((m) => m[1]);
    const items = ids.map((persistentID) => ({ persistentID, isTikTok: false, categories: ['Chill'], reason: 'r' }));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tracks: items }) } }] }));
  };
  const run = categorizeLibraryWithAI({ signal });
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(calls, 1, 'paused: no second batch');
  signal.stopped = true;
  const result = await run;
  assert.equal(result.stopped, true);
  assert.equal(calls, 1);
  assert.ok(result.categorizedCount > 0, 'the in-flight batch was saved');
});
