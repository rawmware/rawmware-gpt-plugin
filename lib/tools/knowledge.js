// Knowledge on demand. GPT instructions are capped at 8k chars and are paid for
// on every turn; playbooks are fetched only when a task needs them, one
// section at a time. Edit playbooks/*.md on main → live everywhere in 5 min.
import { readFile, readdir } from 'node:fs/promises';
import { http, pool, REPO, RAW_BASE } from '../net.js';
import { cached } from '../cache.js';
import { cap, focus } from '../compress.js';
import { gh } from './github.js';

const PLAYBOOK_DIR = new URL('../../playbooks/', import.meta.url);

// Topic list comes from GitHub so a playbook added on main is live without a
// redeploy; the bundled copy is the fallback.
async function listTopics() {
  return cached('playbook-index', 300, async () => {
    try {
      const r = await gh(`/repos/${REPO}/contents/playbooks`, {}, { github: process.env.GITHUB_TOKEN, ident: "server" });
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
// Research briefs, decisions and fixes, committed as markdown under docs/ in
// the user's own repo (or the owner's), so the next session starts smarter.
const docsRepo = (args, ctx) => args.repo || (ctx.owner ? process.env.DOCS_REPO || REPO : null);

async function docFiles(repo, ctx) {
  const r = await gh(`/repos/${repo}/git/trees/HEAD?recursive=1`, {}, ctx);
  return r.tree.filter((t) => t.type === 'blob' && /^(docs|notes|adr|\.notes)\//i.test(t.path) && /\.mdx?$/.test(t.path)).map((t) => t.path);
}

async function readDoc(repo, path, ctx) {
  const r = await gh(`/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {}, ctx);
  return Buffer.from(r.content || '', 'base64').toString('utf8');
}

export async function docs(args, ctx = {}) {
  const { op = 'list', path, query, content, message } = args;
  const repo = docsRepo(args, ctx);
  if (!repo) throw new Error('repo is required (owner/name): docs live in your repo under docs/');
  switch (op) {
    case 'list': {
      const files = await docFiles(repo, ctx);
      return { repo, count: files.length, files: files.sort().reverse().slice(0, 100) };
    }
    case 'read': {
      if (!path) throw new Error('path is required');
      const p = /^(docs|notes|adr|\.notes)\//i.test(path) ? path : `docs/${path}`;
      return { path: p, content: cap(await readDoc(repo, p, ctx), 10000) };
    }
    case 'search': {
      // Reuse past research before redoing it. Newest first, ranked by hits.
      if (!query) throw new Error('query is required');
      const files = (await docFiles(repo, ctx)).sort().reverse().slice(0, 50);
      const texts = await pool(files, 10, (f) => readDoc(repo, f, ctx));
      const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const hits = files
        .map((f, i) => ({ f, t: texts[i].ok ? texts[i].value : '' }))
        .map(({ f, t }) => ({ f, t, n: words.reduce((s, w) => s + (t.toLowerCase().split(w).length - 1) + (f.toLowerCase().includes(w) ? 5 : 0), 0) }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n)
        .slice(0, 5);
      return { repo, query, results: hits.map((h) => ({ path: h.f, excerpt: focus(h.t, words, 1, 700) })), searched: files.length };
    }
    case 'write': {
      if (!path || !content) throw new Error('path and content are required');
      const clean = path.replace(/\.\.+/g, '').replace(/^\/+/, '').replace(/^docs\/(log\/)?/, '');
      const full = `docs/log/${clean.endsWith('.md') ? clean : `${clean}.md`}`;
      let sha;
      try { sha = (await gh(`/repos/${repo}/contents/${full}`, {}, ctx)).sha; } catch {}
      const r = await gh(`/repos/${repo}/contents/${full}`, {
        method: 'PUT',
        body: JSON.stringify({ message: message || `docs: ${full}`, content: Buffer.from(content).toString('base64'), sha }),
      }, ctx);
      return { written: full, url: r.content?.html_url };
    }
    default:
      throw new Error(`unknown docs op: ${op}`);
  }
}
