# Design taste

Taste = restraint + a system + craft in the details. It's learnable, and `site op:design` measures most of it.

## Principles
1. **One idea per screen.** If you can't say what the page is for in 5 words, nothing else matters.
2. **Hierarchy through size and weight, not color.** One thing is loudest. Everything else steps down.
3. **Systems, not one-offs.** A type scale, a spacing scale, 2–3 radii, 1 accent. Every value comes from a token.
4. **Whitespace is a feature.** When in doubt, add space, remove a border.
5. **Real content.** Design with the actual words, numbers and photos. Lorem ipsum hides problems.
6. **Details compound.** Focus states, empty states, loading states, 404s, og:images: users feel them even when they can't name them.

## Color
- **60 / 30 / 10:** 60% neutral background, 30% secondary surface/text, 10% one accent.
- Neutrals carry the design: pick a tinted gray ramp (slightly warm or cool), not pure #000/#fff everywhere.
- **One accent.** Use it for the primary action and almost nothing else.
- Contrast: body text ≥ 4.5:1 (aim 7:1), large text ≥ 3:1. Check with `site op:design`.
- Define in OKLCH for perceptually even ramps: `--accent: oklch(0.68 0.2 40)`.
- Dark mode is a separate palette, not an inversion: lift surfaces in lightness, desaturate the accent slightly, never pure black text on pure white or vice versa.
- Smells: purple-to-blue "AI gradient" everywhere, 6 saturated colors, gray text on colored backgrounds.

## Typography
- 1 family is enough; 2 max (display + text). Good free defaults: Inter, Geist, IBM Plex, Instrument Serif (display), JetBrains Mono / Geist Mono (code).
- Scale (px): 12 · 14 · 16 · 20 · 24 · 32 · 48 · 64. Ratio ~1.25.
- Body 16–18px, line-height 1.5–1.65, measure 60–75 characters.
- Headings: tighter line-height (1.1–1.2) and slight negative tracking (-0.01 to -0.03em) at large sizes.
- Numbers in tables/dashboards: `font-variant-numeric: tabular-nums`.
- Max 3 weights on a page (e.g. 400/500/700).

## Spacing & layout
- 4px base, 8px rhythm: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96.
- Group with proximity: space inside a group < space between groups.
- Max content width ~1100–1200px; text columns ~680px.
- Mobile first. 16px side gutters. No horizontal scroll, ever. Tap targets ≥ 44px.
- Align to a grid; when two things nearly line up, make them exactly line up.

## Shape, depth & motion
- Radius: 2–3 values (e.g. 6 / 12 / 999). Nested radius = outer − padding.
- Shadows: soft, low-opacity, layered; or use 1px borders instead. Not both heavy.
- Motion: 150–250ms for UI, ease-out for entering, ease-in for leaving. Animate transform/opacity only.
- Respect `prefers-reduced-motion`. Motion should explain (where did this come from?), not decorate.

## Interaction craft checklist
- Every interactive element: hover, `:focus-visible`, active, disabled states.
- Buttons say what happens ("Deploy", not "Submit").
- Loading: skeletons for layout, spinners only for <1s actions; optimistic UI where safe.
- Empty states teach the next action.
- Forms: labels always visible, errors inline and specific, keyboard works end to end.
- Images: explicit width/height (no layout shift), alt text, modern formats.
- og:image + title + description on every shareable page. The share preview IS the first impression on IG/X/iMessage.

## References worth studying
Linear (restraint, motion), Vercel/Geist (type, grid, dark mode), Stripe (gradients done right, docs), Apple (hierarchy, photography), Rauno Freiberg & Emil Kowalski (interaction craft), Rasmus Andersson / Inter (type), Refactoring UI (practical rules).

## Using site op:design
- Score ≥ 90 = disciplined. 75–89 = fine, fix the top 3. < 75 = system problems, rebuild tokens first.
- To "match the taste" of a reference: audit both, then map the reference's tokens (scale, spacing, radii, motion, palette structure) onto the user's brand colors. Copy the *system*, never the brand.
- Output a token file the user can paste:
```css
:root {
  --bg: oklch(0.99 0 0); --fg: oklch(0.18 0 0); --muted: oklch(0.55 0 0); --line: oklch(0.92 0 0);
  --accent: oklch(0.68 0.2 40);
  --step--1: 14px; --step-0: 16px; --step-1: 20px; --step-2: 24px; --step-3: 32px; --step-4: 48px;
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px; --s7: 48px; --s8: 64px;
  --r-sm: 6px; --r-md: 12px; --r-full: 999px;
  --ease-out: cubic-bezier(.2,.8,.2,1); --dur: 180ms;
}
```
