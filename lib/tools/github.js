import { api, readText, pool, deadline } from '../net.js';
import { cap, pick, compact, day, logErrors } from '../compress.js';
import { cacheGet, cacheSet } from '../cache.js';

// GitHub REST with the caller's token (their private repos) or the server's
// (public reads). GETs use ETags: a 304 doesn't count against the rate limit,
// so repeat reads are free and instant.
export async function gh(path, opts = {}, ctx = {}) {
  const token = ctx.github || null;
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(opts.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.body) headers['content-type'] = 'application/json';
  const get = !opts.method || opts.method === 'GET';
  const key = get && !opts.raw ? `gh:${ctx.ident || 'public'}:${path}` : null;
  const prior = key ? await cacheGet(key) : undefined;
  if (prior?.etag) headers['if-none-match'] = prior.etag;
  let r;
  try {
    r = await api(`https://api.github.com${path}`, { ...opts, headers, timeout: opts.timeout || 12000 });
  } catch (e) {
    if ((e.status === 403 || e.status === 429) && e.headers?.get('x-ratelimit-remaining') === '0') {
      const reset = new Date(Number(e.headers.get('x-ratelimit-reset')) * 1000).toISOString().slice(11, 16);
      throw new Error(`GitHub rate limit hit (resets ${reset} UTC). ${ctx.userGithub ? '' : 'Connect your own GitHub (x-github-token or GPT sign-in) for 5,000 req/hr.'}`);
    }
    if (e.status === 404 && !ctx.userGithub) throw new Error(`${e.message.split(' — ')[0]}: not found, or private (connect GitHub to read your private repos)`);
    throw e;
  }
  if (r.status === 304 && prior) return prior.data;
  if (opts.raw) return readText(r);
  const data = r.status === 204 ? {} : await r.json();
  if (key && r.headers.get('etag')) await cacheSet(key, { etag: r.headers.get('etag'), data }, 3600);
  return data;
}

const b64 = (s) => Buffer.from(s, 'base64').toString('utf8');
const need = (v, name) => { if (v === undefined || v === null || v === '') throw new Error(`${name} is required`); return v; };
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

// "10-80" → numbered slice. Reading 70 lines beats reading 2,000.
function sliceLines(text, lines) {
  if (!lines) return text;
  const [a, b] = String(lines).split('-').map(Number);
  const all = text.split('\n');
  const start = Math.max(1, a || 1);
  const end = Math.min(all.length, b || start + 100);
  return all.slice(start - 1, end).map((l, i) => `${start + i}\t${l}`).join('\n') + `\n[lines ${start}-${end} of ${all.length}]`;
}

async function readFile(repo, path, ref, ctx) {
  const r = await gh(`/repos/${repo}/contents/${enc(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`, {}, ctx);
  if (Array.isArray(r)) return { dir: true, entries: r.map((e) => (e.type === 'dir' ? `${e.name}/` : e.name)) };
  if (r.encoding === 'base64' && r.content) return { text: b64(r.content), size: r.size };
  // >1MB files: raw media type.
  return { text: await gh(`/repos/${repo}/contents/${enc(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`, { raw: true, headers: { accept: 'application/vnd.github.raw' } }, ctx), size: r.size };
}

async function tree(repo, ref, ctx) {
  const r = await gh(`/repos/${repo}/git/trees/${encodeURIComponent(ref || 'HEAD')}?recursive=1`, {}, ctx);
  return { files: r.tree.filter((t) => t.type === 'blob'), truncated: r.truncated };
}

const TEXT_EXT = /\.(m?[jt]sx?|cjs|mts|cts|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|scala|ex|exs|erl|clj|lua|dart|vue|svelte|astro|html?|css|scss|sass|less|json|ya?ml|toml|ini|env\.example|md|mdx|txt|sql|graphql|gql|prisma|proto|sh|bash|zsh|ps1|dockerfile|tf|hcl|gradle|xml|cfg|conf)$/i;
const SKIP_DIR = /(^|\/)(node_modules|dist|build|out|\.next|vendor|coverage|\.git|target|__pycache__|\.venv|venv)\//;

