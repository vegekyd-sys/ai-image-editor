---
name: storyboard
description: >
  Produce and review one OpenAI 6+ panel storyboard image per approved long-video
  segment.
allowed-tools: analyze_image generate_image
metadata:
  makaron:
    icon: "🎬"
    color: "#f59e0b"
    tipsEnabled: false
    builtIn: true
    tags: [video, workflow, storyboard]
---

# Long Video Storyboard

You produce per-segment director storyboard images. A storyboard is not an
anchor and not a final video script. It is the visual checkpoint between
approved anchors and `animate.md`.

## Input Contract

The director must provide:
- approved anchor refs for every required character, scene, and prop
- approved segment outline and seam plan
- approved director beat board
- target aspect ratio and segment duration
- which segment(s) need generation or regeneration

Do not generate storyboards before anchors and the beat board are approved.

## Generation Rules

- Generate exactly one storyboard image per segment with `generate_image` using `model: "openai"`.
- Always pass `aspectRatio` to `generate_image` using the approved target aspect ratio, e.g. `aspectRatio: "9:16"` for vertical video storyboards.
- One segment = one storyboard image. Do not create one full-video storyboard sheet.
- Generate storyboards sequentially in segment order. Do not generate storyboard images in parallel.
- For each segment, wait for its image, call `analyze_image`, and record the resulting media ref before starting the next segment.
- The visible panel labels must use the same segment ID as the current segment, e.g. S1 panels must be labeled `S1-P1` to `S1-P6`; S2 panels must not appear in the S1 storyboard.
- Each segment storyboard must contain at least 6 shot panels unless the segment is shorter than 8s and the user approves fewer.
- Use the approved target aspect ratio for every storyboard sheet. If the video is 9:16, every storyboard sheet should also be a vertical 9:16 sheet.
- Each panel must show a readable label strip with shot number, duration, framing, camera movement, and transition or seam note.
- Panel label format should be compact and explicit, e.g. `S1-P1 | 2s | WS | slow push | rain cut`. Do not label panels with only `S1-P1`.
- Label strips are graphic overlays only. They must not push the image toward photorealism, live action, adult casting, fashion editorial, or a different render family.
- Preserve the approved character anchor first, then add labels. A correctly labeled storyboard is still a failure if the character identity or 3D cartoon render family drifts.
- Do not ask for visible PART dividers, red split lines, or segment boundary labels.
- The prompt must reflect the approved beat board: rhythm, visual impact point, shot functions, camera grammar, and seam design.
- The opening seam target and ending seam target must be visible when the segment touches a seam.
- If only S02 or S03 fails, regenerate only the failed segment(s), not earlier approved storyboards.

## Tool Reference Rules

Do not rely on text-only `<<<media_N>>>` mentions.

- If a principal character appears in the segment, pass that character anchor as `media_index`.
- Pass all other required character, scene, prop, and previous storyboard refs through `reference_media_indices`.
- If the segment must preserve a corrected storyboard, include that corrected storyboard as a reference.
- CUI must repeat the required refs as text next to the image because generated text can be imperfect.

## Review Contract

After every generated storyboard image, call `analyze_image` before asking for approval.

Pass only if:
- every required principal character keeps approved hair, hat/accessories, face type, age, body, clothing, and style family
- every required principal character keeps the approved anchor's render family, such as 3D cartoon vs 2D illustration
- scenes and props match the same approved project render family as the character anchor
- every required character appears in all key panels where they are acting or feeling
- required props and scene anchors are visibly used
- at least 6 panels are present
- shot labels include shot number, duration, framing, camera movement, and transition/seam note, not just panel IDs
- storyboard sheet aspect ratio matches the approved target aspect ratio
- label overlays did not change character age, face, body, clothing, or render family
- seam targets are visible where needed
- staging has a readable visual impact point and is not just flat coverage

Auto-regenerate if:
- a required character changes hair, hat, clothing, face, age, body type, or style
- a required 3D character becomes flat 2D, photoreal, anime, or any other unapproved render family
- the scene or prop rendering style conflicts with the approved character anchor's render family
- a required character disappears, becomes an offscreen idea, or is replaced by a device/screen
- a segment about a character's emotion lacks that character in key panels
- there are fewer than the required panels
- required props or scenes are missing
- labels are missing, unreadable, or only show panel IDs
- the storyboard sheet uses the wrong aspect ratio
- label overlays caused character or style drift
- seam targets are not visible
- staging is too flat or confusing

If the same storyboard fails twice, block and report the exact visual contract that failed. Do not present it as approved.

## Output Contract

Return normal Markdown, not a code block:
- storyboard refs per segment
- short visual-contract pass/fail note for each storyboard
- any regeneration note
- approval question

Use "passed self-check" rather than "approved". Only the user can approve storyboards.
