import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, extractMeta, extractLinks, cap, focus } from '../lib/compress.js';
import { buildSpec } from '../api/openapi.js';
import { SCHEMAS } from '../lib/schemas.js';
import { TOOLS, TTL } from '../lib/tools.js';
import { assertPublicUrl } from '../lib/net.js';
import { analyzeCss, contrast } from '../lib/tools/design.js';
import { rank } from '../lib/tools/registry.js';
import { cacheClear } from '../lib/cache.js';
import { PROMPTS } from '../lib/prompts.js';
import mcp from '../api/mcp.js';
import rest from '../api/tools/[name].js';
import registry from '../registry/plugins.json' with { type: 'json' };

const html = `<html lang="en"><head><title>Hi &amp; bye</title><meta name="description" content="Desc"><meta property="og:image" content="/og.png"><script>evil()</script></head>
<body><nav>menu</nav><h1>Head</h1><p>One &amp; two</p><a href="/x">x</a><a href="mailto:a@b.c">m</a></body></html>`;

// Route global fetch to canned responses so tests never touch the network.
function mockFetch(routes) {
  return mock.method(globalThis, 'fetch', async (url) => {
    const key = Object.keys(routes).find((k) => String(url).startsWith(k));
    if (!key) return new Response('not found', { status: 404 });
    const [body, type = 'text/html'] = [].concat(routes[key]);
    return new Response(body, { status: 200, headers: { 'content-type': type } });
  });
}

function call(handler, req) {
  return new Promise((resolve) => {
    const res = {
      code: 0, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.code = c; return this; },
      json(j) { resolve({ code: this.code, j }); },
      end() { resolve({ code: this.code }); },
    };
    handler({ headers: {}, query: {}, ...req }, res);
  });
}
const rpc = (body, headers = {}) => call(mcp, { method: 'POST', body, headers });

// ───────── compression ─────────
test('htmlToText strips noise and decodes entities', () => {
  const t = htmlToText(html);
  assert.ok(t.includes('## Head') && t.includes('One & two'));
  assert.ok(!t.includes('evil') && !t.includes('menu'));
});

test('meta + links (skips mailto)', () => {
  const m = extractMeta(html);
  assert.equal(m.title, 'Hi & bye');
  assert.equal(m.lang, 'en');
  assert.deepEqual(extractLinks(html, 'https://a.com/'), ['https://a.com/x']);
});

test('cap marks truncation with the next offset', () => {
  assert.match(cap('a'.repeat(20), 10, 30), /truncated 10 chars — call again with offset=40/);
});

test('focus keeps only matching lines with context', () => {
  const t = ['intro', 'filler', 'Pricing starts at $9', 'per month', 'footer'].join('\n');
  const f = focus(t, 'pricing', 1);
  assert.ok(f.includes('$9') && f.includes('per month') && !f.includes('intro'));
});

// ───────── safety ─────────
test('SSRF guard blocks private targets', async () => {
  for (const u of ['http://127.0.0.1/', 'http://localhost:3000', 'http://169.254.169.254/latest', 'http://10.0.0.5', 'http://[::1]/', 'file:///etc/passwd']) {
    await assert.rejects(assertPublicUrl(u), undefined, u);
  }
  await assertPublicUrl('https://93.184.216.34/');
});

test('write tools and write ops need the owner key', async () => {
  delete process.env.OPERATOR_API_KEY;
  const r = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'github_write', arguments: { op: 'issue', repo: 'rawmware/x', title: 't' } } });
  assert.equal(r.j.result.isError, true);
  const d = await call(rest, { method: 'POST', query: { name: 'docs' }, body: { op: 'write', path: 'a.md', content: 'x' } });
  assert.equal(d.code, 401);
});

test('owner key unlocks gating (constant-time compare)', async () => {
  process.env.OPERATOR_API_KEY = 'k'.repeat(32);
  const { isOwner } = await import('../lib/auth.js');
  assert.equal(isOwner({ authorization: `Bearer ${'k'.repeat(32)}` }), true);
  assert.equal(isOwner({ authorization: 'Bearer nope' }), false);
  delete process.env.OPERATOR_API_KEY;
});

test('openai tool never spends the server key for the public', async () => {
  process.env.OPENAI_API_KEY = 'sk-server';
  await assert.rejects(TOOLS.openai({ op: 'ask', prompt: 'hi' }, { headers: {}, owner: false }), /built-in tools/);
  delete process.env.OPENAI_API_KEY;
});

// ───────── contracts ─────────
test('every schema has an implementation, TTL, and OpenAPI path', () => {
  assert.deepEqual(Object.keys(SCHEMAS).sort(), Object.keys(TOOLS).sort());
  assert.deepEqual(Object.keys(TTL).sort(), Object.keys(TOOLS).sort());
  const spec = buildSpec('https://x');
  assert.equal(Object.keys(spec.paths).length, Object.keys(SCHEMAS).length);
  assert.ok(Object.keys(spec.paths).length <= 30, 'GPT Actions allow at most 30 operations');
  assert.equal(spec.paths['/api/tools/github_write'].post['x-openai-isConsequential'], true);
  assert.equal(spec.paths['/api/tools/research'].post['x-openai-isConsequential'], false);
});

