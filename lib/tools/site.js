// Live-site checks: is it fast, cached, secure, indexable, and does every
// page work? Plus a scoped crawler for reading docs sections or finding
// broken pages. Timings are measured from the server's region (approximate
// for end users, exact for comparisons: before vs after, cold vs warm).
import { http, readText, pool, deadline, BROWSER_UA } from '../net.js';
import { htmlToText, extractMeta, focus, compact } from '../compress.js';
import { designAudit } from './design.js';

async function timed(url, timeout = 10000) {
  const hops = [];
  const t0 = performance.now();
  const res = await http(url, { hops, timeout, headers: { 'user-agent': BROWSER_UA, accept: 'text/html,*/*', 'accept-encoding': 'gzip, br' } });
  const ttfb = Math.round(performance.now() - t0);
  const body = await readText(res);
  return { res, body, hops, ttfb, total: Math.round(performance.now() - t0) };
}

const SEC_HEADERS = ['strict-transport-security', 'content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy'];

export async function health(url) {
  const budget = deadline(24000);
  const origin = new URL(url).origin;
  const [first, robots, sitemap] = await Promise.all([
    timed(url),
    http(`${origin}/robots.txt`, { timeout: 6000 }).then(async (r) => ({ ok: true, text: await readText(r, 50_000) })).catch((e) => ({ ok: false, status: e.status })),
    http(`${origin}/sitemap.xml`, { timeout: 6000 }).then(() => true).catch(() => false),
  ]);
  const warm = budget.left() > 6000 ? await timed(url, 6000).catch(() => null) : null;
  const { res, body, hops } = first;
  const h = (k) => res.headers.get(k);
  const head = body.match(/<head\b[\s\S]*?<\/head>/i)?.[0] || '';
  const scripts = [...body.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const external = scripts.filter((s) => /\bsrc=/.test(s[1]));
  const blocking = [...head.matchAll(/<script\b([^>]*)>/gi)].filter((s) => /\bsrc=/.test(s[1]) && !/\b(async|defer)\b|type=["']module["']/.test(s[1])).length;
  const inlineJs = scripts.filter((s) => !/\bsrc=/.test(s[1])).reduce((n, s) => n + s[2].length, 0);
  const thirdParty = [...new Set(external.map((s) => s[1].match(/src=["']([^"']+)/)?.[1]).filter(Boolean).map((u) => { try { return new URL(u, url).hostname; } catch { return null; } }).filter((d) => d && d !== new URL(url).hostname))];
  const imgs = [...body.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const meta = extractMeta(body);
  const noindex = /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(body) || /noindex/i.test(h('x-robots-tag') || '');
  const bytes = Buffer.byteLength(body);
  const enc = h('content-encoding');

  const issues = [];
  const add = (sev, msg) => issues.push(`${sev} ${msg}`);
  if (first.ttfb > 800) add('🔴', `Slow server response: ${first.ttfb}ms to first byte (aim < 200ms cached, < 600ms dynamic).`);
  else if (first.ttfb > 400) add('🟠', `TTFB ${first.ttfb}ms: consider caching/ISR/edge.`);
  if (hops.length > 1) add('🟠', `${hops.length} redirects before content (${hops.map((x) => x.status).join(' → ')}): link directly to the final URL.`);
  if (!enc && bytes > 10_000) add('🔴', 'HTML not compressed (no gzip/br).');
  if (bytes > 500_000) add('🟠', `HTML is ${Math.round(bytes / 1024)}KB: large inline data/hydration payload.`);
  if (blocking) add('🟠', `${blocking} render-blocking <script> in <head> (add defer/async or type=module).`);
  if (inlineJs > 100_000) add('🟠', `${Math.round(inlineJs / 1024)}KB inline JS.`);
  if (thirdParty.length > 5) add('🟡', `${thirdParty.length} third-party script hosts: each costs DNS+TLS and main-thread time.`);
  if (!/max-age|s-maxage/.test(h('cache-control') || '') && !h('x-vercel-cache') && !h('cf-cache-status')) add('🟡', 'No cache-control max-age on HTML (fine if dynamic; otherwise cache at the edge).');
  const missingImgDims = imgs.filter((i) => !/\bwidth=/.test(i) || !/\bheight=/.test(i)).length;
  if (missingImgDims) add('🟡', `${missingImgDims} <img> without width/height → layout shift (CLS).`);
  if (imgs.length > 3 && !imgs.some((i) => /loading=["']lazy/.test(i))) add('🟡', 'No lazy-loaded images.');
  const missingSec = SEC_HEADERS.filter((k) => !h(k));
  if (missingSec.includes('strict-transport-security') && url.startsWith('https')) add('🟠', 'No HSTS header.');
  if (missingSec.includes('content-security-policy')) add('🟡', 'No Content-Security-Policy.');
  if (!meta.title) add('🔴', 'No <title>.');
  if (!meta.description) add('🟠', 'No meta description.');
  if (!/<meta[^>]+name=["']viewport/i.test(body)) add('🔴', 'No viewport meta: broken on mobile.');
  if (!meta.canonical) add('🟡', 'No canonical URL.');
  if (!meta.ogImage) add('🟡', 'No og:image: shared links render without a preview.');
  if (noindex) add('🟠', 'Page is noindex (intended?).');
  if (!robots.ok) add('🟡', 'No robots.txt.');
  if (!sitemap) add('🟡', 'No sitemap.xml.');
  if ((body.match(/<h1\b/gi) || []).length !== 1) add('🟡', `${(body.match(/<h1\b/gi) || []).length} <h1> elements (use exactly one).`);

  const score = Math.max(0, 100 - issues.reduce((s, i) => s + (i.startsWith('🔴') ? 15 : i.startsWith('🟠') ? 7 : 3), 0));
  return compact({
    url: res.finalUrl,
    status: res.status,
    score,
    timing_ms: compact({ ttfb: first.ttfb, total: first.total, warm_ttfb: warm?.ttfb, from: process.env.VERCEL_REGION || 'server' }),
    size_kb: Math.round(bytes / 102.4) / 10,
    compression: enc || 'none',
    cache: compact({ 'cache-control': h('cache-control'), age: h('age'), vercel: h('x-vercel-cache'), cloudflare: h('cf-cache-status'), warm: warm?.res.headers.get('x-vercel-cache') || warm?.res.headers.get('cf-cache-status') }),
    server: h('server') || (h('x-vercel-id') ? 'Vercel' : undefined),
    redirects: hops.length ? hops.map((x) => `${x.status} ${x.url}`) : undefined,
    scripts: { external: external.length, render_blocking: blocking, inline_kb: Math.round(inlineJs / 1024), third_party: thirdParty.slice(0, 10) },
    images: imgs.length,
    security_headers_missing: missingSec,
    seo: compact({ title: meta.title, title_len: meta.title?.length, description_len: meta.description?.length, canonical: meta.canonical, noindex: noindex || undefined, robots_txt: robots.ok, sitemap }),
    issues,
    note: 'Network timings only. For Core Web Vitals (LCP ≤2.5s, INP ≤200ms, CLS ≤0.1) use PageSpeed Insights or Vercel Speed Insights.',
  });
}

// Scoped BFS crawl. Default scope = the start URL's directory, so crawling
// /docs/routing stays inside /docs/. With `find`, returns only matching lines.
export async function crawl({ url, find, max_pages = 15, scope }) {
  const budget = deadline(24000);
  max_pages = Math.min(max_pages, 40);
  const start = new URL(url);
  const prefix = scope ?? start.pathname.replace(/[^/]*$/, '');
  const norm = (u) => { const x = new URL(u); x.hash = ''; x.search = ''; return x.href.replace(/\/$/, ''); };
  const queue = [norm(url)];
  const seen = new Set(queue);
  const pages = [];
  const broken = [];
  while (queue.length && pages.length + broken.length < max_pages && !budget.over()) {
    const batch = queue.splice(0, Math.min(6, max_pages - pages.length - broken.length));
    const res = await pool(batch, 6, async (u) => {
      const t0 = performance.now();
      const r = await http(u, { timeout: Math.min(8000, budget.left()), headers: { 'user-agent': BROWSER_UA } });
      const type = r.headers.get('content-type') || '';
      const html = /html/.test(type) ? await readText(r, 2_000_000) : (r.body?.cancel(), '');
      return { u, html, ms: Math.round(performance.now() - t0), final: r.finalUrl };
    });
    for (let i = 0; i < res.length; i++) {
      const r = res[i];
      if (!r.ok) { broken.push(`${batch[i]} — ${r.error.status || r.error.message.slice(0, 60)}`); continue; }
      const { u, html, ms } = r.value;
      const meta = extractMeta(html);
      const page = { url: u, title: meta.title?.slice(0, 80), ms };
      if (find) {
        const hit = focus(htmlToText(html), find, 1, 700);
        if (!hit.startsWith('[no lines')) page.matches = hit;
      }
      pages.push(page);
      for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
        let next;
        try { next = new URL(m[1], u); } catch { continue; }
        if (next.origin !== start.origin || !next.pathname.startsWith(prefix) || /\.(png|jpe?g|gif|svg|webp|pdf|zip|css|js|ico|xml|txt|mp4)$/i.test(next.pathname)) continue;
        const n = norm(next.href);
        if (!seen.has(n)) { seen.add(n); queue.push(n); }
      }
    }
  }
  const relevant = find ? pages.filter((p) => p.matches) : pages;
  return compact({
    start: url, scope: prefix, crawled: pages.length, discovered: seen.size,
    broken: broken.length ? broken : undefined,
    pages: find ? relevant : pages.map((p) => `${p.url} — ${p.title || ''} (${p.ms}ms)`),
    slowest: find ? undefined : pages.slice().sort((a, b) => b.ms - a.ms).slice(0, 3).map((p) => `${p.ms}ms ${p.url}`),
    partial: budget.over() || queue.length ? `stopped with ${queue.length} URLs unvisited; raise max_pages or narrow scope` : undefined,
  });
}

export async function site(args) {
  const { op = 'health', url } = args;
  if (!url) throw new Error('url is required');
  switch (op) {
    case 'health': return health(url);
    case 'crawl': return crawl(args);
    case 'design': return designAudit(args);
    default: throw new Error(`unknown site op: ${op}`);
  }
}
