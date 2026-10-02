# rawmware Operator

A developer operator for ChatGPT and any MCP client. It reads your real sources (repo, CI logs, deploy logs, live site, current library docs), finds the actual cause, and ships the fix as a PR, **acting as you** on GitHub.

```
scrape → research → document → analyze → build
```

Works as a **Custom GPT** (Actions + GitHub sign-in) and as a **ChatGPT app / MCP server** (Claude, Cursor, VS Code, ChatGPT developer mode). Zero runtime dependencies, Node 20+, deploys to Vercel as-is.

---

## What it does
| Job | Tool call | What you get |
|---|---|---|
| **CI is red** | `github op:run_logs` | Latest failed run → failed jobs/steps → first real error with context (log noise stripped) |
| **Deploy failed** | `vercel op:logs project:x` | Latest failed deployment → first build error + context |
| **Review a PR** | `github op:pr` | Diff (per-file patches), CI checks, review state in one call. Then `github_write op:review` with inline comments |
| **Find code** | `github op:grep query:"regex" ext:"ts"` | `file:line: match` across the repo, no clone, any branch, private repos too |
| **Read code** | `github op:file paths:[…] lines:"40-90"` | Up to 10 files per call, line-sliced |
| **Ship a fix** | `github_write op:pr` | Branch + commit N files + open PR in one call. Re-run with the same branch → new commit on the same PR |
| **Dependency risk** | `deps op:audit repo:x` | Vulnerabilities (OSV: GitHub advisories, PyPA, RustSec, Go) with fixed versions, outdated majors, deprecated packages. npm, PyPI, crates.io, Go. Reads lockfiles for exact versions |
| **Use a library correctly** | `libdocs library:"next.js" topic:"middleware"` | Current, version-specific docs: Context7 → `llms.txt` → official docs |
| **Is the site fast and sound?** | `site op:health` | TTFB cold/warm, size, compression, cache headers (Vercel/Cloudflare), render-blocking scripts, third parties, image CLS risks, security headers, SEO basics, robots/sitemap |
| **Crawl docs / find broken pages** | `site op:crawl find:"auth"` | Scoped BFS crawl (stays in `/docs/`), only matching lines, broken links, slowest pages |
| **Repo health** | `github op:audit` | Stack, scripts, CI status, tests, lockfile, committed secrets, AGENTS.md: gaps ranked by severity |
| **Research** | `research` / `web_fetch urls:[…]` | Search with provider fallback → top sources read in parallel → condensed notes. Code blocks and tables preserved |
| **Design system** | `site op:design` | Palette, type scale, spacing grid, radii, motion, CSS vars + taste/a11y score |
| **Social** | `social` | Instagram/TikTok/YouTube/X post & profile data, current platform specs |
| **What's new** | `trends`, `github op:releases` | HN, GitHub trending, dev.to, npm, Reddit; release notes |
| **Other tools** | `plugins op:suggest` · `plugin_call` | Registry of ChatGPT built-ins, OpenAI APIs and MCP servers; calls public MCP servers (DeepWiki) directly |
| **Project memory** | `docs op:search/write` | Research briefs committed to `docs/` in *your* repo; searched before re-researching |

MCP extras: tool annotations (read vs write), a ChatGPT result widget (`text/html+skybridge`), and one-click prompts: `fix_ci`, `review_pr`, `fix_deploy`, `audit_repo`, `upgrade_deps`, `research_build`, `site_check`, `design_review`, `whats_new`.

## Access model
| Who | How | Can do |
|---|---|---|
| Anyone | no auth | Public repos, web, deps, libdocs, site, research |
| GitHub user | GPT: **Sign in with GitHub** (OAuth). MCP: `x-github-token` header (or `Authorization: Bearer gh…`) | Everything above **as themselves**: private repos, CI logs, PRs, reviews, docs memory in their repo. 5,000 req/hr of their own quota |
| Vercel user | MCP: `x-vercel-token` header | Their own projects, logs, env keys, domains, redeploys |
| OpenAI user | MCP: `x-openai-key` header | `openai` tool (Responses API + hosted web search, moderation) |
| Owner | `Authorization: Bearer $OPERATOR_API_KEY` | Server-side Vercel/OpenAI tokens, writes with the server GitHub token (allowlisted repos) |

The server's tokens are never used to act for anyone else. Results fetched with a user's token are cached **per user** and never served to another.

