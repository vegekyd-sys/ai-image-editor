---
name: gif-maker
description: >
  Create new animated GIFs with GPT Image 2.6 native GIF output: chat stickers, 表情包, reaction memes,
  mascot/character loops, emoji-style reactions, simple product or icon loops, and pixel sprites.
  Read before any generate_image call with outputFormat "gif". Assembling existing frames uses animated-gif instead.
allowed-tools: generate_image analyze_image run_code write_file
metadata:
  makaron:
    icon: "🎞️"
    color: "#FF6B35"
    tipsEnabled: false
    tags: [gif, sticker, meme, emoji, animation, loop]
---

# GIF Maker

GPT Image 2.6 draws every GIF frame in **one image call**: the provider lays the
frames out as a sprite sheet, renders the whole sheet, then slices it into the
GIF. The model is therefore good at a **short, planned sequence of distinct
poses on a locked camera** and poor at long stories, camera moves, or vague
"smooth continuous motion". Write the prompt as a storyboard, frame by frame.

## 1. Decide the beat before writing

State to yourself, in one line each:

- **Emotion / punchline** — the single reaction the sticker sends ("no-no", "吓死我了", "我裂开了", "辛苦啦").
- **One action** that shows it, readable at 200px. One action, not a sequence of scenes.
- **Key poses** — 2–4 poses: rest → anticipation → peak (held) → back to rest.
- **Caption** (optional) — 2–6 characters, exact text.

If the user asked for several things in one sticker (point, swirl, text appears,
gift, wink), split them into separate stickers. One sticker = one beat.

## 2. Parameters

| Use | frameCount | frameDurationMs | Loop length |
|---|---|---|---|
| Reaction sticker / 表情包 / meme (default) | 10–12 | 110–130 | ~1.3–1.5 s |
| Gentle idle / breathing / blink | 8–9 | 150–200 | ~1.5 s |
| Snappy gag, bounce, shake | 8 | 80–100 | ~0.8 s |
| Smooth physics (ball bounce, spin) | 16 | 70–90 | ~1.3 s |

Hard limits (fal enforces them; invalid requests fail before payment):

- `frameCount` 2–**16**. Never ask for more than 16.
- Frame edge follows the sheet grid: ≤8 frames and 9 frames → up to 960px; 10–12 frames → 816px; 13–16 frames → 720px. Fewer frames do not give larger frames beyond 960.
- No 2K/4K. Keep square (`aspectRatio: "1:1"`) for stickers.
- All frames share one duration. Create holds by **repeating a pose across consecutive frames in the plan**, not by asking for variable timing.

Always pass `outputFormat: "gif"`, `frameCount`, `frameDurationMs`, `aspectRatio: "1:1"` and `background` explicitly:

- `background: "opaque"` for a solid coloured background (default for 表情包/meme).
- `background: "transparent"` only when the user wants a die-cut sticker without a background; then ask for a thick white sticker outline around the subject so GIF's 1-bit transparency edge stays clean. With `"auto"` the model may choose transparency itself and leave a jagged coloured fringe around the subject.

Keep default `imageQuality` (low) and `imageReasoningEffort` (high) unless the user asks otherwise; reasoning is what follows the frame plan.

## 3. Prompt template

Write the `editPrompt` in English with exactly these blocks. Keep it short: one
frame plan, no repeated paragraphs, no separate "animation description" prose.

```text
Animated chat sticker (GIF) of [subject — for a reference: "the character in Image 1"; restate 4–6 identity anchors: hair, eyes, outfit, signature item, art style].

LOCKED CAMERA: identical framing, scale and position in every frame, [chest-up / full body], centred, generous margin. Only [arms / head / expression] change. Plain flat [colour + hex] background[, thick white sticker outline around the subject].

ONE ACTION, readable at 200px: [the single action] — "[caption or emotion]".
[Optional layout line: where props sit and which empty area the effect uses.]

FRAME PLAN ([N] frames, seamless loop):
1-2: [rest pose] (hold)
3: [anticipation]
4: [motion]
5: [motion]
6-8: [peak pose — the punchline] (hold)
9: [return]
10: identical to frame 1

Every frame is a crisp, fully rendered pose — no motion blur, no ghosting, no smeared in-between frames, no extra limbs.
Caption: bold Chinese text "[exact text]" in a [chunky rounded] font, [fill colour] with thick [outline colour] outline, [bottom / top] centre, exactly the same size and position in every frame, never covered by hands or props.
```

Rules that made the difference in live tests:

