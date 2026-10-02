# Token economy: why less is more

## Why it matters
1. **Cost.** Every token in a tool result is paid for, by the user's plan limits or by API spend. A raw GitHub API response or HTML page is 5–20× bigger than the useful part.
2. **Quality.** Models reason worse over long, noisy context. Relevant facts get buried ("lost in the middle"). Less junk in = sharper answers out.
3. **Speed.** Fewer input tokens = faster first token, faster turns.
4. **Runway.** Context windows fill up. Every wasted token is one less turn before the conversation degrades or gets summarized.
5. **Repetition.** Tool descriptions and instructions are re-sent *every turn*. 100 wasted words there cost 100 × every message, forever.

## How the operator saves tokens (by design)
| Technique | Where |
|---|---|
| Strip scripts/nav/footer; prefer `<main>` | `web_fetch` |
| `find:` returns only matching lines ±context | `web_fetch`, `research`, `playbook` |
| Hard caps with "call again with offset=N" markers | all text tools |
| `lines:"10-80"` partial file reads; `paths:[…]` batch reads | `github op:file` |
| grep instead of reading whole files | `github op:grep` |
| Parallel multi-URL reads in one call | `web_fetch urls:[…]` |
| Log → first error + context, not 5,000 lines | `github op:run_logs`, `vercel op:logs` |
| ETag revalidation (304 = free, instant) | every GitHub read |
| Pick ~10 useful fields from 100-field API objects | `github`, `vercel` |
| Composite calls (1 call replaces 6) | `github op:audit`/`op:pr`, `deps op:audit`, `research` |
| Errors first in logs | `vercel op:logs` |
| Compact JSON, empty fields dropped | every response |
| Knowledge loaded on demand, one section at a time | `playbook` |
| Memory: search past research before redoing it | `docs op:search` |
| Two-tier cache (memory + Upstash) | every read tool |
| Short tool descriptions (CI-enforced budget) | `lib/schemas.js` + tests |

## Rules for the model
- Smallest useful slice first: `meta` → `find` → full text.
- Never fetch the same URL twice; page with `offset`.
- Don't paste tool output back to the user; synthesize it.
- Deliverable first, context after, no restating the question.
- Reasoning shown: 1–3 lines that matter, not a monologue.
