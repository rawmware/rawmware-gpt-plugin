# Roadmap

## v1.0 (this commit)
- [x] Scrape / search / research tools with output compression
- [x] GitHub + Vercel read tools
- [x] Shared plugin registry, live-loaded from `main`
- [x] MCP endpoint + GPT Actions (OpenAPI) from one schema source
- [x] Owner-gated write tools (`docs_write`, `plugins_propose`)

## v1.1: compounding memory
- [ ] `docs_search`: read back `docs/log/` so past research is reused, not redone
- [ ] Response cache (Vercel KV / Upstash) keyed by URL + params
- [ ] GitHub Action: auto-convert approved `[registry]` issues into a registry PR

## v1.2: build tools
- [ ] `github_pr`: open a branch + PR with a generated diff (owner key)
- [ ] `vercel_redeploy` / env inspection
- [ ] Headless browser fallback for JS-heavy pages (Browserless / Playwright service)

## v1.3: ecosystem
- [ ] Registry entries carry an MCP URL so the operator can proxy calls to other MCP servers directly
- [ ] Usage telemetry (opt-in, anonymous) → rank registry by what actually helps
- [ ] Public showcase page: what people built with it

## Launch checklist
- [ ] Deploy to Vercel, set env vars
- [ ] Create GPT, test all 4 conversation starters
- [ ] Publish GPT to GPT Store (needs verified builder profile + privacy URL)
- [ ] Demo video: broken Vercel deploy → diagnosis → fix in under 60s
- [ ] Post: X/Instagram/LinkedIn with the demo, link the repo
