import { http, api } from '../net.js';
import { extractMeta, htmlToText, compact, decodeEntities } from '../compress.js';
import { SPECS, SPECS_AS_OF } from '../social-specs.js';

function platformOf(url) {
  const h = new URL(url).hostname.replace(/^www\.|^m\./, '');
  if (h.endsWith('tiktok.com')) return 'tiktok';
  if (h.endsWith('instagram.com')) return 'instagram';
  if (h.endsWith('youtube.com') || h === 'youtu.be') return 'youtube';
  if (h === 'x.com' || h === 'twitter.com') return 'x';
  if (h.endsWith('linkedin.com')) return 'linkedin';
  return 'web';
}

// "12.3K" / "1.2M" / "4,512" → number
function num(s) {
  if (!s) return undefined;
  const m = String(s).replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return undefined;
  return Math.round(parseFloat(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2]?.toLowerCase()] || 1));
}

// Official oEmbed endpoints: stable, keyless (Instagram needs a Meta app token).
async function oembed(url) {
  const p = platformOf(url);
  const enc = encodeURIComponent(url);
  const endpoints = {
    tiktok: `https://www.tiktok.com/oembed?url=${enc}`,
    youtube: `https://www.youtube.com/oembed?url=${enc}&format=json`,
    x: `https://publish.twitter.com/oembed?url=${enc}&omit_script=1`,
    instagram: process.env.META_APP_TOKEN ? `https://graph.facebook.com/v21.0/instagram_oembed?url=${enc}&access_token=${process.env.META_APP_TOKEN}` : null,
  };
  if (!endpoints[p]) return null;
  const j = await (await api(endpoints[p])).json();
  return compact({
    platform: p, title: j.title, author: j.author_name, author_url: j.author_url, thumbnail: j.thumbnail_url,
    text: p === 'x' && j.html ? htmlToText(j.html).slice(0, 500) : undefined,
  });
}

// Public profile/post metadata from the page itself (og tags + embedded JSON).
async function scrapeMeta(url) {
  const html = await (await http(url, { headers: { 'accept-language': 'en-US,en;q=0.9' } })).text();
  const meta = extractMeta(html);
  const out = { platform: platformOf(url), ...meta };
  // Instagram og:description: "12K Followers, 300 Following, 210 Posts - …"
  const ig = meta.description?.match(/([\d.,]+[KMB]?) Followers, ([\d.,]+[KMB]?) Following, ([\d.,]+[KMB]?) Posts/i);
  if (ig) Object.assign(out, { followers: num(ig[1]), following: num(ig[2]), posts: num(ig[3]) });
  // TikTok embeds stats JSON in the page.
  const tk = (k) => num(html.match(new RegExp(`"${k}":(\\d+)`))?.[1]);
  if (out.platform === 'tiktok') Object.assign(out, compact({ followers: tk('followerCount'), likes: tk('heartCount'), videos: tk('videoCount'), plays: tk('playCount') }));
  const yt = html.match(/"subscriberCountText":\{[^}]*?"simpleText":"([^"]+)"/)?.[1];
  if (yt) out.subscribers = decodeEntities(yt);
  return compact(out);
}

export async function social({ op, url, platform }) {
  switch (op) {
    case 'post': {
      if (!url) throw new Error('url is required');
      const [o, m] = await Promise.allSettled([oembed(url), scrapeMeta(url)]);
      const res = { ...(m.status === 'fulfilled' ? m.value : {}), ...(o.status === 'fulfilled' && o.value ? o.value : {}) };
      if (!Object.keys(res).length) throw new Error(`could not read ${url} (${o.reason?.message || m.reason?.message})`);
      return res;
    }
    case 'profile': {
      if (!url) throw new Error('url is required');
      return scrapeMeta(url);
    }
    case 'specs': {
      const p = platform?.toLowerCase().replace(/\s+/g, '_');
      return { as_of: SPECS_AS_OF, ...(p && SPECS[p] ? { [p]: SPECS[p], universal: SPECS.universal } : SPECS) };
    }
    default:
      throw new Error(`unknown social op: ${op}`);
  }
}
