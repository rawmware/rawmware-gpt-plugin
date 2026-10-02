# Architecture

```
                    ┌──────────────── ChatGPT ────────────────┐
                    │  built-ins (Web Search, Deep Research,  │  ← used FIRST: covered by
                    │  Python, Image Gen, Canvas, Agent)      │    the user's plan
                    └──────┬───────────────────────┬──────────┘
          GPT Actions (OpenAPI)              ChatGPT app (MCP + widget)
                           │                       │        Claude / Cursor / VS Code (MCP)
                           ▼                       ▼                 │
                 api/tools/[name].js          api/mcp.js ◄───────────┘
                           └──────────┬────────────┘
                                 lib/run.js   auth → rate limit → cache → run
                                      │
     ┌──────────┬──────────┬──────────┼───────────┬────────────┬──────────────┐
   web.js   github.js  vercel.js  social.js   design.js   registry.js   knowledge.js  openai.js
     │          │          │          │           │        │       │       │       │      │
  lib/net.js (SSRF guard)  │      oEmbed APIs     │   registry  mcp-client  playbooks docs  BYOK
     │                     │                      │   (GitHub    (other MCP  (GitHub (GitHub
  web, Brave/DDG,     Vercel API             site HTML+CSS  main)     servers)   main)   repo)
  Browserless/Jina
```

## Principles
1. **One contract, two transports.** `lib/schemas.js` → MCP `tools/list` and `/openapi.json`. `lib/run.js` is the only execution path, so auth, limits and caching are identical everywhere.
2. **Trim at the source.** Tools return the smallest useful answer; the model never sees raw API JSON or raw HTML.
3. **Route to what's already paid for.** ChatGPT built-ins first; the server fills the gaps; the user's own key for OpenAI API calls outside ChatGPT.
4. **Data, not deploys.** Registry, playbooks and platform specs are content in the repo, read live, so updating knowledge doesn't need a redeploy.
5. **Safe by default.** Public = read-only. Writes need the owner key, are allowlisted by repo, and are marked consequential so ChatGPT asks before running them. Every outbound URL (and every redirect) is checked against private networks.

## Request flow
1. Client calls a tool (MCP `tools/call` or `POST /api/tools/<name>`).
2. `run.js`: owner check (`timingSafeEqual`) → gate write ops → per-IP rate limit (owner exempt) → cache lookup (`t:<tool>:<args>`).
3. Tool runs with `(args, { headers, owner })`.
4. Output cached by tool TTL (never for writes or BYOK calls) and returned as compact JSON; MCP also returns `structuredContent` for the widget.

## Self-update loop
```
user finds tool ─► plugins op:propose ─► prefilled issue ─► maintainer labels `approved`
     ─► registry-from-issue.yml validates + opens PR ─► merge ─► live in ≤5 min everywhere

every Monday ─► weekly-refresh.yml: link + MCP health, trends snapshot ─► PR to docs/log/health/
     ─► operator reads it via docs op:search ─► recommendations stay current
```

## Limits worth knowing
- GPT Actions: ≤30 operations (we use 16), and long responses get truncated, so tools cap at ~6–12k chars.
- GPT instructions: 8,000 chars (we use ~5.6k; a test enforces it).
- Vercel functions: 30s max here; `research` and `design_audit` run fetches in parallel to stay well under.
- The in-memory cache and rate limiter are per warm instance; set Upstash for shared caching.
