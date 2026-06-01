---
name: long-video-director
description: >
  Direct long videos up to 120 seconds by turning user intent and media into
  approved visual anchors, short self-contained segment scripts, seam scripts
  between segments, and a real generation plan.
  Activate for long videos, multi-part videos, 15s+ generation, consistent
  characters/props/scenes across clips, or transitions between generated clips.
allowed-tools: analyze_video analyze_image generate_image generate_animation run_code write_file
metadata:
  makaron:
    icon: "🎞️"
    color: "#38bdf8"
    tipsEnabled: false
    builtIn: true
    tags: [video, workflow, long-video, director]
---

# Long Video Director

You are directing a long video, not asking a video model to remember a long story.

Critical premise:
- Video generation models do **not** know what happened in the previous segment.
- Each video generation call can produce at most 15 seconds.
- Therefore every segment script must be self-contained and executable by the current `prompts/animate.md` rules.
- Do not produce a final MP4 first.
- Do not dump a full long-video package in one response. Long-video work is a staged collaboration: story first, then approved anchors, then director storyboard panels for every segment, then segment/seam scripts, then optional real generation.
- Before any real video generation, produce an explicit asset inventory and prove that each segment will use the approved assets.

## Required Reading

Before writing any segment script, read `prompts/animate.md`.

If you need real video probing, frame extraction, trimming, or concatenation, read `skills/video-ffmpeg-lab/SKILL.md` before using `run_code` with `runtime: "node"`.

## Output Surfaces

Do not build new UI.

Use the existing product surfaces:
- **Timeline**: approved visual anchors, approved director storyboard images, and later approved final media. Anchors and storyboard images should usually be image-model outputs or extracted video frames.
- **CUI**: discuss story, show asset inventory, show storyboard requirements, show segment/seam scripts as readable text, and ask for approval at each gate.

## Core Objects

### Anchor

An anchor is a reusable visual reference sheet for the video model, not a beautiful keyframe.

Do not copy the style of example anchors. Every video can have a different style. Copy the **structure and purpose** only: multi-angle, repeatable, model-friendly reference material.

The best anchors look like production settei / model sheets:
- Character: full-body front / side / back turnaround plus expression or pose grid.
- Scene: the same location from multiple useful camera angles, such as entrance view, wall-side view, and aerial/bird's-eye layout.
- Prop: front / side / top views, open-case or detail view when relevant, scale/material details.

Infer which visual facts must stay stable across the long video, then generate only the character, scene, and prop cards needed to protect those facts.

Kinds:
- `character`
- `scene`
- `prop`
- `freeform`

Rules:
- Prefer extracting anchors from user-provided media or uploaded video frames.
- Generate missing anchors with `generate_image`.
- Before choosing anchor types, read the story beats and list the stable visual facts: characters, locations, props, and any visible start/end facts that should be represented inside those cards. Generate only the cards needed to stabilize those facts.
- If the user gives an anchor image limit, treat it as a hard cap. Never call `generate_image` more times than that cap for anchors.
- After the user approves an anchor, keep it visible on the timeline as an image asset.
- Later segment scripts must reference approved anchors with `<<<media_N>>>`.
- Do not create conflicting duplicate anchors. If a scene or prop anchor does not need the character, explicitly exclude people from that image.
- If a later anchor must include an already generated character, generate anchors sequentially and use the approved character anchor as a reference. Do not parallel-generate dependent anchors.
- Before asking for anchor approval, check visual compatibility: the same character, prop, or setting must not appear with contradictory face, clothing, color, era, or style.
- Avoid cinematic one-off keyframes as anchors. Strong shadows, dramatic lensing, motion blur, extreme closeups, or story-specific staging usually make poor anchors.
- Anchor image prompts should ask for clean reference sheets: neutral lighting, clear proportions, multiple views, no motion blur, no decorative poster layout. Text labels are optional; do not rely on text being spelled correctly.

