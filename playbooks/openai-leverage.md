# Getting the most out of OpenAI tools

Principle: **route each job to whatever already pays for it.** The user's ChatGPT plan includes powerful built-in tools. Use them first. The operator's server only does what ChatGPT can't do on its own. Users get more from their subscription; nobody pays twice.

## Routing table (inside ChatGPT)
| Job | Use | Why |
|---|---|---|
| Broad web lookup, news, "what's the latest" | ChatGPT **Web Search** | Included in plan, fast, cited |
| Multi-source report, market/competitor scan | ChatGPT **Deep Research** | Included (plan quotas apply), thorough |
| Read *specific* pages condensed, `find` a detail | operator `web_fetch` / `research` | Trimmed output, page contents not just snippets |
| Data, CSV/Excel/PDF, charts, math, file conversion | ChatGPT **Python** | Included, sandboxed, handles files |
| Thumbnails, mockups, carousel slides, og:images | ChatGPT **Image Generation** | Included |
| Long doc or code editing | ChatGPT **Canvas** | Inline revisions |
| Click through a website, fill forms, multi-step web tasks | ChatGPT **Agent** | Has its own browser |
| Persistent context for one project | ChatGPT **Projects + Memory** | Stops re-explaining |
| Work inside a repo, run tests, open PRs at scale | **Codex** | Purpose-built coding agent |
| GitHub as the user: grep, PRs, CI logs, open PRs | operator `github` / `github_write` | ChatGPT can't reach these alone |
| Deploy logs, env keys, domains | operator `vercel` | User's own token |
| Current library docs before coding | operator `libdocs` | Version-specific; beats stale training data |
| Vulnerable / outdated dependencies | operator `deps` | OSV + registries in one call |
| Live site speed, caching, headers, broken pages | operator `site op:health / crawl` | Measured, not guessed |
| Design tokens + taste score | operator `site op:design` | Unique to the operator |
| IG/TikTok post & profile data, platform specs | operator `social` | Structured, current |
| What's trending for builders | operator `trends` | HN/GitHub/dev.to/npm in one call |
| Which tool should I use? | operator `plugins op:suggest` | Shared registry incl. builtins |

Tell the user which built-in you're using and why, once, so they learn their plan's power.

## OpenAI API (for builders and non-ChatGPT clients)
- **Responses API**: one endpoint for text + hosted tools (`web_search`, `file_search`, `code_interpreter`, `image_generation`, remote MCP). The operator's `openai op:ask` wraps it with the user's own key (`x-openai-key`).
- **Agents SDK** (Python/TS): multi-agent apps with handoffs, guardrails, tracing.
- **Apps SDK**: ship an app *inside* ChatGPT: an MCP server + optional UI widget. This operator is one.
- **Realtime API**: voice agents.
- **Moderation**: free. Screen user-generated text before publishing (`openai op:moderate`).
- **Cost levers**: smaller models for routing/extraction, reasoning `effort: low|minimal` for simple jobs, prompt caching (stable prefix first), Batch API for non-urgent bulk jobs (cheaper), structured outputs to avoid retries.

## Free-tier and cheap paths
- ChatGPT Free has limited built-in tool access; tell free users which features need a paid plan rather than failing silently.
- The operator's own tools are free to use (rate-limited); keyless fallbacks for search (DuckDuckGo) and rendering (Jina Reader).
- New OpenAI API accounts: check the dashboard for current free credits/limits. Never assume.

## Rules
- Never ask a user to paste an API key into chat. BYOK goes in their MCP client's headers.
- Never spend the operator owner's OpenAI key for public users. The server enforces this.
