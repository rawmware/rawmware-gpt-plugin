# Architecture

```
 ChatGPT (GPT Actions + GitHub OAuth)     ChatGPT app / Claude / Cursor / VS Code (MCP + headers)
              │                                          │
     api/tools/[name].js                            api/mcp.js
              └───────────────────┬──────────────────────┘
                             lib/run.js
          credentials → permission → rate limit → cache (per identity) → run
                                  │
  ┌────────┬────────┬────────┬────┴───┬────────┬────────┬─────────┬──────────┐
 github  vercel   deps   libdocs   site     web     social/   registry   knowledge
 (as     (user    (OSV + (Context7 (health, (search  trends   (+ MCP     (playbooks,
 user,   token)   regis- → llms.txt crawl,  chain,            client)    docs memory)
 ETag)            tries) → docs)   design) render)
                                  │
                   lib/net.js: SSRF guard per hop · auth stripped cross-origin
                               capped reads · pool() · deadline()
```

## Principles
1. **One contract, two transports.** `lib/schemas.js` → MCP `tools/list` and `/openapi.json`. `lib/run.js` is the only execution path, so auth, limits and caching are identical everywhere.
2. **Act as the user.** GitHub OAuth (GPT) or headers (MCP) carry the user's own tokens. Server tokens serve public reads (GitHub) or the owner only, never someone else's writes or private data.
3. **Trim at the source.** Tools return the smallest useful answer: markdown with code intact, first errors from logs, picked fields, slices on request.
4. **Composite over chatty.** One call does what would take 5–10 turns (`audit`, `pr`, `run_logs`, `deps audit`, `research`, batch reads).
5. **Fail soft, finish in time.** Provider fallbacks, deadlines with partial results, capped body reads.
6. **Knowledge as data.** Registry, playbooks and platform specs live in the repo and are read live, so updates don't need a redeploy.

## Request flow
1. Client calls a tool (MCP `tools/call` or `POST /api/tools/<name>`).
2. `credentials(headers)`: owner key (constant-time) / user GitHub token (OAuth bearer or `x-github-token`) / `x-vercel-token` / `x-openai-key` → `ident` (hash of user tokens, `owner`, or `public`).
3. `denied()`: writes need the user's GitHub token or the owner; Vercel needs a Vercel token; docs writes need a repo the user can write.
4. Rate limit per IP + identity (owner exempt). Result cache keyed by `ident` + tool + args.
5. Tool runs with `(args, ctx)`. GitHub GETs send `If-None-Match`; 304 → cached body.
6. Output returned as compact JSON; MCP also returns `structuredContent` for the widget.

## Limits worth knowing
- GPT Actions: ≤30 operations (16 used); long responses get truncated, so tools cap at ~6–15k chars.
- GPT instructions: 8,000 chars (4.3k used; test-enforced). Tool schemas ≈ 2.6k tokens (test-enforced).
- Vercel functions: `maxDuration` 60s; composite tools budget ~25s and return partial results.
- In-memory cache and rate limiter are per warm instance; set Upstash for shared caching.
