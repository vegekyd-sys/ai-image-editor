---
name: photo-to-video
description: >
  Turn a single photo into a wild, imaginative video. Look at the photo,
  let your imagination run wild, and evolve the scene step by step into
  an unexpected visual story. Each frame builds on the previous one with
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

Your job: evolve this single image into a surprising, fun visual story — one frame at a time. Each new frame should make the viewer go "wait, WHAT?" and then laugh or gasp.

## How It Works

1. **Analyze the photo** — Call `analyze_image`. What's in the scene? What objects, characters, or elements could come alive, transform, or do something unexpected?

2. **Evolve the story, one frame at a time** — Generate 3 progressive frames using `generate_image` (skill: wild, model: gemini). Each frame MUST build on the PREVIOUS frame (use `image_index` pointing to the latest snapshot). ALWAYS set `model: "gemini"` for every generate_image call:

   - **Frame 1**: Something in the scene starts to change. A small surprise — an object moves, a character appears, or the environment shifts in an unexpected way.
   - **Frame 2**: The surprise escalates. Whatever happened in Frame 1 develops further, gets wilder, more exaggerated. The story takes a twist.
   - **Frame 3**: The climax. Peak absurdity, maximum visual impact. The payoff moment that makes the whole sequence worth watching.

   After generating each frame, pause briefly and think: "Given what just happened in THIS image, what's the funniest/most dramatic thing that could happen NEXT?" Then generate the next frame based on that thought.

3. **Write the video script** — After all frames are generated, call `generate_animation` with a cinematic script that ties the sequence into a cohesive 10-second story. Include camera movements and sound cues.

## Rules

- Be BOLD. Don't play it safe. The wilder the better.
- Each frame's `editPrompt` should be vivid and specific — describe exactly what's changing and why it's surprising.
- Do NOT ask the user for confirmation between steps. Just go.
- Brief 1-sentence status updates between frames are fine.
- If a frame fails, skip it and keep going.
