// One pipeline for every surface (MCP, GPT Actions REST): auth → rate limit →
// cache → run → normalize errors. Keeps the two transports identical.
import { TOOLS, TTL } from './tools.js';
import { isOwner, needsOwner } from './auth.js';
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
  const owner = isOwner(headers);
  if (needsOwner(name, args) && !owner) {
    throw new ToolError(401, `${name}${args.op ? `:${args.op}` : ''} writes with the owner's credentials and needs OPERATOR_API_KEY. Ask the owner, or self-host: https://github.com/rawmware/rawmware-gpt-plugin`);
  }
  if (!owner && !allow(clientIp(headers))) throw new ToolError(429, 'rate limit: try again in a minute');

  // BYOK calls are never cached: results belong to that key's owner.
  const ttl = needsOwner(name, args) || headers['x-openai-key'] ? 0 : TTL[name] || 0;
  const key = ttl ? `t:${name}:${JSON.stringify(args)}` : null;
  if (key) {
    const hit = await cacheGet(key);
    if (hit !== undefined) return hit;
  }
  try {
    const out = await fn(args, { headers, owner });
    if (key) await cacheSet(key, out, ttl);
    return out;
  } catch (e) {
    if (e instanceof ToolError) throw e;
    throw new ToolError(502, e.message || String(e));
  }
}
