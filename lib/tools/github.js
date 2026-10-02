import { api } from '../net.js';
import { cap, pick, compact, day } from '../compress.js';

export async function gh(path, opts = {}) {
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  if (opts.body) headers['content-type'] = 'application/json';
  const r = await api(`https://api.github.com${path}`, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  return r.status === 204 ? {} : r.json();
}

const b64 = (s) => Buffer.from(s, 'base64').toString('utf8');
const need = (v, name) => { if (!v) throw new Error(`${name} is required`); return v; };

// "10-80" → numbered slice. Reading 70 lines beats reading 2,000.
function sliceLines(text, lines) {
  if (!lines) return text;
  const [a, b] = String(lines).split('-').map(Number);
  const all = text.split('\n');
  const start = Math.max(1, a || 1);
  const end = Math.min(all.length, b || start + 100);
  return all.slice(start - 1, end).map((l, i) => `${start + i}\t${l}`).join('\n') + `\n[lines ${start}-${end} of ${all.length}]`;
}

const FRAMEWORKS = [
  ['next', 'Next.js'], ['nuxt', 'Nuxt'], ['@sveltejs/kit', 'SvelteKit'], ['astro', 'Astro'], ['@remix-run/react', 'Remix'],
  ['vite', 'Vite'], ['react', 'React'], ['vue', 'Vue'], ['express', 'Express'], ['hono', 'Hono'], ['fastify', 'Fastify'],
  ['tailwindcss', 'Tailwind'], ['prisma', 'Prisma'], ['drizzle-orm', 'Drizzle'], ['@supabase/supabase-js', 'Supabase'],
  ['stripe', 'Stripe'], ['openai', 'OpenAI SDK'], ['@anthropic-ai/sdk', 'Anthropic SDK'], ['ai', 'Vercel AI SDK'],
  ['@modelcontextprotocol/sdk', 'MCP SDK'], ['electron', 'Electron'], ['expo', 'Expo'], ['react-native', 'React Native'],
];

// One call that answers "what is this repo and what's wrong with it?"
// Replaces ~6 separate calls (repo, tree, readme, package.json, runs, issues).
async function audit(repo) {
  const [r, tree, runs] = await Promise.all([
    gh(`/repos/${repo}`),
    gh(`/repos/${repo}/git/trees/HEAD?recursive=1`).catch(() => ({ tree: [] })),
    gh(`/repos/${repo}/actions/runs?per_page=5`).catch(() => ({ workflow_runs: [] })),
  ]);
  const files = tree.tree.filter((t) => t.type === 'blob').map((t) => t.path);
  const has = (re) => files.some((f) => re.test(f));
  let pkg = null;
  if (files.includes('package.json')) {
    try { pkg = JSON.parse(b64((await gh(`/repos/${repo}/contents/package.json`)).content)); } catch {}
  }
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const stack = FRAMEWORKS.filter(([d]) => deps[d]).map(([, n]) => n);
  const langs = {};
  for (const f of files) {
    const ext = f.split('.').pop();
    if (ext && ext !== f && ext.length <= 5) langs[ext] = (langs[ext] || 0) + 1;
  }
  const signals = {
    readme: has(/^readme/i), license: has(/^licen[cs]e/i), tests: has(/(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[jt]sx?$|_test\.(go|py)$|test_.*\.py$/i),
    ci: has(/^\.github\/workflows\//), env_example: has(/\.env\.(example|sample)$/), lockfile: has(/(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|poetry\.lock|uv\.lock)$/),
    typescript: has(/tsconfig\.json$/), docker: has(/Dockerfile$/), vercel: has(/^vercel\.json$/), secrets_committed: has(/(^|\/)\.env$/),
  };
  const gaps = [];
  if (!signals.readme) gaps.push('No README: nobody can tell what this is in 5 seconds.');
  if (!signals.license) gaps.push('No LICENSE: others legally can’t reuse it.');
  if (!signals.tests) gaps.push('No tests detected.');
  if (!signals.ci) gaps.push('No CI workflow.');
  if (signals.secrets_committed) gaps.push('A .env file is committed. Rotate those secrets now.');
  if (pkg && !signals.lockfile) gaps.push('No lockfile: builds are not reproducible.');
  if (!r.description) gaps.push('No repo description: hurts discoverability.');
  if (!r.topics?.length) gaps.push('No topics: invisible in GitHub search.');
  const failing = runs.workflow_runs.filter((w) => w.conclusion === 'failure');
  if (failing.length) gaps.push(`${failing.length}/5 recent CI runs failed (latest: ${failing[0].name}).`);
  return compact({
    ...pick(r, ['full_name', 'description', 'homepage', 'default_branch', 'stargazers_count', 'forks_count', 'open_issues_count', 'topics']),
    pushed: day(r.pushed_at),
    files: files.length,
    top_dirs: [...new Set(files.filter((f) => f.includes('/')).map((f) => f.split('/')[0]))].slice(0, 20),
    langs: Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([e, n]) => `${e}:${n}`),
    stack,
    scripts: pkg?.scripts ? Object.keys(pkg.scripts) : undefined,
    signals,
    ci: runs.workflow_runs.map((w) => `${w.name}: ${w.conclusion || w.status} (${day(w.created_at)})`),
    gaps,
  });
}

export async function github({ op, repo, path = '', query, ref, lines, limit = 20, state = 'open', user }) {
  limit = Math.min(limit, 50);
  const R = () => need(repo, 'repo');
  switch (op) {
    case 'repo': {
      const r = await gh(`/repos/${R()}`);
      return { ...pick(r, ['full_name', 'description', 'homepage', 'language', 'stargazers_count', 'forks_count', 'open_issues_count', 'default_branch', 'topics', 'license']), license: r.license?.spdx_id, pushed: day(r.pushed_at) };
    }
    case 'audit':
      return audit(R());
    case 'tree': {
      const r = await gh(`/repos/${R()}/git/trees/${ref || 'HEAD'}?recursive=1`);
      const files = r.tree.filter((t) => t.type === 'blob' && t.path.startsWith(path)).map((t) => t.path);
      return { repo, count: files.length, files: files.slice(0, 400), truncated: files.length > 400 || undefined };
    }
    case 'file': {
      const r = await gh(`/repos/${R()}/contents/${path}${ref ? `?ref=${ref}` : ''}`);
      if (Array.isArray(r)) return { dir: path, entries: r.map((e) => (e.type === 'dir' ? `${e.name}/` : e.name)) };
      const text = r.encoding === 'base64' ? b64(r.content) : await (await api(r.download_url)).text();
      return { path, size: r.size, content: cap(sliceLines(text, lines), 12000) };
    }
    case 'readme': {
      const r = await gh(`/repos/${R()}/readme`);
      return { content: cap(b64(r.content), 8000) };
    }
    case 'commits': {
      const r = await gh(`/repos/${R()}/commits?per_page=${limit}${ref ? `&sha=${ref}` : ''}${path ? `&path=${encodeURIComponent(path)}` : ''}`);
      return r.map((c) => `${c.sha.slice(0, 7)} ${day(c.commit.author.date)} ${c.commit.message.split('\n')[0]}`);
    }
    case 'issues': {
      const r = await gh(`/repos/${R()}/issues?state=${state}&per_page=${limit}`);
      return r.map((i) => compact({ n: i.number, title: i.title, pr: i.pull_request ? true : undefined, labels: i.labels.map((l) => l.name), comments: i.comments || undefined }));
    }
    case 'prs': {
      const r = await gh(`/repos/${R()}/pulls?state=${state}&per_page=${limit}`);
      return r.map((p) => compact({ n: p.number, title: p.title, head: p.head.ref, draft: p.draft || undefined, user: p.user.login, updated: day(p.updated_at) }));
    }
    case 'runs': {
      const r = await gh(`/repos/${R()}/actions/runs?per_page=${limit}`);
      return r.workflow_runs.map((w) => compact({ id: w.id, name: w.name, branch: w.head_branch, status: w.status, conclusion: w.conclusion, at: day(w.created_at) }));
    }
    case 'releases': {
      const r = await gh(`/repos/${R()}/releases?per_page=${Math.min(limit, 10)}`);
      return r.map((x) => compact({ tag: x.tag_name, name: x.name, at: day(x.published_at), notes: cap(x.body || '', 600) }));
    }
    case 'search_repos': {
      const r = await gh(`/search/repositories?q=${encodeURIComponent(need(query, 'query'))}&per_page=${limit}`);
      return r.items.map((x) => compact({ ...pick(x, ['full_name', 'description', 'stargazers_count', 'language']), pushed: day(x.pushed_at) }));
    }
    case 'search_code': {
      if (!process.env.GITHUB_TOKEN) throw new Error('search_code needs GITHUB_TOKEN on the server');
      const r = await gh(`/search/code?q=${encodeURIComponent(need(query, 'query'))}&per_page=${limit}`);
      return r.items.map((x) => `${x.repository.full_name}/${x.path}`);
    }
    case 'user': {
      const login = need(user || repo?.split('/')[0], 'user');
      const [u, repos] = await Promise.all([gh(`/users/${login}`), gh(`/users/${login}/repos?sort=pushed&per_page=${limit}`)]);
      return {
        ...pick(u, ['login', 'name', 'bio', 'blog', 'location', 'followers', 'public_repos']),
        repos: repos.filter((x) => !x.fork).map((x) => compact({ name: x.name, desc: x.description?.slice(0, 120), lang: x.language, stars: x.stargazers_count || undefined, site: x.homepage || undefined, pushed: day(x.pushed_at) })),
      };
    }
    default:
      throw new Error(`unknown github op: ${op}`);
  }
}

// ───────────────────── WRITE (owner key required) ─────────────────────
function assertWritable(repo) {
  const allow = (process.env.GITHUB_WRITE_REPOS || 'rawmware/*').split(',').map((s) => s.trim());
  const ok = allow.some((a) => a === repo || (a.endsWith('/*') && repo.startsWith(a.slice(0, -1))));
  if (!ok) throw new Error(`repo ${repo} is not in GITHUB_WRITE_REPOS`);
}

// Branch + commit N files + open PR, in one call, via the Git Data API.
async function openPr({ repo, branch, base, title, body = '', files = [], message }) {
  need(branch, 'branch'); need(title, 'title');
  if (!files.length) throw new Error('files[] is required');
  base = base || (await gh(`/repos/${repo}`)).default_branch;
  const baseSha = (await gh(`/repos/${repo}/git/ref/heads/${base}`)).object.sha;
  const baseTree = (await gh(`/repos/${repo}/git/commits/${baseSha}`)).tree.sha;
  const tree = await gh(`/repos/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseTree,
      tree: files.map((f) => (f.delete ? { path: f.path, mode: '100644', type: 'blob', sha: null } : { path: f.path, mode: '100644', type: 'blob', content: f.content ?? '' })),
    }),
  });
  const commit = await gh(`/repos/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message: message || title, tree: tree.sha, parents: [baseSha] }),
  });
  await gh(`/repos/${repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }) });
  const pr = await gh(`/repos/${repo}/pulls`, { method: 'POST', body: JSON.stringify({ title, body, head: branch, base }) });
  return { pr: pr.html_url, number: pr.number, branch, commit: commit.sha.slice(0, 7), files: files.map((f) => f.path) };
}

export async function github_write({ op, repo, number, title, body, labels, branch, base, files, message }) {
  if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN not configured on the server');
  assertWritable(need(repo, 'repo'));
  switch (op) {
    case 'pr':
      return openPr({ repo, branch, base, title, body, files, message });
    case 'issue': {
      const r = await gh(`/repos/${repo}/issues`, { method: 'POST', body: JSON.stringify({ title: need(title, 'title'), body, labels }) });
      return { issue: r.html_url, number: r.number };
    }
    case 'comment': {
      const r = await gh(`/repos/${repo}/issues/${need(number, 'number')}/comments`, { method: 'POST', body: JSON.stringify({ body: need(body, 'body') }) });
      return { comment: r.html_url };
    }
    default:
      throw new Error(`unknown github_write op: ${op}`);
  }
}
