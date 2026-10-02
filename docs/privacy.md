# Privacy policy: rawmware Operator

_Last updated: 2026-10-02_

- **What we receive:** the arguments ChatGPT or your MCP client sends to a tool (URLs, repo names, queries, file contents you ask us to commit) and, if you connect them, your GitHub OAuth token or tokens you send in headers.
- **What we do with it:** call GitHub, Vercel, package registries, OSV.dev, documentation sources and web pages on your behalf, and return a trimmed result. Nothing is sold, shared, or used for advertising or training.
- **Your tokens:** used only for your request, never stored or logged, never used for anyone else. GitHub actions run as you, with exactly your GitHub permissions.
- **Caching:** results may be cached up to 1 hour (memory, and Upstash Redis if enabled) to make repeat requests fast. Anything fetched with your token is cached under a hash of your identity and is never served to another user. Vercel env tools return variable names only, never values.
- **Logs:** standard hosting logs per Vercel's retention.
- **Third parties called on your behalf:** GitHub, Vercel, npm/PyPI/crates.io/Go proxy, OSV.dev, Context7, search providers (Brave/Tavily/Serper/DuckDuckGo), rendering providers (Browserless/Jina Reader), oEmbed endpoints (TikTok/YouTube/X/Meta), OpenAI (only with your own key), and registry MCP servers you call via `plugin_call`.
- **Contact:** https://github.com/rawmware/rawmware-gpt-plugin/issues
