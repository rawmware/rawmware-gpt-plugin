// GitHub OAuth token exchange for Custom GPT Actions.
// In the GPT editor: Authentication → OAuth
//   Authorization URL: https://github.com/login/oauth/authorize
//   Token URL:         https://<domain>/api/oauth/token   (this file)
//   Scope:             repo read:user   (or public_repo for public-only)
// GitHub returns form-encoded tokens unless asked for JSON; this proxy always
// asks for JSON so ChatGPT can parse it. Nothing is stored.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let params = req.body || {};
  if (typeof params === 'string') params = Object.fromEntries(new URLSearchParams(params));
  const body = {
    client_id: params.client_id || process.env.GITHUB_CLIENT_ID,
    client_secret: params.client_secret || process.env.GITHUB_CLIENT_SECRET,
    code: params.code,
    redirect_uri: params.redirect_uri,
    grant_type: params.grant_type,
    refresh_token: params.refresh_token,
  };
  // Basic auth is the other way OAuth clients send credentials.
  const basic = (req.headers.authorization || '').match(/^Basic\s+(.+)$/i)?.[1];
  if (basic) {
    const [id, secret] = Buffer.from(basic, 'base64').toString().split(':');
    body.client_id ||= decodeURIComponent(id);
    body.client_secret ||= decodeURIComponent(secret || '');
  }
  if (!body.client_id || !body.client_secret || !(body.code || body.refresh_token)) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'client_id, client_secret and code are required' });
  }
  const r = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(Object.fromEntries(Object.entries(body).filter(([, v]) => v))),
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json().catch(() => ({ error: 'bad_response' }));
  res.setHeader('cache-control', 'no-store');
  return res.status(j.error ? 400 : 200).json(j);
}
