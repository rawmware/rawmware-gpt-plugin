// Outbound HTTP: SSRF guard, capped body reads, deadlines, bounded concurrency.
// Anyone can hand the operator a URL, so it must never reach localhost, cloud
// metadata, or private networks, including via a redirect from a public host.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const UA = 'rawmware-operator/2.1 (+https://github.com/rawmware/rawmware-gpt-plugin)';
export const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
export const REPO = process.env.OPERATOR_REPO || 'rawmware/rawmware-gpt-plugin';
export const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main`;
const MAX_BYTES = 4 * 1024 * 1024;

function privateIp(ip) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    // IPv4-mapped: the URL parser normalizes ::ffff:127.0.0.1 to ::ffff:7f00:1.
    const dotted = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return privateIp(dotted[1]);
    const hex = v.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const [hi, lo] = [parseInt(hex[1], 16), parseInt(hex[2], 16)];
      return privateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return false;
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

// fetch() that follows redirects manually: every hop is re-checked, and
// credentials are dropped when a redirect leaves the origin (GitHub log
// downloads redirect to blob storage, which rejects foreign auth headers).
export async function http(url, opts = {}) {
  const { timeout = 12000, guard = true, hops, ...init } = opts;
  let current = url;
  let headers = { 'user-agent': UA, ...(init.headers || {}) };
  for (let hop = 0; hop < 6; hop++) {
    if (guard) await assertPublicUrl(current);
    const res = await fetch(current, { ...init, headers, redirect: 'manual', signal: AbortSignal.timeout(timeout) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = new URL(res.headers.get('location'), current).href;
      hops?.push({ status: res.status, url: current });
      if (new URL(next).origin !== new URL(current).origin) {
        headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !/^(authorization|x-api-key|cookie)$/i.test(k)));
      }
      if (init.method && init.method !== 'GET' && init.method !== 'HEAD' && res.status !== 307 && res.status !== 308) {
        init.method = 'GET';
        delete init.body;
      }
      current = next;
      continue;
    }
    if (!res.ok && res.status !== 304) {
      const detail = (await res.text().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ');
      const err = new Error(`${res.status} ${res.statusText} — ${current}${detail ? ` — ${detail}` : ''}`);
      err.status = res.status;
      err.headers = res.headers;
      throw err;
    }
    res.finalUrl = current;
    return res;
  }
  throw new Error(`too many redirects — ${url}`);
}

// Trusted first-party APIs (GitHub, Vercel, OpenAI, registries) skip DNS checks.
export const api = (url, opts = {}) => http(url, { ...opts, guard: false });

// Read a body but stop at maxBytes: a 40MB page must not OOM the function.
export async function readText(res, maxBytes = MAX_BYTES) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    chunks.push(value);
    if (size >= maxBytes) { await reader.cancel().catch(() => {}); break; }
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, maxBytes));
}

// Run fn over items with at most n in flight. Order preserved; failures returned, not thrown.
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = { ok: true, value: await fn(items[idx], idx) }; } catch (e) { out[idx] = { ok: false, error: e }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

// A time budget shared across steps so composite tools finish inside the
// platform limit and return partial results instead of timing out.
export function deadline(ms) {
  const end = Date.now() + ms;
  return { left: () => Math.max(0, end - Date.now()), over: () => Date.now() >= end };
}
