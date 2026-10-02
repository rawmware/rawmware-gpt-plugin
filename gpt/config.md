# GPT editor config

chatgpt.com → Explore GPTs → Create → **Configure**.

**Name:** rawmware Operator

**Description:**
Fixes red CI, failed Vercel deploys and vulnerable dependencies, reviews PRs, and opens PRs as you on GitHub, using current library docs instead of stale training data.

**Instructions:** paste everything below `<!-- paste below -->` in [`instructions.md`](instructions.md).

**Conversation starters**
1. Why is CI failing on my repo? Fix it: github.com/…
2. Review PR #… on owner/repo
3. Audit dependencies in owner/repo and fix the vulnerable ones
4. Check my site's speed, caching and headers: https://…

**Knowledge:** none (playbooks are fetched live).

**Capabilities:** ✅ Web Search · ✅ Code Interpreter & Data Analysis · ✅ Image Generation · ✅ Canvas

## Actions
Create new action → **Import from URL** → `https://<your-domain>/openapi.json`

### Authentication: OAuth with GitHub (recommended)
Users sign in once; every GitHub call then runs **as them** (private repos, CI logs, PRs).
1. github.com/settings/developers → **New OAuth App**. Homepage: your domain. Callback URL: temporary (ChatGPT shows the real one after saving).
2. In the GPT action → Authentication → **OAuth**:
   - Client ID / Client Secret: from the OAuth app
   - Authorization URL: `https://github.com/login/oauth/authorize`
   - Token URL: `https://<your-domain>/api/oauth/token` (returns JSON; GitHub's own endpoint defaults to form-encoding)
   - Scope: `repo read:user` (use `public_repo read:user` if you only want public repos)
   - Token exchange method: Default (POST)
3. Save, copy the **Callback URL** ChatGPT shows, and paste it into the GitHub OAuth app.
4. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in Vercel too (the token proxy uses them if ChatGPT doesn't send them).

### Alternative: no auth
Public repos, web, deps, libdocs and site checks work; GitHub writes return a clear "connect GitHub" message.

**Privacy policy URL** (required to publish): `https://github.com/rawmware/rawmware-gpt-plugin/blob/main/docs/privacy.md`

## ChatGPT app (MCP)
Settings → Apps & Connectors → Advanced → Developer mode → Create → `https://<domain>/mcp`. You get the result widget and tool annotations. For per-user GitHub/Vercel access in other MCP clients, set headers `x-github-token` / `x-vercel-token`.

## Claude Code / Cursor
```bash
claude mcp add --transport http rawmware https://<domain>/mcp --header "x-github-token: $GITHUB_TOKEN"
```
```json
{ "mcpServers": { "rawmware": { "url": "https://<domain>/mcp", "headers": { "x-github-token": "ghp_…", "x-vercel-token": "…" } } } }
```