- **Frame plan with explicit numbers.** The model follows numbered frames almost literally; holds (`6-8: ... (hold)`) give the punchline time to read.
- **Peak pose held for 2–4 frames.** Without holds the loop feels like a shiver.
- **Last frame = "identical to frame 1"** for a seamless loop. A gag may end on the peak if the user wants a "stuck" ending.
- **Locked camera sentence** prevents size drift and jitter between frames.
- **The anti-blur sentence.** Without it the model draws motion-blur in-betweens that look like ghosting.
- **Effects need empty space.** If a prop or effect must read (steam heart, "!", sweat drop), reserve the empty area in a layout line and give it a size ("as wide as her face").
- **Captions baked in are stable** when the prompt fixes font, colours, outline, position and "exactly the same in every frame". Keep captions short; put them in a band the motion never enters.
- **One flat background colour, flat lighting.** Gradients, particles everywhere and glow fields flicker and band in 256-colour GIF.
- OpenAI's own loop rule: give the subject a starting pose to return to, and say whether the camera moves (for stickers: it does not).
- Text: put the exact wording in quotes, describe position and typography, and add "no other text anywhere". For small, dense or multi-font text use `imageQuality: "medium"`; short bold captions are fine at the default low.
- Do not write "smooth continuous motion", "rich multi-beat performance", "motion arcs trailing", camera moves, outfit changes, or more than 4 distinct poses.

## 4. References and identity

- Use the user's photo, mascot sheet or previous approved frame as the reference image (`media_index` / `reference_media_indices`). Name each input's role in the prompt ("Image 1: character identity", "Image 2: style/background") and restate the identity anchors in text anyway.
- GIFs are not accepted as inputs. To revise an approved GIF, extract one representative frame as PNG (`run_code` node FFmpeg), pass it as the reference, request **one** change, and repeat everything that must stay the same.
- A previous approved GIF frame is the best reference for series consistency; keep background colour, caption font and outline identical across the series and change only the action.
- Turning a real person into a sticker: say the target style (3D Pixar, flat 2D cartoon, chibi) explicitly and keep the face recognisable.

## 5. Check before delivering

After generation, inspect the GIF (analyze_image on the result or a frame strip):

- the action reads at sticker size and the punchline pose is held;
- identity, caption text and caption position are stable in every frame;
- no ghosted in-between frames, extra fingers, or background fringe.

If one point fails, regenerate once with the prompt fixed at that point (more holds, bigger effect space, explicit background). Do not loop more than twice; report the remaining issue honestly.

## 6. Platform export (only when asked)

The native GIF is 720–960px and 1–2.5MB. For chat platforms, convert with
`run_code` `runtime: "node"` FFmpeg (palettegen/paletteuse) and publish the result:

- WeChat 表情: 240×240, under 500KB (128-colour palette usually lands at 130–300KB).
- Discord: 320×320 under 512KB. Telegram: convert to WEBM/VP9 512px, under 256KB, no audio.

```bash
ffmpeg -i in.gif -filter_complex "scale=240:240:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" -loop 0 out-240.gif
```

## 7. Worked examples (live-tested, GPT Image 2.6 Flare)

Reference character, finger wag, `frameCount: 12, frameDurationMs: 120, background: "opaque"`:

```text
FRAME PLAN (12 frames, seamless loop):
1-2: smug closed-mouth smile, hand down, looking at viewer (hold)
3: hand rises to shoulder height, index finger up
4: finger tilted to her right, eyebrows raised
5: finger tilted to her left
6: finger tilted to her right
7: finger tilted to her left
8-10: finger straight up beside her face, eyes closed, chin up, satisfied smirk (hold)
11: hand lowering
12: identical to frame 1
```

Text-only meme, flat 2D cat at a laptop, `frameCount: 10, frameDurationMs: 120`:

```text
ONE ACTION, readable at 200px: the cat reads something on the laptop and slowly breaks — "我裂开了".
FRAME PLAN (10 frames, loop):
1-2: cat staring at the laptop, neutral face (hold)
3: eyes widen
4: one eye twitches, whiskers droop
5: a thin white crack line appears from the top of its head
6: crack spreads down the face, mouth trembling
7: cat splits cleanly into two halves along the crack, halves leaning apart slightly
8-9: hold the split pose, tiny dust puffs
10: halves snap back together, same as frame 1
```

Mascot startle-jump with squash and stretch, `frameCount: 10, frameDurationMs: 110`:
rest (hold) → eyes snap open with "!" → squash flat → stretch upward, hat lifting →
peak with flailing arms → fall, hat lands → squash landing with shaky eyes → rest (hold).
