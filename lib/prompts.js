// MCP prompts: one-click workflows that clients show as slash commands.
// Each is the operator's loop (scrape → research → document → analyze → build)
// specialized for a common job.
export const PROMPTS = {
  audit_repo: {
    description: 'Audit a GitHub repo and ship the top fixes.',
    args: [{ name: 'repo', description: 'owner/name', required: true }],
    text: ({ repo }) => `Audit ${repo}. 1) github op:audit. 2) Read only the files behind the top gaps (github op:file with lines). 3) Rank the 3 highest-impact fixes by impact/effort. 4) Write each fix as a complete diff. 5) Offer github_write op:pr if I have the owner key.`,
  },
  fix_deploy: {
    description: 'Find why a Vercel deploy failed and fix it.',
    args: [{ name: 'project', description: 'Vercel project name', required: true }],
    text: ({ project }) => `My Vercel project ${project} is failing. vercel op:deployments → op:logs on the newest ERROR one → find root cause (quote the log line) → if the fix is in code, read the file via github and give the exact diff → tell me how to verify.`,
  },
  research_build: {
    description: 'Research the current best way to do X, then build it.',
    args: [{ name: 'goal', description: 'What to build', required: true }],
    text: ({ goal }) => `Goal: ${goal}. docs op:search first (maybe we already researched it). Then research (depth 3, official docs first; use plugin_call Context7 for library docs). Write a 10-line brief with sources. Decide one approach and why. Then build it: complete, runnable files. Offer to save the brief with docs op:write.`,
  },
  design_review: {
    description: 'Score a site’s design and produce a tighter design system.',
    args: [{ name: 'url', description: 'Site URL', required: true }, { name: 'reference', description: 'Optional site to match the taste of' }],
    text: ({ url, reference }) => `design_audit ${url}${reference ? ` and ${reference}` : ''}. playbook design-taste. Give: grade, the 5 fixes that matter most, and a cleaned-up token set (CSS variables: palette, type scale, spacing, radius, motion)${reference ? ` that moves ${url} toward ${reference}'s taste` : ''}.`,
  },
  launch_content: {
    description: 'Turn a shipped project into a week of IG Reels / TikTok / X posts.',
    args: [{ name: 'project', description: 'Repo or URL', required: true }],
    text: ({ project }) => `Project: ${project}. Read it (github audit or web_fetch). trends topic matching the project. social op:specs. playbook social-content. Output: 5 short-form video scripts (hook in first 2s, shot list, on-screen text, caption ≤125 visible chars, ≤5 hashtags) + 3 X posts + 1 LinkedIn post. Every post links the repo.`,
  },
  whats_new: {
    description: 'What changed this week in my stack, and what should I do about it?',
    args: [{ name: 'stack', description: 'e.g. Next.js, Vercel, OpenAI', required: true }],
    text: ({ stack }) => `My stack: ${stack}. trends for each piece + research "${stack} changelog this month". Give the 5 changes that affect me, ranked, each with the concrete action to take.`,
  },
};
