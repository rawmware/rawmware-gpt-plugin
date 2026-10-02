// "Stay relevant" isn't a vibe, it's a data feed. These are the places where
// builders find out what's new, all readable without keys.
import { http } from '../net.js';
import { htmlToText, compact } from '../compress.js';

async function hn(topic, limit) {
  const since = Math.floor(Date.now() / 1000) - 7 * 86400;
  const url = topic
    ? `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(topic)}&tags=story&numericFilters=created_at_i>${since},points>20&hitsPerPage=${limit}`
    : `https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=${limit}`;
  const j = await (await http(url, { guard: false })).json();
  return j.hits.map((h) => compact({ title: h.title, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, points: h.points, comments: h.num_comments }));
}

async function githubTrending(topic, limit, since = 'daily') {
  const lang = topic && /^[a-z+#]+$/i.test(topic) && topic.length < 15 ? `/${encodeURIComponent(topic.toLowerCase())}` : '';
  const html = await (await http(`https://github.com/trending${lang}?since=${since}`, { guard: false })).text();
  const out = [];
  for (const block of html.split('<article').slice(1)) {
    const repo = block.match(/<h2[^>]*>[\s\S]*?href="\/([^"]+)"/)?.[1];
    if (!repo) continue;
    out.push(compact({
      repo,
      desc: htmlToText(block.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] || '').slice(0, 140),
      lang: block.match(/itemprop="programmingLanguage">([^<]+)/)?.[1],
      today: block.match(/([\d,]+) stars (today|this week|this month)/)?.[1],
    }));
    if (out.length >= limit) break;
  }
  return out;
}

async function reddit(topic, limit) {
  const sub = (topic || 'programming').replace(/^r\//, '').replace(/[^\w]/g, '');
  const j = await (await http(`https://www.reddit.com/r/${sub}/top.json?t=week&limit=${limit}`, { guard: false })).json();
  return j.data.children.map(({ data: d }) => compact({ title: d.title, url: `https://reddit.com${d.permalink}`, score: d.score, comments: d.num_comments }));
}

async function devto(topic, limit) {
  const tag = topic ? `&tag=${encodeURIComponent(topic.toLowerCase().replace(/\W/g, ''))}` : '';
  const j = await (await http(`https://dev.to/api/articles?top=7&per_page=${limit}${tag}`, { guard: false })).json();
  return j.map((a) => compact({ title: a.title, url: a.url, reactions: a.public_reactions_count, tags: a.tag_list }));
}

async function npm(topic, limit) {
  const j = await (await http(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(topic || 'mcp')}&size=${limit}&popularity=1.0`, { guard: false })).json();
  return j.objects.map((o) => compact({ name: o.package.name, desc: o.package.description?.slice(0, 120), version: o.package.version, updated: o.package.date?.slice(0, 10) }));
}

const SOURCES = { hn, github: githubTrending, reddit, devto, npm };

export async function trends({ source = 'all', topic, limit = 8 }) {
  limit = Math.min(limit, 25);
  if (source !== 'all') {
    if (!SOURCES[source]) throw new Error(`unknown source ${source}; use ${Object.keys(SOURCES).join('|')}|all`);
    return { source, topic, items: await SOURCES[source](topic, limit) };
  }
  const per = Math.max(3, Math.ceil(limit / 2));
  const names = ['hn', 'github', 'devto'];
  const res = await Promise.allSettled(names.map((n) => SOURCES[n](topic, per)));
  return {
    topic,
    at: new Date().toISOString().slice(0, 16),
    ...Object.fromEntries(names.map((n, i) => [n, res[i].status === 'fulfilled' ? res[i].value : `unavailable: ${res[i].reason?.message?.slice(0, 60)}`])),
  };
}