Anchor record shape:

```json
{
  "id": "anchor-main-character",
  "kind": "character",
  "name": "Main character",
  "timelineMediaRef": "<<<media_3>>>",
  "source": "extracted|generated|uploaded",
  "referenceSheetType": "character_turnaround|scene_multiview|prop_multiview|freeform_reference",
  "visualContract": "The stable visual traits that must remain consistent.",
  "usageNotes": "How this anchor should be used in segment scripts.",
  "approved": true
}
```

### Asset Inventory

The asset inventory is the handoff contract before segment scripts or video generation.

It must list every asset that will be used:
- existing user media
- approved character anchors
- approved scene anchors
- approved prop anchors
- approved director storyboard panels for every segment
- optional motion/reference clips
- audio or voice requirements when relevant

Rules:
- Do not assume a generated anchor is used just because it exists on the timeline. Explicitly map it to segment IDs.
- Before calling `generate_animation`, every segment must list the exact `<<<media_N>>>` refs it will pass to the video model.
- If an approved asset is important but not referenced in a segment script, that is a blocking error. Revise the script before submission.
- If a required asset is missing, stop and create/extract that asset before writing the final script.

Asset inventory record shape:

```json
{
  "id": "asset-v-character",
  "kind": "character_anchor",
  "name": "V",
  "timelineMediaRef": "<<<media_2>>>",
  "approved": true,
  "usedBySegments": ["segment-01", "segment-02"],
  "usageContract": "V must keep silver hair, black straw hat, green-black outfit, and 3D cartoon proportions."
}
```

### Segment Storyboard

A segment storyboard is the visual reference between approved anchors and video scripts.

It is not a reusable anchor. It is a per-segment visual checkpoint that lets the user verify framing, staging, mood, action, and continuity before any video script or video generation.

Rules:
- Every segment must have storyboard requirements before scripts are written.
- Every segment must have exactly one approved storyboard image before the final compiled segment script is shown.
- Generate storyboard images with `generate_image` using `model: "openai"`. This is a hard requirement for long-video storyboards, even if the default image router would choose another model.
- Do not use `run_code`, Remotion, design runtime, or CSS drawings for storyboard images.
- Storyboard prompts must reference the approved anchors and exact `<<<media_N>>>` assets used by each segment.
- A storyboard image must preserve the approved anchors. If it conflicts with an approved character, prop, scene, or style anchor, reject it and regenerate.
- Do not create one full-video storyboard sheet. This workflow's key difference is one storyboard image per segment.
- Do not ask for visible PART dividers, red split lines, or segment boundary labels inside the storyboard image. They are unstable and unnecessary because each segment has its own storyboard image.
- Each segment storyboard image should be a compact shot-board for that segment. One image per segment is still required, but that image may contain multiple shot panels.
- Each shot panel inside the storyboard image must visibly include short labels for shot number, duration, framing, camera movement, and transition or seam note. Keep the labels short so the image model has a realistic chance to render them.
- The storyboard image should show the segment's opening seam target, main action, ending seam target, principal characters/props, environment, and mood across its panels.
- CUI must repeat the same shot number, duration, framing, camera movement, and transition information as text next to the storyboard image because generated image text can still be imperfect.
- Show storyboard images on the timeline and ask for approval before writing final segment scripts.
- After every storyboard image generation, call `analyze_image` before script writing. Check whether approved anchors stayed consistent, whether the storyboard is clearly a per-segment shot-board, whether shot panels include shot number, duration, framing, camera movement, and transition/seam labels, whether the segment's key action/staging is visible, and whether seam-critical objects, gestures, or camera states are present. If the analysis finds wrong character/prop/scene/style, missing shot labels, missing seam target, or unusable staging, regenerate the storyboard. Do not proceed.

Segment storyboard record shape:

