// MCP prompts: one-click developer workflows that clients show as slash
// commands. Each one chains tools so the job finishes in a few calls.
export const PROMPTS = {
  fix_ci: {
    description: 'Find why CI is failing and push a fix.',
    args: [{ name: 'repo', description: 'owner/name', required: true }, { name: 'run_id', description: 'Optional run id' }],
    text: ({ repo, run_id }) => `CI is failing on ${repo}. 1) github op:run_logs${run_id ? ` run_id:${run_id}` : ''} → quote the first real error. 2) github op:file (paths[] + lines) for the code it points at; github op:grep if the cause is elsewhere. 3) If it's a library API, libdocs to confirm current usage. 4) Root cause in one line, then the fix as complete files. 5) github_write op:pr on a fix/ branch. 6) Say how to verify.`,
  },
  review_pr: {
    description: 'Review a pull request like a senior engineer.',
    args: [{ name: 'repo', description: 'owner/name', required: true }, { name: 'number', description: 'PR number', required: true }],
    text: ({ repo, number }) => `Review ${repo}#${number}. github op:pr → read the diff. Pull surrounding code with op:file lines where the diff isn't enough. playbook code-review section Checklist. Report: blocking issues (bugs, security, data loss) with file:line, then non-blocking, then what's good. Verify library usage with libdocs when unsure. Offer github_write op:review with inline comments.`,
  },
  fix_deploy: {
    description: 'Find why a Vercel deploy failed and fix it.',
    args: [{ name: 'project', description: 'Vercel project', required: true }],
    text: ({ project }) => `Vercel project ${project} is failing. vercel op:logs project:${project} (latest failed) → quote the first error → vercel op:project for build settings → if code, github op:file/grep on the linked repo → exact fix → github_write op:pr → how to verify (vercel op:deployments after push).`,
  },
  audit_repo: {
    description: 'Audit a repo and ship the top fixes.',
    args: [{ name: 'repo', description: 'owner/name', required: true }],
    text: ({ repo }) => `Audit ${repo}: github op:audit + deps op:audit in parallel. Rank the 5 highest-impact fixes (security first, then broken CI, then reliability, then DX) by impact/effort. For the top 3, read the relevant files and write complete fixes. Offer one PR per fix.`,
  },
  upgrade_deps: {
    description: 'Plan and ship dependency upgrades safely.',
    args: [{ name: 'repo', description: 'owner/name', required: true }],
    text: ({ repo }) => `deps op:audit repo:${repo}. Fix vulnerabilities first (smallest version that fixes). For each major upgrade, libdocs the library's migration/breaking changes and github op:grep for affected call sites. Output: ordered upgrade plan, code changes per step, and the manifest diff. Offer github_write op:pr.`,
  },
  research_build: {
    description: 'Research the current best way to build X, then build it.',
    args: [{ name: 'goal', description: 'What to build', required: true }],
    text: ({ goal }) => `Goal: ${goal}. docs op:search first. libdocs for each library involved. research (depth 3) for approach tradeoffs. 10-line brief with sources. Pick one approach and why. Then build it: complete, runnable files + commands. Offer docs op:write for the brief.`,
  },
  site_check: {
    description: 'Check a live site: speed, caching, security, SEO, broken pages.',
    args: [{ name: 'url', description: 'Site URL', required: true }],
    text: ({ url }) => `site op:health ${url} and site op:crawl ${url} max_pages:20 in parallel. playbook web-performance. Report the top fixes by user impact, each with the exact config/code change (Next.js/Vercel specifics if detected).`,
  },
  design_review: {
    description: 'Score a site’s design and produce a tighter design system.',
    args: [{ name: 'url', description: 'Site URL', required: true }, { name: 'reference', description: 'Optional site to match' }],
    text: ({ url, reference }) => `site op:design ${url}${reference ? ` and ${reference}` : ''}. playbook design-taste. Give: grade, the 5 fixes that matter most, and a paste-ready token set (CSS variables: palette, type scale, spacing, radius, motion)${reference ? ` that moves toward ${reference}'s system` : ''}.`,
  },
  whats_new: {
    description: 'What changed this month in my stack, and what to do about it.',
    args: [{ name: 'stack', description: 'e.g. Next.js, Vercel, OpenAI', required: true }],
    text: ({ stack }) => `Stack: ${stack}. For each piece: github op:releases on its repo + trends topic. Give the 5 changes that affect me, ranked, each with the concrete action (and code if needed).`,
  },
};
