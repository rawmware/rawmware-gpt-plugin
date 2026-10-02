// Vercel with the caller's own token (x-vercel-token), or the owner's.
// Never the owner's token for anyone else: their projects are their business.
import { api } from '../net.js';
import { compact, logErrors } from '../compress.js';

async function vc(path, opts = {}, ctx = {}, team) {
  if (!ctx.vercel) throw new Error('vercel needs your token: send x-vercel-token (vercel.com/account/tokens)');
  const teamId = team || (ctx.userVercel ? null : process.env.VERCEL_TEAM_ID);
  const q = teamId ? `${path.includes('?') ? '&' : '?'}${teamId.startsWith('team_') ? 'teamId' : 'slug'}=${encodeURIComponent(teamId)}` : '';
  const headers = { authorization: `Bearer ${ctx.vercel}` };
  if (opts.body) headers['content-type'] = 'application/json';
  const r = await api(`https://api.vercel.com${path}${q}`, { ...opts, headers, timeout: opts.timeout || 12000 });
  return opts.text ? r.text() : r.json();
}

const iso = (t) => (t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') : undefined);
const need = (v, name) => { if (!v) throw new Error(`${name} is required`); return v; };

export async function vercel({ op, project, deployment_id, limit = 10, target = 'production', team, state }, ctx = {}) {
  limit = Math.min(limit, 50);
  const P = () => encodeURIComponent(need(project, 'project'));
  switch (op) {
    case 'projects': {
      const r = await vc(`/v9/projects?limit=${limit}`, {}, ctx, team);
      return r.projects.map((p) => compact({ name: p.name, framework: p.framework, repo: p.link?.repo ? `${p.link.org || p.link.owner || ''}/${p.link.repo}` : undefined, prod: p.targets?.production?.alias?.[0], updated: iso(p.updatedAt) }));
    }
    case 'project': {
      const p = await vc(`/v9/projects/${P()}`, {}, ctx, team);
      return compact({
        name: p.name, framework: p.framework, node: p.nodeVersion, root: p.rootDirectory, install: p.installCommand, build: p.buildCommand, output: p.outputDirectory,
        repo: p.link?.repo, branch: p.link?.productionBranch, domains: (p.targets?.production?.alias || (p.alias || []).map((a) => a.domain || a)).slice(0, 10),
        latest: p.latestDeployments?.slice(0, 3).map((d) => `${d.readyState} ${d.url} ${iso(d.createdAt)}`),
      });
    }
    case 'deployments': {
      const st = state ? `&state=${encodeURIComponent(state.toUpperCase())}` : '';
      const r = await vc(`/v6/deployments?limit=${limit}${project ? `&projectId=${P()}` : ''}${st}`, {}, ctx, team);
      return r.deployments.map((d) => compact({ id: d.uid, url: d.url, state: d.state || d.readyState, target: d.target, branch: d.meta?.githubCommitRef, commit: d.meta?.githubCommitMessage?.split('\n')[0]?.slice(0, 80), at: iso(d.created) }));
    }
    case 'logs': {
      // Build logs. No id → newest ERROR deployment of the project.
      let id = deployment_id;
      if (!id) {
        const r = await vc(`/v6/deployments?limit=1&state=ERROR${project ? `&projectId=${P()}` : ''}`, {}, ctx, team);
        id = r.deployments[0]?.uid;
        if (!id) return { note: 'No failed deployments found.' };
      }
      const [d, events] = await Promise.all([
        vc(`/v13/deployments/${encodeURIComponent(id)}`, {}, ctx, team),
        vc(`/v3/deployments/${encodeURIComponent(id)}/events?limit=-1&builds=1`, {}, ctx, team),
      ]);
      const lines = (Array.isArray(events) ? events : []).map((e) => e.payload?.text || e.text).filter(Boolean).join('\n');
      return compact({
        deployment: id, url: d.url, state: d.readyState, target: d.target, branch: d.meta?.githubCommitRef,
        commit: d.meta?.githubCommitSha?.slice(0, 7), error: d.errorMessage || d.errorCode,
        ...logErrors(lines),
      });
    }
    case 'env': {
      // Keys and targets only, never values.
      const r = await vc(`/v9/projects/${P()}/env`, {}, ctx, team);
      return r.envs.map((e) => `${e.key} [${[].concat(e.target).join(',')}] ${e.type}`);
    }
    case 'domains': {
      const r = await vc(`/v9/projects/${P()}/domains`, {}, ctx, team);
      return r.domains.map((x) => compact({ name: x.name, verified: x.verified, redirect: x.redirect, branch: x.gitBranch }));
    }
    case 'redeploy': {
      need(deployment_id, 'deployment_id');
      const d = await vc(`/v13/deployments/${encodeURIComponent(deployment_id)}`, {}, ctx, team);
      const r = await vc('/v13/deployments', { method: 'POST', body: JSON.stringify({ name: d.name, deploymentId: deployment_id, target }) }, ctx, team);
      return { redeploying: r.id, url: r.url, state: r.readyState || r.status, inspector: r.inspectorUrl };
    }
    default:
      throw new Error(`unknown vercel op: ${op}`);
  }
}
