// Read tools are public; write tools use the server's GitHub token, so they
// require the owner's key. Set OPERATOR_API_KEY in Vercel env.
export const WRITE_TOOLS = new Set(['docs_write', 'plugins_propose']);

export function authorized(req, tool) {
  const key = process.env.OPERATOR_API_KEY;
  const sent = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (WRITE_TOOLS.has(tool)) return !!key && sent === key;
  return true;
}