test('tool descriptions stay short (they are paid for every turn)', () => {
  const total = JSON.stringify(Object.values(SCHEMAS).map((s) => [s.description, s.input])).length;
  for (const [n, s] of Object.entries(SCHEMAS)) assert.ok(s.description.length <= 160, `${n} description too long`);
  assert.ok(total < 9000, `tool schemas are ${total} chars; keep under 9000`);
});

test('GPT instructions fit the 8,000 char limit', async () => {
  const { readFile } = await import('node:fs/promises');
  const md = await readFile(new URL('../gpt/instructions.md', import.meta.url), 'utf8');
  const body = md.split('<!-- paste below -->')[1] ?? md;
  assert.ok(body.trim().length <= 8000, `instructions are ${body.trim().length} chars`);
});

// ───────── MCP protocol ─────────
test('mcp initialize/tools/resources/prompts', async () => {
  const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(init.j.result.protocolVersion, '2025-06-18');
  assert.ok(init.j.result.instructions);
  const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(list.j.result.tools.length, Object.keys(SCHEMAS).length);
  const research = list.j.result.tools.find((t) => t.name === 'research');
  assert.equal(research.annotations.readOnlyHint, true);
  assert.equal(research._meta['openai/outputTemplate'], 'ui://widget/operator-card.v2.html');
  const res = await rpc({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: research._meta['openai/outputTemplate'] } });
  assert.equal(res.j.result.contents[0].mimeType, 'text/html+skybridge');
  const prompts = await rpc({ jsonrpc: '2.0', id: 4, method: 'prompts/list' });
  assert.equal(prompts.j.result.prompts.length, Object.keys(PROMPTS).length);
  const p = await rpc({ jsonrpc: '2.0', id: 5, method: 'prompts/get', params: { name: 'audit_repo', arguments: { repo: 'a/b' } } });
  assert.match(p.j.result.messages[0].content.text, /a\/b/);
  const note = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(note.code, 202);
  const bad = await call(mcp, { method: 'POST', body: '{nope' });
  assert.equal(bad.j.error.code, -32700);
});

