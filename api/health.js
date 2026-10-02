// What's configured on this deployment (booleans only, never values).
import { SCHEMAS, VERSION } from '../lib/schemas.js';

export default function handler(req, res) {
  const has = (k) => Boolean(process.env[k]);
  res.status(200).json({
    ok: true,
    version: VERSION,
    tools: Object.keys(SCHEMAS).length,
    configured: {
      github: has('GITHUB_TOKEN'),
      owner_key: has('OPERATOR_API_KEY'),
      vercel_owner: has('VERCEL_TOKEN'),
      search: ['BRAVE_API_KEY', 'TAVILY_API_KEY', 'SERPER_API_KEY'].filter(has).map((k) => k.split('_')[0].toLowerCase()).concat('duckduckgo'),
      render: has('BROWSERLESS_TOKEN') ? 'browserless' : 'jina',
      shared_cache: has('UPSTASH_REDIS_REST_URL'),
      openai_owner: has('OPENAI_API_KEY'),
      instagram_oembed: has('META_APP_TOKEN'),
      github_oauth: has('GITHUB_CLIENT_ID'),
    },
  });
}
