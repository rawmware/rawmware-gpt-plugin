// Design taste, made measurable. Pulls a site's real design tokens (palette,
// type, spacing, radius, motion) out of its HTML + CSS, then scores it against
// the rubric in playbooks/design-taste.md. Output is a fingerprint the model can
// reason about, or reuse to build something "in the style of" a reference.
import { http } from '../net.js';
import { extractMeta, compact } from '../compress.js';

const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);

function hexNorm(h) {
  h = h.toLowerCase();
  if (h.length === 4) h = '#' + [...h.slice(1)].map((c) => c + c).join('');
  return h.length === 7 ? h : null; // ignore #rrggbbaa for palette purposes
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
}

function saturation(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

export function analyzeCss(css) {
  const colors = new Map(), fonts = new Map(), sizes = new Map(), space = new Map(), radii = new Map(), durations = new Map();
  const vars = {};
  for (const m of css.matchAll(/(?<=[:\s,(])#([0-9a-f]{3}|[0-9a-f]{6})\b(?![^;{}]*\{)/gi)) { const h = hexNorm('#' + m[1]); if (h) bump(colors, h); }
  for (const m of css.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/gi)) bump(colors, rgbToHex(+m[1], +m[2], +m[3]));
  for (const m of css.matchAll(/(oklch|oklab|hsl)a?\([^)]+\)/gi)) bump(colors, m[0].toLowerCase().replace(/\s+/g, ' '));
  for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    const f = m[1].split(',')[0].replace(/["']/g, '').trim();
    if (f && !/^(var\(|inherit|initial|unset)/.test(f)) bump(fonts, f);
  }
  for (const m of css.matchAll(/@font-face\s*{[^}]*font-family\s*:\s*["']?([^;"'}]+)/gi)) bump(fonts, m[1].trim());
  for (const m of css.matchAll(/font-size\s*:\s*([\d.]+)(px|rem|em)\b/gi)) bump(sizes, m[2] === 'px' ? +m[1] : Math.round(+m[1] * 16 * 10) / 10);
  for (const m of css.matchAll(/(?:margin|padding|gap|row-gap|column-gap)(?:-[a-z]+)?\s*:\s*([^;}]+)/gi))
    for (const v of m[1].matchAll(/([\d.]+)(px|rem)\b/g)) { const px = v[2] === 'px' ? +v[1] : +v[1] * 16; if (px > 0) bump(space, px); }
  for (const m of css.matchAll(/border-radius\s*:\s*([\d.]+)(px|rem)/gi)) bump(radii, m[2] === 'px' ? +m[1] : +m[1] * 16);
  for (const m of css.matchAll(/(?:transition|animation)(?:-duration)?\s*:[^;}]*?([\d.]+)(ms|s)\b/gi)) bump(durations, m[2] === 's' ? +m[1] * 1000 : +m[1]);
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;}]{1,60})/g)) if (Object.keys(vars).length < 40) vars[m[1]] = m[2].trim();
  return { colors, fonts, sizes, space, radii, durations, vars };
}

