import { api } from '../net.js';
import { compact } from '../compress.js';

async function vc(path, opts = {}) {
  if (!process.env.VERCEL_TOKEN) throw new Error('VERCEL_TOKEN not configured on the server (owner deployments only)');
  const team = process.env.VERCEL_TEAM_ID ? `${path.includes('?') ? '&' : '?'}teamId=${process.env.VERCEL_TEAM_ID}` : '';
  const headers = { authorization: `Bearer ${process.env.VERCEL_TOKEN}` };
  if (opts.body) headers['content-type'] = 'application/json';
  const r = await api(`https://api.vercel.com${path}${team}`, { ...opts, headers });
  return r.json();
}

const iso = (t) => (t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') : undefined);
const need = (v, name) => { if (!v) throw new Error(`${name} is required`); return v; };

export async function vercel({ op, project, deployment_id, limit = 10, target = 'production' }) {
  limit = Math.min(limit, 50);
  switch (op) {
    case 'projects': {
      const r = await vc(`/v9/projects?limit=${limit}`);
      return r.projects.map((p) => compact({ name: p.name, framework: p.framework, repo: p.link?.repo ? `${p.link.org || p.link.owner || ''}/${p.link.repo}` : undefined, updated: iso(p.updatedAt) }));
    }
    case 'project': {
      const p = await vc(`/v9/projects/${encodeURIComponent(need(project, 'project'))}`);
      return compact({
        name: p.name, framework: p.framework, node: p.nodeVersion, root: p.rootDirectory, build: p.buildCommand, output: p.outputDirectory,
        repo: p.link?.repo, branch: p.link?.productionBranch, domains: (p.targets?.production?.alias || (p.alias || []).map((a) => a.domain || a)).slice(0, 10),
        latest: p.latestDeployments?.slice(0, 3).map((d) => `${d.readyState} ${d.url} ${iso(d.createdAt)}`),
      });
    }
    case 'deployments': {
      const r = await vc(`/v6/deployments?limit=${limit}${project ? `&app=${encodeURIComponent(project)}` : ''}`);
      return r.deployments.map((d) => compact({ id: d.uid, url: d.url, state: d.state || d.readyState, target: d.target, branch: d.meta?.githubCommitRef, commit: d.meta?.githubCommitMessage?.split('\n')[0]?.slice(0, 80), at: iso(d.created) }));
    }
    case 'logs': {
      const r = await vc(`/v3/deployments/${encodeURIComponent(need(deployment_id, 'deployment_id'))}/events?limit=-1&builds=1`);
      const lines = (Array.isArray(r) ? r : []).map((e) => e.payload?.text || e.text).filter(Boolean);
      // Errors first — that's what you're here for. Plus the first error's context.
      const firstErr = lines.findIndex((l) => /error|failed|cannot|not found|exit code/i.test(l));
      return compact({
        lines: lines.length,
        errors: lines.filter((l) => /error|fail|cannot|not found|exit code|warn/i.test(l)).slice(-30),
        context: firstErr >= 0 ? lines.slice(Math.max(0, firstErr - 8), firstErr + 6) : undefined,
        tail: lines.slice(-15),
      });
    }
    case 'env': {
      // Keys and targets only — never values.
      const r = await vc(`/v9/projects/${encodeURIComponent(need(project, 'project'))}/env`);
      return r.envs.map((e) => `${e.key} [${[].concat(e.target).join(',')}] ${e.type}`);
    }
    case 'redeploy': {
      need(deployment_id, 'deployment_id');
      const d = await vc(`/v13/deployments/${encodeURIComponent(deployment_id)}`);
      const r = await vc('/v13/deployments', {
        method: 'POST',
        body: JSON.stringify({ name: d.name, deploymentId: deployment_id, target }),
      });
      return { redeploying: r.id, url: r.url, state: r.readyState || r.status, inspector: r.inspectorUrl };
    }
    default:
      throw new Error(`unknown vercel op: ${op}`);
  }
}
