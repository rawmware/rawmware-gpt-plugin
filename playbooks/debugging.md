# Debugging: from symptom to verified fix

## Procedure
1. **Get the real error.** Not the user's paraphrase: the first error line.
   - CI: `github op:run_logs` → `first_error` + context. Later errors are usually fallout.
   - Vercel build: `vercel op:logs project:X` (latest failed) → `first_error`.
   - Runtime/site: `site op:health` (status, redirects, headers) and `web_fetch` the failing URL.
2. **Locate.** `github op:grep query:"<symbol|message>"` → `op:file paths:[…] lines:"N-M"` around the hit. Read callers, not just the line.
3. **What changed?** `github op:commits path:<file>` or `op:compare base:<last-green-sha> head:<branch>`. Most breakages are the last diff.
4. **Hypothesize, then check.** One sentence: "X fails because Y." Find evidence in code/logs that confirms or kills it. Never patch on an unverified guess.
5. **Check the API you're relying on.** `libdocs` for the library + topic. Version mismatches and renamed APIs cause a large share of modern build failures.
6. **Fix minimally**, at the cause, not the symptom. Complete file contents.
7. **Prove it.** State the exact check that will go green (test, build, URL) and run/trigger it.

## Error → likely cause
| Signal | Usually |
|---|---|
| `Module not found` / `Cannot find module` | Missing dep, wrong import path/case (Linux is case-sensitive, macOS isn't), ESM/CJS mismatch |
| `ERR_REQUIRE_ESM`, `exports is not defined` | Package went ESM-only; use `import` or pin the older major |
| Works locally, fails on CI/Vercel | Node version (`engines`), missing env var, case-sensitive paths, lockfile drift, dev-only dep used at runtime |
| `x is not a function` after upgrade | Breaking API change → `libdocs` + migration guide |
| Type errors only in CI | Different TS version / `skipLibCheck` / stricter config in CI |
| `ECONNREFUSED`/timeout in tests | Test hits a real service; mock it or start it in CI |
| Next.js `Dynamic server usage` / prerender errors | Using cookies/headers/searchParams in a statically rendered route |
| Hydration mismatch | Non-deterministic render (Date, random, locale) or invalid HTML nesting |
| 401/403 from an API in prod only | Env var missing in that Vercel environment (`vercel op:env`) |
| Flaky test | Shared state, time, ordering, network. Fix the cause; never mark it skipped to get green |

## Rules
- Quote the log line you're acting on.
- One fix per PR when possible; explain the root cause in the PR body.
- If you can't reproduce or confirm, say what evidence is missing and how to get it.
