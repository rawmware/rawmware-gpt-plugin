// Weekly self-check: is every registry link alive, does every callable MCP
// server still answer, and what's trending? Writes a report into docs/log/
// so the operator's own memory (docs op:search) knows the ecosystem's state.
//   node scripts/registry-check.js            → prints report
//   node scripts/registry-check.js --write    → also writes docs/log/health/<date>.md
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { mcpListTools } from '../lib/mcp-client.js';
import { trends } from '../lib/tools/trends.js';
import { UA } from '../lib/net.js';

const reg = JSON.parse(await readFile(new URL('../registry/plugins.json', import.meta.url), 'utf8'));
const today = new Date().toISOString().slice(0, 10);

async function alive(url) {
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(12000) });
    return r.status < 400 || r.status === 401 || r.status === 403 ? 'ok' : `HTTP ${r.status}`;
  } catch (e) {
    return `down (${e.cause?.code || e.name})`;
  }
}

const rows = await Promise.all(reg.plugins.map(async (p) => {
  const link = p.kind === 'builtin' ? 'n/a' : await alive(p.url);
  let mcp = '';
  if (p.mcp_url && ['none', 'optional'].includes(p.auth)) {
    try { mcp = `${(await mcpListTools(p.mcp_url)).length} tools`; } catch (e) { mcp = `FAIL: ${e.message.slice(0, 60)}`; }
  }
  return { name: p.name, kind: p.kind, link, mcp };
}));

const broken = rows.filter((r) => (r.link !== 'ok' && r.link !== 'n/a') || r.mcp.startsWith('FAIL'));
let trending = '';
try {
  const t = await trends({ source: 'all', topic: 'mcp', limit: 6 });
  const fmt = (list, f) => (Array.isArray(list) ? list.map(f).join('\n') : `- ${list}`);
  trending = `## Trending (topic: mcp)\n### Hacker News\n${fmt(t.hn, (x) => `- [${x.title}](${x.url}) · ${x.points ?? ''}`)}\n### GitHub\n${fmt(t.github, (x) => `- [${x.repo}](https://github.com/${x.repo}) ${x.desc || ''}`)}\n### dev.to\n${fmt(t.devto, (x) => `- [${x.title}](${x.url})`)}\n`;
} catch (e) {
  trending = `## Trending\nunavailable: ${e.message}\n`;
}

const report = `# Ecosystem health: ${today}

Registry ${reg.version}: ${reg.plugins.length} entries, ${broken.length} need attention.

| Plugin | Kind | Link | MCP |
|---|---|---|---|
${rows.map((r) => `| ${r.name} | ${r.kind} | ${r.link} | ${r.mcp} |`).join('\n')}

${broken.length ? `## Needs attention\n${broken.map((r) => `- **${r.name}**: ${r.link} ${r.mcp}`).join('\n')}\n` : ''}
${trending}`;

console.log(report);
if (process.argv.includes('--write')) {
  await mkdir(new URL('../docs/log/health/', import.meta.url), { recursive: true });
  await writeFile(new URL(`../docs/log/health/${today}.md`, import.meta.url), report);
}
