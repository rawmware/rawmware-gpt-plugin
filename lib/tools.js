import { htmlToText, extractMeta, extractLinks, cap, pick } from './compress.js';

const UA = 'rawmware-operator/1.0 (+https://github.com/rawmware/rawmware-gpt-plugin)';
const REGISTRY_URL =
  process.env.REGISTRY_URL ||
  'https://raw.githubusercontent.com/rawmware/rawmware-gpt-plugin/main/registry/plugins.json';

async function http(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'user-agent': UA, ...(opts.headers || {}) },
    signal: AbortSignal.timeout(opts.timeout || 15000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res;
}

// ───────────────────────── SCRAPE ─────────────────────────
export async function web_fetch({ url, mode = 'text', offset = 0, max_chars = 6000 }) {
  const res = await http(url);
  const type = res.headers.get('content-type') || '';
  const body = await res.text();
  if (!type.includes('html')) return { url, type, content: cap(body.slice(offset), max_chars) };
  if (mode === 'meta') return { url, ...extractMeta(body) };
  if (mode === 'links') return { url, links: extractLinks(body, url) };
  return { url, ...extractMeta(body), content: cap(htmlToText(body).slice(offset), max_chars) };
}

// ───────────────────────── RESEARCH ─────────────────────────
export async function web_search({ query, limit = 6 }) {
  if (process.env.BRAVE_API_KEY) {
    const r = await http(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`, {
      headers: { 'X-Subscription-Token': process.env.BRAVE_API_KEY, accept: 'application/json' },
    });
    const j = await r.json();
    return { query, results: (j.web?.results || []).map((x) => ({ title: x.title, url: x.url, snippet: x.description })) };
  }
  // Keyless fallback.
  const r = await http(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  const html = await r.text();
  const results = [];
  for (const m of html.matchAll(/class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)) {
    let url = m[1];
    const u = url.match(/uddg=([^&]+)/);
    if (u) url = decodeURIComponent(u[1]);
    results.push({ title: htmlToText(m[2]), url, snippet: htmlToText(m[3]) });
    if (results.length >= limit) break;
  }
  return { query, results };
}

// search → fetch top N in parallel → return compressed notes, not raw pages.
export async function research({ query, depth = 3, chars_per_source = 1500 }) {
  const { results } = await web_search({ query, limit: depth + 2 });
  const pages = await Promise.allSettled(
    results.slice(0, depth).map((r) => web_fetch({ url: r.url, max_chars: chars_per_source })),
  );
  return {
    query,
    sources: pages.map((p, i) => ({
      url: results[i].url,
      title: results[i].title,
      notes: p.status === 'fulfilled' ? p.value.content : `fetch failed: ${p.reason?.message}`,
    })),
    also_see: results.slice(depth).map((r) => r.url),
  };
}

// ───────────────────────── GITHUB ─────────────────────────
async function gh(path, opts = {}) {
  const headers = { accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await http(`https://api.github.com${path}`, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  return r.json();
}

export async function github({ op, repo, path = '', query, ref, limit = 20 }) {
  switch (op) {
    case 'repo': {
      const r = await gh(`/repos/${repo}`);
      return pick(r, ['full_name', 'description', 'homepage', 'language', 'stargazers_count', 'forks_count', 'open_issues_count', 'default_branch', 'topics', 'pushed_at']);
    }
    case 'tree': {
      const r = await gh(`/repos/${repo}/git/trees/${ref || 'HEAD'}?recursive=1`);
      const files = r.tree.filter((t) => t.type === 'blob' && t.path.startsWith(path)).map((t) => t.path);
      return { repo, count: files.length, files: files.slice(0, 400), truncated: files.length > 400 };
    }
    case 'file': {
      const r = await gh(`/repos/${repo}/contents/${path}${ref ? `?ref=${ref}` : ''}`);
      if (Array.isArray(r)) return { dir: path, entries: r.map((e) => `${e.type === 'dir' ? '📁' : ''}${e.name}`) };
      return { path, content: cap(Buffer.from(r.content, 'base64').toString('utf8'), 12000) };
    }
    case 'readme': {
      const r = await gh(`/repos/${repo}/readme`);
      return { content: cap(Buffer.from(r.content, 'base64').toString('utf8'), 8000) };
    }
    case 'commits': {
      const r = await gh(`/repos/${repo}/commits?per_page=${limit}`);
      return r.map((c) => `${c.sha.slice(0, 7)} ${c.commit.author.date.slice(0, 10)} ${c.commit.message.split('\n')[0]}`);
    }
    case 'issues': {
      const r = await gh(`/repos/${repo}/issues?state=open&per_page=${limit}`);
      return r.map((i) => ({ n: i.number, title: i.title, pr: !!i.pull_request, labels: i.labels.map((l) => l.name) }));
    }
    case 'search_repos': {
      const r = await gh(`/search/repositories?q=${encodeURIComponent(query)}&per_page=${limit}`);
      return r.items.map((x) => pick(x, ['full_name', 'description', 'stargazers_count', 'html_url']));
    }
    case 'search_code': {
      const r = await gh(`/search/code?q=${encodeURIComponent(query)}&per_page=${limit}`);
      return r.items.map((x) => `${x.repository.full_name}/${x.path}`);
    }
    default:
      throw new Error(`unknown github op: ${op}`);
  }
}

// ───────────────────────── VERCEL ─────────────────────────
async function vc(path) {
  if (!process.env.VERCEL_TOKEN) throw new Error('VERCEL_TOKEN not configured on the server');
  const team = process.env.VERCEL_TEAM_ID ? `${path.includes('?') ? '&' : '?'}teamId=${process.env.VERCEL_TEAM_ID}` : '';
  const r = await http(`https://api.vercel.com${path}${team}`, { headers: { authorization: `Bearer ${process.env.VERCEL_TOKEN}` } });
  return r.json();
}

export async function vercel({ op, project, deployment_id, limit = 10 }) {
  switch (op) {
    case 'projects': {
      const r = await vc(`/v9/projects?limit=${limit}`);
      return r.projects.map((p) => ({ name: p.name, framework: p.framework, updated: new Date(p.updatedAt).toISOString().slice(0, 10) }));
    }
    case 'deployments': {
      const r = await vc(`/v6/deployments?limit=${limit}${project ? `&app=${project}` : ''}`);
      return r.deployments.map((d) => ({ id: d.uid, url: d.url, state: d.state, target: d.target, created: new Date(d.created).toISOString() }));
    }
    case 'logs': {
      const r = await vc(`/v3/deployments/${deployment_id}/events?limit=200`);
      // Errors first — that's what you're here for.
      const lines = r.map((e) => e.payload?.text || e.text).filter(Boolean);
      const errs = lines.filter((l) => /error|fail|warn/i.test(l));
      return { errors: errs.slice(-40), tail: lines.slice(-20) };
    }
    default:
      throw new Error(`unknown vercel op: ${op}`);
  }
}

// ───────────────────────── PLUGIN REGISTRY ─────────────────────────
// The registry lives in the GitHub repo, so the operator "updates itself":
// merge a PR to registry/plugins.json and every user gets it on the next call.
let cache = { at: 0, data: null };
async function loadRegistry() {
  if (cache.data && Date.now() - cache.at < 5 * 60_000) return cache.data;
  try {
    cache = { at: Date.now(), data: await (await http(REGISTRY_URL)).json() };
  } catch {
    cache = { at: Date.now(), data: (await import('../registry/plugins.json', { with: { type: 'json' } })).default };
  }
  return cache.data;
}

export async function plugins_suggest({ task, limit = 5 }) {
  const reg = await loadRegistry();
  const words = task.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const scored = reg.plugins
    .map((p) => {
      const hay = `${p.name} ${p.description} ${p.tags.join(' ')}`.toLowerCase();
      return { ...p, score: words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0) };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return { task, suggestions: scored, registry_version: reg.version, contribute: 'Use plugins_propose to add one.' };
}

// Community contribution: opens a GitHub issue that a maintainer (or CI) turns
// into a registry entry. Keeps the shared cache curated instead of spam-able.
export async function plugins_propose({ name, url, description, tags = [], why }) {
  if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN required to propose plugins');
  const repo = process.env.REGISTRY_REPO || 'rawmware/rawmware-gpt-plugin';
  const body = '```json\n' + JSON.stringify({ name, url, description, tags }, null, 2) + '\n```\n\n**Why:** ' + (why || '');
  const r = await gh(`/repos/${repo}/issues`, {
    method: 'POST',
    body: JSON.stringify({ title: `[registry] ${name}`, body, labels: ['registry'] }),
    headers: { 'content-type': 'application/json' },
  });
  return { proposed: name, issue: r.html_url };
}

// ───────────────────────── DOCUMENT ─────────────────────────
// Writes research/build notes back to the repo so every session compounds.
export async function docs_write({ path, content, message }) {
  if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN required to write docs');
  const repo = process.env.DOCS_REPO || 'rawmware/rawmware-gpt-plugin';
  const full = `docs/log/${path.replace(/^\/+|\.\./g, '')}`;
  let sha;
  try { sha = (await gh(`/repos/${repo}/contents/${full}`)).sha; } catch {}
  const r = await gh(`/repos/${repo}/contents/${full}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: message || `docs: ${full}`, content: Buffer.from(content).toString('base64'), sha }),
  });
  return { written: full, url: r.content?.html_url };
}

export const TOOLS = { web_fetch, web_search, research, github, vercel, plugins_suggest, plugins_propose, docs_write };