// Grep a repo without cloning: pick candidate files from the tree, fetch them
// in parallel, return file:line matches. Works on any branch, public or private.
async function grep({ repo, query, path = '', ref, ext, limit = 60 }, ctx) {
  need(query, 'query');
  const budget = deadline(22000);
  const { files } = await tree(repo, ref, ctx);
  let re;
  try { re = new RegExp(query, 'i'); } catch { re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
  const extRe = ext ? new RegExp(`\\.(${ext.replace(/[^\w,|]/g, '').replace(/,/g, '|')})$`, 'i') : TEXT_EXT;
  const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const candidates = files
    .filter((f) => f.path.startsWith(path) && extRe.test(f.path) && !SKIP_DIR.test(f.path) && (f.size || 0) < 300_000 && !/\.(min\.js|lock)$|lock\.json$/.test(f.path))
    .sort((a, b) => (words.some((w) => b.path.toLowerCase().includes(w)) ? 1 : 0) - (words.some((w) => a.path.toLowerCase().includes(w)) ? 1 : 0) || a.size - b.size)
    .slice(0, 150);
  const hits = [];
  let scanned = 0;
  await pool(candidates, 12, async (f) => {
    if (budget.over() || hits.length >= limit) return;
    // raw CDN first: no API rate limit. Private repos 404 there → API with token.
    let text;
    try {
      text = await readText(await api(`https://raw.githubusercontent.com/${repo}/${ref || 'HEAD'}/${enc(f.path)}`, { timeout: 8000 }), 400_000);
    } catch (e) {
      if (e.status !== 404 || !ctx.github) throw e;
      text = (await readFile(repo, f.path, ref, ctx)).text;
    }
    scanned++;
    text.split('\n').forEach((line, i) => {
      if (hits.length < limit && re.test(line)) hits.push(`${f.path}:${i + 1}: ${line.trim().slice(0, 200)}`);
    });
  });
  return compact({ repo, query, scanned, candidates: candidates.length, matches: hits, partial: budget.over() || undefined, tip: hits.length ? undefined : 'No matches: try a broader regex, another path, or ext.' });
}

const FRAMEWORKS = [
  ['next', 'Next.js'], ['nuxt', 'Nuxt'], ['@sveltejs/kit', 'SvelteKit'], ['astro', 'Astro'], ['@remix-run/react', 'Remix'], ['react-router', 'React Router'],
  ['vite', 'Vite'], ['react', 'React'], ['vue', 'Vue'], ['express', 'Express'], ['hono', 'Hono'], ['fastify', 'Fastify'], ['@nestjs/core', 'NestJS'],
  ['tailwindcss', 'Tailwind'], ['prisma', 'Prisma'], ['drizzle-orm', 'Drizzle'], ['@supabase/supabase-js', 'Supabase'], ['convex', 'Convex'],
  ['stripe', 'Stripe'], ['openai', 'OpenAI SDK'], ['@anthropic-ai/sdk', 'Anthropic SDK'], ['ai', 'Vercel AI SDK'], ['@modelcontextprotocol/sdk', 'MCP SDK'],
  ['electron', 'Electron'], ['expo', 'Expo'], ['react-native', 'React Native'], ['vitest', 'Vitest'], ['jest', 'Jest'], ['@playwright/test', 'Playwright'],
  ['typescript', 'TypeScript'], ['eslint', 'ESLint'], ['@biomejs/biome', 'Biome'],
];
const PY_FRAMEWORKS = [['django', 'Django'], ['fastapi', 'FastAPI'], ['flask', 'Flask'], ['pytest', 'pytest'], ['openai', 'OpenAI SDK'], ['anthropic', 'Anthropic SDK'], ['langchain', 'LangChain'], ['torch', 'PyTorch'], ['pandas', 'pandas']];

// One call that answers "what is this repo and what's wrong with it?"
async function audit(repo, ctx) {
  const [r, t, runs] = await Promise.all([
    gh(`/repos/${repo}`, {}, ctx),
    tree(repo, null, ctx).catch(() => ({ files: [] })),
    gh(`/repos/${repo}/actions/runs?per_page=6`, {}, ctx).catch(() => ({ workflow_runs: [] })),
  ]);
  const files = t.files.map((f) => f.path);
  const has = (re) => files.some((f) => re.test(f));
  const manifests = files.filter((f) => /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|Cargo\.toml|go\.mod)$/.test(f) && !SKIP_DIR.test(f)).slice(0, 3);
  const texts = await pool(manifests, 3, (p) => readFile(repo, p, null, ctx).then((x) => x.text));
  const stack = new Set();
  let scripts, engines;
  manifests.forEach((m, i) => {
    if (!texts[i].ok) return;
    const txt = texts[i].value;
    if (m.endsWith('package.json')) {
      try {
        const pkg = JSON.parse(txt);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        FRAMEWORKS.filter(([d]) => deps[d]).forEach(([, n]) => stack.add(n));
        if (m === 'package.json') { scripts = pkg.scripts; engines = pkg.engines; }
      } catch {}
    } else if (/requirements|pyproject/.test(m)) PY_FRAMEWORKS.filter(([d]) => new RegExp(`^\\s*["']?${d}\\b`, 'mi').test(txt)).forEach(([, n]) => stack.add(n));
    else if (m.endsWith('Cargo.toml')) stack.add('Rust');
    else if (m.endsWith('go.mod')) stack.add('Go');
  });
  const signals = {
    readme: has(/^readme/i), license: has(/^licen[cs]e/i),
    tests: has(/(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$|(^|\/)test_[^/]*\.py$/i),
    ci: has(/^\.github\/workflows\//), env_example: has(/\.env\.(example|sample|template)$/),
    lockfile: has(/(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|poetry\.lock|uv\.lock|Cargo\.lock|go\.sum)$/),
    typescript: has(/tsconfig\.json$/), docker: has(/Dockerfile$/), linter: has(/(eslint\.config|\.eslintrc|biome\.json|ruff\.toml|\.prettierrc)/),
    secrets_committed: has(/(^|\/)\.env(\.local|\.production)?$/), agents_md: has(/(^|\/)(AGENTS|CLAUDE)\.md$/),
  };
  const gaps = [];
  if (signals.secrets_committed) gaps.push('🔴 A .env file is committed: rotate those secrets, then git rm --cached it.');
  const failing = runs.workflow_runs.filter((w) => w.conclusion === 'failure');
  if (failing.length) gaps.push(`🔴 ${failing.length}/${runs.workflow_runs.length} recent CI runs failed (latest: "${failing[0].name}" run ${failing[0].id}). Use op:run_logs.`);
  if (!signals.tests) gaps.push('🟠 No tests detected.');
  if (!signals.ci) gaps.push('🟠 No CI workflow.');
  if (manifests.length && !signals.lockfile) gaps.push('🟠 No lockfile: builds are not reproducible.');
  if (!signals.readme) gaps.push('🟡 No README.');
  if (!signals.license) gaps.push('🟡 No LICENSE: others can’t legally reuse it.');
  if (!signals.linter) gaps.push('🟡 No linter/formatter config.');
  if (!signals.agents_md) gaps.push('🟡 No AGENTS.md/CLAUDE.md: coding agents start without project context.');
  if (manifests.length) gaps.push(`ℹ️ Run deps op:audit repo:${repo} for vulnerable/outdated packages.`);
  return compact({
    ...pick(r, ['full_name', 'description', 'default_branch', 'private', 'stargazers_count', 'open_issues_count', 'topics']),
    pushed: day(r.pushed_at),
    files: files.length,
    top_dirs: [...new Set(files.filter((f) => f.includes('/') && !SKIP_DIR.test(f)).map((f) => f.split('/')[0]))].slice(0, 20),
    stack: [...stack],
    scripts: scripts ? Object.fromEntries(Object.entries(scripts).slice(0, 12)) : undefined,
    engines,
    manifests,
    signals,
    ci: runs.workflow_runs.map((w) => `${w.name}: ${w.conclusion || w.status} (${w.head_branch}, ${day(w.created_at)}, id ${w.id})`),
    gaps,
  });
}

// PR in one call: metadata, per-file patches (capped), CI status, review state.
async function prDetail(repo, number, ctx) {
  const [p, files, reviews] = await Promise.all([
    gh(`/repos/${repo}/pulls/${number}`, {}, ctx),
    gh(`/repos/${repo}/pulls/${number}/files?per_page=100`, {}, ctx),
    gh(`/repos/${repo}/pulls/${number}/reviews?per_page=30`, {}, ctx).catch(() => []),
  ]);
  const checks = await gh(`/repos/${repo}/commits/${p.head.sha}/check-runs?per_page=50`, {}, ctx).catch(() => ({ check_runs: [] }));
  let budget = 14000;
  return compact({
    title: p.title, state: p.merged ? 'merged' : p.state, draft: p.draft || undefined, author: p.user.login,
    base: p.base.ref, head: p.head.ref, mergeable: p.mergeable_state,
    body: cap(p.body || '', 1200),
    stats: `${p.commits} commits, ${p.changed_files} files, +${p.additions}/-${p.deletions}`,
    checks: checks.check_runs.map((c) => `${c.name}: ${c.conclusion || c.status}`),
    reviews: reviews.filter((r) => r.state !== 'COMMENTED' || r.body).map((r) => `${r.user.login}: ${r.state}${r.body ? ` — ${r.body.slice(0, 160)}` : ''}`),
    files: files.map((f) => {
      const patch = f.patch && budget > 0 ? cap(f.patch, Math.min(2500, budget)) : undefined;
      budget -= patch?.length || 0;
      return compact({ file: f.filename, status: f.status, change: `+${f.additions}/-${f.deletions}`, patch: patch || (f.patch ? '[patch omitted: budget]' : undefined) });
    }),
  });
}

async function compare(repo, base, head, ctx) {
  const c = await gh(`/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`, {}, ctx);
  let budget = 12000;
  return compact({
    status: c.status, ahead: c.ahead_by, behind: c.behind_by,
    commits: c.commits.slice(-30).map((x) => `${x.sha.slice(0, 7)} ${x.commit.message.split('\n')[0]}`),
    files: (c.files || []).slice(0, 60).map((f) => {
      const patch = f.patch && budget > 0 ? cap(f.patch, Math.min(1500, budget)) : undefined;
      budget -= patch?.length || 0;
      return compact({ file: f.filename, status: f.status, change: `+${f.additions}/-${f.deletions}`, patch });
    }),
  });
}

// Why did CI fail? Failed jobs → failed steps → error lines with context.
async function runLogs(repo, runId, ctx) {
  if (!runId) {
    const r = await gh(`/repos/${repo}/actions/runs?status=failure&per_page=1`, {}, ctx);
    runId = r.workflow_runs[0]?.id;
    if (!runId) return { repo, note: 'No failed workflow runs found.' };
  }
  const [run, jobs] = await Promise.all([gh(`/repos/${repo}/actions/runs/${runId}`, {}, ctx), gh(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=50`, {}, ctx)]);
  const failed = jobs.jobs.filter((j) => j.conclusion === 'failure' || j.conclusion === 'timed_out').slice(0, 3);
  const logs = await pool(failed, 3, async (j) => {
    if (!ctx.github) return { job: j.name, note: 'Log download needs a GitHub token.' };
    const text = await gh(`/repos/${repo}/actions/jobs/${j.id}/logs`, { raw: true }, ctx);
    return { job: j.name, failed_steps: j.steps.filter((s) => s.conclusion === 'failure').map((s) => s.name), ...logErrors(text) };
  });
  return compact({
    run: runId, workflow: run.name, branch: run.head_branch, commit: `${run.head_sha.slice(0, 7)} ${run.head_commit?.message?.split('\n')[0] || ''}`, event: run.event, at: day(run.created_at),
    jobs: jobs.jobs.map((j) => `${j.name}: ${j.conclusion || j.status}`),
    failures: logs.map((l, i) => (l.ok ? l.value : { job: failed[i].name, error: l.error.message.slice(0, 200) })),
  });
}

export async function github(args, ctx = {}) {
  const { op, repo, path = '', paths, query, ref, lines, number, base, head, run_id, limit = 20, state = 'open', user } = args;
  const L = Math.min(limit, 50);
  const R = () => need(repo, 'repo');
  switch (op) {
    case 'audit': return audit(R(), ctx);
    case 'repo': {
      const r = await gh(`/repos/${R()}`, {}, ctx);
      return compact({ ...pick(r, ['full_name', 'description', 'homepage', 'language', 'stargazers_count', 'forks_count', 'open_issues_count', 'default_branch', 'topics', 'private', 'archived']), license: r.license?.spdx_id, pushed: day(r.pushed_at) });
    }
    case 'tree': {
      const t = await tree(R(), ref, ctx);
      const files = t.files.filter((f) => f.path.startsWith(path) && !SKIP_DIR.test(f.path)).map((f) => f.path);
      return compact({ repo, count: files.length, files: files.slice(0, 500), truncated: files.length > 500 || t.truncated || undefined });
    }
    case 'file': {
      // Batch: up to 10 files in one call.
      const list = paths?.length ? paths.slice(0, 10) : [need(path, 'path')];
      const per = list.length > 1 ? Math.floor(30000 / list.length) : 14000;
      const res = await pool(list, 10, async (p) => {
        const f = await readFile(R(), p, ref, ctx);
        return f.dir ? { path: p, entries: f.entries } : { path: p, size: f.size, content: cap(sliceLines(f.text, list.length === 1 ? lines : undefined), per) };
      });
      const out = res.map((r, i) => (r.ok ? r.value : { path: list[i], error: r.error.message.slice(0, 160) }));
      return list.length === 1 ? out[0] : { files: out };
    }
    case 'readme': {
      const r = await gh(`/repos/${R()}/readme`, {}, ctx);
      return { content: cap(b64(r.content), 8000) };
    }
    case 'grep': return grep({ repo: R(), query, path, ref, ext: args.ext, limit: L * 3 }, ctx);
    case 'commits': {
      const r = await gh(`/repos/${R()}/commits?per_page=${L}${ref ? `&sha=${encodeURIComponent(ref)}` : ''}${path ? `&path=${encodeURIComponent(path)}` : ''}`, {}, ctx);
      return r.map((c) => `${c.sha.slice(0, 7)} ${day(c.commit.author.date)} ${c.commit.author.name}: ${c.commit.message.split('\n')[0]}`);
    }
    case 'compare': return compare(R(), need(base, 'base'), need(head, 'head'), ctx);
    case 'issues': {
      const q = query ? `/search/issues?q=${encodeURIComponent(`repo:${repo} ${query}`)}&per_page=${L}` : `/repos/${R()}/issues?state=${state}&per_page=${L}`;
      const r = await gh(q, {}, ctx);
      return (r.items || r).map((i) => compact({ n: i.number, title: i.title, state: state !== 'open' || query ? i.state : undefined, pr: i.pull_request ? true : undefined, labels: i.labels.map((l) => l.name), comments: i.comments || undefined, updated: day(i.updated_at) }));
    }
    case 'issue': {
      const [i, comments] = await Promise.all([gh(`/repos/${R()}/issues/${need(number, 'number')}`, {}, ctx), gh(`/repos/${repo}/issues/${number}/comments?per_page=30`, {}, ctx)]);
      return compact({ title: i.title, state: i.state, author: i.user.login, labels: i.labels.map((l) => l.name), body: cap(i.body || '', 4000), comments: comments.map((c) => `${c.user.login} (${day(c.created_at)}): ${cap(c.body, 600)}`) });
    }
    case 'prs': {
      const r = await gh(`/repos/${R()}/pulls?state=${state}&per_page=${L}`, {}, ctx);
      return r.map((p) => compact({ n: p.number, title: p.title, head: p.head.ref, draft: p.draft || undefined, user: p.user.login, updated: day(p.updated_at) }));
    }
    case 'pr': return prDetail(R(), need(number, 'number'), ctx);
    case 'runs': {
      const r = await gh(`/repos/${R()}/actions/runs?per_page=${L}${ref ? `&branch=${encodeURIComponent(ref)}` : ''}`, {}, ctx);
      return r.workflow_runs.map((w) => compact({ id: w.id, name: w.name, branch: w.head_branch, status: w.status, conclusion: w.conclusion, at: day(w.created_at) }));
    }
    case 'run_logs': return runLogs(R(), run_id, ctx);
    case 'releases': {
      const r = await gh(`/repos/${R()}/releases?per_page=${Math.min(L, 10)}`, {}, ctx);
      return r.map((x) => compact({ tag: x.tag_name, name: x.name, at: day(x.published_at), notes: cap(x.body || '', 800) }));
    }
    case 'search_repos': {
      const r = await gh(`/search/repositories?q=${encodeURIComponent(need(query, 'query'))}&per_page=${L}`, {}, ctx);
      return r.items.map((x) => compact({ ...pick(x, ['full_name', 'description', 'stargazers_count', 'language']), pushed: day(x.pushed_at) }));
    }
    case 'search_code': {
      if (!ctx.github) throw new Error('search_code needs a GitHub token; use op:grep for a single repo');
      const r = await gh(`/search/code?q=${encodeURIComponent(need(query, 'query'))}&per_page=${L}`, { headers: { accept: 'application/vnd.github.text-match+json' } }, ctx);
      return r.items.map((x) => compact({ file: `${x.repository.full_name}/${x.path}`, match: x.text_matches?.[0]?.fragment?.slice(0, 200) }));
    }
    case 'user': {
      const login = need(user || repo?.split('/')[0], 'user');
      const [u, repos] = await Promise.all([gh(`/users/${login}`, {}, ctx), gh(`/users/${login}/repos?sort=pushed&per_page=${L}`, {}, ctx)]);
      return {
        ...pick(u, ['login', 'name', 'bio', 'blog', 'location', 'followers', 'public_repos']),
        repos: repos.filter((x) => !x.fork).map((x) => compact({ name: x.name, desc: x.description?.slice(0, 120), lang: x.language, stars: x.stargazers_count || undefined, site: x.homepage || undefined, pushed: day(x.pushed_at) })),
      };
    }
    default:
      throw new Error(`unknown github op: ${op}`);
  }
}

// ───────────────────── WRITE (acts as the caller) ─────────────────────
// With the user's own token, GitHub's permissions are the guardrail. With the
// server token (owner), only allowlisted repos.
function assertWritable(repo, ctx) {
  if (ctx.userGithub) return;
  const allow = (process.env.GITHUB_WRITE_REPOS || 'rawmware/*').split(',').map((s) => s.trim());
  if (!allow.some((a) => a === repo || (a.endsWith('/*') && repo.startsWith(a.slice(0, -1))))) throw new Error(`repo ${repo} is not in GITHUB_WRITE_REPOS`);
}

// Commit N files to a branch and open (or update) a PR, in one call.
// Re-running with the same branch adds a commit and reuses the open PR, so
// iterating on a fix is cheap.
async function commitPr({ repo, branch, base, title, body = '', files = [], message, draft }, ctx) {
  need(branch, 'branch');
  if (!files.length) throw new Error('files[] is required');
  base = base || (await gh(`/repos/${repo}`, {}, ctx)).default_branch;
  const existing = await gh(`/repos/${repo}/git/ref/heads/${enc(branch)}`, { method: 'GET' }, ctx).catch(() => null);
  const parentSha = existing?.object?.sha || (await gh(`/repos/${repo}/git/ref/heads/${enc(base)}`, { method: 'GET' }, ctx)).object.sha;
  const baseTree = (await gh(`/repos/${repo}/git/commits/${parentSha}`, {}, ctx)).tree.sha;
  const t = await gh(`/repos/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTree, tree: files.map((f) => (f.delete ? { path: f.path, mode: '100644', type: 'blob', sha: null } : { path: f.path, mode: '100644', type: 'blob', content: f.content ?? '' })) }),
  }, ctx);
  const commit = await gh(`/repos/${repo}/git/commits`, { method: 'POST', body: JSON.stringify({ message: message || title || `Update ${files.length} file(s)`, tree: t.sha, parents: [parentSha] }) }, ctx);
  if (existing) await gh(`/repos/${repo}/git/refs/heads/${enc(branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) }, ctx);
  else await gh(`/repos/${repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }) }, ctx);
  const owner = repo.split('/')[0];
  const open = await gh(`/repos/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open`, { method: 'GET' }, ctx);
  const pr = open[0] || (await gh(`/repos/${repo}/pulls`, { method: 'POST', body: JSON.stringify({ title: need(title, 'title'), body, head: branch, base, draft: !!draft }) }, ctx));
  return { pr: pr.html_url, number: pr.number, branch, commit: commit.sha.slice(0, 7), updated_existing: !!existing || undefined, files: files.map((f) => f.path) };
}

