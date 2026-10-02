import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, extractMeta, extractLinks, cap } from '../lib/compress.js';
import { buildSpec } from '../api/openapi.js';
import { SCHEMAS } from '../lib/schemas.js';
import { TOOLS } from '../lib/tools.js';
import mcp from '../api/mcp.js';

const html = `<html><head><title>Hi</title><meta name="description" content="Desc"><script>evil()</script></head>
<body><nav>menu</nav><h1>Head</h1><p>One &amp; two</p><a href="/x">x</a></body></html>`;

test('htmlToText strips noise', () => {
  const t = htmlToText(html);
  assert.ok(t.includes('## Head') && t.includes('One & two'));
  assert.ok(!t.includes('evil') && !t.includes('menu'));
});

test('meta + links', () => {
  assert.deepEqual(extractMeta(html).title, 'Hi');
  assert.deepEqual(extractLinks(html, 'https://a.com/'), ['https://a.com/x']);
});

test('cap marks truncation', () => assert.match(cap('a'.repeat(20), 10), /truncated 10 chars/));

test('every schema has an implementation and vice versa', () => {
  assert.deepEqual(Object.keys(SCHEMAS).sort(), Object.keys(TOOLS).sort());
  assert.equal(Object.keys(buildSpec('https://x').paths).length, Object.keys(SCHEMAS).length);
});

function call(body, headers = {}) {
  return new Promise((resolve) => {
    const res = { code: 0, status(c) { this.code = c; return this; }, json(j) { resolve({ code: this.code, j }); }, end() { resolve({ code: this.code }); } };
    mcp({ method: 'POST', body, headers }, res);
  });
}

test('mcp tools/list + write-tool auth', async () => {
  const list = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(list.j.result.tools.length, Object.keys(SCHEMAS).length);
  const denied = await call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'docs_write', arguments: { path: 'a.md', content: 'x' } } });
  assert.equal(denied.j.result.isError, true);
});

test('plugins_suggest ranks from local registry', async () => {
  const r = await TOOLS.plugins_suggest({ task: 'debug my vercel deploy logs' });
  assert.equal(r.suggestions[0].name, 'Vercel MCP');
});
