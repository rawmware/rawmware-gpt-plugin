// Turns an approved `[registry]` issue into a registry entry.
// Used by .github/workflows/registry-from-issue.yml (ISSUE_BODY env), or locally:
//   ISSUE_BODY="$(cat body.md)" npm run registry:add
import { readFile, writeFile } from 'node:fs/promises';

const FILE = new URL('../registry/plugins.json', import.meta.url);
const KINDS = ['builtin', 'openai-api', 'mcp', 'gpt', 'api', 'cli'];

export function parseProposal(body) {
  const json = body?.match(/```json\s*([\s\S]*?)```/)?.[1];
  if (!json) throw new Error('no ```json block in issue body');
  const p = JSON.parse(json);
  const errors = [];
  if (!p.name || p.name.length > 60) errors.push('name: required, ≤60 chars');
  try { if (new URL(p.url).protocol !== 'https:') errors.push('url: must be https'); } catch { errors.push('url: invalid'); }
  if (!p.description || p.description.length > 160) errors.push('description: required, ≤160 chars');
  if (p.tags && (!Array.isArray(p.tags) || p.tags.length > 10)) errors.push('tags: array of ≤10');
  if (p.kind && !KINDS.includes(p.kind)) errors.push(`kind: one of ${KINDS.join('|')}`);
  if (p.mcp_url) try { if (new URL(p.mcp_url).protocol !== 'https:') errors.push('mcp_url: must be https'); } catch { errors.push('mcp_url: invalid'); }
  if (errors.length) throw new Error(errors.join('; '));
  return {
    name: p.name.trim(),
    kind: p.kind || 'mcp',
    url: p.url,
    ...(p.mcp_url ? { mcp_url: p.mcp_url, auth: p.auth || 'none' } : p.auth ? { auth: p.auth } : {}),
    description: p.description.trim(),
    tags: (p.tags || []).map((t) => String(t).toLowerCase().trim()).filter(Boolean),
  };
}

export function addEntry(registry, entry, today = new Date().toISOString().slice(0, 10).replace(/-/g, '.')) {
  const dupe = registry.plugins.find((p) => p.name.toLowerCase() === entry.name.toLowerCase() || p.url === entry.url);
  if (dupe) throw new Error(`already in registry as "${dupe.name}"`);
  return { ...registry, version: today, plugins: [...registry.plugins, entry] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const entry = parseProposal(process.env.ISSUE_BODY);
  const reg = JSON.parse(await readFile(FILE, 'utf8'));
  const next = addEntry(reg, entry);
  // One entry per line keeps diffs reviewable.
  const lines = next.plugins.map((p) => '    ' + JSON.stringify(p).replace(/","/g, '", "').replace(/":"/g, '": "').replace(/":\[/g, '": [').replace(/\],"/g, '], "'));
  const out = `{\n  "version": ${JSON.stringify(next.version)},\n  "about": ${JSON.stringify(next.about)},\n  "plugins": [\n${lines.join(',\n')}\n  ]\n}\n`;
  JSON.parse(out); // sanity
  await writeFile(FILE, out);
  console.log(`added ${entry.name}`);
}