export async function github_write(args, ctx = {}) {
  const { op, repo, number, title, body, labels, event = 'COMMENT' } = args;
  assertWritable(need(repo, 'repo'), ctx);
  switch (op) {
    case 'pr':
    case 'commit':
      return commitPr(args, ctx);
    case 'issue': {
      const r = await gh(`/repos/${repo}/issues`, { method: 'POST', body: JSON.stringify({ title: need(title, 'title'), body, labels }) }, ctx);
      return { issue: r.html_url, number: r.number };
    }
    case 'comment': {
      const r = await gh(`/repos/${repo}/issues/${need(number, 'number')}/comments`, { method: 'POST', body: JSON.stringify({ body: need(body, 'body') }) }, ctx);
      return { comment: r.html_url };
    }
    case 'review': {
      // Submit a PR review: COMMENT, APPROVE or REQUEST_CHANGES, with inline comments.
      const comments = (args.comments || []).map((c) => ({ path: c.path, line: c.line, side: 'RIGHT', body: c.body }));
      const r = await gh(`/repos/${repo}/pulls/${need(number, 'number')}/reviews`, { method: 'POST', body: JSON.stringify({ body: body || '', event, comments }) }, ctx);
      return { review: r.html_url, state: r.state };
    }
    default:
      throw new Error(`unknown github_write op: ${op}`);
  }
}
