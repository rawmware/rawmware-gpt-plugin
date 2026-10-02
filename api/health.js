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
      vercel: has('VERCEL_TOKEN'),
      search: has('BRAVE_API_KEY') ? 'brave' : 'duckduckgo',
      render: has('BROWSERLESS_TOKEN') ? 'browserless' : 'jina',
      shared_cache: has('UPSTASH_REDIS_REST_URL'),
      openai_owner: has('OPENAI_API_KEY'),
      instagram_oembed: has('META_APP_TOKEN'),
    },
  });
}
