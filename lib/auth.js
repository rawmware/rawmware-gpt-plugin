// Read tools are public. Anything that writes with the server's credentials
// (GitHub token, Vercel token, OpenAI key) needs the owner's key.
// Set OPERATOR_API_KEY in Vercel env; send it as `Authorization: Bearer <key>`.
import { timingSafeEqual } from 'node:crypto';

// tool -> '*' (every op) or the list of gated ops.
export const WRITE_OPS = {
  github_write: '*',
  docs: ['write'],
  vercel: ['redeploy'],
};

export function isOwner(headers = {}) {
  const key = process.env.OPERATOR_API_KEY;
  const sent = (headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!key || !sent || key.length !== sent.length) return false;
  return timingSafeEqual(Buffer.from(key), Buffer.from(sent));
}

export function needsOwner(tool, args = {}) {
  const gate = WRITE_OPS[tool];
  if (!gate) return false;
  return gate === '*' || gate.includes(args.op);
}

export function authorized(headers, tool, args) {
  return !needsOwner(tool, args) || isOwner(headers);
}
