// Token economy: every byte we return is a token the model pays for and a
// token stolen from reasoning. These helpers shrink payloads before they leave,
// without destroying what developers actually need (code, tables, headings).

const DROP_TAGS = /<(script|style|noscript|svg|iframe|nav|footer|form|template|aside|button|select|dialog)\b[\s\S]*?<\/\1>/gi;
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…', '&rsquo;': "'", '&lsquo;': "'", '&rdquo;': '"', '&ldquo;': '"', '&copy;': '©', '&rarr;': '→', '&times;': '×' };

export function decodeEntities(s = '') {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? ' ');
}

const stripTags = (s) => decodeEntities(s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));

// Pick the densest content container: <main>/<article>/[role=main], else the
// <div>/<section> with the most paragraph text. Cheap readability.
function mainContent(html) {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || html;
  const candidates = [];
  for (const m of body.matchAll(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/gi)) candidates.push(m[2]);
  for (const m of body.matchAll(/<(div|section)\b[^>]*(?:role=["']main["']|id=["'](?:content|main|docs?-content|article)["']|class=["'][^"']*(?:markdown|prose|content|article|docs?-body|post-body)[^"']*["'])[^>]*>([\s\S]*?)<\/\1>/gi)) candidates.push(m[2]);
  const score = (h) => (h.match(/<(p|li|pre|h[1-6]|td)\b/gi) || []).length * 20 + h.replace(/<[^>]+>/g, '').length / 50;
  const best = candidates.filter((c) => c.length > 400).sort((a, b) => score(b) - score(a))[0];
  return best && score(best) > score(body) * 0.3 ? best : body.replace(/<header\b[\s\S]*?<\/header>/i, '');
}

// HTML → compact markdown. Code blocks keep exact whitespace inside fences;
// tables become pipe rows; links optional (they cost tokens).
export function htmlToText(html, { links = false, base } = {}) {
  const blocks = [];
  const hold = (s) => `\u0000${blocks.push(s) - 1}\u0000`;
  let src = mainContent(html.replace(/<!--[\s\S]*?-->/g, ''))
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner) => {
      const lang = inner.match(/class=["'][^"']*(?:language|lang)-([\w+#-]+)/i)?.[1] || '';
      const code = stripTags(inner).replace(/^\n+|\s+$/g, '');
      return hold(`\n\`\`\`${lang}\n${code}\n\`\`\`\n`);
    })
    .replace(DROP_TAGS, ' ')
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => hold(`\`${stripTags(c).trim()}\``))
    .replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_, row) => {
      const cells = [...row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => stripTags(c[1]).replace(/\s+/g, ' ').trim());
      return cells.length ? `\n| ${cells.join(' | ')} |` : '';
    });
  if (links) {
    src = src.replace(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) => {
      const text = stripTags(t).replace(/\s+/g, ' ').trim();
      if (!text) return '';
      let u = href;
      try { u = new URL(href, base).href; } catch {}
      return hold(`[${text}](${u})`);
    });
  }
  const text = decodeEntities(
    src
      .replace(/<h([1-6])\b[^>]*>/gi, (_, n) => `\n${'#'.repeat(Math.min(Number(n) + 1, 6))} `)
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<(br|p|div|section|article|blockquote|dt|dd|header|table)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return text.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]).replace(/\n{3,}/g, '\n\n');
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
    ogImage: metaContent(html, 'property', 'og:image'),
    canonical: html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1],
    themeColor: metaContent(html, 'name', 'theme-color'),
    lang: html.match(/<html[^>]+lang=["']([^"']+)/i)?.[1],
  });
}

export function extractLinks(html, base, limit = 50) {
  const out = new Set();
  for (const m of html.matchAll(/<a\b[^>]*?href=["']([^"'#]+)["']/gi)) {
    if (/^(mailto|tel|javascript|data):/i.test(m[1])) continue;
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

// Error-ish lines from a log, with context, timestamps stripped. Used for CI
// and deploy logs: the first error is usually the real one.
export function logErrors(text, { ctx = 3, max = 40 } = {}) {
  const lines = text.split('\n').map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, '').replace(/\u001b\[[0-9;]*m/g, '').trimEnd());
  const re = /\b(error|failed|failure|fatal|exception|panic|cannot find|not found|undefined is not|exit code [1-9]|ERR!|✕|×|FAIL\b|Traceback|AssertionError|TypeError|SyntaxError|ReferenceError)/i;
  const hits = [];
  lines.forEach((l, i) => { if (re.test(l) && !/^##\[(group|endgroup)\]/.test(l)) hits.push(i); });
  const keep = new Set();
  for (const i of hits.slice(0, 15)) for (let j = i - ctx; j <= i + ctx; j++) if (j >= 0 && j < lines.length) keep.add(j);
  const out = [];
  let prev = -2;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i !== prev + 1) out.push('…');
    out.push(lines[i].slice(0, 300));
    prev = i;
  }
  return { error_lines: hits.length, first_error: hits.length ? lines[hits[0]].slice(0, 300) : undefined, context: out.slice(0, max * 2), tail: lines.filter(Boolean).slice(-15) };
}
