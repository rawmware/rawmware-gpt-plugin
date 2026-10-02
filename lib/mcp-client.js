// Minimal MCP client (Streamable HTTP). Lets the operator call *other* MCP
// servers from the shared registry, so one connector gives ChatGPT access to
// many. Handles JSON and SSE responses and the mcp-session-id handshake.
import { http, UA } from './net.js';

const PROTOCOL = '2025-06-18';
const sessions = new Map(); // url -> { id, at }

function parseSse(text, id) {
  for (const block of text.split(/\n\n/)) {
    const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
    if (!data) continue;
    try {
      const msg = JSON.parse(data);
      if (msg.id === id) return msg;
    } catch {}
  }
  throw new Error('no matching response in event stream');
}

async function rpc(url, method, params, { headers = {}, sessionId, id = Date.now() } = {}) {
  const res = await http(url, {
    method: 'POST',
    timeout: 25000,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOCOL,
      'user-agent': UA,
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      ...headers,
    },
    body: JSON.stringify(id === null ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params }),
  });
  if (id === null) return { res };
  const type = res.headers.get('content-type') || '';
  const text = await res.text();
  const msg = type.includes('text/event-stream') ? parseSse(text, id) : JSON.parse(text);
  if (msg.error) throw new Error(`${method}: ${msg.error.message}`);
  return { res, result: msg.result };
}

async function session(url, headers) {
  const s = sessions.get(url);
  if (s && Date.now() - s.at < 10 * 60_000) return s.id;
  const { res } = await rpc(url, 'initialize', {
    protocolVersion: PROTOCOL,
    capabilities: {},
    clientInfo: { name: 'rawmware-operator', version: '2.0.0' },
  }, { headers });
  const id = res.headers.get('mcp-session-id') || null;
  await rpc(url, 'notifications/initialized', {}, { headers, sessionId: id, id: null }).catch(() => {});
  sessions.set(url, { id, at: Date.now() });
  return id;
}

export async function mcpListTools(url, headers = {}) {
  const sessionId = await session(url, headers);
  const { result } = await rpc(url, 'tools/list', {}, { headers, sessionId });
  return result.tools;
}

export async function mcpCallTool(url, name, args, headers = {}) {
  const sessionId = await session(url, headers);
  try {
    const { result } = await rpc(url, 'tools/call', { name, arguments: args || {} }, { headers, sessionId });
    return result;
  } catch (e) {
    sessions.delete(url); // stale session → retry once with a fresh one
    if (!/40[04]/.test(e.message)) throw e;
    const fresh = await session(url, headers);
    return (await rpc(url, 'tools/call', { name, arguments: args || {} }, { headers, sessionId: fresh })).result;
  }
}
