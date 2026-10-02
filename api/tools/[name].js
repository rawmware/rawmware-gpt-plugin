// REST surface for Custom GPT Actions: POST /api/tools/<tool> with JSON args.
import { TOOLS } from '../../lib/tools.js';
import { authorized } from '../../lib/auth.js';

export default async function handler(req, res) {
  const { name } = req.query;
  const fn = TOOLS[name];
  if (!fn) return res.status(404).json({ error: `unknown tool ${name}` });
  if (req.method !== 'POST') return res.status(405).end();
  if (!authorized(req, name)) return res.status(401).json({ error: 'write tool needs OPERATOR_API_KEY' });
  try {
    const args = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    res.status(200).json(await fn(args));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
