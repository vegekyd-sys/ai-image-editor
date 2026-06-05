# Makaron SEO Release Checklist

## Goal

Make `www.makaron.app` discoverable for the brand query `makaron`, with multiple public, indexable pages instead of relying only on `/home`.

## Public Pages Expected In Sitemap

- `/home`
- `/makaron`
- `/landingpage`
- `/agent`
- `/releases/video-in-timeline`
- `/use-cases`
- `/use-cases/ai-photo-editor`
- `/use-cases/photo-to-video`
- `/use-cases/product-photos`
- `/use-cases/ai-poster-generator`
- `/use-cases/pet-stickers`
- `/use-cases/social-content`
- Filtered active `/skill/{skillId}` pages from `home_skills`

Route ownership note: `/home/{skillId}` is an app compatibility route that redirects to
`/home?skill={skillId}`. Do not turn it into a standalone SEO page; login and mobile
detail UI flows depend on that route shape. Skill SEO pages live under `/skill/{skillId}`.

## Pre-Deploy Gates

Run from repo root:

```bash
npx tsc --noEmit
npm run lint
npm run build
```

Expected:

- `tsc` exits 0
- `lint` exits 0; existing warnings are acceptable
- `build` exits 0
- Next route manifest includes `/makaron`, `/robots.txt`, `/sitemap.xml`, `/use-cases`, and `/use-cases/[slug]`

## Post-Deploy Smoke Test

Replace `$BASE_URL` with `https://www.makaron.app`.

```bash
curl -sSI "$BASE_URL/makaron" | sed -n '1,20p'
curl -sS "$BASE_URL/makaron" | rg '<title>|canonical|og:title|application/ld\\+json|<h1'
curl -sS "$BASE_URL/robots.txt"
curl -sS "$BASE_URL/sitemap.xml" | rg '<loc>' | sed -n '1,40p'
npm run check:seo -- "$BASE_URL"
```

Expected:

- `/makaron` returns `200 OK`
- `/makaron` has title, canonical, OG title, JSON-LD, and H1
- `robots.txt` allows `/makaron`, `/agent`, `/home`, `/use-cases/`, and `/releases/`
- `sitemap.xml` contains `/makaron` and the use-case pages
- `npm run check:seo -- "$BASE_URL"` exits 0

## Google Search Console

After production deploy:

1. Submit `https://www.makaron.app/sitemap.xml`.
2. Use URL Inspection and request indexing for:
   - `https://www.makaron.app/makaron`
   - `https://www.makaron.app/home`
   - `https://www.makaron.app/use-cases`
   - `https://www.makaron.app/use-cases/ai-photo-editor`
   - `https://www.makaron.app/use-cases/photo-to-video`
   - `https://www.makaron.app/use-cases/product-photos`
3. Re-check coverage after Google crawls the sitemap.

## Search Verification

Use these queries after indexing has had time to settle:

- `site:makaron.app makaron`
- `site:makaron.app "Makaron AI Creative Studio"`
- `site:makaron.app "AI Photo to Video Maker"`
- `makaron ai creative studio`
- `makaron ai image editor`

Google ranking for `makaron` is not instant after deploy. The target is first to get `www.makaron.app` indexed with multiple public pages, then improve brand-query ranking over subsequent crawls.
