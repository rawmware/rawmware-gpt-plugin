// Two-tier cache. Tier 1: per-instance memory (free, survives warm starts).
// Tier 2: Upstash Redis over REST if configured (shared across instances).
// A cache hit costs zero upstream calls and returns in milliseconds, which is
// what makes "research the same thing twice" cheap.
const MAX = 500;
const mem = new Map();

const UP_URL = process.env.UPSTASH_REDIS_REST_URL;
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function upstash(cmd) {
  if (!UP_URL || !UP_TOKEN) return null;
  try {
    const r = await fetch(UP_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${UP_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(cmd),
      signal: AbortSignal.timeout(1500),
    });
    return (await r.json()).result ?? null;
  } catch {
    return null;
  }
}

export async function cacheGet(key) {
  const hit = mem.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  if (hit) mem.delete(key);
  const remote = await upstash(['GET', key]);
  if (remote == null) return undefined;
  try { return JSON.parse(remote); } catch { return undefined; }
}

export async function cacheSet(key, val, ttlSec) {
  if (!ttlSec) return;
  if (mem.size >= MAX) mem.delete(mem.keys().next().value);
  mem.set(key, { val, exp: Date.now() + ttlSec * 1000 });
  await upstash(['SET', key, JSON.stringify(val), 'EX', String(ttlSec)]);
}

export async function cached(key, ttlSec, fn) {
  const hit = await cacheGet(key);
  if (hit !== undefined) return hit;
  const val = await fn();
  await cacheSet(key, val, ttlSec);
  return val;
}

export function cacheClear() {
  mem.clear();
}