function detectStack(html) {
  const t = [];
  const add = (cond, name) => cond && t.push(name);
  add(/\/_next\//.test(html), 'Next.js');
  add(/__nuxt|\/_nuxt\//.test(html), 'Nuxt');
  add(/data-svelte|__sveltekit/.test(html), 'SvelteKit');
  add(/astro-island|data-astro/.test(html), 'Astro');
  add(/framerusercontent|data-framer/.test(html), 'Framer');
  add(/webflow/i.test(html), 'Webflow');
  add(/cdn\.shopify|Shopify\.theme/.test(html), 'Shopify');
  add(/wp-content|wp-includes/.test(html), 'WordPress');
  add(/squarespace/i.test(html), 'Squarespace');
  add(/--tw-|class="[^"]*\b(flex|grid) [^"]*\b(items-center|gap-\d)/.test(html), 'Tailwind');
  add(/vercel-insights|_vercel\//.test(html), 'Vercel');
  return t;
}

export async function design_audit({ url, max_stylesheets = 4 }) {
  const html = await (await http(url)).text();
  const inline = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  const styleAttrs = [...html.matchAll(/style="([^"]*)"/gi)].map((m) => m[1]).join(';');
  const sheetUrls = [...html.matchAll(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi)]
    .map((m) => m[0].match(/href=["']([^"']+)/)?.[1])
    .filter(Boolean)
    .map((h) => { try { return new URL(h, url).href; } catch { return null; } })
    .filter(Boolean);
  const googleFonts = sheetUrls.filter((u) => u.includes('fonts.googleapis.com')).flatMap((u) => [...u.matchAll(/family=([^:&]+)/g)].map((m) => decodeURIComponent(m[1]).replace(/\+/g, ' ')));
  const sheets = await Promise.allSettled(sheetUrls.filter((u) => !u.includes('fonts.googleapis.com')).slice(0, Math.min(max_stylesheets, 8)).map(async (u) => (await http(u, { timeout: 8000 })).text()));
  const css = [inline, styleAttrs, ...sheets.filter((s) => s.status === 'fulfilled').map((s) => s.value.slice(0, 600_000))].join('\n');
  const a = analyzeCss(css);
  googleFonts.forEach((f) => bump(a.fonts, f));

  const palette = top(a.colors, 12).map(([c]) => c);
  const hexes = palette.filter((c) => c.startsWith('#'));
  const accents = hexes.filter((h) => saturation(h) > 0.35);
  const sorted = [...hexes].sort((x, y) => luminance(x) - luminance(y));
  const darkest = sorted[0], lightest = sorted[sorted.length - 1];
  const typeScale = [...a.sizes.keys()].filter((s) => s >= 10 && s <= 96).sort((x, y) => x - y);
  const spaceVals = [...a.space.entries()];
  const totalSpace = spaceVals.reduce((s, [, n]) => s + n, 0);
  const onGrid = totalSpace ? Math.round((spaceVals.filter(([v]) => v % 4 === 0).reduce((s, [, n]) => s + n, 0) / totalSpace) * 100) : null;
  const fontList = top(a.fonts, 6).map(([f]) => f).filter((f) => !/^(system-ui|-apple-system|sans-serif|serif|monospace|ui-\w+|BlinkMacSystemFont|Segoe UI|Arial|Helvetica)$/i.test(f));

  // Accessibility & craft checks straight from markup.
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const noAlt = imgs.filter((i) => !/\balt=/.test(i)).length;
  const headings = [...html.matchAll(/<h([1-6])\b/gi)].map((m) => +m[1]);
  const h1s = headings.filter((h) => h === 1).length;
  const skipped = headings.some((h, i) => i > 0 && h - headings[i - 1] > 1);
  const meta = extractMeta(html);

  const checks = {
    viewport: /<meta[^>]+name=["']viewport/i.test(html),
    lang: !!meta.lang,
    og_image: !!meta.ogImage,
    description: !!meta.description,
    favicon: /<link[^>]+rel=["'][^"']*icon/i.test(html),
    one_h1: h1s === 1,
    heading_order: !skipped,
    img_alt: noAlt === 0,
    reduced_motion: /prefers-reduced-motion/.test(css),
    dark_mode: /prefers-color-scheme:\s*dark/.test(css),
    focus_styles: /:focus-visible/.test(css),
  };

  // Taste rubric: restraint + system + craft. 100 = disciplined, shippable.
  const fixes = [];
  let score = 100;
  const ding = (pts, msg) => { score -= pts; fixes.push(msg); };
  if (accents.length > 4) ding(12, `Palette sprawl: ${accents.length} saturated colors. Pick 1 accent + neutrals (60/30/10).`);
  if (fontList.length > 2) ding(10, `${fontList.length} font families (${fontList.join(', ')}). Use 1–2: one for display, one for text.`);
  if (typeScale.length > 10) ding(8, `${typeScale.length} distinct font sizes. Collapse to a 5–7 step scale (e.g. 12/14/16/20/24/32/48).`);
  if (onGrid !== null && onGrid < 70) ding(8, `Only ${onGrid}% of spacing is on a 4px grid. Use a 4/8 spacing scale.`);
  if (a.radii.size > 5) ding(4, `${a.radii.size} different border radii. Use 2–3 (e.g. 6/12/full).`);
  if (darkest && lightest && contrast(darkest, lightest) < 7) ding(8, `Max palette contrast is ${contrast(darkest, lightest)}:1. Body text needs ≥4.5:1, aim for 7:1.`);
  if (!checks.viewport) ding(10, 'No viewport meta: broken on phones.');
  if (!checks.img_alt) ding(6, `${noAlt} images missing alt text.`);
  if (!checks.one_h1) ding(4, `${h1s} <h1> elements. Use exactly one.`);
  if (!checks.heading_order) ding(3, 'Heading levels skip (e.g. h2 → h4).');
  if (!checks.og_image) ding(5, 'No og:image: links look dead when shared on IG/X/iMessage.');
  if (!checks.description) ding(3, 'No meta description.');
  if (!checks.focus_styles) ding(3, 'No :focus-visible styles: keyboard users are lost.');
  if (!checks.reduced_motion && a.durations.size) ding(2, 'Animations ignore prefers-reduced-motion.');
  if ([...a.durations.keys()].some((d) => d > 600)) ding(2, 'Some transitions are over 600ms. UI motion should mostly be 150–300ms.');

  return compact({
    url,
    title: meta.title,
    stack: detectStack(html),
    score: Math.max(0, score),
    grade: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 65 ? 'C' : score >= 50 ? 'D' : 'F',
    fixes: fixes.slice(0, 8),
    tokens: compact({
      palette,
      accents,
      contrast_range: darkest && lightest ? `${darkest} on ${lightest} = ${contrast(darkest, lightest)}:1` : undefined,
      theme_color: meta.themeColor,
      fonts: fontList.length ? fontList : top(a.fonts, 3).map(([f]) => f),
      type_scale: typeScale.slice(0, 14),
      spacing: top(a.space, 10).map(([v]) => v).sort((x, y) => x - y),
      spacing_on_4px_grid: onGrid === null ? undefined : `${onGrid}%`,
      radii: top(a.radii, 6).map(([v]) => v).sort((x, y) => x - y),
      motion_ms: top(a.durations, 5).map(([v]) => v).sort((x, y) => x - y),
      css_vars: Object.keys(a.vars).length ? Object.fromEntries(Object.entries(a.vars).slice(0, 24)) : undefined,
    }),
    checks,
    stylesheets_read: sheets.filter((s) => s.status === 'fulfilled').length,
  });
}
