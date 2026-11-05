import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAiConfig, generateJson, parseJsonReply } from '../src/services/ai.js';

test('getAiConfig: saved provider, legacy Gemini key, defaults, custom needs URL+model', () => {
  assert.equal(getAiConfig({}), null);
  assert.equal(getAiConfig({ geminiApiKey: 'g' }).provider, 'gemini');
  const or = getAiConfig({ ai: { provider: 'openrouter', apiKey: 'k', model: '' } });
  assert.equal(or.model, 'openrouter/auto');
  assert.equal(or.baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(getAiConfig({ ai: { provider: 'opencode', apiKey: 'k', model: 'glm-5.3' } }).model, 'glm-5.3');
  assert.equal(getAiConfig({ ai: { provider: 'custom', apiKey: 'k', model: 'm' } }), null);
  assert.equal(getAiConfig({ ai: { provider: 'custom', apiKey: 'k', model: 'm', baseUrl: 'https://x/v1/' } }).baseUrl, 'https://x/v1');
});

test('parseJsonReply handles fenced and chatty replies', () => {
  assert.deepEqual(parseJsonReply('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonReply('Sure! {"a":2} hope that helps'), { a: 2 });
  assert.throws(() => parseJsonReply('no json here'));
});

test('OpenAI-compatible call sends bearer + schema, falls back when json_schema is rejected', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, auth: init.headers.Authorization, hasSchema: Boolean(body.response_format) });
    if (body.response_format) {
      return new Response(JSON.stringify({ error: { message: 'response_format json_schema not supported' } }), { status: 400 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"ok":true}\n```' } }] }), { status: 200 });
  };
  try {
    const cfg = getAiConfig({ ai: { provider: 'opencode', apiKey: 'sk-test' } });
    const out = await generateJson(cfg, { prompt: 'hi', schema: { type: 'object' } });
    assert.deepEqual(out, { ok: true });
    assert.deepEqual(calls.map((c) => c.hasSchema), [true, false]);
    assert.equal(calls[0].url, 'https://opencode.ai/inference/openai/v1/chat/completions');
    assert.equal(calls[0].auth, 'Bearer sk-test');
  } finally {
    globalThis.fetch = realFetch;
  }
});
