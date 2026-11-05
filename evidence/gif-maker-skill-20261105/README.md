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
