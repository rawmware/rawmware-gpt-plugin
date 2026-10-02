// Best-effort per-IP limiter (per warm instance). Stops one client from
// burning the shared GitHub/search quota for everyone. Owner is exempt.
const WINDOW_MS = 60_000;
const LIMIT = Number(process.env.RATE_LIMIT_PER_MIN || 60);
const hits = new Map();

export function clientIp(headers = {}) {
  return (headers['x-forwarded-for'] || '').split(',')[0].trim() || headers['x-real-ip'] || 'unknown';
}

export function allow(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.delete(hits.keys().next().value);
  return true;
}
