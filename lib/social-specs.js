// Platform specs, checked October 2026. The weekly refresh workflow and
// docs/log track changes. Edit here and every deployment picks it up.
export const SPECS_AS_OF = '2026-10-02';

export const SPECS = {
  instagram: {
    reels: { ratio: '9:16', px: '1080x1920', length: 'record ≤3 min in-app, upload ≤15 min; Explore/Reels reach drops past 3 min', safe_zone: 'keep text out of top ~250px and bottom ~350px (UI overlays)' },
    feed: { ratio: '4:5 portrait (best) · 1:1 · 1.91:1', px: '1080x1350' },
    carousel: { slides: 'up to 20', tip: 'slide 1 is the hook, the last slide is the CTA' },
    stories: { ratio: '9:16', px: '1080x1920', length: '60s per segment' },
    caption: { max: 2200, visible: '~125 chars before "more"' },
    hashtags: { max: 5, note: 'hard cap since Dec 2025; caption + first comment combined; over-limit posts lose Explore/Reels reach' },
    bio: { max: 150 },
  },
  tiktok: {
    video: { ratio: '9:16', px: '1080x1920', length: 'in-app ≤10 min, upload ≤60 min', safe_zone: 'keep text out of the bottom ~20% and right edge (buttons)' },
    caption: { max: 2200, visible: '~80–100 chars', note: 'API posting caps at 2200 UTF-16 units' },
    hashtags: { tip: '3–5 specific tags beat many broad ones; search-style keywords in the caption matter' },
    bio: { max: 80 },
  },
  youtube_shorts: { video: { ratio: '9:16', px: '1080x1920', length: '≤3 min' }, title: { max: 100 } },
  x: { post: { max: 280, premium_max: 25000 }, video: { ratio: '16:9 or 1:1 or 9:16', length: '≤2:20 (longer with Premium)' } },
  linkedin: { post: { max: 3000, visible: '~210 chars' }, video: { ratio: '1:1 or 4:5 or 9:16', length: '≤15 min desktop, ≤10 min mobile' } },
  universal: {
    hook: 'First 1–2 seconds decide retention: show the result first, then how.',
    captions: 'Burn in captions; most short-form is watched muted.',
    loop: 'End on a frame that cuts cleanly back to the start; rewatches count.',
    dev_content: 'Screen recordings: zoom to 150%+, crop to the action, never show a full 1440p desktop on a phone.',
  },
};