```json
{
  "id": "storyboard-segment-01",
  "segmentId": "segment-01",
  "timelineMediaRef": "<<<media_7>>>",
  "source": "generated_openai",
  "storyboardRequirement": "A single segment storyboard image with multiple shot panels, each labeled with shot number, duration, framing, camera movement, and transition/seam note.",
  "requiredAnchors": ["anchor-v-character", "anchor-work-desk"],
  "visualContract": "What must remain true when this storyboard becomes a video segment.",
  "approved": true
}
```

### Segment

A segment is one video-model-sized unit, normally close to 15 seconds.

Fewer segments are better for consistency. Every extra segment is another independent video generation call, and therefore another chance for character, prop, scene, and style drift. Prefer 15-second segments by default, then vary duration only when the story beat, seam, platform pacing, or model reliability clearly needs it.

Rules:
- Each segment must be self-contained.
- Prefer filling each segment to 12-15 seconds when the action can remain coherent.
- Use shorter 5-10 second segments only for special cases: a very simple beat, a hard seam, a bridge/title/interstitial, a high-risk action, or a requested exact duration that does not divide cleanly into 15-second units.
- When planning target duration, minimize segment count first, then optimize seams. For example, 30s should usually be 2 x 15s, 45s should usually be 3 x 15s, and 60s should usually be 4 x 15s unless there is a strong creative reason to vary.
- Never write "continue from the previous segment" as a dependency.
- Include every required anchor directly in the script.
- Include the intended start state and end state.
- Compile the final segment prompt into the exact `prompts/animate.md` style: title first line, script body, `Style:` line.
- Every `<<<media_N>>>` reference must be followed by a role or label.

Segment record shape:

```json
{
  "id": "segment-03",
  "durationSec": 10,
  "purpose": "What this short segment contributes to the long video.",
  "requiredAnchors": ["anchor-main-character", "anchor-red-umbrella"],
  "storyboardRequirements": ["The approved segment storyboard must show the segment opening, the core action, and the end object-cut target."],
  "storyboardRefs": ["storyboard-segment-03"],
  "startState": "What the first 1-2 seconds must show.",
  "endState": "What the final 1-2 seconds must land on.",
  "visibleScriptForUser": "Readable CUI script for user review.",
  "compiledAnimateScript": "The exact script to send to generate_animation after approval."
}
```

### Seam

A seam is the planned connection between two segments.

Rules:
- Design seams before generating the adjacent segments.
- A seam must constrain the previous segment's ending and the next segment's opening.
- A seam is not complete if it only appears as a separate CUI note. Its requirements must be embedded into the actual adjacent segment scripts:
  - `fromEndRequirement` must appear in the final shot/action of the previous segment script.
  - `toStartRequirement` must appear in the first shot/action of the next segment script.
  - The two scripts must still be independently executable; do not write "continue from previous segment".
- If the seam is weak, prefer a design bridge or a short bridge clip over pretending two unrelated clips will cut cleanly.

Transition strategies:
- `match_cut`
- `action_cut`
- `object_cut`
- `camera_cut`
- `audio_bridge`
- `design_bridge`
- `fade`
- `bridge_clip`

Seam record shape:

```json
{
  "id": "seam-03-04",
  "from": "segment-03",
  "to": "segment-04",
  "transitionStrategy": "object_cut",
  "sharedAnchors": ["anchor-red-umbrella"],
  "fromEndRequirement": "Segment 03 must end on an extreme close-up of the red umbrella handle.",
  "toStartRequirement": "Segment 04 must start from the same red umbrella handle before revealing the subway entrance.",
  "visibleScriptForUser": "Readable CUI explanation of why this cut works.",
  "bridgeDesign": "Optional generated bridge plan."
}
```

## Workflow

### 1. Story Discussion

Identify:
- target length, default max 120 seconds
- source media
- aspect ratio
- audience/platform
- tone
- whether final output is text-only planning, storyboard frames, or later real generated video

In the first response, do not generate scripts and do not generate assets. Keep it small enough to read.

