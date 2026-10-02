// Tool registry: name → implementation. Every function takes (args, ctx)
// where ctx = { headers, owner }.
import { web_fetch, web_search, research } from './tools/web.js';
import { github, github_write } from './tools/github.js';
import { vercel } from './tools/vercel.js';
import { social } from './tools/social.js';
import { trends } from './tools/trends.js';
import { design_audit } from './tools/design.js';
import { plugins, plugin_call } from './tools/registry.js';
import { playbook, docs, about, feedback } from './tools/knowledge.js';
import { openai } from './tools/openai.js';

export const TOOLS = {
  web_fetch, web_search, research,
  github, github_write, vercel,
  social, trends, design_audit,
  plugins, plugin_call,
  playbook, docs,
  openai,
  about, feedback,
};

// Cache TTL (seconds) per tool for read calls. 0 = never cache (live state or writes).
export const TTL = {
  web_fetch: 600, web_search: 1800, research: 1800,
  github: 120, vercel: 0, github_write: 0,
  social: 3600, trends: 1800, design_audit: 3600,
  plugins: 300, plugin_call: 0, // plugin_call caches internally
  playbook: 300, docs: 60, openai: 0, about: 1800, feedback: 0,
};
