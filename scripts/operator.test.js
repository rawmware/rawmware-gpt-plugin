// Offline test suite: global fetch is mocked, so every test is deterministic
// and runs without network. `npm test`.
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { htmlToText, extractMeta, extractLinks, cap, focus, logErrors } from '../lib/compress.js';
import { assertPublicUrl, http, readText, pool } from '../lib/net.js';
import { credentials, denied } from '../lib/auth.js';
import { runTool } from '../lib/run.js';
import { buildSpec } from '../api/openapi.js';
import { SCHEMAS } from '../lib/schemas.js';
import { TOOLS, TTL } from '../lib/tools.js';
import { analyzeCss, contrast } from '../lib/tools/design.js';
import { rank } from '../lib/tools/registry.js';
import { parseManifest, bump } from '../lib/tools/deps.js';
import { fillArgs } from '../lib/tools/libdocs.js';
import { cacheClear } from '../lib/cache.js';
import { PROMPTS } from '../lib/prompts.js';
import mcp from '../api/mcp.js';
import rest from '../api/tools/[name].js';
import registry from '../registry/plugins.json' with { type: 'json' };

const IP = 'https://93.184.216.34'; // public IP literal: passes the SSRF guard without DNS
const b64 = (s) => Buffer.from(s).toString('base64');

// Route fetch to handlers. A route is [prefix | RegExp, handler(url, init) → Response | body | {status, body, headers, type}].
let calls = [];
function mockFetch(routes) {
  calls = [];
  return mock.method(globalThis, 'fetch', async (url, init = {}) => {
    url = String(url);
    calls.push({ url, init });
    const route = routes.find(([k]) => (k instanceof RegExp ? k.test(url) : url.startsWith(k)));
    if (!route) return new Response(`no mock for ${url}`, { status: 404 });
    let out = typeof route[1] === 'function' ? await route[1](url, init) : route[1];
    if (out instanceof Response) return out;
    if (typeof out === 'string') out = { body: out };
    else if (!('body' in out) && !('status' in out)) out = { body: out };
    const body = typeof out.body === 'string' ? out.body : JSON.stringify(out.body ?? {});
    const type = out.type || (typeof out.body === 'string' ? 'text/html' : 'application/json');
    return new Response(out.status === 204 || out.status === 304 ? null : body, { status: out.status || 200, headers: { 'content-type': type, ...(out.headers || {}) } });
  });
}
const withFetch = (routes, fn) => async () => {
  const f = mockFetch(routes);
  try { await fn(); } finally { f.mock.restore(); cacheClear(); }
};

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

beforeEach(() => { delete process.env.OPERATOR_API_KEY; delete process.env.GITHUB_TOKEN; delete process.env.VERCEL_TOKEN; delete process.env.OPENAI_API_KEY; });