// ───────── tools (offline, mocked fetch) ─────────
test('playbook index and section fetch (local fallback)', async () => {
  const f = mockFetch({});
  try {
    const idx = await TOOLS.playbook({});
    const topics = idx.playbooks.map((p) => p.topic);
    for (const t of ['build-loop', 'design-taste', 'social-content', 'openai-leverage', 'token-economy', 'launch', 'lessons']) assert.ok(topics.includes(t), t);
    const sec = await TOOLS.playbook({ topic: 'design-taste', section: 'color' });
    assert.match(sec.content, /^## /);
  } finally { f.mock.restore(); cacheClear(); }
});

test('plugins suggest: synonyms, builtins, callable flag', async () => {
  const s = rank(registry.plugins, 'debug my vercel deploy logs');
  assert.equal(s[0].name, 'Vercel MCP');
  const img = rank(registry.plugins, 'make an instagram thumbnail');
  assert.ok(img.some((p) => p.kind === 'builtin'));
  const docs = rank(registry.plugins, 'nextjs library docs');
  assert.ok(docs.find((p) => p.name === 'Context7').callable);
});

test('plugin_call refuses servers that are not callable', async () => {
  const f = mockFetch({});
  try {
    await assert.rejects(TOOLS.plugin_call({ server: 'Stripe MCP' }), /not callable.*DeepWiki/);
  } finally { f.mock.restore(); cacheClear(); }
});

test('plugins propose returns a prefilled issue link, no token needed', async () => {
  const f = mockFetch({});
  try {
    const r = await TOOLS.plugins({ op: 'propose', name: 'X', url: 'https://x.dev', description: 'does x' });
    assert.match(r.submit, /^https:\/\/github\.com\/rawmware\/rawmware-gpt-plugin\/issues\/new\?labels=registry/);
  } finally { f.mock.restore(); cacheClear(); }
});

test('design tokens + contrast', () => {
  const a = analyzeCss(':root{--brand:#ff4d00}body{font-family:"Inter",sans-serif;font-size:16px;color:#111;background:#fff;padding:8px 16px;border-radius:12px;transition:all 200ms}h1{font-size:3rem}');
  assert.ok(a.colors.has('#ff4d00') && a.colors.has('#111111'));
  assert.ok(a.fonts.has('Inter'));
  assert.ok(a.sizes.has(48) && a.space.has(16));
  assert.equal(a.vars['--brand'], '#ff4d00');
  assert.equal(contrast('#000000', '#ffffff'), 21);
});

test('design_audit end to end', async () => {
  const page = `<html lang="en"><head><meta name="viewport" content="width=device-width"><title>T</title>
    <link rel="stylesheet" href="/s.css"><style>body{color:#0b0b0c;background:#ffffff}</style></head>
    <body><h1>A</h1><h3>skip</h3><img src="a.png"></body></html>`;
  const f = mockFetch({ 'https://93.184.216.34/s.css': ['a{color:#ff0000}b{color:#00ff00}i{color:#0000ff}u{color:#ff00ff}s{color:#00ffff}q{color:#ffcc00}', 'text/css'], 'https://93.184.216.34/': page });
  try {
    const r = await TOOLS.design_audit({ url: 'https://93.184.216.34/' });
    assert.ok(r.score < 90);
    assert.ok(r.fixes.some((x) => /Palette sprawl/.test(x)));
    assert.ok(r.fixes.some((x) => /alt text/.test(x)));
    assert.equal(r.checks.heading_order, false);
    assert.equal(r.stylesheets_read, 1);
  } finally { f.mock.restore(); cacheClear(); }
});

test('web_fetch with find returns only relevant lines', async () => {
  const page = '<html><body><main><p>' + 'filler text. '.repeat(80) + '</p><p>Pricing: $20/mo</p><p>' + 'more filler. '.repeat(80) + '</p></main></body></html>';
  const f = mockFetch({ 'https://93.184.216.34/': page });
  try {
    const r = await TOOLS.web_fetch({ url: 'https://93.184.216.34/', find: 'pricing' });
    assert.match(r.content, /\$20\/mo/);
    assert.ok(r.content.length < 2000);
  } finally { f.mock.restore(); cacheClear(); }
});

test('social profile parses Instagram og counts', async () => {
  const page = '<html><head><meta property="og:description" content="12.5K Followers, 300 Following, 210 Posts - See Instagram photos"></head></html>';
  const f = mockFetch({ 'https://93.184.216.34/': page });
  try {
    const r = await TOOLS.social({ op: 'profile', url: 'https://93.184.216.34/' });
    assert.equal(r.followers, 12500);
    assert.equal(r.posts, 210);
    const specs = await TOOLS.social({ op: 'specs', platform: 'instagram' });
    assert.equal(specs.instagram.hashtags.max, 5);
  } finally { f.mock.restore(); cacheClear(); }
});

test('trends parses GitHub trending HTML', async () => {
  const page = '<article class="Box-row"><h2 class="h3"><a href="/acme/rocket">acme / rocket</a></h2><p class="col-9">Fast thing</p><span itemprop="programmingLanguage">Rust</span> 1,234 stars today</article>';
  const f = mockFetch({ 'https://github.com/trending': page });
  try {
    const r = await TOOLS.trends({ source: 'github' });
    assert.deepEqual(r.items[0], { repo: 'acme/rocket', desc: 'Fast thing', lang: 'Rust', today: '1,234' });
  } finally { f.mock.restore(); cacheClear(); }
});

test('rest surface reports unknown tools', async () => {
  const r = await call(rest, { method: 'POST', query: { name: 'nope' }, body: {} });
  assert.equal(r.code, 404);
});

test('registry-add validates and dedupes proposals', async () => {
  const { parseProposal, addEntry } = await import('./registry-add.js');
  const body = '```json\n{"name":"Neat MCP","url":"https://neat.dev","description":"Does neat things","tags":["Neat"]}\n```\n**Why:** speed';
  const e = parseProposal(body);
  assert.deepEqual(e, { name: 'Neat MCP', kind: 'mcp', url: 'https://neat.dev', description: 'Does neat things', tags: ['neat'] });
  const next = addEntry(registry, e, '2026.10.09');
  assert.equal(next.plugins.length, registry.plugins.length + 1);
  assert.throws(() => addEntry(next, e), /already in registry/);
  assert.throws(() => parseProposal('```json\n{"name":"x","url":"http://x","description":""}\n```'), /https.*description/);
});

test('design ignores id selectors that look like hex', () => {
  const a = analyzeCss('#bad .x{color:#123456}#fade{background:linear-gradient(#fff, #000)}');
  assert.ok(!a.colors.has('#bbaadd') && !a.colors.has('#ffaadd'.slice(0, 7)));
  assert.ok(a.colors.has('#123456') && a.colors.has('#ffffff') && a.colors.has('#000000'));
});

test('web_fetch routes binary files to ChatGPT Python', async () => {
  const f = mockFetch({ 'https://93.184.216.34/a.pdf': ['%PDF-1.7', 'application/pdf'] });
  try {
    const r = await TOOLS.web_fetch({ url: 'https://93.184.216.34/a.pdf' });
    assert.match(r.note, /Python/);
    assert.equal(r.content, undefined);
  } finally { f.mock.restore(); cacheClear(); }
});