Produce:
- 2-3 distinct story directions when the user gives a broad request
- for each direction: one-sentence concept, tone, likely duration/segment count, and minimum anchor set
- one clear question asking the user to pick or revise a direction

Do not write `Shot N (Xs):` scripts in the first story-direction response.

Stop and ask the user to confirm or revise the story direction unless they explicitly asked to proceed without confirmation.

### 2. Understand Source Media

For input long videos:
- Use FFmpeg/FFprobe through `run_code runtime="node"` to probe duration and extract representative frames.
- Use `analyze_video` when the clip is short enough and suitable.
- For long or large videos, analyze sampled frames and build a scene graph instead of sending the entire video to the model.

Scene graph should include:
- time ranges
- subjects
- actions
- visual style
- possible anchors
- possible seam moments

### 3. Asset Inventory And Anchor Plan

Before generating anchors or scripts, create an asset inventory draft:
- which existing timeline media can be used directly
- which visual facts must remain stable across segments
- which character cards are needed
- which scene cards are needed
- which prop cards are needed
- the storyboard requirement for every segment
- which segments will use each asset

Ask for approval on the asset plan before creating many assets. If the user chooses a story direction or says to continue, treat that as approval to create the minimum anchor set for that direction. If the user only needs a lightweight 30s draft, keep the asset count minimal.

### 4. Create Or Extract Approved Assets

Create or extract the minimum useful anchor set.

After the user approves or chooses a story direction, do not merely describe anchor ideas. Generate or extract the needed anchor images first, then stop for anchor approval. Do not write segment scripts before the anchor images are visible and approved.

Generation order:
- Independent anchors may be generated in parallel.
- Dependent anchors must be generated sequentially.
- If there is a character anchor plus a scene or prop anchor, the non-character anchor should usually omit the character unless it is generated with the character anchor as an explicit reference.

Anchor/card prompt templates:

Character card template:

```text
[target style] character reference sheet, vertical 9:16, clean background with subtle ground shadow.

Top section: three full-body views arranged horizontally:
- front view / left side view / back view
- same proportions across views, face and costume details aligned across angles

Bottom section: six facial close-ups in a 2x3 grid:
- joy / sadness / anger / surprise / fear / calm neutral

Face requirements: preserve the source identity and age cues; keep skin, facial structure, eyes, hair, and costume consistent across all views and expressions.

Appearance: [height, body type, face, clothing, hairstyle, skin tone, accessories; extract strictly from the user source/story, do not over-invent]

Title at top: [asset name] / [project title] / character reference

High-resolution production reference sheet, neutral global lighting, clear proportions, no motion blur.
```

Scene card template:

```text
[target style] environment reference sheet, 16:9 horizontal, the same location shown in three views.

Scene: [scene name] — [time / interior or exterior]

Set dressing: [detailed layout of the room/location; specify furniture, landmarks, entrances, props, and spatial orientation]

Three views:
- left panel: [entrance or left-side view; what is visible]
- middle panel: [opposite/right-side view; what is visible]
- right panel: [top-down or bird's-eye layout; overall geography]

No people unless the user explicitly needs scale. Keep landmarks and layout consistent across all three panels.

Top label: [asset name] / [project title] / scene reference
```

Prop card template:

```text
[target style] prop reference sheet, 16:9 horizontal, the same object shown in three views.

Prop: [prop name] — [project title]

Description: [material, color, texture, wear, usage marks, scale, distinctive details]

Three views:
- left panel: front view, [details to show]
- middle panel: side view, [outline/thickness/mechanism to show]
- right panel: top view or detail view, [top texture, interior, case, or assembled parts]

Clean background with subtle physical shadow. No human hand unless scale is required.

Top label: [asset name] / [project title] / prop reference
```

Show anchor candidates in CUI and ask for approval.

Once approved:
- if extracted/generated image assets are available, keep them as timeline media
- use those timeline media refs in all later segment scripts

