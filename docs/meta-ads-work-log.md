# Meta Ads Work Log

Date: 2026-05-31

Worktree: `/Users/tianyicai/ai-image-editor-meta-ads-asian-cool`

Branch: `codex/meta-ads-asian-cool`

Related commit: `8c527ee Add Meta ads tracking and research tooling`

## Why This Work Exists

Makaron is preparing its first Meta/Facebook paid-social launch for English-speaking, young Asian-cool audiences. The important strategic shift was to avoid selling Makaron as a generic AI photo editor. That category is crowded, expensive, and hard to differentiate.

The better approach is to sell concrete skills as individual ad products:

- One selfie becomes an idol-stage video.
- One selfie becomes a stadium broadcast moment.
- A camera roll becomes a photo booth / CCD dump.
- A pet photo becomes a mugshot or action movie.
- A still photo becomes a specific scene-based video.

The work in this branch turns that strategy into tracking infrastructure, research tooling, and first-pass launch documentation.

## What Was Implemented

### Meta Tracking

Added Meta Pixel and Conversions API foundations:

- Browser Pixel loader and event helpers.
- Server-side CAPI helper.
- Attribution utilities for `utm_*`, `fbclid`, and event metadata.
- Tracking component mounted in the app layout.
- Event wiring for key paid-social funnel moments:
  - `PageView`
  - `ViewContent`
  - registration / activation
  - project creation / upload
  - checkout / subscription
  - purchase / successful payment

Added a first admin-facing Meta status API:

- `src/app/api/admin/meta/status/route.ts`
- `src/lib/marketing/meta-api.ts`

This is deliberately read-only. The next step is to build toward automation after the funnel is stable.

### English / i18n Readiness

Adjusted English validation paths for the paid landing flow:

- Skill pages support `locale=en`.
- Shared skill links preserve locale.
- Login / auth callback / activation flows preserve landing intent better.
- CUI behavior was checked around the requirement that English user input should produce English assistant replies.

### `/api/skills` Stability

Investigated and patched the `/api/skills` 500 path so the home skill feed can survive inconsistent skill data instead of breaking the paid landing page.

### Apify Swipe Tooling

Added:

- `scripts/meta-swipe-apify.mjs`
- `npm run ads:swipe`
- `docs/meta-apify-swipe-file.md`

The tool runs `apify/facebook-ads-scraper`, normalizes results, and writes:

- raw Apify dataset JSON
- simplified normalized JSON
- markdown swipe table
- local video/image archives

Important fix: Meta `fbcdn.net` asset URLs are short-lived. The scraper now downloads the first video/image immediately into `*-assets/`, and the markdown links local assets first.

### Video Analysis Tooling

Added:

- `scripts/meta-analyze-videos.mjs`

It analyzes competitor or internal skill videos with Gemini and produces JSON + markdown notes:

- first 2 seconds
- shot breakdown
- creative mechanic
- hook strength
- clarity
- Makaron relevance
- what pattern to copy
- what to change for Makaron

It now prefers local archived video files, so analysis does not depend on expired fbcdn links.

### Supabase Skill Inventory

Queried the live `home_skills` data and generated:

- `docs/meta-skill-research/supabase-home-skills.json`
- `docs/meta-skill-research/supabase-home-skills.md`

This gave a real view of the current skill shelf instead of planning from memory.

Current inventory found 78 home skills, including:

- idol-social
- pet
- video
- visual
- utility
- IP/fantasy
- travel

### Research Outputs

Generated positioning and launch documents:

- `docs/makaron-positioning-and-meta-angle.md`
- `docs/meta-ads-asian-cool-launch.md`
- `docs/meta-skill-research/skill-ad-priority-and-creative-plan.md`

Generated Meta swipe and video-analysis artifacts:

- `docs/meta-swipe-runs/`
- `docs/meta-skill-research/video-analysis/`

## Core Strategic Conclusions

### 1. Mobile H5 First

First launch should target mobile H5, not desktop web.

Reason:

- Meta traffic will mainly come from Instagram Reels, Stories, and Feed.
- Users click inside mobile in-app browsers.
- 9:16 creative maps naturally to mobile.
- Desktop web should remain functional, but it is not the first paid acquisition surface.

### 2. Do Not Lead With "AI Photo Editor"

That angle is too broad and too competitive. The first campaign should sell specific outcomes, not generic capability.

Better examples:

- `One selfie. Your idol-era stage.`
- `Put yourself on the stadium big screen.`
- `Make your photos feel like a Seoul photo booth strip.`
- `Caught red-pawed. Turn your pet into a mugshot.`

### 3. First Skill Priorities

Recommended first test set:

1. One-Take / 打歌舞台
2. Broadcast Candid / 棒球直播抓拍
3. Photo Booth Pack: Photo Booth, Retro CCD, Flash Snap, Polaroid
4. Pet Mugshot / Pet Action Movie
5. Photo to Video, but only with scenario-specific packaging

Do not start with:

- IP/fantasy skills
- romantic / intimate synthetic scenes
- broad utility skills
- generic photo-to-video messaging

### 4. Existing Skill Assets Need Direct-Response Refitting

Most current assets are showcase assets. Ads need a funnel shape:

1. First 0-1s: show the strongest result or POV hook.
2. 1-2s: show original input photo.
3. 2-4s: show Makaron skill / upload / create action.
4. 4-7s: show final output and variants.
5. End: clear CTA.

Pure result montage is not enough. Users must understand: "I can upload my photo and get this."

## Verification Performed

Passed:

- `node --check scripts/meta-swipe-apify.mjs`
- `node --check scripts/meta-analyze-videos.mjs`
- `git diff --cached --check`

Also verified:

- Apify run can fetch current Meta Ad Library results.
- New scraper can archive video assets locally.
- Gemini video analysis works from local archived videos.
- Sensitive token scan found only environment variable names and placeholders, not real secrets.

Known issue:

- `npm run lint` fails because the repo already has broad lint debt: 100 errors and 134 warnings at the time of this work. This branch did not attempt to repair unrelated lint debt.

## Next Practical Steps

1. Produce first ad assets for:
   - One-Take
   - Broadcast Candid
   - Photo Booth Pack
   - Pet Mugshot / Pet Action Movie

2. Validate mobile H5 funnel for each target skill URL:
   - skill page
   - upload
   - login / signup
   - project creation
   - CUI English reply
   - checkout / subscription

3. Use Meta Events Manager to confirm:
   - browser Pixel events
   - CAPI events
   - event deduplication
   - `skill_id`
   - `utm_*`

4. Keep Meta API automation read-only until the funnel and assets are stable.

5. Continue building the swipe library, but always archive competitor media locally immediately because fbcdn links expire.
