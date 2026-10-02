// Minimal MCP server (Streamable HTTP, JSON responses). Connect it in
// ChatGPT → Settings → Apps/Connectors (developer mode), Claude, Cursor, etc.
import { TOOLS } from '../lib/tools.js';
import { SCHEMAS } from '../lib/schemas.js';
import { authorized } from '../lib/auth.js';

const INFO = { name: 'rawmware-operator', version: '1.0.0' };

async function handle(msg, req) {
  const { id, method, params } = msg;
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  switch (method) {
    case 'initialize':
      return ok({ protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: INFO });
    case 'notifications/initialized':
      return null;
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: Object.entries(SCHEMAS).map(([name, s]) => ({ name, description: s.description, inputSchema: s.input })) });
    case 'tools/call': {
      const fn = TOOLS[params?.name];
      if (!fn) return err(-32602, `unknown tool ${params?.name}`);
      if (!authorized(req, params.name)) return ok({ isError: true, content: [{ type: 'text', text: 'unauthorized: write tool needs OPERATOR_API_KEY' }] });
      try {
        const out = await fn(params.arguments || {});
        // Compact JSON (no pretty-print) — whitespace is tokens.
        return ok({ content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out) }] });
      } catch (e) {
        return ok({ isError: true, content: [{ type: 'text', text: e.message }] });
      }
    }
    default:
      return id === undefined ? null : err(-32601, `method not found: ${method}`);
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ ...INFO, transport: 'streamable-http', tools: Object.keys(SCHEMAS) });
  if (req.method !== 'POST') return res.status(405).end();
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m, req)))).filter(Boolean);
    return out.length ? res.status(200).json(out) : res.status(202).end();
  }
  const out = await handle(body, req);
  return out ? res.status(200).json(out) : res.status(202).end();
}