### 5. Segment Outline And Storyboard Requirements

After anchors are approved, create a concise segment outline before writing final scripts.

For every segment, show:
- duration, purpose, required anchors, start state, end state
- exact asset refs, e.g. `uses: <<<media_2>>>（V角色卡）, <<<media_4>>>（海滩场景卡）`
- storyboard requirement: the visual checkpoint the OpenAI segment storyboard image must prove
- seam requirements that must be visible in the storyboard if this segment touches a seam

Ask for approval or revision of the segment outline and storyboard requirements.

Do not write final `Shot N (Xs):` scripts yet.

### 6. Generate And Approve Segment Storyboards

After the segment outline and storyboard requirements are approved:
- generate one storyboard image per segment with `generate_image`
- always set `model: "openai"` for storyboard generation
- pass the most important approved anchor for that segment as `media_index` and the other approved anchors through `reference_media_indices` so the image model sees the exact references
- make each storyboard prompt describe only one segment as a compact multi-panel shot-board: shot count, per-panel shot number, duration, framing, camera movement, transition or seam note, key staging, main action, required anchors, start/end state, seam target, mood, and aspect ratio
- do not ask for full-video sheets, PART dividers, red split lines, or boundary labels inside the image
- include the segment IDs, storyboard requirements, and the exact per-shot labels in the CUI text so the user can review them

Before moving to scripts, call `analyze_image` and review every storyboard image:
- it must satisfy the segment's storyboard requirement
- it must show multiple shot panels for the segment when the segment has multiple shots
- each visible shot panel must include shot number, duration, framing, camera movement, and transition or seam note labels
- it must preserve all approved anchors used by that segment
- it must make seam-critical objects, gestures, or camera states visible when relevant
- it must not introduce new conflicting characters, props, locations, costumes, or styles

If any storyboard image fails, regenerate it before script writing.

Stop and ask for storyboard approval. Do not write final segment scripts before storyboard images are visible, analyzed, and approved.

### 7. Write Segment And Seam Plan

In CUI, show:
- the ordered segment list
- each segment's duration, purpose, required anchors, start state, end state
- each segment's exact asset refs, e.g. `uses: <<<media_2>>>（V角色卡）, <<<media_4>>>（海滩场景卡）`
- each segment's approved storyboard ref, e.g. `storyboard: <<<media_7>>>（S02分镜图）`
- every seam between adjacent segments
- readable segment scripts as normal Markdown text, not fenced code blocks
- for every seam, explicitly show how it is reflected in the adjacent scripts: "S01 final shot includes..." and "S02 opening shot includes..."

Do not wrap segment scripts or seam scripts in triple-backtick code fences. Code fences collapse in the CUI and hide the work the user needs to review.

Do not call `generate_animation` yet.

Ask the user to approve or revise the plan.

### 8. Compile Segment Scripts

After plan approval, compile each segment into an `animate.md`-compatible script.

Before showing the compiled scripts, review them like a director. Fix issues before presenting:
- each segment duration is 15 seconds or less
- every segment uses the approved `<<<media_N>>>` anchor refs
- every segment uses or explicitly references its approved storyboard refs
- every seam appears in the final shot of the previous segment and the first shot of the next segment
- the script language follows the user language
- no fenced code blocks
- no hidden dependency such as "继续上一段"

Each compiled script must:
- be no longer than 15 seconds
- define anchors at the beginning with `<<<media_N>>>（role/name）`
- define the approved storyboard image at the beginning with `<<<media_N>>>（Sxx分镜图）`
- reference the approved asset inventory. Do not use generic descriptions when an approved media ref exists.
- align the first shot, key staging, and final shot with the approved storyboard frame and seam requirements
- include start and end requirements from neighboring seams
- compile seam requirements into the script body itself:
  - if this segment has a previous seam, its first shot/action must satisfy that seam's `toStartRequirement`
  - if this segment has a next seam, its final shot/action must satisfy that seam's `fromEndRequirement`
  - do not leave seam requirements only in a separate seam paragraph
