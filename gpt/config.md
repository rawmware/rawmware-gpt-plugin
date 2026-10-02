# GPT editor config

Do this in your browser at chatgpt.com → Explore GPTs → Create → **Configure**.

**Name:** rawmware Operator

**Description** (≤300 chars):
Reads your repo, your Vercel deploys and the live web, then ships the fix. Scrape → research → document → analyze → build. Scores design taste, reads Instagram/TikTok, tracks what's trending, and finds the right plugin for every job.

**Instructions:** paste everything below `<!-- paste below -->` in [`instructions.md`](instructions.md).

**Conversation starters** (each shows a different superpower):
1. Audit my repo and give me the 3 highest-impact fixes as diffs: github.com/…
2. My Vercel deploy is failing. Find out why and give me the fix.
3. Score the design of my site against linear.app and give me a cleaner token set: …
4. Turn my latest project into a week of Reels/TikToks with hooks and captions: …

**Knowledge:** none needed (playbooks are fetched live, so they stay current).

**Capabilities:** ✅ Web Search · ✅ Code Interpreter & Data Analysis · ✅ Image Generation · ✅ Canvas
(The instructions route work to these first, since they're included in the user's plan.)

**Actions:** Create new action → **Import from URL** → `https://<your-vercel-domain>/openapi.json`
- **Public GPT:** Authentication: *None*. Read tools work; 🔒 tools return a clear 401 message.
- **Your private copy:** duplicate the GPT, set Authentication: *API Key → Bearer*, paste `OPERATOR_API_KEY`. This unlocks `github_write`, `docs write`, `vercel redeploy`.
- **Privacy policy URL** (required to publish): `https://github.com/rawmware/rawmware-gpt-plugin/blob/main/docs/privacy.md`

**Publishing to the GPT Store**
1. Settings → Builder profile → verify a domain (e.g. your Vercel domain) or link socials.
2. Share → *GPT Store* → category **Programming** (or Productivity).
3. Copy the GPT link into `GPT_URL` in `public/index.html` and the README "Use it" table.

**ChatGPT app (MCP) instead of / alongside Actions**
Settings → Apps & Connectors → Advanced → Developer mode → Create → MCP server URL `https://<domain>/mcp`, auth *None* (or OAuth later). Apps get the result-card widget and tool annotations.
