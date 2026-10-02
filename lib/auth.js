// Who is calling, and with whose credentials.
//
//   Authorization: Bearer <OPERATOR_API_KEY>   → owner: server tokens unlocked
//   Authorization: Bearer gh*_… / github_pat_… → the user's own GitHub token
//                                                (GPT Actions OAuth with GitHub)
//   x-github-token / x-vercel-token / x-openai-key → bring-your-own keys (MCP clients)
//
// Users act as themselves with their own tokens: their private repos, their
// PRs, their Vercel projects. The server's tokens are only ever used for
// public reads (GitHub) or by the owner. Never for strangers' writes.
import { timingSafeEqual, createHash } from 'node:crypto';

const GH_TOKEN = /^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$/;

function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function credentials(headers = {}) {
  const bearer = (headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const owner = safeEqual(bearer, process.env.OPERATOR_API_KEY);
  const userGithub = headers['x-github-token'] || (GH_TOKEN.test(bearer) ? bearer : null);
  const userVercel = headers['x-vercel-token'] || null;
  const userOpenai = headers['x-openai-key'] || null;
  const github = userGithub || process.env.GITHUB_TOKEN || null;
  const vercel = userVercel || (owner ? process.env.VERCEL_TOKEN : null) || null;
  const openai = userOpenai || (owner ? process.env.OPENAI_API_KEY : null) || null;
  // Cache partition: anything fetched with a user's token is private to them.
  const ident = userGithub || userVercel || userOpenai ? createHash('sha256').update(`${userGithub}|${userVercel}|${userOpenai}`).digest('hex').slice(0, 16) : owner ? 'owner' : 'public';
  return { owner, github, userGithub: !!userGithub, vercel, userVercel: !!userVercel, openai, ident };
}

// Is this call allowed with these credentials? Returns an error string or null.
export function denied(tool, args = {}, c) {
  if (tool === 'github_write' && !c.userGithub && !c.owner) {
    return 'github_write acts as you: connect GitHub (GPT: sign in when prompted; MCP: send x-github-token).';
  }
  if (tool === 'vercel' && !c.vercel) {
    return 'vercel needs your Vercel token: send x-vercel-token (create one at vercel.com/account/tokens).';
  }
  if (tool === 'docs' && args.op === 'write' && !c.owner && !(c.userGithub && args.repo)) {
    return 'docs write: pass repo (your own) and connect GitHub, or use the owner key.';
  }
  return null;
}

export const WRITE_TOOLS = new Set(['github_write']);
