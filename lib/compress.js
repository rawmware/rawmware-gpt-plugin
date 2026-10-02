// Token economy: every byte we return is a token the model pays for and a
// token stolen from reasoning. These helpers shrink payloads before they leave.

const DROP_TAGS = /<(script|style|noscript|svg|iframe|nav|footer|header|form|template|aside)[\s\S]*?<\/\1>/gi;
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…', '&rsquo;': "'", '&lsquo;': "'", '&rdquo;': '"', '&ldquo;': '"' };

export function decodeEntities(s = '') {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? ' ');
}

export function htmlToText(html) {
  // Prefer <main>/<article> when present: that's where the content is.
  const main = html.match(/<(main|article)[^>]*>([\s\S]*?)<\/\1>/i)?.[2];
  const src = main && main.length > 500 ? main : html;
  return decodeEntities(
    src
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(DROP_TAGS, ' ')
      .replace(/<(h[1-6])[^>]*>/gi, '\n## ')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<(br|p|div|section|article|tr|pre|blockquote)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function metaContent(html, attr, name) {
  const a = html.match(new RegExp(`<meta[^>]+${attr}=["']${name}["'][^>]+content=["']([^"']*)`, 'i'))?.[1];
  const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${name}["']`, 'i'))?.[1];
  const v = (a ?? b)?.trim();
  return v ? decodeEntities(v) : undefined;
}

export function extractMeta(html) {
  return compact({
    title: decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || '') || undefined,
    description: metaContent(html, 'name', 'description') || metaContent(html, 'property', 'og:description'),
    ogTitle: metaContent(html, 'property', 'og:title'),
    ogImage: metaContent(html, 'property', 'og:image'),
    siteName: metaContent(html, 'property', 'og:site_name'),
    themeColor: metaContent(html, 'name', 'theme-color'),
    lang: html.match(/<html[^>]+lang=["']([^"']+)/i)?.[1],
  });
}

export function extractLinks(html, base, limit = 50) {
  const out = new Set();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    if (/^(mailto|tel|javascript):/i.test(m[1])) continue;
    try { out.add(new URL(m[1], base).href); } catch {}
    if (out.size >= limit) break;
  }
  return [...out];
}

// Hard cap with a visible marker so the model knows to page instead of guessing.
export function cap(text, max = 6000, offset = 0) {
  if (!text || text.length <= max) return text;
  return text.slice(0, max) + `\n…[truncated ${text.length - max} chars — call again with offset=${offset + max}]`;
}

// Return only the lines that mention any of `terms`, with ±ctx lines around
// them. Reading 600 chars about "pricing" beats reading a 40k-char page.
export function focus(text, terms, ctx = 1, max = 4000) {
  const words = [].concat(terms).flatMap((t) => String(t).toLowerCase().split(/[,|]/)).map((t) => t.trim()).filter(Boolean);
  if (!words.length) return text;
  const lines = text.split('\n');
  const keep = new Set();
  lines.forEach((l, i) => {
    const low = l.toLowerCase();
    if (words.some((w) => low.includes(w))) for (let j = i - ctx; j <= i + ctx; j++) if (j >= 0 && j < lines.length) keep.add(j);
  });
  if (!keep.size) return `[no lines matched: ${words.join(', ')}]`;
  // Long lines (minified HTML, giant paragraphs) get windowed around the match;
  // context lines get clipped. Otherwise one paragraph can be the whole page.
  const clip = (line) => {
    const low = line.toLowerCase();
    const at = Math.min(...words.map((w) => low.indexOf(w)).filter((n) => n >= 0));
    if (Number.isFinite(at)) return line.length > 400 ? `…${line.slice(Math.max(0, at - 160), at + 240)}…` : line;
    return line.length > 160 ? `${line.slice(0, 160)}…` : line;
  };
  const out = [];
  let prev = -2;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i !== prev + 1) out.push('…');
    out.push(clip(lines[i]));
    prev = i;
  }
  return cap(out.join('\n'), max);
}

// Keep only listed keys from API objects (GitHub/Vercel JSON is ~90% noise).
export function pick(obj, keys) {
  const o = {};
  for (const k of keys) if (obj?.[k] !== undefined && obj[k] !== null && obj[k] !== '') o[k] = obj[k];
  return o;
}

// Drop undefined/null/empty values so they don't cost tokens.
export function compact(obj) {
  const o = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && !v.length) continue;
    o[k] = v;
  }
  return o;
}

export const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : undefined);
