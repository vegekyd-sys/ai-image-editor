# Hero B — refine the existing orbit

A remains `/home`; B is `/home?hero=b`. The user rejected an aligned media strip because it lost the original creativity. The revised concept is `hero-b-orbit-concept.png`, built-in ImageGen editing the user's actual homepage screenshot.

Keep the original five moving artworks, full-bleed angled collage, black/fuchsia, native centered composer and header. Form a shared oval: cloud house midleft, Android upperleft, floral upperright, jellyfish midright, fashion MV bottomcenter. Subtle elliptical stroke ties them together; restrained synchronized breathing maintains the arrangement. The single headline is “Imagination / can’t wait.”, with equivalent localized copy. Remove the separate slogan ribbon, preserve motion control.

Tokens: #000 background, #d946ef accent, #fff heading, #a1a1aa supporting copy; native Geist/PingFang typography, 64–108px desktop headline. Original frames, controls, captions and template lifecycle. No media tint. Actual catalog video frames differ from frozen concept frames. Mobile maintains the existing top/bottom edge collage and readable centered composer.

Allowed copy: existing navigation and composer controls; “Imagination / can’t wait.”; “Your ideas deserve to exist.”; “Images, films, design, music. Just tell Makaron.”; “Explore templates”; motion control. No other headline or decorative label.

## Verification

Browser/IAB screenshots at 1536×1024, 1900×1240, 390×844 and a 360×740 check. All four locales rendered. Compared concept and final captures with view_image: black/fuchsia palette, single headline hierarchy, centered composer, five-artwork oval, angled edge crops, original control anatomy. Fixed floral video overlapping the English headline. Copy matches the revised brief; real playback frames and the existing guest/auth controls intentionally differ from the frozen concept. Composer stays nearer the viewport center than in the generated concept to honor the user's earlier requirement. No remaining material layout mismatch in the inspected sizes.

Five live hero videos reached readyState 4 and advanced while unpaused; pause stopped video and card animation. Fashion MV opens the right template and closing retains ?hero=b. A retains its original headline, ribbon and collage. Browser checks use real media, without submitting any paid generation. TypeScript, lint (two pre-existing unrelated warnings) and 23 existing relevant tests passed. Local preview only; no merge or production deployment.

## Mobile refinement after desktop acceptance

The user accepted desktop B and requested a calmer mobile composition: the old center was empty, edges full and bottom crowded. Only the <=767px orbital rules changed. The mobile hero now follows content height, with title, two lightly angled portrait videos, composer and exploration link in sequence. The three remaining hero cards are hidden on mobile and IntersectionObserver detaches their videos. Header and bottom corners stay clear. Desktop still renders all five in the accepted orbit, with the 1536px composer at x472.5/y455, width580/height122, unchanged from the previous check.

IAB verified 360×740, 390×844, 430×932, and desktop1536×1024. Chinese and English checked visually. Both visible mobile videos play at readyState4, the three hidden cards have no video elements, and Jellyfish Throne opens the correct detail with real playback then closes back to B. No horizontal overflow. Ten existing composer/media tests and i18n guard passed. LAN URL returns200. Development server restarted after the previous process stopped responding; same port4318.
