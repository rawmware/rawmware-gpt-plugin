// Tool registry: name → implementation. Every function takes (args, ctx)
// where ctx = credentials(headers) from auth.js plus { headers }.
import { web_fetch, web_search, research } from './tools/web.js';
import { github, github_write } from './tools/github.js';
import { vercel } from './tools/vercel.js';
import { deps } from './tools/deps.js';
import { libdocs } from './tools/libdocs.js';
import { site } from './tools/site.js';
import { social } from './tools/social.js';
import { trends } from './tools/trends.js';
import { plugins, plugin_call } from './tools/registry.js';
import { playbook, docs } from './tools/knowledge.js';
import { openai } from './tools/openai.js';

export const TOOLS = {
  web_fetch, web_search, research,
  github, github_write, vercel,
  deps, libdocs, site,
  social, trends,
  plugins, plugin_call,
  playbook, docs, openai,
};

// Cache TTL (seconds) for results. 0 = never (live state, writes, or tools
// that cache internally). GitHub GETs revalidate by ETag inside gh() instead,
// so `github` is always fresh but costs nothing when unchanged.
export const TTL = {
  web_fetch: 600, web_search: 1800, research: 1800,
  github: 0, github_write: 0, vercel: 0,
  deps: 1800, libdocs: 3600, site: 0,
  social: 3600, trends: 1800,
  plugins: 300, plugin_call: 0,
  playbook: 300, docs: 0, openai: 0,
};
