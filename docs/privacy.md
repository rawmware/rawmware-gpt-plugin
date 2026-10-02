# Privacy policy: rawmware Operator

_Last updated: 2026-10-02_

- **What we receive:** only the arguments ChatGPT or your MCP client sends to a tool (URLs, repo names, search queries, text you ask us to process).
- **What we do with it:** fetch public web pages, public GitHub data, public social-media metadata, and (for the owner) Vercel data, then return a trimmed result. Nothing is sold, shared or used for advertising or training.
- **Retention:** results may be cached for up to 1 hour to make repeat requests fast and cheap (in memory and, if enabled, in an Upstash Redis cache). Standard hosting logs are kept per Vercel's retention.
- **API keys:** if you send your own OpenAI key in the `x-openai-key` header, it's used for that single request and never stored or logged; those results are never cached.
- **Write tools** (`github_write`, `docs write`, `vercel redeploy`) only work with the owner's key and only write to the owner's allowlisted repositories.
- **Feedback & proposals** generate a GitHub link; nothing is posted unless you submit it yourself on GitHub.
- **Third parties called on your behalf:** GitHub, Vercel, search providers (Brave or DuckDuckGo), rendering providers (Browserless or Jina Reader), oEmbed endpoints (TikTok, YouTube, X, Meta), OpenAI (BYOK only), and MCP servers in the registry when you use `plugin_call`.
- **Contact:** open an issue at https://github.com/rawmware/rawmware-gpt-plugin/issues