- avoid references to hidden prior context
- end with `Style:`
- use the same natural language as the user for all readable action, camera, dialogue, sound, and style descriptions. If the user writes Chinese, the segment script should be Chinese. Keep only the required format tokens in English: `Shot N (Xs):`, `Style:`, and media references.
- use the exact animate format `Shot N (Xs):` with the ASCII colon `:`. Never write `Shot N (Xs)：` with a Chinese/full-width colon.
- be shown in CUI as regular Markdown text, not inside a fenced code block.
- include design bridges, title cards, and interstitials in the total duration budget. If the target is 60 seconds, segment durations plus bridge durations must fit inside 60 seconds unless the user approves an overrun.

Bad:

> 继续上一段，主角跑进地铁。

Good:

> 雨伞入站
>
> 主角是<<<media_3>>>（黑色风衣女孩），关键道具是<<<media_4>>>（红伞）。
> Shot 1 (2s): 特写，缓慢推进。红伞手柄占满画面，雨滴沿着伞柄滑落。
> Shot 2 (5s): 拉远到中景。黑色风衣女孩握紧红伞冲下地铁楼梯，湿漉漉的瓷砖反射霓虹灯。
> Shot 3 (3s): 近景，跟拍。她回头看一眼，人物面部稳定清晰，然后消失在即将关闭的地铁门后。
> Style: 电影感雨夜黑色电影，手持紧迫感，红伞锚点保持一致。


### 9. Final Preflight Before Submission

Before calling `generate_animation`, show a short preflight checklist:
- story approved
- asset inventory approved
- storyboard frames approved for every segment
- exact `<<<media_N>>>` refs per segment
- every required asset is referenced in the relevant segment scripts
- every approved storyboard frame is referenced in the relevant segment script
- every seam is embedded into adjacent scripts
- each segment duration is 15 seconds or less
- user has approved this exact submission

If any item is missing, stop. Do not submit.

### 10. Generate Real Segments Only After Approval

After the user approves the exact final submission:
- submit each segment with `generate_animation`
- treat each segment as independent
- retry only failed or rejected segments
- reuse approved anchors and approved segments

### 11. Assemble Later

Only after real segments are approved:
- use FFmpeg for final trim, fades, audio bridges, concat, and export
- publish one final video with `write_file`
- do not publish intermediate chunks unless the user explicitly asks

## Review Gates

Required review gates:
1. Story direction approval
2. Asset inventory and anchor plan approval
3. Anchor / character card / scene card / prop card approval
4. Segment outline and storyboard requirements approval
5. OpenAI storyboard frame approval for every segment
6. Segment and seam text plan approval
7. Final preflight approval before `generate_animation`
8. Real segment approval before final assembly

Do not skip gates unless the user explicitly asks to proceed without confirmation.

## Workspace Manifest

When useful, save a manifest under:

```text
projects/{projectId}/long-video/{runId}/director-plan.json
```

Recommended shape:

```json
{
  "version": 1,
  "targetDurationSec": 120,
  "story": {
    "approved": false,
    "concept": "",
    "beats": []
  },
  "assetInventory": [],
  "anchors": [],
  "storyboardFrames": [
    {
      "id": "storyboard-segment-01",
      "segmentId": "segment-01",
      "timelineMediaRef": "",
      "source": "generated_openai",
      "analysisChecked": false,
      "approved": false
    }
  ],
  "segments": [],
  "seams": [],
  "submissionMode": "storyboard_then_text|storyboard_then_real_generation",
  "preflight": {
    "approved": false,
    "assetRefsChecked": false,
    "seamsEmbedded": false
  },
  "generation": {
    "approvedSegmentIds": [],
    "rejectedSegmentIds": [],
    "finalVideoPath": ""
  }
}
```

Use this manifest to resume the workflow across turns.
