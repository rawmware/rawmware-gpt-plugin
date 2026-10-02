# rawmware Operator

**Scrape → Research → Document → Analyze → Build.**
A ChatGPT GPT (via Actions) *and* an MCP server (ChatGPT Apps, Claude, Cursor, any MCP client) that reads GitHub, Vercel and the live web, suggests the right tools from a shared community registry, and ships real work.

Built by [rawmware](https://github.com/rawmware). Need something custom built? Open an issue or reach out.

---

## Why it exists
Most AI work now happens *inside* platforms people already use. Instead of another app, this is a capability layer you drop into ChatGPT (or any MCP client) that runs the same loop a senior engineer does: go to primary sources, read only what matters, write it down, decide, build.

## Tools
| Tool | What it does | Token discipline |
|---|---|---|
| `web_fetch` | Scrape a URL → clean text / meta / links | Strips scripts, nav, footers; hard cap + `offset` paging |
| `web_search` | Search (Brave API if keyed, keyless fallback) | Title + URL + snippet only |
| `research` | Search + read top N sources in parallel | Condensed notes per source, not raw pages |
| `github` | repo · tree · file · readme · commits · issues · search | Returns ~10 useful fields, not GitHub's 100 |
| `vercel` | projects · deployments · logs | Logs return **errors first** |
| `plugins_suggest` | Recommends tools from the shared registry for a task | Ranked, top 5 |
| `plugins_propose` | Adds a tool to the registry (opens an issue) | 🔒 owner key |
| `docs_write` | Commits research/build notes to `docs/log/` | 🔒 owner key |

## Why fewer tokens is a feature
- **Cost:** tool output is billed (or rate-limited) like everything else. A raw GitHub API response or HTML page is 5–20× larger than the useful part.
- **Quality:** models reason worse over long, noisy contexts. Less junk in = sharper answers out.
- **Speed:** fewer tokens means faster replies and more turns before the context fills up.

So every tool trims at the source, tool descriptions are kept short (they're sent on every turn), and JSON is returned without pretty-printing.

## How it stays current ("self-updating")
- `registry/plugins.json` on `main` **is** the live registry. Every deployment reads it from GitHub, cached for 5 minutes. Merge a PR and every user has it, with no redeploy.
- The OpenAPI spec is generated live from `lib/schemas.js`, so the GPT always matches the server.
- Vercel redeploys on every push to `main`.

## Deploy (≈5 min)
1. Import this repo in Vercel. No build step.
2. Env vars:
   - `GITHUB_TOKEN`: fine-grained PAT. Read for public repos; Issues + Contents write on this repo for the 🔒 tools
   - `OPERATOR_API_KEY`: any long random string; unlocks 🔒 tools
   - optional: `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `BRAVE_API_KEY`, `PUBLIC_URL`
3. **ChatGPT GPT:** Create → paste `gpt/instructions.md` → Actions → *Import from URL* `https://<domain>/api/openapi`. Config in `gpt/config.md`.
4. **MCP (ChatGPT Apps / Claude / Cursor):** add server URL `https://<domain>/mcp`.

## Develop
```bash
npm test     # node built-in test runner, zero dependencies
```

## Layout
```
api/mcp.js            MCP JSON-RPC endpoint
api/tools/[name].js   REST endpoints for GPT Actions
api/openapi.js        live OpenAPI 3.1 spec
lib/tools.js          tool implementations
lib/schemas.js        single source of truth for tool contracts
lib/compress.js       token-economy helpers
registry/plugins.json shared community plugin registry
gpt/                  GPT instructions + editor config
docs/                 architecture, roadmap, privacy, build log
```
