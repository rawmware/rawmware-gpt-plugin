// MCP server (Streamable HTTP, JSON responses, stateless). Connect it in
// ChatGPT → Settings → Apps & Connectors (developer mode), Claude, Cursor,
// VS Code, or any MCP client: https://<domain>/mcp
import { SCHEMAS, VERSION } from '../lib/schemas.js';
import { runTool } from '../lib/run.js';
import { WIDGET_URI, WIDGET_HTML } from '../lib/widget.js';
import { PROMPTS } from '../lib/prompts.js';

const INFO = { name: 'rawmware-operator', title: 'rawmware Operator', version: VERSION };
const SUPPORTED = ['2025-06-18', '2025-11-25', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS =
  'Developer operator. Read primary sources before answering: github (as the user), vercel, web_fetch. ' +
  'Before writing code against a library, call libdocs. CI red → github op:run_logs. PR → github op:pr. Deploy failed → vercel op:logs. ' +
  'Dependencies → deps op:audit. Live site → site op:health. Ask for the smallest slice (find, lines, paths, section). ' +
  'docs op:search before re-researching. Ship fixes with github_write op:pr. plugins op:suggest when another tool fits better.';

export function toolList() {
  return Object.entries(SCHEMAS).map(([name, s]) => ({
    name,
    description: s.description,
    inputSchema: s.input,
    annotations: { title: name.replace(/_/g, ' '), ...s.annotations },
    ...(s.widget ? {
      _meta: {
        'openai/outputTemplate': WIDGET_URI,
        'openai/toolInvocation/invoking': 'Working…',
        'openai/toolInvocation/invoked': 'Done',
      },
    } : {}),
  }));
}

async function handle(msg, headers) {
  const { id, method, params } = msg || {};
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0') return err(-32600, 'invalid request');

  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      return ok({
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: { listChanged: false }, resources: {}, prompts: {} },
        serverInfo: INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: toolList() });
    case 'tools/call': {
      const name = params?.name;
      if (!SCHEMAS[name]) return err(-32602, `unknown tool ${name}`);
      try {
        const out = await runTool(name, params.arguments || {}, headers);
        const isObj = out && typeof out === 'object' && !Array.isArray(out);
        return ok({
          // Compact JSON (no pretty-print): whitespace is tokens.
          content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out) }],
          ...(isObj ? { structuredContent: out } : {}),
        });
      } catch (e) {
        return ok({ isError: true, content: [{ type: 'text', text: e.message }] });
      }
    }
    case 'resources/list':
      return ok({ resources: [{ uri: WIDGET_URI, name: 'operator-card', mimeType: 'text/html+skybridge', description: 'Result card for research, repo audits, site checks, trends.' }] });
    case 'resources/read':
      if (params?.uri !== WIDGET_URI) return err(-32602, `unknown resource ${params?.uri}`);
      return ok({ contents: [{ uri: WIDGET_URI, mimeType: 'text/html+skybridge', text: WIDGET_HTML, _meta: { 'openai/widgetDescription': 'Compact result card.', 'openai/widgetPrefersBorder': true } }] });
    case 'resources/templates/list':
      return ok({ resourceTemplates: [] });
    case 'prompts/list':
      return ok({ prompts: Object.entries(PROMPTS).map(([name, p]) => ({ name, description: p.description, arguments: p.args })) });
    case 'prompts/get': {
      const p = PROMPTS[params?.name];
      if (!p) return err(-32602, `unknown prompt ${params?.name}`);
      return ok({ description: p.description, messages: [{ role: 'user', content: { type: 'text', text: p.text(params.arguments || {}) } }] });
    }
    default:
      if (method?.startsWith('notifications/')) return null;
      return id === undefined ? null : err(-32601, `method not found: ${method}`);
  }
}

export default async function handler(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type, authorization, mcp-session-id, mcp-protocol-version, x-github-token, x-vercel-token, x-openai-key');
  res.setHeader('access-control-expose-headers', 'mcp-session-id');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') {
    // Stateless server: no server-initiated stream. Browsers get a summary.
    if ((req.headers.accept || '').includes('text/event-stream')) return res.status(405).end();
    return res.status(200).json({ ...INFO, transport: 'streamable-http', endpoint: '/mcp', tools: Object.keys(SCHEMAS), prompts: Object.keys(PROMPTS) });
  }
  if (req.method === 'DELETE') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
  }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m, req.headers)))).filter(Boolean);
    return out.length ? res.status(200).json(out) : res.status(202).end();
  }
  const out = await handle(body, req.headers);
  return out ? res.status(200).json(out) : res.status(202).end();
}
