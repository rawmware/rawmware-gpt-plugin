import { http } from '../net.js';
import { htmlToText, extractMeta, extractLinks, cap, focus, compact } from '../compress.js';

// JS-heavy pages (SPAs) ship an empty shell. Detect that and render instead.
const SPA_SHELL = /<div id=["'](root|app|__next|__nuxt|svelte)["'][^>]*>\s*<\/div>|window\.__NUXT__|data-reactroot/i;

async function render(url) {
  if (process.env.BROWSERLESS_TOKEN) {
    const base = process.env.BROWSERLESS_URL || 'https://production-sfo.browserless.io';
    const r = await http(`${base}/content?token=${process.env.BROWSERLESS_TOKEN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, gotoOptions: { waitUntil: 'networkidle2' } }),
      timeout: 25000,
      guard: false,
    });
    return { html: await r.text(), via: 'browserless' };
  }
  // Keyless fallback: Jina Reader renders the page and returns markdown.
  const headers = { accept: 'text/plain' };
  if (process.env.JINA_API_KEY) headers.authorization = `Bearer ${process.env.JINA_API_KEY}`;
  const r = await http(`https://r.jina.ai/${url}`, { headers, timeout: 25000, guard: false });
  return { markdown: await r.text(), via: 'jina' };
}

export async function web_fetch({ url, mode = 'text', find, offset = 0, max_chars = 6000, render: want = 'auto' }) {
  max_chars = Math.min(max_chars, 20000);
  const res = await http(url);
  const type = res.headers.get('content-type') || '';
  if (/pdf|image\/|audio\/|video\/|octet-stream|zip|officedocument/.test(type)) {
    const size = res.headers.get('content-length');
    res.body?.cancel();
    return compact({ url, type, size, note: 'Binary file. In ChatGPT, have the user upload it and use built-in Python (PDF, Excel, images). Elsewhere, use openai or a file tool.' });
  }
  let body = await res.text();
  if (!type.includes('html')) {
    const text = find ? focus(body, find) : body.slice(offset);
    return { url, type, content: cap(text, max_chars, offset) };
  }
  if (mode === 'meta') return { url, ...extractMeta(body) };
  if (mode === 'links') return { url, links: extractLinks(body, url, 80) };

  let text = htmlToText(body);
  let rendered;
  if (want === 'always' || (want === 'auto' && text.length < 400 && SPA_SHELL.test(body))) {
    try {
      const r = await render(url);
      rendered = r.via;
      text = r.markdown ?? htmlToText(r.html);
      if (r.html) body = r.html;
    } catch (e) {
      rendered = `failed: ${e.message.slice(0, 80)}`;
    }
  }
  const content = find ? focus(text, find) : cap(text.slice(offset), max_chars, offset);
  return compact({ url, ...extractMeta(body), rendered, chars: text.length, content });
}

export async function web_search({ query, limit = 6, site }) {
  limit = Math.min(limit, 15);
  const q = site ? `${query} site:${site}` : query;
  if (process.env.BRAVE_API_KEY) {
    const r = await http(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${limit}`, {
      headers: { 'X-Subscription-Token': process.env.BRAVE_API_KEY, accept: 'application/json' },
      guard: false,
    });
    const j = await r.json();
    return { query: q, results: (j.web?.results || []).map((x) => compact({ title: x.title, url: x.url, snippet: htmlToText(x.description || ''), age: x.age })) };
  }
  // Keyless fallback.
  const r = await http(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { guard: false });
  const html = await r.text();
  const results = [];
  for (const m of html.matchAll(/class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)) {
    let link = m[1];
    const u = link.match(/uddg=([^&]+)/);
    if (u) link = decodeURIComponent(u[1]);
    if (/duckduckgo\.com\/y\.js/.test(link)) continue; // ads
    results.push({ title: htmlToText(m[2]), url: link, snippet: htmlToText(m[3]) });
    if (results.length >= limit) break;
  }
  return { query: q, results };
}

// search → read top N in parallel (one per domain) → condensed notes.
// One call instead of 1 search + N fetches + N model turns.
export async function research({ query, depth = 3, chars_per_source = 1500, find, site }) {
  depth = Math.min(depth, 6);
  const { results } = await web_search({ query, limit: depth + 4, site });
  const seen = new Set();
  const picks = [];
  const rest = [];
  for (const r of results) {
    let host = '';
    try { host = new URL(r.url).hostname.replace(/^www\./, ''); } catch {}
    if (picks.length < depth && !seen.has(host)) {
      seen.add(host);
      picks.push(r);
    } else rest.push(r);
  }
  const pages = await Promise.allSettled(picks.map((r) => web_fetch({ url: r.url, max_chars: chars_per_source, find })));
  return {
    query,
    fetched_at: new Date().toISOString(),
    sources: pages.map((p, i) => ({
      url: picks[i].url,
      title: picks[i].title,
      notes: p.status === 'fulfilled' ? p.value.content : `fetch failed (${p.reason?.message?.slice(0, 80)}); snippet: ${picks[i].snippet}`,
    })),
    also_see: rest.slice(0, 4).map((r) => r.url),
  };
}
