// Single source of truth for tool contracts. Used by the MCP server
// (ChatGPT Apps / Claude / any MCP client) and to generate the OpenAPI spec
// for Custom GPT Actions. Descriptions are short on purpose: they are sent
// to the model on every turn.

const s = (props, required = []) => ({ type: 'object', properties: props, required });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const int = (description) => ({ type: 'integer', description });

export const SCHEMAS = {
  web_fetch: {
    description: 'Scrape a URL into compact text, metadata, or links.',
    input: s({ url: str('Absolute URL'), mode: str('text|meta|links', { enum: ['text', 'meta', 'links'] }), offset: int('Char offset for paging'), max_chars: int('Default 6000') }, ['url']),
  },
  web_search: {
    description: 'Web search; returns titles, URLs, snippets.',
    input: s({ query: str('Search query'), limit: int('Default 6') }, ['query']),
  },
  research: {
    description: 'Search + read top sources in parallel; returns condensed notes per source.',
    input: s({ query: str('Research question'), depth: int('Sources to read, default 3'), chars_per_source: int('Default 1500') }, ['query']),
  },
  github: {
    description: 'Read GitHub: repo|tree|file|readme|commits|issues|search_repos|search_code.',
    input: s({
      op: str('Operation', { enum: ['repo', 'tree', 'file', 'readme', 'commits', 'issues', 'search_repos', 'search_code'] }),
      repo: str('owner/name'), path: str('File or dir path'), query: str('Search query'), ref: str('Branch/sha'), limit: int('Max items'),
    }, ['op']),
  },
  vercel: {
    description: 'Read Vercel: projects|deployments|logs (errors first).',
    input: s({ op: str('Operation', { enum: ['projects', 'deployments', 'logs'] }), project: str('Project name'), deployment_id: str('For logs'), limit: int('Max items') }, ['op']),
  },
  plugins_suggest: {
    description: 'Suggest community plugins/tools from the shared registry that fit a task.',
    input: s({ task: str('What the user is trying to do'), limit: int('Default 5') }, ['task']),
  },
  plugins_propose: {
    description: 'Propose a new plugin for the shared registry (opens a GitHub issue).',
    input: s({ name: str('Name'), url: str('Homepage/manifest URL'), description: str('One line'), tags: { type: 'array', items: { type: 'string' } }, why: str('What it unlocks') }, ['name', 'url', 'description']),
  },
  docs_write: {
    description: 'Persist research/analysis/build notes as markdown in the project repo.',
    input: s({ path: str('e.g. 2026-10-02-topic.md'), content: str('Markdown'), message: str('Commit message') }, ['path', 'content']),
  },
};
