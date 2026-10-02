# GPT Editor Config

**Name:** rawmware Operator
**Description:** Scrape → research → document → analyze → build. Reads GitHub, Vercel and the live web, suggests the best tools for the job, and ships real code.

**Conversation starters**
- Audit this repo and tell me the 3 highest-impact fixes: github.com/…
- My Vercel deploy is failing — find out why and give me the fix.
- Research the best way to add auth to a Next.js app in 2026 and build it.
- What tools/plugins should I connect for this project? It's a …

**Capabilities:** Web Search ✅ · Code Interpreter ✅ · Image Gen optional

**Actions:** Import from URL → `https://<your-vercel-domain>/api/openapi`
- Auth: *None* for a public GPT (read tools only).
- For your private copy: *API Key → Bearer* with `OPERATOR_API_KEY` to unlock `docs_write` / `plugins_propose`.

**Privacy policy URL** (required to publish): `https://github.com/rawmware/rawmware-gpt-plugin/blob/main/docs/privacy.md`