// ───────────────────────── compression ─────────────────────────
test('htmlToText keeps code blocks verbatim, tables as rows, drops chrome', () => {
  const html = `<html><body><nav>menu</nav><main><h1>Install</h1><p>Run this &amp; go:</p>
    <pre><code class="language-js">function a() {
    if (x) {
        return 1;
    }
}</code></pre><table><tr><th>Opt</th><th>Default</th></tr><tr><td>port</td><td>3000</td></tr></table>
    <p>Use <code>npm i</code> then.</p>${'<p>body text here.</p>'.repeat(30)}</main><footer>foot</footer><script>evil()</script></body></html>`;
  const t = htmlToText(html);
  assert.match(t, /```js\nfunction a\(\) \{\n {4}if \(x\) \{\n {8}return 1;/);
  assert.match(t, /\| Opt \| Default \|\n\| port \| 3000 \|/);
  assert.match(t, /Use `npm i` then/);
  assert.match(t, /## Install/);
  assert.ok(!/menu|foot|evil/.test(t));
});

test('htmlToText picks the densest content container', () => {
  const html = `<body><div class="sidebar">${'<a href="#">link</a>'.repeat(50)}</div><article>${'<p>Real article paragraph with words.</p>'.repeat(20)}</article></body>`;
  const t = htmlToText(html);
  assert.ok(t.startsWith('Real article'));
  assert.ok(!t.includes('link'));
});

test('optional inline links resolve against base', () => {
  const t = htmlToText('<main><p>See <a href="/docs/x">the docs</a>.</p>' + '<p>pad pad pad pad pad pad.</p>'.repeat(30) + '</main>', { links: true, base: 'https://a.dev/guide/' });
  assert.match(t, /\[the docs\]\(https:\/\/a\.dev\/docs\/x\)/);
});

test('meta + links', () => {
  const html = '<html lang="en"><head><title>Hi &amp; bye</title><link rel="canonical" href="https://a.com/"><meta name="description" content="Desc"></head><body><a href="/x">x</a><a href="mailto:a@b.c">m</a></body></html>';
  const m = extractMeta(html);
  assert.equal(m.title, 'Hi & bye');
  assert.equal(m.canonical, 'https://a.com/');
  assert.deepEqual(extractLinks(html, 'https://a.com/'), ['https://a.com/x']);
});

test('cap + focus keep output small and pageable', () => {
  assert.match(cap('a'.repeat(20), 10, 30), /call again with offset=40/);
  const big = ['intro', 'x'.repeat(2000) + ' pricing $9 ' + 'y'.repeat(2000), 'footer'].join('\n');
  const f = focus(big, 'pricing');
  assert.ok(f.includes('$9') && f.length < 600);
});

test('logErrors finds the first real error with context, strips timestamps/ANSI', () => {
  const log = ['2026-10-01T10:00:00.000Z ##[group]Run npm test', 'ok 1', 'ok 2', '\u001b[31mTypeError: x is not a function\u001b[0m', '    at foo (src/a.ts:12:5)', 'more', 'Error: Process completed with exit code 1.'].join('\n');
  const r = logErrors(log);
  assert.equal(r.first_error, 'TypeError: x is not a function');
  assert.ok(r.context.some((l) => l.includes('src/a.ts:12')));
  assert.equal(r.error_lines, 2);
});

// ───────────────────────── network safety & perf ─────────────────────────
test('SSRF guard blocks private targets', async () => {
  for (const u of ['http://127.0.0.1/', 'http://localhost:3000', 'http://169.254.169.254/latest', 'http://10.0.0.5', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'file:///etc/passwd']) {
    await assert.rejects(assertPublicUrl(u), undefined, u);
  }
  await assertPublicUrl(`${IP}/`);
});

test('redirects re-check targets and drop credentials across origins', withFetch([
  [`${IP}/start`, { status: 302, body: '', headers: { location: 'https://blob.example.net/log.txt' } }],
  ['https://blob.example.net/log.txt', (u, init) => (init.headers.authorization ? { status: 400, body: 'auth not allowed' } : 'LOG')],
  [`${IP}/evil`, { status: 302, body: '', headers: { location: 'http://169.254.169.254/' } }],
], async () => {
  const r = await http(`${IP}/start`, { guard: false, headers: { authorization: 'Bearer secret' } });
  assert.equal(await r.text(), 'LOG');
  await assert.rejects(http(`${IP}/evil`), /private address/);
}));

test('readText caps huge bodies; pool preserves order and bounds concurrency', async () => {
  const res = new Response('x'.repeat(100_000));
  assert.equal((await readText(res, 10_000)).length, 10_000);
  let inFlight = 0, peak = 0;
  const out = await pool([5, 1, 3, 2], 2, async (n) => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, n)); inFlight--; return n * 2; });
  assert.deepEqual(out.map((o) => o.value), [10, 2, 6, 4]);
  assert.equal(peak, 2);
});

// ───────────────────────── auth & isolation ─────────────────────────
test('credentials: users act as themselves; server tokens never leak to strangers', () => {
  process.env.GITHUB_TOKEN = 'ghp_server';
  process.env.VERCEL_TOKEN = 'vc_owner';
  process.env.OPERATOR_API_KEY = 'k'.repeat(32);
  const anon = credentials({});
  assert.equal(anon.github, 'ghp_server'); // public reads only
  assert.equal(anon.vercel, null); // owner's Vercel is never exposed
  assert.equal(anon.ident, 'public');
  const user = credentials({ authorization: `Bearer gho_${'a'.repeat(36)}` });
  assert.equal(user.userGithub, true);
  assert.notEqual(user.ident, 'public');
  const owner = credentials({ authorization: `Bearer ${'k'.repeat(32)}` });
  assert.equal(owner.owner, true);
  assert.equal(owner.vercel, 'vc_owner');
  assert.equal(credentials({ authorization: 'Bearer nope' }).owner, false);
  assert.match(denied('github_write', { op: 'pr' }, anon), /acts as you/);
  assert.equal(denied('github_write', { op: 'pr' }, user), null);
  assert.match(denied('vercel', { op: 'projects' }, anon), /x-vercel-token/);
  assert.equal(denied('vercel', { op: 'projects' }, credentials({ 'x-vercel-token': 'v' })), null);
});

test('cache is partitioned per user: private results never cross users', withFetch([
  ['https://api.github.com/repos/a/b', (u, init) => ({ body: { full_name: 'a/b', description: init.headers.authorization === `Bearer ghp_${'u'.repeat(36)}` ? 'PRIVATE-U1' : 'other' }, headers: { etag: init.headers.authorization || 'none' } })],
], async () => {
  const u1 = { authorization: `Bearer ghp_${'u'.repeat(36)}` };
  const u2 = { authorization: `Bearer ghp_${'v'.repeat(36)}` };
  assert.equal((await runTool('github', { op: 'repo', repo: 'a/b' }, u1)).description, 'PRIVATE-U1');
  assert.equal((await runTool('github', { op: 'repo', repo: 'a/b' }, u2)).description, 'other');
  assert.equal((await runTool('github', { op: 'repo', repo: 'a/b' }, {})).description, 'other');
}));

test('GitHub reads revalidate with ETag; 304 serves cached data', withFetch([
  ['https://api.github.com/repos/a/b', (u, init) => (init.headers['if-none-match'] === '"v1"' ? { status: 304 } : { body: { full_name: 'a/b', description: 'fresh' }, headers: { etag: '"v1"' } })],
], async () => {
  await TOOLS.github({ op: 'repo', repo: 'a/b' }, {});
  const r = await TOOLS.github({ op: 'repo', repo: 'a/b' }, {});
  assert.equal(r.description, 'fresh');
  assert.equal(calls.at(-1).init.headers['if-none-match'], '"v1"');
}));

test('rate-limit errors explain how to fix', withFetch([
  ['https://api.github.com/', { status: 403, body: { message: 'API rate limit exceeded' }, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790000000' } }],
], async () => {
  await assert.rejects(TOOLS.github({ op: 'repo', repo: 'a/b' }, {}), /rate limit hit.*Connect your own GitHub/);
}));

// ───────────────────────── github ─────────────────────────
const TREE = { tree: [
  { path: 'src/auth.ts', type: 'blob', size: 300 }, { path: 'src/util.ts', type: 'blob', size: 200 },
  { path: 'node_modules/x/index.js', type: 'blob', size: 10 }, { path: 'logo.png', type: 'blob', size: 10 },
  { path: 'package.json', type: 'blob', size: 100 }, { path: '.github/workflows/ci.yml', type: 'blob', size: 50 },
] };

test('grep searches the repo without cloning (skips vendored/binary files)', withFetch([
  ['https://api.github.com/repos/a/b/git/trees/HEAD', TREE],
  ['https://raw.githubusercontent.com/a/b/HEAD/src/auth.ts', 'import x\nexport function verifyToken(t) {\n  return t;\n}'],
  ['https://raw.githubusercontent.com/a/b/HEAD/src/util.ts', 'const a = verifyToken(1);'],
  ['https://raw.githubusercontent.com/a/b/HEAD/package.json', '{}'],
  ['https://raw.githubusercontent.com/a/b/HEAD/.github/workflows/ci.yml', 'on: push'],
], async () => {
  const r = await TOOLS.github({ op: 'grep', repo: 'a/b', query: 'verifyToken\\(' }, {});
  assert.deepEqual(r.matches.sort(), ['src/auth.ts:2: export function verifyToken(t) {', 'src/util.ts:1: const a = verifyToken(1);']);
  assert.ok(!calls.some((c) => c.url.includes('node_modules') || c.url.includes('logo.png')));
}));

test('file op batches paths and slices lines', withFetch([
  ['https://api.github.com/repos/a/b/contents/src/a.ts', { body: { content: b64('l1\nl2\nl3\nl4'), encoding: 'base64', size: 11 } }],
  ['https://api.github.com/repos/a/b/contents/src/b.ts', { body: { content: b64('b1'), encoding: 'base64', size: 2 } }],
], async () => {
  const one = await TOOLS.github({ op: 'file', repo: 'a/b', path: 'src/a.ts', lines: '2-3' }, {});
  assert.match(one.content, /^2\tl2\n3\tl3\n\[lines 2-3 of 4\]/);
  const many = await TOOLS.github({ op: 'file', repo: 'a/b', paths: ['src/a.ts', 'src/b.ts', 'nope.ts'] }, {});
  assert.equal(many.files.length, 3);
  assert.equal(many.files[1].content, 'b1');
  assert.ok(many.files[2].error);
}));

test('pr op returns diff, CI and reviews in one call', withFetch([
  ['https://api.github.com/repos/a/b/pulls/7/files', [{ filename: 'src/a.ts', status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1 @@\n-a\n+b' }]],
  ['https://api.github.com/repos/a/b/pulls/7/reviews', [{ user: { login: 'rev' }, state: 'CHANGES_REQUESTED', body: 'fix null' }]],
  ['https://api.github.com/repos/a/b/pulls/7', { body: { title: 'Fix', state: 'open', user: { login: 'me' }, base: { ref: 'main' }, head: { ref: 'fix', sha: 'abc' }, commits: 1, changed_files: 1, additions: 2, deletions: 1, body: 'why' } }],
  ['https://api.github.com/repos/a/b/commits/abc/check-runs', { check_runs: [{ name: 'test', conclusion: 'failure' }] }],
], async () => {
  const r = await TOOLS.github({ op: 'pr', repo: 'a/b', number: 7 }, {});
  assert.deepEqual(r.checks, ['test: failure']);
  assert.match(r.files[0].patch, /\+b/);
  assert.match(r.reviews[0], /CHANGES_REQUESTED — fix null/);
}));

test('run_logs finds the latest failed run and extracts the error', withFetch([
  [/actions\/runs\?status=failure/, { workflow_runs: [{ id: 99 }] }],
  ['https://api.github.com/repos/a/b/actions/runs/99/jobs', { jobs: [{ id: 5, name: 'test', conclusion: 'failure', steps: [{ name: 'npm test', conclusion: 'failure' }] }, { id: 6, name: 'lint', conclusion: 'success', steps: [] }] }],
  ['https://api.github.com/repos/a/b/actions/runs/99', { name: 'CI', head_branch: 'main', head_sha: 'deadbeef1', event: 'push', created_at: '2026-10-01T00:00:00Z', head_commit: { message: 'break it' } }],
  ['https://api.github.com/repos/a/b/actions/jobs/5/logs', { status: 302, body: '', headers: { location: 'https://pipelines.example.net/log' } }],
  ['https://pipelines.example.net/log', (u, init) => (init.headers.authorization ? { status: 403, body: 'no' } : 'setup\nFAIL src/a.test.ts\n  Expected 1 got 2\nError: Process completed with exit code 1.')],
], async () => {
  const r = await TOOLS.github({ op: 'run_logs', repo: 'a/b' }, { github: 'ghp_x' });
  assert.equal(r.run, 99);
  assert.deepEqual(r.failures[0].failed_steps, ['npm test']);
  assert.equal(r.failures[0].first_error, 'FAIL src/a.test.ts');
}));

test('github_write pr: commits to an existing branch and reuses its open PR', withFetch([
  ['https://api.github.com/repos/me/app/git/ref/heads/fix-1', { object: { sha: 'p1' } }],
  ['https://api.github.com/repos/me/app/git/commits/p1', { tree: { sha: 't0' } }],
  ['https://api.github.com/repos/me/app/git/trees', { sha: 't1' }],
  ['https://api.github.com/repos/me/app/git/commits', { sha: 'c2c2c2c2' }],
  ['https://api.github.com/repos/me/app/git/refs/heads/fix-1', { ref: 'refs/heads/fix-1' }],
  [/\/pulls\?head=/, [{ html_url: 'https://github.com/me/app/pull/3', number: 3 }]],
  ['https://api.github.com/repos/me/app', { default_branch: 'main' }],
], async () => {
  const ctx = credentials({ 'x-github-token': `ghp_${'z'.repeat(36)}` });
  const r = await TOOLS.github_write({ op: 'pr', repo: 'me/app', branch: 'fix-1', title: 'Fix', files: [{ path: 'a.js', content: 'x' }] }, ctx);
  assert.equal(r.number, 3);
  assert.equal(r.updated_existing, true);
  const patch = calls.find((c) => c.init.method === 'PATCH');
  assert.equal(JSON.parse(patch.init.body).sha, 'c2c2c2c2');
  assert.ok(!calls.some((c) => c.url.endsWith('/pulls') && c.init.method === 'POST'), 'no duplicate PR');
}));

test('audit flags committed secrets and failing CI first', withFetch([
  ['https://api.github.com/repos/a/b/git/trees/HEAD', { tree: [...TREE.tree, { path: '.env', type: 'blob', size: 5 }] }],
  ['https://api.github.com/repos/a/b/actions/runs', { workflow_runs: [{ id: 1, name: 'CI', conclusion: 'failure', head_branch: 'main', created_at: '2026-10-01' }] }],
  ['https://api.github.com/repos/a/b/contents/package.json', { content: b64(JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0' }, scripts: { build: 'next build' } })), encoding: 'base64' }],
  ['https://api.github.com/repos/a/b', { full_name: 'a/b', default_branch: 'main' }],
], async () => {
  const r = await TOOLS.github({ op: 'audit', repo: 'a/b' }, {});
  assert.match(r.gaps[0], /\.env file is committed/);
  assert.match(r.gaps[1], /CI runs failed/);
  assert.ok(r.stack.includes('Next.js') && r.stack.includes('React'));
}));

// ───────────────────────── deps ─────────────────────────
test('manifest parsers: npm lock v3, package.json, requirements, Cargo.lock, go.mod', () => {
  const lock = JSON.stringify({ packages: { '': {}, 'node_modules/next': { version: '14.0.0' }, 'node_modules/@types/node': { version: '20.1.0', dev: true }, 'node_modules/a/node_modules/b': { version: '1.0.0' } } });
  assert.deepEqual(parseManifest('package-lock.json', lock).deps, [{ name: 'next', version: '14.0.0', exact: true, dev: false }, { name: '@types/node', version: '20.1.0', exact: true, dev: true }]);
  const pkg = parseManifest('package.json', JSON.stringify({ dependencies: { react: '^18.2.0', local: 'file:../x' }, devDependencies: { vitest: '~1.0.0' } }));
  assert.deepEqual(pkg.deps.map((d) => `${d.name}@${d.version}`), ['react@18.2.0', 'vitest@1.0.0']);
  assert.deepEqual(parseManifest('requirements.txt', 'Django==4.2.0 # web\nrequests>=2.0\n# c\n').deps.map((d) => d.name), ['django', 'requests']);
  assert.equal(parseManifest('Cargo.lock', '[[package]]\nname = "serde"\nversion = "1.0.1"\n').deps[0].version, '1.0.1');
  assert.equal(parseManifest('go.mod', 'module x\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.0\n)\n').deps[0].name, 'github.com/gin-gonic/gin');
  assert.equal(bump('14.0.0', '15.1.0'), 'major');
  assert.equal(bump('1.2.0', '1.3.0'), 'minor');
  assert.equal(bump('2.0.0', '2.0.0'), null);
});

test('deps audit: vulnerabilities with fix version, outdated, deprecated', withFetch([
  ['https://api.osv.dev/v1/querybatch', (u, init) => ({ body: { results: JSON.parse(init.body).queries.map((q) => (q.package.name === 'next' ? { vulns: [{ id: 'GHSA-1' }] } : {})) } })],
  ['https://api.osv.dev/v1/vulns/GHSA-1', { id: 'GHSA-1', summary: 'Auth bypass in middleware', aliases: ['CVE-2025-29927'], database_specific: { severity: 'CRITICAL' }, affected: [{ package: { name: 'next' }, ranges: [{ events: [{ introduced: '0' }, { fixed: '14.2.25' }, { fixed: '15.2.3' }] }] }] }],
  ['https://registry.npmjs.org/next/latest', { version: '15.5.0' }],
  ['https://registry.npmjs.org/request/latest', { version: '2.88.2', deprecated: 'request has been deprecated' }],
], async () => {
  const manifest = JSON.stringify({ dependencies: { next: '14.0.0', request: '2.88.2' } });
  const r = await TOOLS.deps({ op: 'audit', manifest, filename: 'package.json' }, {});
  assert.equal(r.vulnerable[0].name, 'next');
  assert.deepEqual(r.vulnerable[0].advisories, ['CVE-2025-29927']);
  assert.equal(r.vulnerable[0].fix, '>= 14.2.25');
  assert.equal(r.vulnerable[0].severity, 'CRITICAL');
  assert.deepEqual(r.outdated.major, ['next 14.0.0 → 15.5.0']);
  assert.match(r.deprecated[0], /request@2\.88\.2/);
}));

// ───────────────────────── libdocs ─────────────────────────
test('libdocs: Context7 over MCP with schema-adaptive arguments', withFetch([
  ['https://mcp.context7.com/mcp', (u, init) => {
    const m = JSON.parse(init.body);
    if (m.method === 'initialize') return { body: { jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18' } }, headers: { 'mcp-session-id': 's1' } };
    if (m.method === 'notifications/initialized') return { status: 202, body: '' };
    if (m.method === 'tools/list') return { body: { jsonrpc: '2.0', id: m.id, result: { tools: [
      { name: 'resolve-library-id', inputSchema: { properties: { libraryName: {}, query: {} } } },
      { name: 'query-docs', inputSchema: { properties: { libraryId: {}, query: {} } } },
    ] } } };
    const { name, arguments: a } = m.params;
    assert.equal(init.headers['mcp-session-id'], 's1');
    if (name === 'resolve-library-id') { assert.equal(a.libraryName, 'next.js'); return { body: `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'Context7-compatible library ID: /vercel/next.js' }] } })}\n\n`, type: 'text/event-stream' }; }
    assert.deepEqual(a, { libraryId: '/vercel/next.js', query: 'middleware' });
    return { body: { jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'export function middleware(req) {}\n'.repeat(20) }] } } };
  }],
], async () => {
  const r = await TOOLS.libdocs({ library: 'next.js', topic: 'middleware' });
  assert.equal(r.source, 'context7');
  assert.equal(r.library_id, '/vercel/next.js');
  assert.match(r.content, /export function middleware/);
  assert.deepEqual(fillArgs({ properties: { context7CompatibleLibraryID: {}, topic: {}, tokens: {} } }, { id: '/x/y', topic: 't', tokens: 500 }), { context7CompatibleLibraryID: '/x/y', topic: 't', tokens: 500 });
}));

// ───────────────────────── web ─────────────────────────
test('search falls through blocked providers', withFetch([
  ['https://html.duckduckgo.com/', '<html>anomaly detected, captcha</html>'],
  ['https://lite.duckduckgo.com/', `<table><tr><td><a rel="nofollow" href="https://nextjs.org/docs" class='result-link'>Next.js Docs</a></td></tr><tr><td class='result-snippet'>The React framework</td></tr></table>`],
], async () => {
  const r = await TOOLS.web_search({ query: 'next.js docs' });
  assert.equal(r.provider, 'duckduckgo-lite');
  assert.equal(r.results[0].url, 'https://nextjs.org/docs');
}));

test('web_fetch: batch urls, find, llms.txt, binary routing', withFetch([
  [`${IP}/a`, `<main>${'<p>filler.</p>'.repeat(50)}<p>Pricing: $20/mo</p></main>`],
  [`${IP}/b`, { status: 500, body: 'boom' }],
  [`${IP}/llms.txt`, { body: '# Docs\n- [Routing](https://x/routing)\n- [Auth](https://x/auth)', type: 'text/plain' }],
  [`${IP}/f.pdf`, { body: '%PDF', type: 'application/pdf' }],
], async () => {
  const r = await TOOLS.web_fetch({ urls: [`${IP}/a`, `${IP}/b`], find: 'pricing' });
  assert.match(r.pages[0].content, /\$20\/mo/);
  assert.match(r.pages[1].error, /500/);
  const l = await TOOLS.web_fetch({ url: `${IP}/docs/x`, mode: 'llms', find: 'auth' });
  assert.match(l.content, /Auth/);
  assert.match((await TOOLS.web_fetch({ url: `${IP}/f.pdf` })).note, /Python/);
}));

// ───────────────────────── site ─────────────────────────
test('site health measures and flags real problems', withFetch([
  [`${IP}/robots.txt`, { status: 404, body: '' }],
  [`${IP}/sitemap.xml`, { status: 404, body: '' }],
  [`${IP}/`, { body: `<html><head><title>T</title><script src="/a.js"></script><script src="https://cdn.x.com/t.js" async></script></head><body><h1>a</h1><img src="x.png"></body></html>`, headers: { 'cache-control': 'no-store' } }],
], async () => {
  const r = await TOOLS.site({ op: 'health', url: `${IP}/` });
  assert.equal(r.scripts.render_blocking, 1);
  assert.deepEqual(r.scripts.third_party, ['cdn.x.com']);
  assert.ok(r.issues.some((i) => /viewport/.test(i)));
  assert.ok(r.issues.some((i) => /width\/height/.test(i)));
  assert.ok(r.security_headers_missing.includes('strict-transport-security'));
  assert.ok(typeof r.timing_ms.ttfb === 'number' && r.score < 100);
}));

test('site crawl stays in scope, finds content and broken pages', withFetch([
  [`${IP}/docs/start`, '<a href="/docs/auth">a</a><a href="/docs/gone">g</a><a href="/blog/x">b</a><p>start</p>'],
  [`${IP}/docs/auth`, '<p>Use the auth token header.</p>'],
  [`${IP}/docs/gone`, { status: 404, body: 'nf' }],
], async () => {
  const r = await TOOLS.site({ op: 'crawl', url: `${IP}/docs/start`, find: 'token' });
  assert.equal(r.scope, '/docs/');
  assert.equal(r.pages.length, 1);
  assert.match(r.pages[0].matches, /auth token/);
  assert.equal(r.broken.length, 1);
  assert.ok(!calls.some((c) => c.url.includes('/blog/')));
}));

test('site design: tokens, contrast, selector-safe colors', () => {
  const a = analyzeCss('#bad .x{color:#123456}:root{--brand:#ff4d00}body{font-family:"Inter",sans-serif;font-size:16px;padding:8px 16px;border-radius:12px;transition:all 200ms;background:linear-gradient(#fff, #000)}h1{font-size:3rem}');
  assert.ok(!a.colors.has('#bbaadd'));
  assert.ok(a.colors.has('#123456') && a.colors.has('#ffffff') && a.colors.has('#000000'));
  assert.ok(a.fonts.has('Inter') && a.sizes.has(48) && a.space.has(16));
  assert.equal(a.vars['--brand'], '#ff4d00');
  assert.equal(contrast('#000000', '#ffffff'), 21);
});

// ───────────────────────── vercel ─────────────────────────
test('vercel logs: latest failed deployment, first error, never the owner token for strangers', withFetch([
  [/v6\/deployments\?limit=1&state=ERROR/, { deployments: [{ uid: 'dpl_1' }] }],
  [/v13\/deployments\/dpl_1/, { url: 'app-x.vercel.app', readyState: 'ERROR', target: 'production', meta: { githubCommitRef: 'main' } }],
  [/v3\/deployments\/dpl_1\/events/, [{ text: 'Installing...' }, { text: 'Type error: Property x does not exist' }, { text: 'Error: Command "npm run build" exited with 1' }]],
], async () => {
  process.env.VERCEL_TOKEN = 'owner-secret';
  const res = await call(rest, { method: 'POST', query: { name: 'vercel' }, body: { op: 'projects' } });
  assert.equal(res.code, 401);
  assert.ok(!calls.length, 'owner token never used');
  const r = await TOOLS.vercel({ op: 'logs', project: 'app' }, credentials({ 'x-vercel-token': 'user-token' }));
  assert.equal(r.first_error, 'Type error: Property x does not exist');
  assert.equal(calls[0].init.headers.authorization, 'Bearer user-token');
}));

// ───────────────────────── contracts & budgets ─────────────────────────
test('every schema has an implementation, TTL, and OpenAPI path', () => {
  assert.deepEqual(Object.keys(SCHEMAS).sort(), Object.keys(TOOLS).sort());
  assert.deepEqual(Object.keys(TTL).sort(), Object.keys(TOOLS).sort());
  const spec = buildSpec('https://x');
  assert.equal(Object.keys(spec.paths).length, Object.keys(SCHEMAS).length);
  assert.ok(Object.keys(spec.paths).length <= 30, 'GPT Actions allow at most 30 operations');
  assert.equal(spec.paths['/api/tools/github_write'].post['x-openai-isConsequential'], true);
  assert.equal(spec.paths['/api/tools/github'].post['x-openai-isConsequential'], false);
});

test('token budgets: tool schemas and GPT instructions', async () => {
  const total = JSON.stringify(Object.values(SCHEMAS).map((s) => [s.description, s.input])).length;
  for (const [n, s] of Object.entries(SCHEMAS)) assert.ok(s.description.length <= 200, `${n} description too long`);
  assert.ok(total < 11000, `tool schemas are ${total} chars (~${Math.round(total / 4)} tokens); keep under 11000`);
  const md = await readFile(new URL('../gpt/instructions.md', import.meta.url), 'utf8');
  const body = md.split('<!-- paste below -->')[1].trim();
  assert.ok(body.length <= 8000, `instructions are ${body.length} chars`);
});

test('playbooks referenced by tools exist', async () => {
  const f = mockFetch([]);
  try {
    const idx = await TOOLS.playbook({});
    const topics = idx.playbooks.map((p) => p.topic);
    for (const t of SCHEMAS.playbook.description.match(/: ([^.]+)\./)[1].split(', ')) assert.ok(topics.includes(t.trim()), t);
    assert.match((await TOOLS.playbook({ topic: 'debugging', section: 'procedure' })).content, /^## Procedure/);
  } finally { f.mock.restore(); cacheClear(); }
});

// ───────────────────────── MCP protocol ─────────────────────────
test('mcp initialize/tools/resources/prompts/errors', async () => {
  const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(init.j.result.protocolVersion, '2025-06-18');
  assert.match(init.j.result.instructions, /libdocs/);
  const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(list.j.result.tools.length, Object.keys(SCHEMAS).length);
  const gh = list.j.result.tools.find((t) => t.name === 'github');
  assert.equal(gh.annotations.readOnlyHint, true);
  const res = await rpc({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: gh._meta['openai/outputTemplate'] } });
  assert.equal(res.j.result.contents[0].mimeType, 'text/html+skybridge');
  const prompts = await rpc({ jsonrpc: '2.0', id: 4, method: 'prompts/list' });
  assert.equal(prompts.j.result.prompts.length, Object.keys(PROMPTS).length);
  const p = await rpc({ jsonrpc: '2.0', id: 5, method: 'prompts/get', params: { name: 'fix_ci', arguments: { repo: 'a/b' } } });
  assert.match(p.j.result.messages[0].content.text, /run_logs/);
  assert.equal((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).code, 202);
  assert.equal((await call(mcp, { method: 'POST', body: '{nope' })).j.error.code, -32700);
  const denied = await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'github_write', arguments: { op: 'issue', repo: 'a/b', title: 't' } } });
  assert.equal(denied.j.result.isError, true);
  assert.equal((await call(rest, { method: 'POST', query: { name: 'nope' }, body: {} })).code, 404);
});

// ───────────────────────── registry, social, trends ─────────────────────────
test('plugins: ranking, callable allowlist, propose link', withFetch([], async () => {
  assert.equal(rank(registry.plugins, 'debug my vercel deploy logs')[0].name, 'Vercel MCP');
  assert.ok(rank(registry.plugins, 'make an instagram thumbnail').some((p) => p.kind === 'builtin'));
  await assert.rejects(TOOLS.plugin_call({ server: 'Stripe MCP' }), /not callable.*DeepWiki/);
  const r = await TOOLS.plugins({ op: 'propose', name: 'X', url: 'https://x.dev', description: 'does x' });
  assert.match(r.submit, /issues\/new\?labels=registry/);
}));

test('registry-add validates and dedupes proposals', async () => {
  const { parseProposal, addEntry } = await import('./registry-add.js');
  const e = parseProposal('```json\n{"name":"Neat MCP","url":"https://neat.dev","description":"Does neat things","tags":["Neat"]}\n```');
  assert.deepEqual(e, { name: 'Neat MCP', kind: 'mcp', url: 'https://neat.dev', description: 'Does neat things', tags: ['neat'] });
  const next = addEntry(registry, e, '2026.10.09');
  assert.throws(() => addEntry(next, e), /already in registry/);
  assert.throws(() => parseProposal('```json\n{"name":"x","url":"http://x","description":""}\n```'), /https.*description/);
});

test('social: Instagram og counts + current specs', withFetch([
  [`${IP}/`, '<html><head><meta property="og:description" content="12.5K Followers, 300 Following, 210 Posts - See Instagram photos"></head></html>'],
], async () => {
  const r = await TOOLS.social({ op: 'profile', url: `${IP}/` });
  assert.equal(r.followers, 12500);
  assert.equal((await TOOLS.social({ op: 'specs', platform: 'instagram' })).instagram.hashtags.max, 5);
}));

test('trends parses GitHub trending', withFetch([
  ['https://github.com/trending', '<article class="Box-row"><h2 class="h3"><a href="/acme/rocket">acme / rocket</a></h2><p class="col-9">Fast thing</p><span itemprop="programmingLanguage">Rust</span> 1,234 stars today</article>'],
], async () => {
  const r = await TOOLS.trends({ source: 'github' });
  assert.deepEqual(r.items[0], { repo: 'acme/rocket', desc: 'Fast thing', lang: 'Rust', today: '1,234' });
}));

test('openai tool never spends the server key for the public', async () => {
  process.env.OPENAI_API_KEY = 'sk-server';
  await assert.rejects(TOOLS.openai({ op: 'ask', prompt: 'hi' }, credentials({})), /built-in tools/);
});
