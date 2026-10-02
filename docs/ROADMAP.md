# Roadmap

## v1.0
- [x] Scrape / search / research tools with output compression
- [x] GitHub + Vercel read tools
- [x] Shared plugin registry, live-loaded from `main`
- [x] MCP endpoint + GPT Actions (OpenAPI) from one schema source
- [x] Owner-gated write tools

## v2.0 (this release)
- [x] 16 tools: social (IG/TikTok/YouTube/X), trends, design_audit, playbook, docs (search/read/write), plugin_call, openai (BYOK), about, feedback, github_write (PR in one call), github audit/prs/runs/releases/user, vercel project/env/redeploy
- [x] Uses ChatGPT built-ins first (routing table in `playbooks/openai-leverage.md`)
- [x] Registry v2: kinds (builtin / openai-api / mcp / gpt / api), callable MCP servers (DeepWiki, Context7)
- [x] MCP client: call other MCP servers (allowlisted)
- [x] ChatGPT Apps SDK widget, tool annotations, MCP prompts
- [x] Knowledge on demand: 7 playbooks, section-level fetch
- [x] SSRF guard (every redirect hop), rate limiting, constant-time key check
- [x] Two-tier cache (memory + Upstash)
- [x] JS rendering fallback (Browserless or Jina Reader)
- [x] Self-update: issue → registry PR workflow, weekly health + trends PR, CI
- [x] Landing page with og image

## v2.1: smarter ecosystem
- [ ] OAuth for the MCP endpoint, so users connect their own GitHub/Vercel (no owner token)
- [ ] Semantic registry ranking (embeddings, cached) instead of keyword + synonyms
- [ ] `plugin_call` for OAuth servers via user-supplied tokens
- [ ] Opt-in anonymous usage counts per tool → rank registry by what actually helps

## v2.2: build more on its own
- [ ] `github_write op:fix_ci`: read failing run logs → patch → PR
- [ ] Screenshot tool (Browserless) for visual design review + before/after images for posts
- [ ] `social op:plan`: generate a week of posts straight into a docs/log content calendar
- [ ] Vercel preview URL → design_audit + Lighthouse-style perf checks in one call

## v3: community
- [ ] Public showcase page: what people built with it (from `praise` feedback issues)
- [ ] Contributor playbooks (PRs to `playbooks/`), credited in the operator's answers
- [ ] Per-user project memory (opt-in), not just the owner's repo

## Launch checklist
- [ ] Deploy to Vercel, set env vars, check `/health`
- [ ] Create GPT per `gpt/config.md`, run all 4 conversation starters
- [ ] Add the MCP server in ChatGPT developer mode and Claude; test the widget
- [ ] Publish to GPT Store (verified builder profile + privacy URL); set `GPT_URL` in `public/index.html`
- [ ] Label setup in GitHub: `registry`, `approved`, `bug`, `idea`, `praise`, `plugin`, `hire`
- [ ] Demo video ≤45s: failing Vercel deploy → root cause → PR. Second: design_audit 54 → 91
- [ ] Post the same week: IG Reel, TikTok, X, LinkedIn, Show HN, r/ChatGPT (see `playbooks/launch.md`)
