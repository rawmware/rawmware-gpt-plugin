// Live OpenAPI spec for Custom GPT Actions, generated from lib/schemas.js so
// the GPT can never drift from the server. In the GPT editor:
// Actions → Import from URL → https://<your-deployment>/openapi.json
import { SCHEMAS, VERSION } from '../lib/schemas.js';
import { WRITE_TOOLS } from '../lib/auth.js';

export function buildSpec(origin) {
  const paths = {};
  for (const [name, s] of Object.entries(SCHEMAS)) {
    paths[`/api/tools/${name}`] = {
      post: {
        operationId: name,
        summary: s.description.slice(0, 300),
        // Writes ask the user to confirm in ChatGPT; reads run without a prompt.
        'x-openai-isConsequential': WRITE_TOOLS.has(name),
        requestBody: { required: true, content: { 'application/json': { schema: s.input } } },
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          default: { description: 'Error', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } },
        },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'rawmware Operator',
      version: VERSION,
      description: 'Developer operator: GitHub (as you), Vercel, dependency security, current library docs, live-site checks, web research.',
    },
    servers: [{ url: origin }],
    paths,
    components: { schemas: {}, securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
  };
}

export default function handler(req, res) {
  const origin = process.env.PUBLIC_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  res.setHeader('cache-control', 'public, max-age=300');
  res.status(200).json(buildSpec(origin));
}
