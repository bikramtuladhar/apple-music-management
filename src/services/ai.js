import { GoogleGenAI } from '@google/genai';

/**
 * One place that knows how to ask an LLM for JSON. Gemini uses Google's SDK;
 * everything else speaks the OpenAI chat/completions dialect.
 */
export const AI_PROVIDERS = {
  gemini: { label: 'Google Gemini', defaultModel: 'gemini-3.8-flash', minGapMs: 13000 }, // free tier: 5 req/min
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openrouter/auto', minGapMs: 3000 },
  opencode: { label: 'OpenCode', baseUrl: 'https://opencode.ai/inference/openai/v1', defaultModel: 'kimi-k2.6', minGapMs: 3000 },
  custom: { label: 'OpenAI-compatible', defaultModel: '', minGapMs: 3000 }
};

/**
 * Resolve the active AI config: saved settings first, then the legacy Gemini key, then env vars.
 * Returns null when no key is configured.
 */
export function getAiConfig(store = {}) {
  const saved = store.ai || {};
  let provider = AI_PROVIDERS[saved.provider] ? saved.provider : null;
  let apiKey = saved.apiKey || '';
  if (!apiKey && store.geminiApiKey) [provider, apiKey] = ['gemini', store.geminiApiKey];
  if (!apiKey && process.env.OPENROUTER_API_KEY) [provider, apiKey] = ['openrouter', process.env.OPENROUTER_API_KEY];
  if (!apiKey && process.env.GEMINI_API_KEY) [provider, apiKey] = ['gemini', process.env.GEMINI_API_KEY];
  if (!apiKey) return null;
  provider ||= 'gemini';
  const def = AI_PROVIDERS[provider];
  const model = (saved.provider === provider && saved.model) || def.defaultModel;
  const baseUrl = String((provider === 'custom' ? saved.baseUrl : def.baseUrl) || '').replace(/\/+$/, '');
  if (provider === 'custom' && (!baseUrl || !model)) return null;
  return { provider, label: def.label, apiKey, model, baseUrl, minGapMs: def.minGapMs };
}

/** Public, key-free summary for the UI. */
export function describeAi(store) {
  const c = getAiConfig(store);
  return c ? { provider: c.provider, label: c.label, model: c.model, baseUrl: c.baseUrl } : null;
}

// Pull a JSON object out of a reply that may be wrapped in ```json fences or prose
export function parseJsonReply(text) {
  const t = String(text || '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/```(?:json)?\s*([\s\S]*?)```/) || t.match(/(\{[\s\S]*\})/);
    if (m) return JSON.parse(m[1]);
    throw new Error('AI reply was not JSON');
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry rate-limit (429) and overload (500/502/503) errors, honouring a "retry in Ns" hint.
 */
export async function withRetry(fn, { tries = 4, wait = sleep, baseMs = 15000, onRetry = () => {} } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status ?? Number(String(err?.message).match(/^(\d{3})\b/)?.[1]);
      const hint = String(err?.message).match(/retry in (\d+(?:\.\d+)?)s/i);
      // A used-up quota/credit balance won't clear in seconds; fail now unless the provider says when to retry
      if (status === 429 && !hint && /usage limit|quota|credits?|billing|insufficient|subscribe/i.test(err?.message)) {
        err.fatal = true;
        throw err;
      }
      if (![429, 500, 502, 503].includes(status) || attempt >= tries) throw err;
      const ms = hint ? Math.ceil(Number(hint[1]) * 1000) + 1000 : baseMs * 2 ** (attempt - 1);
      onRetry(ms, err);
      await wait(ms);
    }
  }
}

// One shared clock so AI Sort and Discover together stay under the provider's rate limit
let lastCallAt = 0;
export async function paced(cfg, fn) {
  const gap = lastCallAt + Number(process.env.AI_MIN_GAP_MS || cfg.minGapMs) - Date.now();
  if (gap > 0) await sleep(gap);
  lastCallAt = Date.now();
  return fn();
}

const httpError = (status, message) => Object.assign(new Error(`${status} ${message}`), { status });

async function chatCompletions(cfg, prompt, schema, name, useSchema) {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(120000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
      ...(cfg.provider === 'openrouter' ? { 'X-Title': 'CRATE Music Manager' } : {})
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: 'Reply with a single JSON object only, no prose.' },
        { role: 'user', content: useSchema ? prompt : `${prompt}\n\nReturn JSON matching this JSON Schema:\n${JSON.stringify(schema)}` }
      ],
      ...(useSchema ? { response_format: { type: 'json_schema', json_schema: { name, schema, strict: false } } } : {})
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw httpError(res.status, body?.error?.message || res.statusText);
  const content = body?.choices?.[0]?.message?.content;
  if (!content) throw httpError(502, body?.error?.message || 'empty reply from model');
  return parseJsonReply(content);
}

/**
 * Ask the configured model for JSON matching `schema`.
 */
export async function generateJson(cfg, { prompt, schema, name = 'result' }) {
  if (cfg.provider === 'gemini') {
    const client = new GoogleGenAI({ apiKey: cfg.apiKey });
    const interaction = await client.interactions.create({
      model: cfg.model,
      input: prompt,
      response_format: { type: 'text', mime_type: 'application/json', schema }
    });
    return parseJsonReply(interaction.output_text);
  }
  try {
    return await chatCompletions(cfg, prompt, schema, name, true);
  } catch (err) {
    // Some models reject json_schema; fall back to schema-in-prompt
    if (err.status === 400 && /response_format|json_schema|structured/i.test(err.message)) {
      return chatCompletions(cfg, prompt, schema, name, false);
    }
    throw err;
  }
}
