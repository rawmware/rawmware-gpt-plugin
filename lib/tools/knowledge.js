// Knowledge on demand. GPT instructions are capped at 8k chars and are paid for
// on every turn; playbooks are fetched only when a task needs them, one
// section at a time. Edit playbooks/*.md on main → live everywhere in 5 min.
import { readFile, readdir } from 'node:fs/promises';
import { http, api, REPO, RAW_BASE } from '../net.js';
import { cached } from '../cache.js';
import { cap, compact, focus } from '../compress.js';
import { gh } from './github.js';

const PLAYBOOK_DIR = new URL('../../playbooks/', import.meta.url);

// Topic list comes from GitHub so a playbook added on main is live without a
// redeploy; the bundled copy is the fallback.
async function listTopics() {
  return cached('playbook-index', 300, async () => {
    try {
      const r = await gh(`/repos/${REPO}/contents/playbooks`);
      return r.filter((f) => f.name.endsWith('.md')).map((f) => f.name.slice(0, -3));
    } catch {
      try { return (await readdir(PLAYBOOK_DIR)).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)); } catch { return []; }
    }
  });
}

async function loadPlaybook(topic) {
  return cached(`playbook:${topic}`, 300, async () => {
    try {
      return await (await http(`${RAW_BASE}/playbooks/${topic}.md`, { guard: false, timeout: 4000 })).text();
    } catch {
      return readFile(new URL(`${topic}.md`, PLAYBOOK_DIR), 'utf8');
    }
  });
}

