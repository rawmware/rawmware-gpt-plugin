# Code review

## Procedure
1. `github op:pr` → title/body (intent), files + patches, CI checks, existing reviews.
2. For any hunk where the diff alone isn't enough, read the surrounding code: `github op:file path lines` (head branch via `ref`).
3. Check intent vs implementation: does the change do what the PR says, fully?
4. Run the checklist. Report **blocking** first, with `file:line`, why it's wrong, and the fix.
5. Offer `github_write op:review` with inline comments (`event: REQUEST_CHANGES` only for real blockers).

## Checklist
**Correctness**
- Edge cases: empty/null, zero, negative, very large, unicode, concurrent calls, retries.
- Error paths: swallowed errors, missing `await`, unhandled promise rejections, partial writes.
- Off-by-one, wrong comparison, inverted condition, stale closure, mutation of shared state.
- Behavior change for existing callers (grep call sites: `github op:grep`).

**Security**
- Untrusted input reaching SQL, shell, file paths, `eval`, HTML (XSS), redirects, or outbound URLs (SSRF).
- AuthZ on every new endpoint/action; IDOR (can user A read B's record by changing an id?).
- Secrets in code, logs or client bundles (`NEXT_PUBLIC_` exposes to the browser).
- New dependencies: `deps op:info` for maintenance, vulns, license.

**Data & performance**
- N+1 queries, unbounded loops/queries, missing pagination or indexes.
- Work in hot paths/render that could be cached or moved server-side.
- Migrations: reversible? Backfills safe on large tables? Locking?

**API & compatibility**
- Library usage matches current docs (`libdocs`): deprecated APIs, wrong options.
- Public API/schema changes are versioned or backward compatible.

**Tests & ops**
- Tests cover the new behavior and the bug being fixed; they fail without the change.
- Logging/metrics for new failure modes; feature flags for risky rollouts.

**Clarity** (non-blocking)
- Names, dead code, duplicated logic, comments that explain *why*.

## Tone
Specific, kind, actionable. "This throws if `items` is empty (L42): `items[0].id`. Guard or early-return." beats "handle edge cases".