## Performance & token economy
- **Trim at the source.** HTML → markdown that keeps code blocks verbatim (fenced, indentation intact) and tables as rows; nav/footers/scripts dropped; densest content container picked. API objects reduced to ~10 useful fields.
- **Ask for slices.** `find` (only matching lines), `lines`, `paths[]`, `grep`, `section`, `mode:meta`. Logs → first error + context instead of thousands of lines.
- **Fewer round trips.** Composite calls (`audit`, `pr`, `run_logs`, `deps audit`, `research`), batch reads (`urls[]`, `paths[]`), parallel fetches with bounded concurrency.
- **Caching.** GitHub reads revalidate by ETag (a 304 is free and doesn't count against rate limits). Two-tier result cache (memory + optional Upstash), partitioned per user.
- **Deadlines.** Composite tools share a time budget and return partial results instead of timing out. Body reads are capped (4MB) so a huge page can't take the function down.
- **Reliability.** Search falls through Brave → Tavily → Serper → DuckDuckGo → DuckDuckGo Lite. JS-only pages auto-render (Browserless or Jina Reader). Context7 tool args are matched by schema, so upstream renames don't break `libdocs`.
- **Budgets enforced in CI.** All 16 tool schemas ≈ 2.6k tokens; GPT instructions < 8,000 chars.

Why it matters: tool output is paid for in money or plan limits, long noisy context makes models reason worse, and tool descriptions are re-sent on every turn. See [`playbooks/token-economy.md`](playbooks/token-economy.md).

**Inside ChatGPT, built-ins go first.** Web Search, Deep Research, Python, Image Gen, Canvas and Agent are covered by the user's plan; the operator does what ChatGPT can't do alone ([`playbooks/openai-leverage.md`](playbooks/openai-leverage.md)).

## Security
- SSRF guard on every outbound URL **and every redirect hop** (private, loopback, link-local, metadata, IPv4-mapped IPv6).
- Credentials dropped when a redirect leaves the origin.
- Writes are marked consequential (ChatGPT asks before running them); Vercel env returns keys only, never values.
- Per-IP+identity rate limiting; constant-time owner key check.

## Deploy (≈5 min)
1. Import this repo in Vercel (framework: Other, no build step).
2. Env vars ([`.env.example`](.env.example)): `GITHUB_TOKEN` (read-only PAT) and, for the GPT, `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`. Optional: search keys, `BROWSERLESS_TOKEN`, Upstash, `OPERATOR_API_KEY`.
3. Check `https://<domain>/health`.
4. **Custom GPT:** [`gpt/config.md`](gpt/config.md) (Actions from `/openapi.json`, GitHub OAuth).
5. **MCP:** add `https://<domain>/mcp`; pass `x-github-token` / `x-vercel-token` headers in clients that support them.

## Develop
```bash
npm test                         # 37 offline tests (fetch mocked), zero deps
node scripts/registry-check.js   # live health check of registry entries
```

## Self-updating
- Registry ([`registry/plugins.json`](registry/plugins.json)) and playbooks are read live from `main` (5-min cache). Merge → live everywhere, no redeploy.
- `[registry]` issues labeled `approved` → CI validates and opens a PR ([workflow](.github/workflows/registry-from-issue.yml)).
- Weekly: registry link + MCP health check and trends snapshot → PR ([workflow](.github/workflows/weekly-refresh.yml)).

## Layout
```
api/mcp.js              MCP endpoint (tools, widget resource, prompts)
api/tools/[name].js     REST endpoints for GPT Actions
api/openapi.js          live OpenAPI 3.1 spec (from lib/schemas.js)
api/oauth/token.js      GitHub OAuth token exchange for GPT Actions
api/health.js           configuration status (booleans only)
lib/schemas.js          tool contracts: single source of truth
lib/run.js              credentials → permission → rate limit → cache → run
lib/auth.js             who's calling and with whose tokens
lib/net.js              guarded fetch, capped reads, pool, deadlines
lib/compress.js         HTML→markdown, focus, log error extraction
lib/tools/*.js          github, vercel, deps, libdocs, site, web, social, trends, registry, knowledge, openai
lib/mcp-client.js       calls other MCP servers (Context7, DeepWiki)
playbooks/*.md          procedures loaded on demand
```

MIT © rawmware
