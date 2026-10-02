// Single source of truth for tool contracts. Drives the MCP server (ChatGPT
// Apps, Claude, Cursor, any MCP client) AND the OpenAPI spec for Custom GPT
// Actions. Descriptions are short on purpose: every client re-sends them to
// the model on every turn, so each word here is paid for thousands of times.

const s = (props, required = []) => ({ type: 'object', properties: props, required });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const int = (description) => ({ type: 'integer', description });
const bool = (description) => ({ type: 'boolean', description });
const strs = (description) => ({ type: 'array', items: { type: 'string' }, description });
const op = (ops, description = 'Operation') => str(description, { enum: ops });

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

export const SCHEMAS = {
  web_fetch: {
    description: 'Read URL(s) as clean markdown (code blocks kept). find = only matching lines. urls = up to 8 in parallel. mode llms = site llms.txt. Renders JS sites.',
    annotations: READ,
    input: s({
      url: str('URL'), urls: strs('Up to 8 URLs, fetched in parallel'), find: str('Keywords, comma-separated'),
      mode: op(['text', 'meta', 'links', 'llms'], 'Default text'), links: bool('Keep inline links'),
      offset: int('Char offset for paging'), max_chars: int('Default 6000'), render: op(['auto', 'always', 'never'], 'Default auto'),
    }),
  },
  web_search: {
    description: 'Web search with automatic provider fallback → titles, URLs, snippets.',
    annotations: READ,
    input: s({ query: str('Query'), site: str('Limit to a domain'), limit: int('Default 6') }, ['query']),
  },
  research: {
    description: 'Search + read top sources (one per domain) in parallel → condensed notes with URLs.',
    annotations: READ, widget: true,
    input: s({ query: str('Question'), depth: int('Sources, default 3, max 6'), find: str('Focus keywords'), site: str('Limit to a domain'), chars_per_source: int('Default 1500') }, ['query']),
  },
  github: {
    description: 'GitHub as the user (private repos if connected). audit, grep (regex across repo), file (paths[] batch, lines), pr (diff+CI+reviews), compare, run_logs (why CI failed), issues…',
    annotations: READ, widget: true,
    input: s({
      op: op(['audit', 'grep', 'file', 'tree', 'readme', 'pr', 'prs', 'compare', 'run_logs', 'runs', 'commits', 'issues', 'issue', 'releases', 'repo', 'search_repos', 'search_code', 'user']),
      repo: str('owner/name'), path: str('File path or dir prefix'), paths: strs('file: up to 10 paths'), lines: str('e.g. 1-120'),
      query: str('grep regex / search'), ext: str('grep: extensions, e.g. ts,tsx'), ref: str('Branch/sha'),
      number: int('PR/issue number'), base: str('compare base'), head: str('compare head'), run_id: int('run_logs: default latest failed'),
      state: op(['open', 'closed', 'all']), user: str('op=user login'), limit: int('Max items'),
    }, ['op']),
  },
  github_write: {
    description: 'Act as the user on GitHub. pr: commit files to a branch + open/update PR in one call. review (inline comments), issue, comment.',
    annotations: WRITE,
    input: s({
      op: op(['pr', 'review', 'issue', 'comment']), repo: str('owner/name'), title: str('PR/issue title'), body: str('Markdown'),
      branch: str('pr: branch (reused if it exists)'), base: str('pr: base, default repo default'), message: str('Commit message'), draft: bool('Draft PR'),
      files: { type: 'array', description: 'pr: full file contents', items: s({ path: str('Path'), content: str('Full content'), delete: bool('Delete file') }, ['path']) },
      number: int('PR/issue number'), event: op(['COMMENT', 'APPROVE', 'REQUEST_CHANGES'], 'review event'),
      comments: { type: 'array', description: 'review: inline comments', items: s({ path: str('File'), line: int('Line in new file'), body: str('Comment') }, ['path', 'line', 'body']) },
      labels: strs('Labels'),
    }, ['op', 'repo']),
  },
  vercel: {
    description: "Vercel with the user's token: projects, project, deployments, logs (no id = latest failed; errors first), env (keys only), domains, redeploy.",
    annotations: READ,
    input: s({
      op: op(['projects', 'project', 'deployments', 'logs', 'env', 'domains', 'redeploy']), project: str('Name or id'), deployment_id: str('Deployment id'),
      state: str('deployments filter: ERROR|READY|BUILDING'), target: op(['production', 'preview']), team: str('Team id or slug'), limit: int('Max items'),
    }, ['op']),
  },
  deps: {
    description: 'Dependency health (npm/PyPI/crates/Go): audit = vulnerabilities (OSV) + outdated + deprecated from a repo or pasted manifest; info = one package.',
    annotations: READ,
    input: s({
      op: op(['audit', 'info']), repo: str('owner/name (auto-finds lockfile/manifest)'), path: str('Manifest path in repo'),
      manifest: str('Or paste file contents'), filename: str('Name of pasted file, e.g. package-lock.json'),
      name: str('info: package'), ecosystem: op(['npm', 'pypi', 'crates', 'go']), prod_only: bool('Skip dev deps'),
    }),
  },
  libdocs: {
    description: 'Current, version-specific library docs (Context7 → llms.txt → official docs). Use before writing code against any library API.',
    annotations: READ,
    input: s({ library: str('e.g. next.js, stripe, /vercel/next.js'), topic: str('e.g. middleware, webhooks'), site: str('Docs domain if known'), max_chars: int('Default 6000') }, ['library']),
  },
  site: {
    description: 'Live site checks. health: TTFB cold/warm, caching, compression, security headers, blocking scripts, SEO. crawl: scoped crawl, broken pages, find. design: tokens + taste score.',
    annotations: READ, widget: true,
    input: s({ op: op(['health', 'crawl', 'design']), url: str('URL'), find: str('crawl: keywords'), max_pages: int('crawl: default 15, max 40'), scope: str('crawl: path prefix') }, ['op', 'url']),
  },
  social: {
    description: 'Instagram/TikTok/YouTube/X: post (metadata, author, thumbnail), profile (public stats), specs (current sizes, lengths, caption/hashtag limits).',
    annotations: READ,
    input: s({ op: op(['post', 'profile', 'specs']), url: str('Post/profile URL'), platform: str('specs: instagram|tiktok|youtube_shorts|x|linkedin') }, ['op']),
  },
  trends: {
    description: "What's new now: hn|github|reddit|devto|npm|all, filtered by topic.",
    annotations: READ, widget: true,
    input: s({ source: op(['all', 'hn', 'github', 'reddit', 'devto', 'npm']), topic: str('Topic, language, subreddit or tag'), limit: int('Default 8') }),
  },
  plugins: {
    description: 'Registry of tools (ChatGPT built-ins, OpenAI API, MCP servers, APIs): suggest best for a task, list, or propose an addition.',
    annotations: READ,
    input: s({
      op: op(['suggest', 'list', 'propose']), task: str('suggest: the task'), kind: op(['builtin', 'openai-api', 'mcp', 'gpt', 'api', 'cli'], 'list filter'),
      name: str('propose'), url: str('propose'), description: str('propose'), tags: strs('propose'), why: str('propose'), limit: int('Default 5'),
    }, ['op']),
  },
  plugin_call: {
    description: 'Call a callable MCP server from the registry (e.g. DeepWiki). Omit tool to list its tools.',
    annotations: { ...READ, readOnlyHint: false },
    input: s({ server: str('Registry name'), tool: str('Tool name'), args: { type: 'object', description: 'Tool arguments', additionalProperties: true }, max_chars: int('Default 6000') }, ['server']),
  },
  playbook: {
    description: 'Expert procedures on demand: build-loop, debugging, code-review, web-performance, design-taste, social-content, openai-leverage, token-economy. Omit topic for index.',
    annotations: READ,
    input: s({ topic: str('Name or "index"'), section: str('Only this ## section'), find: str('Keywords') }),
  },
  docs: {
    description: "Project memory in the repo's docs/: search past research before redoing it, read, list, write (commit a brief).",
    annotations: READ,
    input: s({ op: op(['search', 'read', 'list', 'write']), repo: str('owner/name'), path: str('e.g. 2026-10-02-auth.md'), query: str('search'), content: str('write: markdown'), message: str('Commit message') }, ['op']),
  },
  openai: {
    description: 'OpenAI API with your key (non-ChatGPT clients): ask (Responses API, optional web search + citations), moderate (free).',
    annotations: READ,
    input: s({ op: op(['ask', 'moderate']), prompt: str('Prompt/text'), web: bool('Hosted web_search'), model: str('Default gpt-5-mini'), effort: op(['minimal', 'low', 'medium', 'high']), max_output_tokens: int('Default 1200') }, ['op']),
  },
};

export const VERSION = '2.1.0';
