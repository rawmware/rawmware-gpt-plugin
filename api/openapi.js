// Live OpenAPI spec for Custom GPT Actions. In the GPT editor:
// Actions → Import from URL → https://<your-deployment>/api/openapi
import { SCHEMAS } from '../lib/schemas.js';

export function buildSpec(origin) {
  const paths = {};
  for (const [name, s] of Object.entries(SCHEMAS)) {
    paths[`/api/tools/${name}`] = {
      post: {
        operationId: name,
        summary: s.description,
        requestBody: { required: true, content: { 'application/json': { schema: s.input } } },
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'rawmware operator', version: '1.0.0', description: 'Scrape → research → document → analyze → build.' },
    servers: [{ url: origin }],
    paths,
  };
}

export default function handler(req, res) {
  const origin = process.env.PUBLIC_URL || `https://${req.headers.host}`;
  res.status(200).json(buildSpec(origin));
}
