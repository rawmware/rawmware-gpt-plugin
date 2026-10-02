// Outbound HTTP with an SSRF guard. Anyone can hand the operator a URL, so it
// must never reach localhost, cloud metadata, or private networks — including
// via a redirect from a public host.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const UA = 'rawmware-operator/2.0 (+https://github.com/rawmware/rawmware-gpt-plugin)';
export const REPO = process.env.OPERATOR_REPO || 'rawmware/rawmware-gpt-plugin';
export const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main`;

function privateIp(ip) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    const m = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? privateIp(m[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error(`invalid URL: ${raw}`); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('only http(s) URLs are allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) throw new Error('private host blocked');
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
  if (ips.some(privateIp)) throw new Error('private address blocked');
  return u;
}

// fetch() that follows redirects manually so every hop is re-checked.
export async function http(url, opts = {}) {
  const { timeout = 15000, guard = true, ...init } = opts;
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    if (guard) await assertPublicUrl(current);
    const res = await fetch(current, {
      ...init,
      redirect: 'manual',
      headers: { 'user-agent': UA, ...(init.headers || {}) },
      signal: AbortSignal.timeout(timeout),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).href;
      continue;
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`${res.status} ${res.statusText} — ${current}${detail ? ` — ${detail}` : ''}`);
    }
    return res;
  }
  throw new Error(`too many redirects — ${url}`);
}

// Trusted first-party APIs (GitHub, Vercel, OpenAI) skip DNS checks for speed.
export const api = (url, opts = {}) => http(url, { ...opts, guard: false });
