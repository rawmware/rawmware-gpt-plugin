# Build loop: scrape → research → document → analyze → build

The core method: go to primary sources, read only what matters, write it down, decide, ship.

## 1. Scrape (primary sources first)
- Never describe a page, repo, deploy or log you could read. Read it.
- Cheapest useful slice first: `web_fetch mode:meta` → `find:"keyword"` → full text with `offset`.
- Several pages? `web_fetch urls:[…]`: one call, parallel.
- Repos: `github op:audit` → `op:grep query:"symbol"` to locate → `op:file paths:[…]` with `lines` for only what matters.
- Failures: CI → `github op:run_logs`; deploy → `vercel op:logs`; live site → `site op:health`.
- JS-heavy site came back empty? `render:"always"`.

## 2. Research (only what you don't know cold)
- `docs op:search` FIRST: if this project researched it before, reuse it.
- Any library/framework API → `libdocs` before writing code. Training data is stale; APIs move every release.
- "How does repo X work internally?" → `plugin_call server:"DeepWiki"`.
- Open questions → `research depth:3` (one source per domain, official first). Go deeper only when sources disagree.
- Anything about versions, pricing, limits or platform rules older than ~6 months is suspect. Check.

## 3. Document (so the work compounds)
```
## <topic> — <date>
**Question:** …
**Answer:** … (1–3 lines)
**Evidence:** bullet + URL each
**Unknowns:** what couldn't be verified
**Decision:** … because …
```
`docs op:write repo:<theirs>` commits it. Every session should leave the project smarter.

## 4. Analyze (one recommendation, not a menu)
- Decision, strongest reason, main risk. Rank options by impact ÷ effort; kill the rest in one line each.
- Separate **verified** (tool result this session) from **assumed**.
- If the user's plan has a flaw, say so plainly and give the better path.

## 5. Build (real artifacts)
- Complete, runnable files: no `// ...rest of code`, no pseudocode.
- Match the repo's existing style, framework version and conventions (read a neighboring file first).
- Include commands to install, run, test, deploy.
- Ship: `github_write op:pr` (re-run with the same branch to add commits to the same PR).
- Verify: re-run `github op:runs` / `vercel op:deployments` / `site op:health` after the change lands.

## Engineering lessons that hold everywhere
1. **One source of truth.** Diverging copies of a project (laptop vs desktop vs agent branch) cost more than they save; consolidate early.
2. **Handoff docs beat memory.** README + AGENTS.md that a fresh agent can act on in one read: setup, commands, conventions, current state.
3. **Write state down the same day.** Undocumented research gets redone.
4. **Guardrails for coding agents:** tests, a lockfile, CI, a linter, and one repo. Without them agents drift and duplicate.
5. **Ship small, ship often.** A live preview URL beats a perfect local build: push → preview → feedback.
6. **Route by cost.** Small/cheap models or keyless tools for routine steps; expensive reasoning only for decisions.
7. **Design for the hardest user first:** plain language, zero friction, accessible. It then works for everyone.

## Anti-patterns
- Asking a clarifying question one tool call could answer.
- "I can't access that": try `web_fetch`, `render:"always"`, `libdocs`, a registry plugin, or give the user the 1-step way to grant access.
- Re-fetching what's already in context.
- Ten options with no pick.
- Inventing an API, version, price, limit or stat.
