// Token economy: every byte we return is a token the model pays for and a
// token stolen from reasoning. These helpers shrink payloads before they leave.

const DROP_TAGS = /<(script|style|noscript|svg|iframe|nav|footer|header|form|template)[\s\S]*?<\/\1>/gi;
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

export function htmlToText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(DROP_TAGS, ' ')
    .replace(/<(h[1-6])[^>]*>/gi, '\n## ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<(br|p|div|section|article|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export function extractMeta(html) {
  const pick = (re) => (html.match(re) || [])[1]?.trim();
  return {
    title: pick(/<title[^>]*>([^<]*)<\/title>/i),
    description: pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i),
    ogImage: pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)/i),
  };
}

export function extractLinks(html, base, limit = 50) {
  const out = new Set();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try { out.add(new URL(m[1], base).href); } catch {}
    if (out.size >= limit) break;
  }
  return [...out];
}

// Hard cap with a visible marker so the model knows to page instead of guessing.
export function cap(text, max = 6000) {
  if (!text || text.length <= max) return text;
  return text.slice(0, max) + `\n…[truncated ${text.length - max} chars — call again with offset=${max}]`;
}

// Keep only listed keys from API objects (GitHub/Vercel JSON is ~90% noise).
export function pick(obj, keys) {
  const o = {};
  for (const k of keys) if (obj?.[k] !== undefined && obj[k] !== null) o[k] = obj[k];
  return o;
}
