// OpenAI platform tools for MCP clients outside ChatGPT (Claude, Cursor, …).
// Inside ChatGPT, the GPT uses the built-in tools instead: they're already
// covered by the user's subscription (see playbooks/openai-leverage.md).
//
// Key resolution — users never spend the owner's credits:
//   1. `x-openai-key` header (bring your own key), else
//   2. the server's OPENAI_API_KEY, only for the owner.
import { api } from '../net.js';
import { cap, compact } from '../compress.js';

function keyFor(ctx) {
  if (ctx?.openai) return ctx.openai; // BYOK, or the owner's own key (see auth.js)
  throw new Error(
    'No OpenAI key. In ChatGPT, use the built-in tools (Web Search, Python, Image Gen, Deep Research) — they are included in your plan. ' +
      'From another MCP client, send your own key in the `x-openai-key` header.',
  );
}

async function oai(path, body, key) {
  const r = await api(`https://api.openai.com/v1${path}`, {
    method: 'POST',
    timeout: 28000,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

export async function openai({ op = 'ask', prompt, web = false, model, effort, input, max_output_tokens = 1200 }, ctx) {
  const key = keyFor(ctx);
  switch (op) {
    case 'ask': {
      // Responses API; optional hosted web_search tool with citations.
      if (!prompt) throw new Error('prompt is required');
      const r = await oai('/responses', compact({
        model: model || process.env.OPENAI_MODEL || 'gpt-5-mini',
        input: prompt,
        tools: web ? [{ type: 'web_search' }] : undefined,
        reasoning: effort ? { effort } : undefined,
        max_output_tokens: Math.min(max_output_tokens, 4000),
      }), key);
      const parts = (r.output || []).filter((o) => o.type === 'message').flatMap((o) => o.content || []);
      const text = parts.filter((c) => c.type === 'output_text').map((c) => c.text).join('\n');
      const cites = [...new Set(parts.flatMap((c) => c.annotations || []).filter((a) => a.type === 'url_citation').map((a) => a.url))];
      return compact({ model: r.model, answer: cap(text, 8000), sources: cites.slice(0, 10), usage: r.usage ? `${r.usage.input_tokens} in / ${r.usage.output_tokens} out` : undefined });
    }
    case 'moderate': {
      // Free endpoint: screen user-submitted text before publishing it anywhere.
      const r = await oai('/moderations', { model: 'omni-moderation-latest', input: input || prompt }, key);
      const res = r.results?.[0] || {};
      return { flagged: !!res.flagged, categories: Object.entries(res.categories || {}).filter(([, v]) => v).map(([k]) => k) };
    }
    default:
      throw new Error(`unknown openai op: ${op}`);
  }
}
