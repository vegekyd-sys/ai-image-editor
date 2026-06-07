# Makaron Meta Ads Launch: English Asian-Cool Market

## Positioning

First paid Meta test targets English-speaking young creators with Asian pop, diaspora, streetwear, idol, and creator aesthetics. Do not write copy that asserts the viewer's race or ethnicity. Let the creative style select the audience.

Use single skill pages as landing pages:

```text
/home/{skillId}?locale=en&utm_source=meta&utm_medium=paid_social&utm_campaign=asian-cool-{skill}&utm_content={creative_id}
```

## Preflight: English QA

Set `locale=en` and verify these pages before launching ads:

- `/home`
- `/home/{skillId}`
- `/login`
- `/projects/{id}`
- CUI chat
- credit popup, subscribe, and top up

Chat prompts to test:

- `Make this photo look cooler.`
- `Turn these photos into a cinematic vlog.`
- `Create an idol-style poster from this selfie.`

Expected:

- Assistant replies in English when the user writes English.
- Tips labels and descriptions are English.
- Status bar, buttons, errors, and billing UI are English.
- No Chinese text appears unless the user writes Chinese.

Music generation is not part of the first required QA pass unless an ad explicitly sells music.

## Tracking Setup

Required env vars:

```bash
NEXT_PUBLIC_META_PIXEL_ID=...
META_CAPI_ACCESS_TOKEN=...
META_GRAPH_API_VERSION=v24.0
# Optional during Events Manager testing:
META_TEST_EVENT_CODE=...
```

Implemented events:

- `PageView`: every route
- `ViewContent`: skill page view, with `skill_id`
- `CompleteRegistration`: signup / first activation
- `StartTrial`: welcome credits activation
- `CustomizeProduct`: project creation after upload or prompt
- `InitiateCheckout`: subscribe or top-up click
- `Subscribe`: subscription checkout success
- `Purchase`: top-up checkout success

Stripe success URLs include `checkout_type` and `meta_event_id`; browser Pixel and server CAPI use the same event ID for checkout success dedupe.

Before launch:

1. Open Meta Events Manager.
2. Add `META_TEST_EVENT_CODE`.
3. Visit a skill URL with UTM params.
4. Create a project.
5. Start a subscription checkout in test mode.
6. Confirm Pixel + CAPI events appear and checkout success events dedupe.
7. Remove `META_TEST_EVENT_CODE` before production traffic.

## Audience

Start simple:

- Locations: United States, Canada, United Kingdom, Australia
- Optional city tests: Los Angeles, NYC, SF Bay Area, Seattle, Toronto, Vancouver, London, Sydney, Melbourne
- Age: 18-34
- Language: English
- Placements: Instagram Reels, Stories, Feed first; Facebook Feed secondary

Interest test ideas:

- K-pop
- J-pop
- anime
- streetwear
- fashion photography
- photo editing
- content creator
- Instagram Reels
- CapCut
- AI art

Do not target or write copy around race or ethnicity. Use Asian pop visual language in the creative instead.

## Campaign Structure

Daily budget: start at `$100+/day` for 7 days.

- Campaign A: Skill Landing Test, 60%
  - Objective: Sales / Website
  - Optimize early for `CompleteRegistration` or `InitiateCheckout`
  - Landing: individual skill page
- Campaign B: Subscribe Test, 25%
  - Optimize for `Subscribe`
  - Use only strongest creatives
- Campaign C: Retargeting, 15%
  - Audiences: skill viewers, project creators, checkout starters
  - Copy: `Pick up where you left off. Your Makaron credits are ready.`

## Creative Matrix

Each skill needs at least three 9:16 videos and one 1:1 or 4:5 feed creative.

| Skill direction | Hook | CTA |
| --- | --- | --- |
| Idol Selfie | `Turn one selfie into an idol-style poster.` | `Try it with your photo` |
| Photo Booth / CCD | `Make your photos feel like a Seoul photo booth strip.` | `Create yours` |
| Fan Merch | `Create fan-style visuals from your own photos.` | `Use this skill` |
| Nightclub / Diamond Bling | `Give your profile pic a late-night flash upgrade.` | `Create yours` |
| Couple / B&W Film | `Turn a casual photo into a movie-poster portrait.` | `Try it with your photo` |
| Photo to Vlog | `Drop in 3 photos. Get a mini vlog.` | `Use this skill` |
| Pet Cover | `Give your pet a magazine-cover moment.` | `Upload a pet photo` |

Creative rules:

- Show the result in the first 2 seconds.
- Sell one repeatable effect, not the whole product.
- Avoid direct identity copy such as `Are you Asian?` or `For Chinese creators`.
- Avoid beauty-shaming, body comparison, or unrealistic transformation claims.

## 7-Day Operating Rhythm

- Day 0: English QA and Pixel/CAPI test events.
- Day 1: Launch 5-7 skill directions, 3 creatives each.
- Day 2: Observe; avoid heavy edits.
- Day 3: Kill low CTR, low upload rate, and no-checkout creatives.
- Day 4-5: Add new variants for winning skills.
- Day 6-7: Judge by subscription CPA. If subscribe volume is thin, optimize temporarily for `InitiateCheckout` while reporting revenue by `Subscribe` / `Purchase`.
