// Single source of truth for tool contracts. Drives the MCP server (ChatGPT
// Apps, Claude, Cursor, any MCP client) AND the OpenAPI spec for Custom GPT
// Actions. Descriptions are short on purpose: every client re-sends them to
// the model on every turn, so each word here is paid for thousands of times.

const s = (props, required = []) => ({ type: 'object', properties: props, required });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const int = (description) => ({ type: 'integer', description });
const bool = (description) => ({ type: 'boolean', description });
const op = (ops, description = 'Operation') => str(description, { enum: ops });

// read: no side effects · write: changes something (owner key) · world: touches the open internet
const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

export const SCHEMAS = {
  web_fetch: {
    description: 'Scrape a URL to clean text/meta/links. `find` returns only matching lines (cheapest). Auto-renders JS-heavy pages.',
    annotations: READ, widget: false,
    input: s({
      url: str('Absolute URL'), mode: op(['text', 'meta', 'links'], 'Default text'), find: str('Keywords, comma-separated: return only matching lines'),
      offset: int('Char offset for paging'), max_chars: int('Default 6000'), render: op(['auto', 'always', 'never'], 'JS rendering, default auto'),
    }, ['url']),
  },
  web_search: {
    description: 'Web search → titles, URLs, snippets.',
    annotations: READ,
    input: s({ query: str('Query'), site: str('Limit to a domain'), limit: int('Default 6') }, ['query']),
  },
  research: {
    description: 'Search + read top sources (one per domain) in parallel → condensed notes with URLs.',
    annotations: READ, widget: true,
    input: s({ query: str('Research question'), depth: int('Sources, default 3, max 6'), find: str('Keywords to focus notes on'), site: str('Limit to a domain'), chars_per_source: int('Default 1500') }, ['query']),
  },
  github: {
    description: 'Read GitHub. audit = one-call repo health report. file supports lines="10-80".',
    annotations: READ, widget: true,
    input: s({
      op: op(['audit', 'repo', 'tree', 'file', 'readme', 'commits', 'issues', 'prs', 'runs', 'releases', 'search_repos', 'search_code', 'user']),
      repo: str('owner/name'), path: str('File/dir path or prefix'), lines: str('Line range, e.g. 1-120'), ref: str('Branch/sha'),
      query: str('Search query'), user: str('Login for op=user'), state: op(['open', 'closed', 'all'], 'Default open'), limit: int('Max items'),
    }, ['op']),
  },
  github_write: {
    description: 'Owner only. pr = branch + commit files + open PR in one call; issue; comment.',
    annotations: WRITE,
    input: s({
      op: op(['pr', 'issue', 'comment']), repo: str('owner/name'), title: str('PR/issue title'), body: str('Markdown body'),
      branch: str('New branch (pr)'), base: str('Base branch, default repo default'), message: str('Commit message'),
      files: { type: 'array', description: 'pr: files to write', items: s({ path: str('Path'), content: str('Full file content'), delete: bool('Delete this file') }, ['path']) },
      number: int('Issue/PR number (comment)'), labels: { type: 'array', items: { type: 'string' } },
    }, ['op', 'repo']),
  },
  vercel: {
    description: 'Vercel: projects|project|deployments|logs (errors first)|env (keys only)|redeploy (owner).',
    annotations: READ,
    input: s({
      op: op(['projects', 'project', 'deployments', 'logs', 'env', 'redeploy']), project: str('Project name/id'),
      deployment_id: str('For logs/redeploy'), target: op(['production', 'preview'], 'redeploy target'), limit: int('Max items'),
    }, ['op']),
  },
  social: {
    description: 'Instagram/TikTok/YouTube/X: post = metadata+author+thumbnail; profile = public stats; specs = current sizes, limits, hashtag rules.',
    annotations: READ,
    input: s({ op: op(['post', 'profile', 'specs']), url: str('Post or profile URL'), platform: str('specs: instagram|tiktok|youtube_shorts|x|linkedin') }, ['op']),
  },
  trends: {
    description: "What's new right now: hn|github|reddit|devto|npm|all, optionally filtered by topic.",
    annotations: READ, widget: true,
    input: s({ source: op(['all', 'hn', 'github', 'reddit', 'devto', 'npm']), topic: str('Topic, language, subreddit or tag'), limit: int('Default 8') }),
  },
  design_audit: {
    description: 'Extract a site’s design tokens (palette, fonts, type scale, spacing, radius, motion) + taste/a11y score and top fixes.',
    annotations: READ, widget: true,
    input: s({ url: str('Page URL'), max_stylesheets: int('Default 4') }, ['url']),
  },
  plugins: {
    description: 'Shared plugin registry: suggest tools for a task (ChatGPT built-ins, OpenAI API, MCP servers, GPTs), list, or propose a new one.',
    annotations: READ,
    input: s({
      op: op(['suggest', 'list', 'propose']), task: str('What the user is trying to do'), kind: op(['builtin', 'openai-api', 'mcp', 'gpt', 'api', 'cli'], 'list filter'),
      name: str('propose: name'), url: str('propose: homepage'), description: str('propose: one line'), tags: { type: 'array', items: { type: 'string' } }, why: str('propose: what it unlocks'), limit: int('Default 5'),
    }, ['op']),
  },
  plugin_call: {
    description: 'Call another MCP server from the registry (e.g. DeepWiki, Context7). Omit tool to list its tools.',
    annotations: { ...READ, readOnlyHint: false },
    input: s({ server: str('Registry name, e.g. "Context7"'), tool: str('Tool name'), args: { type: 'object', description: 'Tool arguments', additionalProperties: true }, max_chars: int('Default 6000') }, ['server']),
  },
  playbook: {
    description: 'Fetch expert know-how on demand: build-loop, design-taste, social-content, launch, openai-leverage, token-economy, lessons. Omit topic for index.',
    annotations: READ,
    input: s({ topic: str('Playbook name or "index"'), section: str('Return only this ## section'), find: str('Keywords') }),
  },
  docs: {
    description: 'Project memory in GitHub docs/: list|read|search past research before redoing it; write (owner) new notes.',
    annotations: READ,
    input: s({ op: op(['list', 'read', 'search', 'write']), path: str('e.g. 2026-10-02-topic.md'), query: str('search terms'), content: str('Markdown (write)'), message: str('Commit message') }, ['op']),
  },
  openai: {
    description: 'OpenAI API for non-ChatGPT clients (bring your own key): ask (Responses API, optional web search w/ citations) | moderate (free).',
    annotations: READ,
    input: s({ op: op(['ask', 'moderate']), prompt: str('Prompt / text'), web: bool('Use hosted web_search'), model: str('Default gpt-5-mini'), effort: op(['minimal', 'low', 'medium', 'high'], 'Reasoning effort'), max_output_tokens: int('Default 1200') }, ['op']),
  },
  about: {
    description: 'Who built this operator, live portfolio, and how to hire them.',
    annotations: READ, widget: true,
    input: s({ include_repos: bool('Default true') }),
  },
  feedback: {
    description: 'Report a bug/idea/praise: returns a prefilled GitHub issue link for the user to submit.',
    annotations: READ,
    input: s({ kind: op(['bug', 'idea', 'praise', 'plugin', 'hire']), title: str('Short title'), details: str('Details') }, ['title']),
  },
};

export const VERSION = '2.0.0';
