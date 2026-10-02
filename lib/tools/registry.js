// The shared plugin registry. It lives in the GitHub repo, so the operator
// "updates itself": merge a PR to registry/plugins.json and every deployment
// serves it within 5 minutes, no redeploy.
import { readFile } from 'node:fs/promises';
import { http, REPO, RAW_BASE } from '../net.js';
import { cached } from '../cache.js';
import { cap, compact } from '../compress.js';
import { mcpListTools, mcpCallTool } from '../mcp-client.js';

const REGISTRY_URL = process.env.REGISTRY_URL || `${RAW_BASE}/registry/plugins.json`;

export async function loadRegistry() {
  return cached('registry', 300, async () => {
    try {
      return await (await http(REGISTRY_URL, { guard: false, timeout: 4000 })).json();
    } catch {
      return JSON.parse(await readFile(new URL('../../registry/plugins.json', import.meta.url), 'utf8'));
    }
  });
}

// Light stemming + synonyms so "deploying" finds "deploy", "pay" finds "payments".
const SYN = {
  deploy: ['hosting', 'vercel', 'ship'], bug: ['debug', 'errors'], error: ['debug', 'errors', 'logs'], pay: ['payments', 'billing', 'stripe'],
  db: ['database', 'postgres'], scrape: ['crawl', 'browser'], ui: ['design', 'frontend'], video: ['social', 'media'], post: ['social', 'content'],
  insta: ['instagram', 'social'], ig: ['instagram', 'social'], tiktok: ['social', 'video'], docs: ['documentation', 'library'], ai: ['openai', 'llm'],
  image: ['images', 'design'], search: ['research', 'web'], email: ['gmail', 'inbox'], notes: ['notion', 'docs'], task: ['linear', 'project'],
};
const stem = (w) => w.replace(/(ing|ed|es|s)$/, '');

export function rank(plugins, task, limit = 5) {
  const words = task.toLowerCase().split(/\W+/).filter((w) => w.length > 1);
  const terms = new Set(words.flatMap((w) => [w, stem(w), ...(SYN[stem(w)] || SYN[w] || [])]));
  return plugins
    .map((p) => {
      const name = p.name.toLowerCase();
      const tags = (p.tags || []).map((t) => t.toLowerCase());
      const desc = (p.description || '').toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (t.length < 3 && !tags.includes(t)) continue;
        if (tags.includes(t) || tags.some((x) => stem(x) === t)) score += 3;
        else if (name.includes(t)) score += 2;
        else if (desc.includes(t)) score += 1;
      }
      if (p.kind === 'builtin') score += 0.5; // free with the user's subscription
      return { p, score };
    })
    .filter((x) => x.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ p, score }) => compact({ name: p.name, kind: p.kind, description: p.description, connect: p.connect || p.url, callable: p.mcp_url && ['none', 'optional'].includes(p.auth) ? true : undefined, score: Math.round(score * 10) / 10 }));
}

function proposeUrl({ name, url, description, tags = [], why = '' }) {
  const body = '```json\n' + JSON.stringify({ name, url, description, tags }, null, 2) + '\n```\n\n**Why:** ' + why;
  return `https://github.com/${REPO}/issues/new?labels=registry&title=${encodeURIComponent(`[registry] ${name}`)}&body=${encodeURIComponent(body)}`;
}

export async function plugins({ op = 'suggest', task, kind, name, url, description, tags, why, limit = 5 }) {
  const reg = await loadRegistry();
  switch (op) {
    case 'suggest':
      if (!task) throw new Error('task is required');
      return { task, suggestions: rank(reg.plugins, task, Math.min(limit, 10)), registry_version: reg.version, tip: 'builtin = free in ChatGPT; callable = use plugin_call now.' };
    case 'list': {
      const items = reg.plugins.filter((p) => !kind || p.kind === kind);
      return { version: reg.version, count: items.length, plugins: items.map((p) => `${p.name} [${p.kind}${p.mcp_url && ['none', 'optional'].includes(p.auth) ? ', callable' : ''}] — ${p.description}`) };
    }
    case 'propose':
      // No server write needed: a prefilled issue the user submits themselves.
      // A maintainer adds the `approved` label and CI turns it into a registry PR.
      if (!name || !url || !description) throw new Error('name, url, description are required');
      return { proposed: name, submit: proposeUrl({ name, url, description, tags, why }), next: 'Open the link and press Submit. Approved proposals ship to every user automatically.' };
    default:
      throw new Error(`unknown plugins op: ${op}`);
  }
}

// Proxy a call to another MCP server in the registry. Only entries marked
// callable (public or optional-auth with a server key) are allowed: this is
// an allowlist, not an open relay.
export async function plugin_call({ server, tool, args, max_chars = 6000 }) {
  const reg = await loadRegistry();
  const entry = reg.plugins.find((p) => p.name.toLowerCase() === String(server || '').toLowerCase() || p.id === server);
  const callable = reg.plugins.filter((p) => p.mcp_url && ['none', 'optional'].includes(p.auth));
  if (!entry || !callable.includes(entry)) {
    throw new Error(`"${server}" is not callable. Callable servers: ${callable.map((p) => p.name).join(', ')}`);
  }
  const headers = {};
  if (entry.auth_env && process.env[entry.auth_env]) headers.authorization = `Bearer ${process.env[entry.auth_env]}`;
  if (!tool) {
    const tools = await cached(`mcp-tools:${entry.mcp_url}`, 3600, () => mcpListTools(entry.mcp_url, headers));
    return { server: entry.name, tools: tools.map((t) => ({ name: t.name, description: t.description?.split('\n')[0].slice(0, 160), args: Object.keys(t.inputSchema?.properties || {}), required: t.inputSchema?.required })) };
  }
  const result = await cached(`mcp-call:${entry.mcp_url}:${tool}:${JSON.stringify(args || {})}`, 900, () => mcpCallTool(entry.mcp_url, tool, args, headers));
  const text = (result.content || []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n');
  return compact({ server: entry.name, tool, isError: result.isError || undefined, content: cap(text, Math.min(max_chars, 15000)) });
}
