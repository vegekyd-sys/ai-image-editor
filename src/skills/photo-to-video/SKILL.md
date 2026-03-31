---
name: photo-to-video
description: >
  Turn a single photo into a wild, imaginative video. Look at the photo,
  let your imagination run wild, and evolve the scene step by step into
  an unexpected visual story. Each act builds on the previous one with
  surprising twists. Activate when user wants to create a video from a photo.
allowed-tools: generate_image analyze_image generate_animation
metadata:
  makaron:
    icon: "\uD83C\uDFAC"
    color: "#c084fc"
    tipsEnabled: false
    builtIn: true
    tags: [video, workflow]
---

# Photo-to-Video: Wild Imagination Workflow

Look at this photo. Let your imagination run absolutely wild.

Your job: evolve this single image into a surprising, fun visual story — one act at a time. Each new act should make the viewer go "wait, WHAT?" and then laugh or gasp.

## How It Works

1. **Analyze the photo** — Call `analyze_image`. What's in the scene? What objects, characters, or elements could come alive, transform, or do something unexpected?

2. **Evolve the story, one act at a time** — Generate 3 progressive acts using `generate_image` (skill: wild, model: gemini). Each act MUST build on the PREVIOUS act (use `image_index` pointing to the latest snapshot). ALWAYS set `model: "gemini"` for every generate_image call:

   - **Act 1 — The Surprise**: Something in the scene starts to change in a way that immediately grabs attention. Not subtle — the viewer should be hooked from the first glance. An object comes alive, a character appears, the environment shifts dramatically.
   - **Act 2 — The Escalation**: Whatever happened in Act 1 develops further, gets significantly wilder and more exaggerated. The story takes an unexpected twist. This must be noticeably more impressive than Act 1.
   - **Act 3 — The Climax**: Peak absurdity, maximum visual impact. The payoff moment that makes the whole sequence worth watching. This should blow the viewer's mind — push creativity to the limit.

   Each act MUST be dramatically more surprising than the previous one. If Act 2 doesn't clearly top Act 1, push harder. If Act 3 doesn't make the viewer's jaw drop, rewrite it.

   After generating each act, pause briefly and think: "Given what just happened in THIS image, what's the most mind-blowing thing that could happen NEXT?" Then generate the next act based on that thought.

3. **Write & submit the video script** — After all acts are generated, write a video script (follow the Video Script Format in your system prompt) and output it in chat. Then call `generate_animation` to submit for rendering.

## Rules

- Be BOLD. Don't play it safe. The wilder the better.
- Each act's `editPrompt` should be vivid and specific — describe exactly what's changing and why it's surprising.
- Do NOT ask the user for confirmation between steps. Just go.
- Brief 1-sentence status updates between acts are fine.
- If an act fails, skip it and keep going.
