# gif-maker Skill — GPT Image 2.6 GIF best practice (2026-11-05)

## Why
V's sticker runs on vege_kyd@msn.com (projects 49426e89, 364aeae8, 22897dc5, 1049d051, 5e2b1afa) produced 28 GIFs with
recurring problems: 4–5 story beats crammed into 12 frames, uniform 110ms with no holds (loop ~1.3s reads as a shiver),
motion-blur/ghost in-between frames, effects (steam heart) unreadable after 5 retries, requests for 16/20/24 frames.

## Provider facts verified live (fal, openai/gpt-image-2.6/flare)
- `frame_count` is validated `<= 16` (17 → 422 `less_than_equal`, no charge). Docs saying 64 are wrong for fal.
- Frames are rendered on one sprite sheet. Candidate grids from validation errors: <=8 → 4x2/2x4, 9 → 3x3,
  10–12 → 4x3/3x4/4x4, 13–16 → 4x4. Sheet edge <= 3840, total <= 8294400.
  → square frames: 960px (<=9), 816px (10–12), 720px (13–16). 16 x 720 verified live.
- Old sizing sent 896px for 10 frames and 864px for 11 → provider rejection; 13–16 were blocked locally. Fixed in `gifFrameSize`.
- `background: "auto"` can return transparent frames with a jagged fringe; `"opaque"` gives a clean solid background.

## Prompt pattern that worked (all first try)
Numbered FRAME PLAN with held peak pose, locked-camera sentence, anti-blur sentence, solid hex background,
exact caption spec. Examples in `src/skills/gif-maker/SKILL.md`.

| Case | Result |
|---|---|
| V "辛苦啦" steam heart (V failed 5x) | heart readable at 200px on first try |
| V finger wag "我说不行" | clean wag, held smirk, stable caption |
| Pixel Wizard startle jump (ref sheet) | squash/stretch, hat pop, stable caption |
| Text-only cat "我裂开了" | crack → split held 3 frames |
| E2E local `makaron chat` (Shiba "收到！") | Agent read gif-maker, used template + opaque bg, self-checked with contact sheet, 30 credits |

WeChat 240px export via ffmpeg palettegen: 136–295KB.

`before-after-xinkula.png`: top = V production result, bottom = new prompt. GIFs are in gitignored `outputs/gif-maker-skill-20261105/`.

## OpenAI docs cross-check (2026-11-05)
- Guide says frame_count 2–64; API reference says 2–16 — fal enforces 16 (live). Reference lists GIF on `/images/edits`; edit + references worked live.
- Official loop advice: starting pose to return to + state camera movement. Official example: 512x512, 9 frames x 200ms, quality high.
- 512px frames are accepted although below the 655,360 general minimum: 10 frames at 512 = 0.0326 fal units / 19s vs 816 = 0.062 / 31s, quality fine for 240px stickers. Production still always picks the largest sheet size.
- Text: quote exact wording, give position/typography, ask for no extra text, medium/high quality for small or dense text.
- GIF does not support streaming, partial images, masks, output_compression, prompt_rewriter; transparent GIF is undocumented.

## Acceptance: V's five original briefs replayed (2026-11-05, local, commit 0820c68e)
Same first user message and the same two reference images per project, one request each, no human revisions.
Agent chose `gifFrameSize: "sticker"` and `background: "opaque"` every time and read gif-maker first.

| Brief | Before (V, production): first GIF / to final / user turns / GIF gens / credits | After: first GIF / delivered / gens / credits |
|---|---|---|
| 4 stickers | 61s / 17.0 min / 2 / 8 / 86 | 205s / 7.4 min / 4 / 41 |
| 交给我吧 | 68s / 17.1 min / 5 / 6 / 164 | 257s / 5.4 min / 1 / 18 |
| 辛苦啦 | 55s / 9.4 min / 3 / 10 / 195 | 196s / 6.8 min / 2 (self-retry) / 23 |
| 搞定啦 | 50s / 5.5 min / 2 / 3 / 53 | 174s / 5.9 min / 1 / 18 |
| 我记得哦 | 50s / 3.7 min / 1 / 4 / 89 | 184s / 5.4 min / 1 / 18 |
| Total | 52.7 min, 13 turns, 31 gens, 587 credits | 31.0 min (7.8 min parallel), 5 turns, 9 gens, 118 credits |

- Time to first GIF is slower: acceptance used `gpt-6-luna` Agent on a local dev server with 5 concurrent runs; V used `deepseek-flash` on production. Replay with `deepseek-flash`: first GIF 97s / 88s, total 3.0 / 4.9 min, 18 / 21 credits. Remaining ~40s gap = reading the Skill + local server; Agent self-QC adds 1–3 min per run.
- Quality: 交给我吧 caption stable first try (V needed 4 extra turns); 搞定啦 cleaner; 我记得哦 comparable; 辛苦啦 heart forms after one Agent self-retry but softer than V's final; 4-sticker set technically clean but still creatively plain (the "太普通" complaint needs a richer brief, not the Skill).
- File size 2.0–3.6MB → 0.8–1.1MB per GIF.
- Comparison page: https://claude.ai/artifact/3f4i3XnMFSJsgdrYPJB9Tz (private).
