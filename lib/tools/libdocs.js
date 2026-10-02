// Current library docs, so generated code uses today's API, not the one from
// the model's training data. Strategy, fastest/most precise first:
//   1. Context7 (version-specific docs, via MCP)
//   2. the library's llms.txt (curated, LLM-ready)
//   3. search the official docs and read the best page with `find`
import { mcpListTools, mcpCallTool } from '../mcp-client.js';
import { cached } from '../cache.js';
import { cap, compact } from '../compress.js';
import { deadline } from '../net.js';
import { web_fetch, web_search } from './web.js';

const C7 = 'https://mcp.context7.com/mcp';

// Fill a tool's arguments by matching its schema's property names, so a
// rename on Context7's side doesn't break us.
function fillArgs(schema, values) {
  const props = Object.keys(schema?.properties || {});
  const args = {};
  for (const p of props) {
    const k = p.toLowerCase();
    if (/library.?id|context7/.test(k) && values.id) args[p] = values.id;
    else if (/library.?name|^name$|^library$/.test(k)) args[p] = values.library;
    else if (/topic|query|question/.test(k)) args[p] = values.topic || values.library;
    else if (/tokens/.test(k) && values.tokens) args[p] = values.tokens;
  }
  return args;
}

const text = (r) => (r?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

async function context7(library, topic, tokens, budget) {
  const headers = process.env.CONTEXT7_API_KEY ? { authorization: `Bearer ${process.env.CONTEXT7_API_KEY}` } : {};
  const tools = await cached('mcp-tools:context7', 3600, () => mcpListTools(C7, headers));
  const resolve = tools.find((t) => /resolve/i.test(t.name));
  const get = tools.find((t) => /docs/i.test(t.name) && t !== resolve);
  if (!resolve || !get) throw new Error('Context7 tools changed');
  let id = /^\/[\w.-]+\/[\w.-]+/.test(library) ? library : null;
  if (!id) {
    const r = text(await cached(`c7-resolve:${library}`, 86400, () => mcpCallTool(C7, resolve.name, fillArgs(resolve.inputSchema, { library, topic }), headers)));
    id = r.match(/library ID:?\s*`?(\/[\w.-]+\/[\w.-]+(?:\/[\w.-]+)?)/i)?.[1] || r.match(/(\/[\w.-]+\/[\w.-]+(?:\/v?[\w.-]+)?)/)?.[1];
    if (!id) throw new Error(`Context7 has no match for "${library}"`);
  }
  if (budget.left() < 3000) throw new Error('out of time');
  const docs = text(await mcpCallTool(C7, get.name, fillArgs(get.inputSchema, { id, library, topic, tokens }), headers));
  if (!docs || docs.length < 200) throw new Error('Context7 returned no docs');
  return { source: 'context7', library_id: id, content: docs };
}

export async function libdocs({ library, topic, site, max_chars = 6000 }) {
  if (!library) throw new Error('library is required (e.g. "next.js", "stripe-node", "/vercel/next.js")');
  const budget = deadline(26000);
  max_chars = Math.min(max_chars, 15000);
  const tried = [];

  try {
    const r = await context7(library, topic, Math.max(2000, Math.round(max_chars / 3.5)), budget);
    return { library, topic, ...r, content: cap(r.content, max_chars) };
  } catch (e) {
    tried.push(`context7: ${e.message.slice(0, 80)}`);
  }

  // Find the docs site if not given.
  let docsUrl = site ? (site.startsWith('http') ? site : `https://${site}`) : null;
  if (!docsUrl && budget.left() > 6000) {
    try {
      const s = await web_search({ query: `${library} official documentation ${topic || ''}`.trim(), limit: 5 }, null, deadline(Math.min(8000, budget.left() - 4000)));
      docsUrl = s.results.find((r) => /docs?\.|\/docs?\b|readthedocs|\.dev\b|developer/.test(r.url))?.url || s.results[0]?.url;
    } catch (e) {
      tried.push(`search: ${e.message.slice(0, 60)}`);
    }
  }
  if (docsUrl && budget.left() > 4000) {
    const llms = await web_fetch({ url: docsUrl, mode: 'llms', find: topic, max_chars }).catch(() => null);
    if (llms?.content && !llms.error) return compact({ library, topic, source: 'llms.txt', url: llms.url, content: llms.content, full: llms.full });
    tried.push('llms.txt: none');
    if (budget.left() > 4000) {
      const page = await web_fetch({ url: docsUrl, find: topic, max_chars }).catch((e) => ({ error: e.message }));
      if (page.content) return compact({ library, topic, source: 'docs page', url: page.url, content: page.content, tried });
      tried.push(`page: ${page.error?.slice(0, 60)}`);
    }
  }
  return { library, topic, error: 'no docs found', tried, tip: 'Pass site (the docs domain) or a Context7 id like /vercel/next.js.' };
}

export { fillArgs };
