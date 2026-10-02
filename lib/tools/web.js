import { http, readText, pool, deadline, BROWSER_UA } from '../net.js';
import { htmlToText, extractMeta, extractLinks, cap, focus, compact } from '../compress.js';

// JS-heavy pages (SPAs) ship an empty shell. Detect that and render instead.
const SPA_SHELL = /<div id=["'](root|app|__next|__nuxt|svelte)["'][^>]*>\s*<\/div>|window\.__NUXT__|data-reactroot|<noscript>[^<]*(enable|requires) javascript/i;
const BINARY = /pdf|image\/|audio\/|video\/|octet-stream|zip|officedocument|msword|font\//;

async function render(url, timeout) {
  if (process.env.BROWSERLESS_TOKEN) {
    const base = process.env.BROWSERLESS_URL || 'https://production-sfo.browserless.io';
    const r = await http(`${base}/content?token=${process.env.BROWSERLESS_TOKEN}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, guard: false, timeout,
      body: JSON.stringify({ url, gotoOptions: { waitUntil: 'networkidle2', timeout: timeout - 1000 } }),
    });
    return { html: await readText(r), via: 'browserless' };
  }
  // Keyless fallback: Jina Reader renders the page and returns markdown.
  const headers = { accept: 'text/plain', 'x-respond-with': 'markdown' };
  if (process.env.JINA_API_KEY) headers.authorization = `Bearer ${process.env.JINA_API_KEY}`;
  const r = await http(`https://r.jina.ai/${url}`, { headers, timeout, guard: false });
  return { markdown: await readText(r), via: 'jina' };
}

async function fetchOne({ url, mode = 'text', find, offset = 0, max_chars = 6000, render: want = 'auto', links = false }, budget = deadline(25000)) {
  max_chars = Math.min(max_chars, 20000);
  if (mode === 'llms') {
    // Docs sites increasingly publish /llms.txt: a curated, LLM-ready index.
    const origin = new URL(url).origin;
    for (const p of ['/llms.txt', '/docs/llms.txt']) {
      try {
        const r = await http(origin + p, { timeout: Math.min(8000, budget.left()) });
        const t = await readText(r, 2_000_000);
        if (!/<html/i.test(t.slice(0, 500))) return { url: origin + p, content: find ? focus(t, find, 1, max_chars) : cap(t.slice(offset), max_chars, offset), full: `${origin}/llms-full.txt` };
      } catch {}
    }
    return { url, error: 'no llms.txt on this site; use mode:text' };
  }
  const res = await http(url, { timeout: Math.min(12000, budget.left()), headers: { 'user-agent': BROWSER_UA, accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9' } });
  const type = res.headers.get('content-type') || '';
  if (BINARY.test(type)) {
    res.body?.cancel();
    return compact({ url, type, size: res.headers.get('content-length'), note: 'Binary file. In ChatGPT: upload it and use built-in Python. Elsewhere: download and parse locally.' });
  }
  let body = await readText(res);
  if (!/html|xml/.test(type)) {
    if (/json/.test(type)) { try { body = JSON.stringify(JSON.parse(body)); } catch {} }
    const text = find ? focus(body, find, 1, max_chars) : cap(body.slice(offset), max_chars, offset);
    return { url, type: type.split(';')[0], content: text };
  }
  if (mode === 'meta') return { url, ...extractMeta(body) };
  if (mode === 'links') return { url, links: extractLinks(body, url, 100) };

  let text = htmlToText(body, { links, base: url });
  let rendered;
  const shell = text.length < 500 && SPA_SHELL.test(body);
  if ((want === 'always' || (want === 'auto' && shell)) && budget.left() > 6000) {
    try {
      const r = await render(url, Math.min(20000, budget.left() - 1000));
      rendered = r.via;
      text = r.markdown ?? htmlToText(r.html, { links, base: url });
      if (r.html) body = r.html;
    } catch (e) {
      rendered = `failed: ${e.message.slice(0, 80)}`;
    }
  }
  const content = find ? focus(text, find, 1, max_chars) : cap(text.slice(offset), max_chars, offset);
  return compact({ url: res.finalUrl !== url ? res.finalUrl : url, ...extractMeta(body), rendered, chars: text.length, content });
}

// One URL or up to 8 in parallel: reading 5 docs pages is one call, not five turns.
export async function web_fetch(args) {
  const budget = deadline(25000);
  if (Array.isArray(args.urls) && args.urls.length) {
    const urls = args.urls.slice(0, 8);
    const per = Math.min(args.max_chars || 3000, Math.floor(24000 / urls.length));
    const res = await pool(urls, 8, (url) => fetchOne({ ...args, url, max_chars: per }, budget));
    return { pages: res.map((r, i) => (r.ok ? r.value : { url: urls[i], error: r.error.message.slice(0, 160) })) };
  }
  if (!args.url) throw new Error('url or urls is required');
  return fetchOne(args, budget);
}

// ───────────────────────── SEARCH ─────────────────────────
// Provider chain: keyed APIs first (reliable), keyless last. A provider that
// errors or returns nothing falls through to the next, so search never just dies.
const PROVIDERS = [
  ['brave', () => process.env.BRAVE_API_KEY, async (q, n, t) => {
    const j = await (await http(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${n}`, { guard: false, timeout: t, headers: { 'X-Subscription-Token': process.env.BRAVE_API_KEY, accept: 'application/json' } })).json();
    return (j.web?.results || []).map((x) => ({ title: x.title, url: x.url, snippet: htmlToText(x.description || ''), age: x.age }));
  }],
  ['tavily', () => process.env.TAVILY_API_KEY, async (q, n, t) => {
    const j = await (await http('https://api.tavily.com/search', { method: 'POST', guard: false, timeout: t, headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.TAVILY_API_KEY}` }, body: JSON.stringify({ query: q, max_results: n }) })).json();
    return (j.results || []).map((x) => ({ title: x.title, url: x.url, snippet: x.content?.slice(0, 300) }));
  }],
  ['serper', () => process.env.SERPER_API_KEY, async (q, n, t) => {
    const j = await (await http('https://google.serper.dev/search', { method: 'POST', guard: false, timeout: t, headers: { 'content-type': 'application/json', 'x-api-key': process.env.SERPER_API_KEY }, body: JSON.stringify({ q, num: n }) })).json();
    return (j.organic || []).map((x) => ({ title: x.title, url: x.link, snippet: x.snippet, age: x.date }));
  }],
  ['duckduckgo', () => true, async (q, n, t) => {
    const html = await readText(await http(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { guard: false, timeout: t, headers: { 'user-agent': BROWSER_UA } }));
    if (/anomaly|captcha/i.test(html) && !/result__a/.test(html)) throw new Error('blocked');
    const out = [];
    for (const m of html.matchAll(/class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)) {
      let link = m[1];
      const u = link.match(/uddg=([^&]+)/);
      if (u) link = decodeURIComponent(u[1]);
      if (/duckduckgo\.com\/y\.js/.test(link)) continue; // ads
      out.push({ title: htmlToText(m[2]), url: link, snippet: htmlToText(m[3]) });
      if (out.length >= n) break;
    }
    return out;
  }],
  ['duckduckgo-lite', () => true, async (q, n, t) => {
    const html = await readText(await http(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`, { guard: false, timeout: t, headers: { 'user-agent': BROWSER_UA } }));
    const out = [];
    for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>[\s\S]*?class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g)) {
      let link = m[1];
      const u = link.match(/uddg=([^&]+)/);
      if (u) link = decodeURIComponent(u[1]);
      out.push({ title: htmlToText(m[2]), url: link, snippet: htmlToText(m[3]) });
      if (out.length >= n) break;
    }
    return out;
  }],
];

export async function web_search({ query, limit = 6, site }, _ctx, budget = deadline(20000)) {
  if (!query) throw new Error('query is required');
  limit = Math.min(limit, 15);
  const q = site ? `${query} site:${site}` : query;
  const tried = [];
  for (const [name, enabled, run] of PROVIDERS) {
    if (!enabled() || budget.left() < 1500) continue;
    try {
      const results = (await run(q, limit, Math.min(8000, budget.left()))).filter((r) => r.url?.startsWith('http')).map(compact);
      if (results.length) return { query: q, provider: name, results: results.slice(0, limit) };
      tried.push(`${name}: empty`);
    } catch (e) {
      tried.push(`${name}: ${e.message.slice(0, 50)}`);
    }
  }
  throw new Error(`all search providers failed (${tried.join('; ')}). Set BRAVE_API_KEY, TAVILY_API_KEY or SERPER_API_KEY for reliable search, or use ChatGPT's built-in Web Search.`);
}

// search → read top N (one per domain) in parallel → condensed notes.
// One call instead of 1 search + N fetches + N model turns. Deadline-aware:
// returns what it has instead of timing out.
export async function research({ query, depth = 3, chars_per_source = 1500, find, site }) {
  const budget = deadline(26000);
  depth = Math.min(depth, 6);
  const { results, provider } = await web_search({ query, limit: depth + 5, site }, null, deadline(9000));
  const seen = new Set();
  const picks = [];
  const rest = [];
  for (const r of results) {
    let host = '';
    try { host = new URL(r.url).hostname.replace(/^www\./, ''); } catch {}
    if (picks.length < depth && !seen.has(host)) { seen.add(host); picks.push(r); } else rest.push(r);
  }
  const pages = await pool(picks, 6, (r) => fetchOne({ url: r.url, max_chars: chars_per_source, find, render: 'never' }, budget));
  return {
    query,
    provider,
    sources: pages.map((p, i) => compact({
      url: picks[i].url,
      title: picks[i].title,
      age: picks[i].age,
      notes: p.ok ? p.value.content : `fetch failed (${p.error?.message?.slice(0, 80)}); snippet: ${picks[i].snippet}`,
    })),
    also_see: rest.slice(0, 4).map((r) => r.url),
  };
}
