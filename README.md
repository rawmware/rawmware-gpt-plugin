# rawmware Operator

**Reads your repo, your deploys and the live web. Then ships the fix.**

A ChatGPT app (MCP server, Apps SDK widget) **and** Custom GPT (Actions) that runs the loop senior engineers run:

```
scrape → research → document → analyze → build
```

It reads GitHub, Vercel, any web page, Instagram/TikTok/YouTube/X. It scores design taste, tracks what's trending, remembers past research in your repo, and calls other plugins from a shared community registry. Works in ChatGPT, Claude, Cursor, VS Code and any MCP client.

Built by [rawmware](https://github.com/rawmware). Want one built for your business? [Start a project](https://github.com/rawmware/rawmware-gpt-plugin/issues/new?labels=hire&title=Project%20inquiry).

---

## Use it
| Where | How |
|---|---|
| **ChatGPT (GPT Store)** | Open the GPT link (set after publishing) |
| **ChatGPT (Apps / connectors)** | Settings → Apps & Connectors → developer mode → add `https://<domain>/mcp` |
| **Claude / Cursor / VS Code** | Add a remote MCP server: `https://<domain>/mcp` |
| **Any HTTP client** | `POST https://<domain>/api/tools/<tool>` with JSON args · spec at `/openapi.json` |

## Tools
| Tool | What it does | Token discipline |
|---|---|---|
| `web_fetch` | Scrape a URL → text / meta / links. Auto-renders JS-heavy sites | `find:` returns only matching lines; caps + `offset` paging |
| `web_search` | Brave (keyed) or DuckDuckGo (keyless) | Title + URL + snippet only |
| `research` | Search + read top sources in parallel, one per domain | Condensed notes, not pages |
| `github` | **audit** (one-call health report) · repo · tree · file (`lines`) · readme · commits · issues · prs · runs · releases · search · user | ~10 useful fields, not 100 |
| `github_write` 🔒 | **pr** (branch + commit N files + open PR, one call) · issue · comment | |
| `vercel` | projects · project · deployments · logs (**errors first**) · env (keys only) · redeploy 🔒 | |
| `social` | Instagram / TikTok / YouTube / X: post (oEmbed + meta) · profile (public stats) · specs (sizes, lengths, caption & hashtag limits) | |
| `trends` | HN · GitHub trending · dev.to · npm · Reddit, by topic | Top N, short fields |
| `design_audit` | Palette, fonts, type scale, spacing grid, radii, motion, CSS vars + taste/a11y score + top fixes | Fingerprint, not CSS |
| `plugins` | suggest / list / propose from the shared registry (ChatGPT built-ins, OpenAI API, MCP servers, GPTs, APIs) | Ranked top 5 |
| `plugin_call` | Call registry MCP servers directly (DeepWiki, Context7…) | Capped, cached |
| `playbook` | Expert know-how on demand: build-loop, design-taste, social-content, launch, openai-leverage, token-economy, lessons | One section at a time |
| `docs` | Project memory in `docs/`: list · read · **search** · write 🔒 | Excerpts only |
| `openai` | Responses API (+ hosted web search, citations) · moderation (free). BYOK via `x-openai-key` | |
| `about` | Who built it, live portfolio, hire link | |
| `feedback` | Prefilled GitHub issue for bugs/ideas/praise | |

🔒 = needs the owner key (`Authorization: Bearer $OPERATOR_API_KEY`).

MCP extras: tool **annotations** (read-only vs write hints), a **ChatGPT widget** (`text/html+skybridge`) that renders research, trends, design audits, repo audits and the portfolio as cards, and **prompts** (`audit_repo`, `fix_deploy`, `research_build`, `design_review`, `launch_content`, `whats_new`).

## Design decisions (the reasoning)
**Use the user's ChatGPT plan first.** Inside ChatGPT, Web Search, Deep Research, Python, Image Gen, Canvas and Agent are already covered by the user's plan. The GPT routes broad search, data work and image generation there, and the operator's server does only what ChatGPT can't do alone. Users get more out of their subscription; the server stays cheap. The `openai` tool exists for non-ChatGPT clients and only ever runs on the caller's own key. See [`playbooks/openai-leverage.md`](playbooks/openai-leverage.md).

**Fewer tokens is a feature.**
- *Cost:* tool output is paid for in money or plan limits. A raw API response or HTML page is 5–20× bigger than the useful part.
- *Quality:* models reason worse over long, noisy context.
- *Speed and runway:* fewer tokens means faster replies and more turns before the context fills.
- *Repetition:* tool descriptions and instructions are re-sent **every turn**, so they're kept short and a test enforces the budget (~2k tokens for all 16 tools).
- How: `find`, `lines`, `section`, composite calls (`audit`, `research`), errors-first logs, field picking, compact JSON, a two-tier cache, and knowledge loaded on demand. See [`playbooks/token-economy.md`](playbooks/token-economy.md).

**One ecosystem, not an island.** The registry ([`registry/plugins.json`](registry/plugins.json)) lists ChatGPT built-ins, OpenAI platform tools, MCP servers, GPTs and APIs. The operator suggests the right one for the task and can call public MCP servers itself (`plugin_call`, allowlisted, never an open relay). Anyone can propose additions in one click. Approved proposals become PRs automatically.

**MCP + Actions from one source.** [`lib/schemas.js`](lib/schemas.js) drives both the MCP `tools/list` and the live OpenAPI spec, so the GPT can never drift from the server.

## How it stays current (self-updating)
- **Registry and playbooks are read live from `main`** (5-minute cache). Merge a PR and every deployment has it, no redeploy.
- **Community → registry:** `plugins op:propose` → prefilled issue → maintainer adds `approved` → [workflow](.github/workflows/registry-from-issue.yml) validates and opens a PR.
- **Weekly refresh:** [workflow](.github/workflows/weekly-refresh.yml) health-checks every registry link and callable MCP server, snapshots trends, and opens a PR with a report in `docs/log/health/`. The operator reads that back through `docs op:search`.
- **Platform facts** (Instagram/TikTok limits) live in [`lib/social-specs.js`](lib/social-specs.js) with an `as_of` date.
- **Vercel redeploys on every push to `main`.** CI runs the test suite on every PR.

## Deploy (≈5 min)
1. Import this repo in Vercel (framework: Other, no build step). `public/` is the landing page; `api/` holds the functions.
2. Env vars (see [`.env.example`](.env.example)):
   - `GITHUB_TOKEN`: fine-grained PAT. Public read is enough for read tools; Contents + Issues + Pull requests write on your repos for 🔒 tools.
   - `OPERATOR_API_KEY`: long random string; unlocks 🔒 tools.
   - Optional: `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `BRAVE_API_KEY`, `BROWSERLESS_TOKEN`, `JINA_API_KEY`, `UPSTASH_REDIS_REST_URL` + `_TOKEN`, `OPENAI_API_KEY` (owner only), `META_APP_TOKEN` (Instagram oEmbed), `CONTEXT7_API_KEY`, `PUBLIC_URL`.
3. Check `https://<domain>/health`.
4. **Custom GPT:** follow [`gpt/config.md`](gpt/config.md).
5. **ChatGPT app / MCP:** add `https://<domain>/mcp`.

## Develop
```bash
npm test                         # zero dependencies, offline (fetch is mocked)
node scripts/registry-check.js   # live health check of every registry entry
```

## Layout
```
api/mcp.js              MCP endpoint (tools, resources/widget, prompts)
api/tools/[name].js     REST endpoints for GPT Actions
api/openapi.js          live OpenAPI 3.1 spec
api/health.js           what's configured (booleans only)
lib/schemas.js          single source of truth for tool contracts
lib/run.js              auth → rate limit → cache → run (shared by MCP + REST)
lib/tools/*.js          tool implementations
lib/net.js              fetch with SSRF guard (checks every redirect hop)
lib/cache.js            memory + Upstash cache
lib/mcp-client.js       calls other MCP servers (plugin_call)
lib/widget.js           ChatGPT Apps SDK result card
lib/prompts.js          MCP prompts (one-click workflows)
lib/social-specs.js     platform specs with as_of date
playbooks/*.md          knowledge loaded on demand
registry/plugins.json   shared community plugin registry
gpt/                    GPT instructions + editor config
public/                 landing page
docs/                   architecture, roadmap, privacy, build log
.github/workflows/      CI, registry-from-issue, weekly refresh
```

## Contributing
Found a great tool? Use `plugins op:propose` from the GPT or open an issue with the `registry` label. Bugs and ideas: `feedback` or an issue. PRs welcome; `npm test` must pass.

MIT © rawmware
