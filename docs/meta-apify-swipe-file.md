# Meta Ad Library Swipe File via Apify

This is the research workflow for building Makaron's paid-social creative library from public Meta Ad Library ads. The goal is not to copy competitor assets. The goal is to extract repeatable patterns: hooks, first-frame structure, reveal rhythm, CTA, and skill mapping.

## Why Apify

Use `apify/facebook-ads-scraper` for the first version because it can scrape public Meta Ad Library ads and return structured fields such as ad copy, images/videos, CTA, publisher platforms, dates, and advertiser page info.

The official Meta Ad Library API is useful, but it is narrower for commercial competitor research. Meta's public API is strongest for political/social-issue ads and ads delivered to the EU. Apify is better for a practical creative swipe file.

## Token Setup

1. Open Apify Console.
2. Go to Settings -> Integrations -> API token.
3. Add this to local `.env.local`:

```bash
APIFY_TOKEN=your_apify_token_here
```

Do not commit the token.

## First Run

Start small so we do not burn credits while testing the schema.

```bash
node scripts/meta-swipe-apify.mjs \
  --url "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&media_type=all&q=AI%20photo%20editor&search_type=keyword_unordered" \
  --limit 10
```

Output files go to `docs/meta-swipe-runs/`:

- `*-raw.json`: original Apify dataset items
- `*-normalized.json`: simplified records
- `*-swipe.md`: human-readable creative swipe table
- `*-assets/`: local copies of the first video/image per ad when download succeeds

Important: Meta `fbcdn.net` media URLs are short-lived signed URLs. Do not treat them as permanent references. The scraper downloads assets immediately by default and the markdown links local files first. Use `--no-download-assets` only when you intentionally want metadata-only runs.

## Better Inputs

Best input is a filtered Meta Ad Library URL, not just a brand page. In Meta Ad Library:

1. Set country: `United States` first, then repeat for `Canada`, `United Kingdom`, `Australia`.
2. Set status: active.
3. Set platform: Instagram + Facebook.
4. Set media type: video first, then image.
5. Search brand/page or keyword.
6. Copy the full URL into the script.

## Competitor Seed List

Start with AI/photo/video apps:

- CapCut
- Remini
- Picsart
- Lensa
- Meitu
- BeautyPlus
- SNOW
- EPIK
- Hypic
- Photoroom
- Canva
- Prequel
- Facetune
- Ulike
- InShot

Then add culturally adjacent brands for Asian-cool visual language:

- YesStyle
- Stylevana
- Olive Young
- SHEIN
- Cider
- Pop Mart
- LINE FRIENDS
- CASETiFY
- KCON
- 88rising

## Keyword Seeds

Use these as Meta Ad Library keyword searches:

- `AI photo editor`
- `AI selfie`
- `AI portrait`
- `AI avatar`
- `photo to video`
- `video editor`
- `profile picture`
- `photo booth`
- `K-pop`
- `idol`
- `anime photo`
- `aesthetic photo`
- `old money portrait`
- `film camera`
- `pet portrait`

## How We Score Inspiration

Each saved ad should answer:

- Hook: What does the first line promise?
- First 2 seconds: What is visible immediately?
- Mechanic: Before/after, template reveal, social proof, tutorial, creator demo, trend remix?
- Asset type: 9:16 video, static before/after, carousel, UGC screen recording?
- Skill mapping: Which Makaron skill should copy the pattern?
- Remake idea: What original Makaron version can we make without copying assets?

## Makaron First Batch Mapping

Use scraped inspiration to produce these first:

| Makaron Skill | Desired Pattern | Example Hook |
|---|---|---|
| Idol Selfie | selfie -> idol poster reveal | Turn one selfie into an idol-style poster. |
| Photo Booth / CCD | 3-photo strip reveal | Make your photos feel like a Seoul photo booth strip. |
| Diamond Bling | profile photo flash upgrade | Give your profile pic a late-night flash upgrade. |
| Fan Merch | user photo -> fan visual / card | Create fan-style visuals from your own photos. |
| Photo to Vlog | 3 photos -> mini video | Drop in 3 photos. Get a mini vlog. |
| Pet Cover | pet photo -> magazine cover | Give your pet a magazine-cover moment. |

## Production Rule

For every winning pattern:

1. Extract the structure.
2. Rewrite the copy in Makaron's voice.
3. Generate original input/output examples with Makaron.
4. Produce 3 vertical video variants and 2 static before/after variants.
5. Launch only as paused draft until Pixel/CAPI events and English CUI are verified.
