# Roadmap

## v2.1 (this release): performance-first rewrite
- [x] Act as the user: GitHub OAuth for GPT Actions (`/api/oauth/token`), `x-github-token` / `x-vercel-token` / `x-openai-key` for MCP
- [x] Fixed: Vercel no longer exposes the owner's projects to the public; cache partitioned per identity
- [x] Fixed: SSRF bypass via IPv4-mapped IPv6 (`::ffff:7f00:1`); credentials stripped on cross-origin redirects
- [x] Fixed: code blocks lost indentation in scraped docs; now fenced verbatim, tables kept, densest content picked
- [x] github: `grep`, `pr` (diff + CI + reviews), `compare`, `run_logs` (first error), `issue`, batch `file paths[]`, ETag revalidation, rate-limit guidance
- [x] github_write: PR iteration on existing branches, `review` with inline comments, draft PRs
- [x] `deps`: OSV vulnerabilities with fixed versions, outdated/deprecated, npm/PyPI/crates/Go, lockfile-aware
- [x] `libdocs`: Context7 (schema-adaptive) → llms.txt → official docs
- [x] `site`: health (TTFB cold/warm, caching, compression, security headers, blocking scripts, SEO), scoped crawl, design
- [x] Search provider chain with fallback; deadline-aware composite tools; capped body reads; bounded concurrency
- [x] Removed self-promotional tools (`about`, `feedback`) and playbooks; added debugging, code-review, web-performance
- [x] 37 offline tests

## Next
- [ ] MCP OAuth (protected-resource metadata) so ChatGPT apps get per-user GitHub without headers
- [ ] `github op:blame` and `op:symbols` (definitions/references via tree + grep heuristics)
- [ ] `deps op:upgrade`: generate the manifest + lockfile-safe upgrade diff
- [ ] `site op:lighthouse` via PageSpeed Insights API (field + lab Core Web Vitals)
- [ ] Vercel runtime logs (function errors), not just build logs
- [ ] Semantic registry ranking (embeddings, cached)
- [ ] Sentry/Supabase integrations via `plugin_call` with user OAuth tokens

## Launch checklist
- [ ] Deploy to Vercel, set env vars, check `/health`
- [ ] GitHub OAuth app + GPT per `gpt/config.md`; run all 4 starters on a real private repo
- [ ] Add MCP server in ChatGPT developer mode and Claude Code; test widget + headers
- [ ] Publish to GPT Store (privacy URL + verified builder profile)
- [ ] GitHub labels: `registry`, `approved`
