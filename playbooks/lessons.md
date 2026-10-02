# Lessons from rawmware's builds

What building TZ, aictuallyhelp, romansproposal.com, recruiter.ai, pocket-agent, flip-engine and the rest taught. The operator applies these so users don't relearn them.

## Projects (live list: `about` tool)
- **TZ / TIZI** (TZ.01, TZ.0002, TZ-IOS, tizi.host): long-running R&D app orchestrated with Codex across desktop + laptop + iOS. Lesson: **one source of truth.** Multiple diverging builds cost more than they save; consolidate early, keep a handoff doc.
- **aictuallyhelp** (aictuallyhelp.vercel.app): helping people with complicated backgrounds (shelters, youth detention) retell their stories with AI. Lesson: **design for the hardest user first**: plain language, zero friction, dignity. If it works for them, it works for everyone.
- **romansproposal.com / rawmware** (Roman's Proposal: websites, custom apps, AI setup & training, NH Seacoast). Lesson: **the portfolio is the pitch.** Ship real sites for real businesses; each one is a case study.
- **recruiter.ai**: agent harness that finds what recruiters want and builds it into a published site. Lesson: **research what the audience is actively asking for, then build exactly that.** Same loop as this operator.
- **flip-engine**: handoff repo (rules, live state, scan logs, dashboard) so any agent can resume. Lesson: **write state down so the next agent (or you tomorrow) picks up instantly.** That's why `docs` exists.
- **pocket-agent**: personal agent on cheap models. Lesson: **route by cost**: small models for routine steps, big ones for decisions.
- **365 days of programming**: shipping daily. Lesson: **consistency compounds** in skill and in audience.

## Cross-cutting lessons
1. **Handoff docs beat memory.** Every project needs a README that a fresh agent can act on in one read.
2. **Ship small, ship daily.** A live URL beats a perfect local build.
3. **Vercel + GitHub is the fastest loop**: push → preview URL → share → feedback.
4. **AI coding agents need guardrails**: tests, a clear spec, and one repo. Without them they drift and duplicate.
5. **Don't fight the platform.** Build on what people already use (ChatGPT, GitHub, Vercel, Instagram) instead of asking them to adopt something new.
6. **Write it down the same day.** Research not documented is research you'll redo.
7. **Real users > imagined users.** Put it in front of someone this week.
