// REST surface for Custom GPT Actions: POST /api/tools/<tool> with JSON args.
import { runTool } from '../../lib/run.js';

export default async function handler(req, res) {
  const { name } = req.query;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let args;
  try {
    args = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  } catch {
    return res.status(400).json({ error: 'body must be JSON' });
  }
  try {
    const out = await runTool(name, args, req.headers);
    res.status(200).json(Array.isArray(out) ? { items: out } : out);
  } catch (e) {
    // Errors are returned as JSON the model can read and act on.
    res.status(e.status || 502).json({ error: e.message });
  }
}
