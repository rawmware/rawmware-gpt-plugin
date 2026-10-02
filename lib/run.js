// One pipeline for every surface (MCP, GPT Actions REST): credentials →
// permission → rate limit → cache → run → normalize errors.
import { TOOLS, TTL } from './tools.js';
import { credentials, denied, WRITE_TOOLS } from './auth.js';
import { allow, clientIp } from './ratelimit.js';
import { cacheGet, cacheSet } from './cache.js';

export class ToolError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function runTool(name, args = {}, headers = {}) {
  const fn = TOOLS[name];
  if (!fn) throw new ToolError(404, `unknown tool ${name}`);
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ToolError(400, 'arguments must be a JSON object');
  const ctx = { ...credentials(headers), headers };
  const why = denied(name, args, ctx);
  if (why) throw new ToolError(401, why);
  if (!ctx.owner && !allow(`${clientIp(headers)}:${ctx.ident}`)) throw new ToolError(429, 'rate limit: try again in a minute');

  // Cache is partitioned by identity: results fetched with a user's token
  // are never served to anyone else.
  const ttl = WRITE_TOOLS.has(name) || args.op === 'write' ? 0 : TTL[name] || 0;
  const key = ttl ? `t:${ctx.ident}:${name}:${JSON.stringify(args)}` : null;
  if (key) {
    const hit = await cacheGet(key);
    if (hit !== undefined) return hit;
  }
  try {
    const out = await fn(args, ctx);
    if (key) await cacheSet(key, out, ttl);
    return out;
  } catch (e) {
    if (e instanceof ToolError) throw e;
    throw new ToolError(e.status === 404 ? 404 : 502, e.message || String(e));
  }
}
