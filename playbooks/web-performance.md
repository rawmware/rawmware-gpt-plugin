# Web performance

## Targets (Core Web Vitals, 75th percentile of real users)
| Metric | Good | What it measures |
|---|---|---|
| LCP | ≤ 2.5s | Largest content painted (hero image/headline) |
| INP | ≤ 200ms | Responsiveness to clicks/taps/keys |
| CLS | ≤ 0.1 | Layout shift |
| TTFB | ≤ 0.8s (aim < 200ms cached) | Server + network before first byte |

`site op:health` measures network-side signals (TTFB cold/warm, size, compression, caching, render-blocking scripts, image dimensions). Field data: PageSpeed Insights / CrUX / Vercel Speed Insights.

## Fix order (biggest wins first)
1. **TTFB:** cache HTML at the edge. Static/ISR where possible; `Cache-Control: s-maxage=…, stale-while-revalidate=…` for dynamic-but-shareable pages. Warm vs cold TTFB gap = cold starts or cache misses.
2. **LCP:** preload the hero image (`fetchpriority="high"`), modern formats (AVIF/WebP), correct `sizes`; no lazy-loading above the fold; self-host fonts with `font-display: swap` and preload the main one.
3. **Render-blocking:** `defer`/`async`/`type=module` for scripts; inline critical CSS only if CSS is large; drop unused third-party tags (each costs DNS+TLS+main thread).
4. **CLS:** width/height (or aspect-ratio) on every image/video/iframe; reserve space for ads/embeds; avoid inserting content above existing content.
5. **INP:** less JS on the main thread: code-split, move work to server components / workers, debounce input handlers, avoid huge hydration payloads.
6. **Bytes:** compression (br/gzip) on, images resized, tree-shake, remove polyfills for modern browsers.

## Next.js / Vercel specifics
- Prefer Server Components; `"use client"` only at interactive leaves.
- `next/image` with explicit sizes; `priority` on the LCP image.
- `next/font` for self-hosted fonts with zero layout shift.
- Route segment config: `export const revalidate = N` for ISR; avoid accidental dynamic rendering (cookies/headers in shared layouts).
- Check `x-vercel-cache` (HIT/MISS/STALE) in `site op:health`.
- Use `@vercel/speed-insights` for field Web Vitals; `vercel op:logs` for build issues.

## Security headers (cheap, high value)
`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` · `Content-Security-Policy` (start with report-only) · `X-Content-Type-Options: nosniff` · `Referrer-Policy: strict-origin-when-cross-origin` · `Permissions-Policy` · `X-Frame-Options: DENY` (or CSP `frame-ancestors`). On Vercel: `headers` in `vercel.json` or `next.config.js`.
