// Dependency intelligence: what's vulnerable, what's outdated, what's
// deprecated, for npm, PyPI, crates.io and Go. Vulnerabilities come from
// OSV.dev (keyless, aggregates GitHub advisories, PyPA, RustSec, Go vulndb).
// Lockfiles are preferred so versions are exact, not ranges.
import { api, readText, pool, deadline } from '../net.js';
import { compact, day } from '../compress.js';
import { gh } from './github.js';

const OSV_ECO = { npm: 'npm', pypi: 'PyPI', crates: 'crates.io', go: 'Go' };

// ───────── version helpers ─────────
const clean = (v) => String(v || '').trim().replace(/^[\^~>=<v\s]+/, '').split(/[\s,|]/)[0];
const parts = (v) => clean(v).split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
export function bump(cur, latest) {
  if (!cur || !latest) return null;
  const [a, b] = [parts(cur), parts(latest)];
  if (a[0] !== b[0]) return a[0] < b[0] ? 'major' : null;
  if (a[1] !== b[1]) return a[1] < b[1] ? 'minor' : null;
  if (a[2] !== b[2]) return a[2] < b[2] ? 'patch' : null;
  return null;
}
const cmp = (x, y) => { const [a, b] = [parts(x), parts(y)]; return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]; };

// ───────── manifest parsers → [{ name, version, exact, dev }] ─────────
export function parseManifest(file, text) {
  const out = [];
  const name = file.split('/').pop();
  if (name === 'package-lock.json') {
    const j = JSON.parse(text);
    if (j.packages) {
      for (const [k, v] of Object.entries(j.packages)) {
        const m = k.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)$/);
        if (m && v.version) out.push({ name: m[1], version: v.version, exact: true, dev: !!v.dev });
      }
    } else for (const [n, v] of Object.entries(j.dependencies || {})) out.push({ name: n, version: v.version, exact: true, dev: !!v.dev });
    return { ecosystem: 'npm', deps: out };
  }
  if (name === 'package.json') {
    const j = JSON.parse(text);
    for (const [dev, group] of [[false, j.dependencies], [true, j.devDependencies]]) {
      for (const [n, r] of Object.entries(group || {})) {
        if (/^(workspace|file|link|git|github|https?):|\//.test(r) && !/^\d/.test(r)) continue;
        if (r === '*' || r === 'latest') continue;
        out.push({ name: n, version: clean(r), exact: /^\d/.test(r), dev });
      }
    }
    return { ecosystem: 'npm', deps: out };
  }
  if (name === 'requirements.txt' || name.endsWith('.txt')) {
    for (const line of text.split('\n')) {
      const m = line.replace(/#.*/, '').trim().match(/^([A-Za-z0-9_.\-[\]]+?)\s*(==|>=|~=|<=|>)\s*([\w.*+-]+)/);
      if (m) out.push({ name: m[1].replace(/\[.*\]/, '').toLowerCase(), version: m[3], exact: m[2] === '==' });
    }
    return { ecosystem: 'pypi', deps: out };
  }
  if (name === 'pyproject.toml') {
    const arr = text.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m)?.[1] || '';
    for (const m of arr.matchAll(/["']([A-Za-z0-9_.\-]+)(?:\[[^\]]*\])?\s*(==|>=|~=|>|\^)?\s*([\w.*+-]*)/g)) out.push({ name: m[1].toLowerCase(), version: m[3] || undefined, exact: m[2] === '==' });
    const poetry = text.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(\n\[|$)/)?.[1] || '';
    for (const m of poetry.matchAll(/^([A-Za-z0-9_.\-]+)\s*=\s*(?:["']([^"']+)["']|\{[^}]*version\s*=\s*["']([^"']+)["'])/gm)) if (m[1] !== 'python') out.push({ name: m[1].toLowerCase(), version: clean(m[2] || m[3]), exact: false });
    return { ecosystem: 'pypi', deps: out };
  }
  if (name === 'Cargo.lock') {
    for (const m of text.matchAll(/\[\[package\]\]\s*name\s*=\s*"([^"]+)"\s*version\s*=\s*"([^"]+)"/g)) out.push({ name: m[1], version: m[2], exact: true });
    return { ecosystem: 'crates', deps: out };
  }
  if (name === 'Cargo.toml') {
    for (const sec of text.matchAll(/\[(?:dev-|build-)?dependencies\]([\s\S]*?)(?=\n\[|$)/g)) {
      for (const m of sec[1].matchAll(/^([A-Za-z0-9_\-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/gm)) out.push({ name: m[1], version: clean(m[2] || m[3]), exact: false });
    }
    return { ecosystem: 'crates', deps: out };
  }
  if (name === 'go.mod') {
    const body = text.replace(/\/\/.*$/gm, '');
    for (const m of body.matchAll(/^\s*(?:require\s+)?([a-z0-9.\-]+\.[a-z]{2,}\/[^\s]+)\s+(v[\d][^\s]*)/gim)) out.push({ name: m[1], version: m[2], exact: true, dev: /\/\/ indirect/.test(m[0]) });
    return { ecosystem: 'go', deps: out };
  }
  throw new Error(`unsupported manifest ${name}: use package.json/package-lock.json, requirements.txt, pyproject.toml, Cargo.toml/Cargo.lock, go.mod`);
}

// ───────── registry lookups ─────────
const goPath = (m) => m.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);

async function jsonCapped(url, max = 3_000_000) {
  const text = await readText(await api(url, { timeout: 8000, headers: { accept: 'application/json' } }), max);
  try { return JSON.parse(text); } catch { return { __prefix: text.slice(0, 300_000) }; }
}

export async function latest(eco, name) {
  if (eco === 'npm') {
    const m = await (await api(`https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`, { timeout: 8000 })).json();
    return compact({ latest: m.version, deprecated: m.deprecated, license: typeof m.license === 'string' ? m.license : m.license?.type, engines: m.engines?.node, repo: typeof m.repository === 'string' ? m.repository : m.repository?.url?.replace(/^git\+|\.git$/g, '') });
  }
  if (eco === 'pypi') {
    // /json lists every release; huge for popular packages. info comes first,
    // so a capped read + prefix regex is enough when the JSON is truncated.
    const j = await jsonCapped(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
    const info = j.info || {};
    const grab = (k) => info[k] ?? j.__prefix?.match(new RegExp(`"${k}":\\s*"([^"]*)"`))?.[1];
    return compact({ latest: grab('version'), requires_python: grab('requires_python'), license: grab('license')?.slice(0, 40), yanked: info.yanked || undefined });
  }
  if (eco === 'crates') {
    const j = await jsonCapped(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`);
    const c = j.crate || {};
    return compact({ latest: c.max_stable_version || c.newest_version || j.__prefix?.match(/"max_stable_version":"([^"]+)"/)?.[1], updated: day(c.updated_at), recent_downloads: c.recent_downloads });
  }
  if (eco === 'go') {
    const j = await (await api(`https://proxy.golang.org/${goPath(name)}/@latest`, { timeout: 8000 })).json();
    return compact({ latest: j.Version, updated: day(j.Time) });
  }
  throw new Error(`unknown ecosystem ${eco}`);
}

// OSV batch: one request for every dep, then details for the hits.
async function vulns(eco, deps, budget) {
  const withVersion = deps.filter((d) => d.version && /\d/.test(d.version));
  if (!withVersion.length) return [];
  const queries = withVersion.map((d) => ({ package: { name: d.name, ecosystem: OSV_ECO[eco] }, version: clean(d.version) }));
  const res = [];
  for (let i = 0; i < queries.length; i += 900) {
    const r = await (await api('https://api.osv.dev/v1/querybatch', { method: 'POST', timeout: Math.min(12000, budget.left()), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ queries: queries.slice(i, i + 900) }) })).json();
    res.push(...r.results);
  }
  const hits = withVersion.map((d, i) => ({ dep: d, ids: (res[i]?.vulns || []).map((v) => v.id) })).filter((h) => h.ids.length);
  const ids = [...new Set(hits.flatMap((h) => h.ids))].slice(0, 25);
  const details = new Map();
  await pool(ids, 8, async (id) => {
    if (budget.left() < 1500) return;
    details.set(id, await (await api(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, { timeout: 6000 })).json());
  });
  return hits.map(({ dep, ids: vids }) => {
    let fix = null;
    let severity;
    const summaries = [];
    for (const id of vids) {
      const v = details.get(id);
      if (!v) continue;
      severity = severity || v.database_specific?.severity || v.severity?.[0]?.score?.match(/CVSS:[\d.]+/)?.[0];
      if (summaries.length < 2 && v.summary) summaries.push(v.summary.slice(0, 120));
      for (const a of v.affected || []) {
        if (a.package?.name?.toLowerCase() !== dep.name.toLowerCase()) continue;
        for (const r of a.ranges || []) for (const e of r.events || []) if (e.fixed && cmp(e.fixed, dep.version) > 0 && (!fix || cmp(e.fixed, fix) < 0)) fix = e.fixed;
      }
    }
    const aliases = vids.map((id) => details.get(id)?.aliases?.find((a) => a.startsWith('CVE-')) || id);
    return compact({ name: dep.name, version: dep.version, dev: dep.dev || undefined, advisories: [...new Set(aliases)].slice(0, 5), count: vids.length, severity, summary: summaries.join(' | ') || undefined, fix: fix ? `>= ${fix}` : 'no fixed version listed' });
  });
}

async function findManifest(repo, ctx) {
  const t = await gh(`/repos/${repo}/git/trees/HEAD?recursive=1`, {}, ctx);
  const paths = t.tree.filter((x) => x.type === 'blob').map((x) => x.path).filter((p) => !/node_modules|vendor\//.test(p));
  const prefer = ['package-lock.json', 'package.json', 'Cargo.lock', 'Cargo.toml', 'go.mod', 'requirements.txt', 'pyproject.toml'];
  for (const p of prefer) if (paths.includes(p)) return p;
  const nested = paths.filter((p) => prefer.includes(p.split('/').pop())).sort((a, b) => a.split('/').length - b.split('/').length);
  if (nested[0]) return nested[0];
  throw new Error(`no supported manifest found in ${repo}`);
}

async function readRepoFile(repo, path, ctx) {
  const r = await gh(`/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {}, ctx);
  if (r.content) return Buffer.from(r.content, 'base64').toString('utf8');
  return gh(`/repos/${repo}/contents/${path}`, { raw: true, headers: { accept: 'application/vnd.github.raw' } }, ctx);
}

export async function deps(args, ctx = {}) {
  const { op = 'audit', name, ecosystem = 'npm', repo, path, manifest, prod_only = false } = args;
  const budget = deadline(25000);
  if (op === 'info') {
    if (!name) throw new Error('name is required');
    const eco = ecosystem.toLowerCase();
    const info = await latest(eco, name);
    const extra = await Promise.allSettled([
      eco === 'npm' ? api(`https://api.npmjs.org/downloads/point/last-week/${name}`, { timeout: 6000 }).then((r) => r.json()) : null,
      eco === 'npm' ? api(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(name)}&size=1`, { timeout: 6000 }).then((r) => r.json()) : null,
      info.latest ? vulns(eco, [{ name, version: info.latest }], budget) : [],
    ]);
    const hit = extra[1].value?.objects?.[0]?.package;
    return compact({
      name, ecosystem: eco, ...info,
      published: hit?.name === name ? day(hit.date) : undefined,
      weekly_downloads: extra[0].value?.downloads,
      latest_vulns: extra[2].status === 'fulfilled' && extra[2].value.length ? extra[2].value : undefined,
    });
  }
  if (op !== 'audit') throw new Error(`unknown deps op: ${op}`);

  let file = path;
  let text = manifest;
  if (!text) {
    if (!repo) throw new Error('repo (owner/name) or manifest (file contents) is required');
    file = file || (await findManifest(repo, ctx));
    text = await readRepoFile(repo, file, ctx);
  }
  if (!file) file = args.filename || (ecosystem === 'pypi' ? 'requirements.txt' : ecosystem === 'crates' ? 'Cargo.toml' : ecosystem === 'go' ? 'go.mod' : 'package.json');
  let { ecosystem: eco, deps: list } = parseManifest(file, text);
  const total = list.length;
  if (prod_only) list = list.filter((d) => !d.dev);

  // Direct deps matter most for upgrades; a lockfile also lists transitives.
  let direct = list;
  if (file.endsWith('package-lock.json') && repo) {
    try {
      const pkg = JSON.parse(await readRepoFile(repo, file.replace('package-lock.json', 'package.json'), ctx));
      const names = new Set(Object.keys({ ...pkg.dependencies, ...(prod_only ? {} : pkg.devDependencies) }));
      direct = list.filter((d) => names.has(d.name));
    } catch {}
  }

  const [vulnRes, latestRes] = await Promise.all([
    vulns(eco, list, budget).catch((e) => ({ error: e.message })),
    pool(direct.slice(0, 80), 12, async (d) => (budget.left() > 2000 ? { d, info: await latest(eco, d.name) } : null)),
  ]);
  const outdated = { major: [], minor: [], patch: 0 };
  const deprecated = [];
  let checked = 0;
  for (const r of latestRes) {
    if (!r.ok || !r.value) continue;
    checked++;
    const { d, info } = r.value;
    if (info.deprecated) deprecated.push(`${d.name}@${d.version}: ${String(info.deprecated).slice(0, 100)}`);
    const kind = bump(d.version, info.latest);
    if (kind === 'major') outdated.major.push(`${d.name} ${d.version} → ${info.latest}${d.dev ? ' (dev)' : ''}`);
    else if (kind === 'minor') outdated.minor.push(`${d.name} ${d.version} → ${info.latest}`);
    else if (kind === 'patch') outdated.patch++;
  }
  const vulnList = Array.isArray(vulnRes) ? vulnRes.sort((a, b) => (/CRITICAL|HIGH/i.test(b.severity) ? 1 : 0) - (/CRITICAL|HIGH/i.test(a.severity) ? 1 : 0)) : [];
  return compact({
    repo, manifest: file, ecosystem: eco,
    deps: total, direct: direct.length, exact_versions: list.every((d) => d.exact) || undefined,
    note: list.some((d) => !d.exact) ? 'Some versions are ranges (no lockfile): vulnerability matching uses the range floor.' : undefined,
    vulnerable: vulnList.length ? vulnList : undefined,
    vuln_error: vulnRes.error,
    outdated: { major: outdated.major, minor: outdated.minor.slice(0, 15), minor_count: outdated.minor.length, patch_count: outdated.patch, checked },
    deprecated,
    partial: budget.over() || undefined,
  });
}