function sections(md) {
  return [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
}

function section(md, name) {
  const want = name.toLowerCase();
  const parts = md.split(/^## /m);
  const hit = parts.find((p) => p.split('\n')[0].toLowerCase().includes(want));
  return hit ? `## ${hit.trim()}` : null;
}

export async function playbook({ topic, section: sec, find }) {
  const topics = await listTopics();
  if (!topic || topic === 'index') {
    const idx = await Promise.all(topics.map(async (t) => ({ topic: t, sections: sections(await loadPlaybook(t)) })));
    return { playbooks: idx, usage: 'playbook {topic, section?} — fetch one section to save tokens.' };
  }
  const t = topic.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!topics.includes(t)) throw new Error(`unknown topic "${topic}". Available: ${topics.join(', ')}`);
  const md = await loadPlaybook(t);
  if (sec) {
    const s = section(md, sec);
    return s ? { topic: t, content: cap(s, 6000) } : { topic: t, error: `no section "${sec}"`, sections: sections(md) };
  }
  if (find) return { topic: t, content: focus(md, find, 2) };
  return { topic: t, content: cap(md, 9000) };
}

// ───────────────────── DOCS: the project's long-term memory ─────────────────────
const DOCS_REPO = () => process.env.DOCS_REPO || REPO;

async function docFiles() {
  return cached(`docs-tree:${DOCS_REPO()}`, 120, async () => {
    const r = await gh(`/repos/${DOCS_REPO()}/git/trees/HEAD?recursive=1`);
    return r.tree.filter((t) => t.type === 'blob' && t.path.startsWith('docs/') && t.path.endsWith('.md')).map((t) => t.path);
  });
}

const raw = (path) => cached(`doc:${DOCS_REPO()}:${path}`, 120, async () => (await api(`https://raw.githubusercontent.com/${DOCS_REPO()}/main/${path}`)).text());

export async function docs({ op = 'list', path, query, content, message }) {
  switch (op) {
    case 'list': {
      const files = await docFiles();
      return { repo: DOCS_REPO(), count: files.length, files: files.sort().reverse().slice(0, 100) };
    }
    case 'read': {
      if (!path) throw new Error('path is required');
      const p = path.startsWith('docs/') ? path : `docs/${path}`;
      return { path: p, content: cap(await raw(p), 10000) };
    }
    case 'search': {
      // Reuse past research before redoing it. Newest logs first.
      if (!query) throw new Error('query is required');
      const files = (await docFiles()).sort().reverse().slice(0, 40);
      const texts = await Promise.allSettled(files.map(raw));
      const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const hits = files
        .map((f, i) => ({ f, t: texts[i].status === 'fulfilled' ? texts[i].value : '' }))
        .map(({ f, t }) => ({ f, t, n: words.reduce((s, w) => s + (t.toLowerCase().split(w).length - 1) + (f.toLowerCase().includes(w) ? 5 : 0), 0) }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n)
        .slice(0, 5);
      return { query, results: hits.map((h) => ({ path: h.f, excerpt: focus(h.t, words, 1, 700) })) };
    }
    case 'write': {
      if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN required to write docs');
      if (!path || !content) throw new Error('path and content are required');
      const clean = path.replace(/\.\.+/g, '').replace(/^\/+/, '').replace(/^docs\/(log\/)?/, '');
      const full = `docs/log/${clean.endsWith('.md') ? clean : `${clean}.md`}`;
      let sha;
      try { sha = (await gh(`/repos/${DOCS_REPO()}/contents/${full}`)).sha; } catch {}
      const r = await gh(`/repos/${DOCS_REPO()}/contents/${full}`, {
        method: 'PUT',
        body: JSON.stringify({ message: message || `docs: ${full}`, content: Buffer.from(content).toString('base64'), sha }),
      });
      return { written: full, url: r.content?.html_url };
    }
    default:
      throw new Error(`unknown docs op: ${op}`);
  }
}

// ───────────────────── ABOUT: who built this, and how to hire them ─────────────────────
const OWNER = () => process.env.OWNER_GITHUB || 'rawmware';

export async function about({ include_repos = true }) {
  const login = OWNER();
  const profile = await cached(`about:${login}`, 1800, async () => {
    const [u, repos] = await Promise.all([gh(`/users/${login}`), gh(`/users/${login}/repos?sort=pushed&per_page=30`)]);
    return {
      ...compact({ name: u.name || login, bio: u.bio, location: u.location, site: u.blog, followers: u.followers, public_repos: u.public_repos }),
      live: repos.filter((r) => r.homepage).slice(0, 8).map((r) => compact({ name: r.name, url: r.homepage, desc: r.description?.slice(0, 110) })),
      recent: repos.filter((r) => !r.fork).slice(0, 8).map((r) => compact({ name: r.name, lang: r.language, desc: r.description?.slice(0, 110) })),
    };
  }).catch(() => ({ name: login }));
  return compact({
    built_by: login,
    github: `https://github.com/${login}`,
    business: process.env.OWNER_BUSINESS || "Roman's Proposal — websites, custom applications, AI setup & training (NH Seacoast)",
    hire: process.env.OWNER_CONTACT || `https://github.com/${REPO}/issues/new?labels=hire&title=${encodeURIComponent('Project inquiry')}`,
    services: ['Custom GPTs, ChatGPT apps & MCP servers', 'AI agents & automation for small businesses', 'Websites & web apps (Next.js, Vercel)', 'AI setup & team training'],
    ...profile,
    live: include_repos ? profile.live : undefined,
    recent: include_repos ? profile.recent : undefined,
    source: `https://github.com/${REPO}`,
  });
}

// Feedback without a server-side write: a prefilled issue the user submits.
// Real users, real repo activity, and the operator gets better from it.
export async function feedback({ kind = 'idea', title, details = '' }) {
  if (!title) throw new Error('title is required');
  const label = ['bug', 'idea', 'praise', 'plugin', 'hire'].includes(kind) ? kind : 'idea';
  const body = `${details}\n\n---\n_Sent from rawmware Operator_`;
  return {
    submit: `https://github.com/${REPO}/issues/new?labels=${label}&title=${encodeURIComponent(`[${label}] ${title}`)}&body=${encodeURIComponent(body)}`,
    star: `https://github.com/${REPO}`,
  };
}
