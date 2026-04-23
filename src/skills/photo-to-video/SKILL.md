---
name: photo-to-video
description: >
  Turn photos into a wild, imaginative video. Single photo: evolve it
  into a 3-act story. Multiple photos: pick the most interesting ones
  and weave them into a cinematic sequence. Activate when user wants
  to create a video from photos.
allowed-tools: generate_image analyze_image generate_animation
metadata:
  makaron:
    icon: "🎬"
    color: "#c084fc"
    tipsEnabled: false
    builtIn: true
    tags: [video, workflow]
---

# Photo-to-Video: Wild Imagination Workflow

Your job: turn photos into a surprising, cinematic video story.

## Single Image Flow

When there's only 1 photo:

1. **Analyze the photo** — Call `analyze_image`. What's in the scene? What objects, characters, or elements could come alive, transform, or do something unexpected?

2. **Evolve the story, one act at a time** — Generate 3 progressive acts using `generate_image` (skill: wild, model: gemini). Each act MUST build on the PREVIOUS act (use `image_index` pointing to the latest snapshot). ALWAYS set `model: "gemini"` for every generate_image call:

   - **Act 1 — The Surprise**: Something in the scene starts to change in a way that immediately grabs attention. Not subtle — the viewer should be hooked from the first glance. An object comes alive, a character appears, the environment shifts dramatically.
   - **Act 2 — The Escalation**: Whatever happened in Act 1 develops further, gets significantly wilder and more exaggerated. The story takes an unexpected twist. This must be noticeably more impressive than Act 1.
   - **Act 3 — The Climax**: Peak absurdity, maximum visual impact. The payoff moment that makes the whole sequence worth watching. This should blow the viewer's mind — push creativity to the limit.

   Each act MUST be dramatically more surprising than the previous one. If Act 2 doesn't clearly top Act 1, push harder. If Act 3 doesn't make the viewer's jaw drop, rewrite it.

   After generating each act, pause briefly and think: "Given what just happened in THIS image, what's the most mind-blowing thing that could happen NEXT?" Then generate the next act based on that thought.

3. **Write the video script** — Write a video script (follow the Video Script Format in your system prompt) and output it in chat.

4. **Ask for confirmation** — Show the script to the user and ask if they want to proceed, make changes, or adjust the story. Wait for their response.

5. **Submit** — Once the user confirms, call `generate_animation` to submit for rendering.

## Multi-Image Flow

When there are 2+ photos:

1. **Analyze all images** — Call `analyze_image` on each. Understand what's in every photo.

2. **Pick & sequence** — Select the most visually interesting images (3-7). Reorder them for the strongest story arc — don't follow upload order. Skip duplicates and weak shots.

3. **Write the video script** — Write a video script using the existing snapshots (<<<image_N>>> references), following the Video Script Format in your system prompt. Output it in chat. No need to generate new images.

4. **Ask for confirmation** — Show the script to the user and ask if they want to proceed, make changes, or adjust the story. Wait for their response.

5. **Submit** — Once the user confirms, call `generate_animation` to submit for rendering.

## Rules

- Be BOLD. Don't play it safe. The wilder the better.
- Each act's `editPrompt` should be vivid and specific — describe exactly what's changing and why it's surprising.
- Between acts, tell the user what's fun or surprising about what just happened — share the excitement!
- If an act fails, skip it and keep going.
- ALWAYS ask for user confirmation before calling `generate_animation`.
