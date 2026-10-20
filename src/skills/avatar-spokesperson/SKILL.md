---
name: avatar-spokesperson
description: Create presenter videos with native speech, lip sync, music and subtitles in one video generation; use the supplied identity and product references. This is a direct video workflow.
allowed-tools: read_file analyze_video analyze_image transcribe_audio generate_animation preview_frame write_code_file run_code publish_draft materialize_media
metadata:
  makaron:
    icon: "◫"
    color: "#d946ef"
    tipsEnabled: false
    builtIn: true
    userSelectable: true
    manifestVisible: true
    sourceProject: "openmontage"
    sourceSkill: "avatar-spokesperson"
    sourceKind: "pipeline"
    supportLevel: "adapted"
    adapterFamily: "video-generation"
    canonicalSkill: "avatar-spokesperson"
    sourceMediaRequired: false
    inputHint: "A presenter image or footage, plus a script or voice track"
    tags: [openmontage, adapted, video, generation, presenter, native-audio]
---

# Avatar Spokesperson

This is a Makaron-native adaptation of the OpenMontage capability. Preserve the
production intent, but use Makaron's existing tools and workspace contract. Do
not invoke OpenMontage Python tools, HyperFrames, or unexposed provider APIs.

## Direct Production

Read `prompts/animate.md` and `skills/_shared/native-audiovisual.md` once.
For a generated presenter, write one complete video script containing the
identity/product references, all shots, the exact quoted speech, voice
performance, music and requested on-screen text. Call `generate_animation`
once within the selected model's duration limit, with native audio enabled.
Respect user/App model selection; Seedance 2.5 requests use its Eco route by
default. Do not generate a voice master, silent plate or separate lip-sync job.

This Skill does not start Studio or require an editable composition. A supplied
script, five shots, product advertising, subtitles or a presenter is not a
reason to enter Studio. Native subtitles and a model label can be requested in
the same generation. Inspect actual words, identity, mouth motion and sound in
the returned MP4; provider success alone is not quality acceptance.

If the user explicitly requires editable/deterministic captions, retain the
generated audiovisual video as the source. Transcribe that video, then use
direct `run_code(runtime: "composition")`, preview, `publish_draft` and
`materialize_media` only for those text layers. This small overlay does not
start `studio_run` or need eight production-stage artifacts. Keep the video
audible; never duplicate its voice in another audio layer. Do not change the
picture/sound production method or invoke the old avatar Studio recipe.
Supplied presenter footage
instead follows `skills/talking-head/SKILL.md` or `skills/video-edit/SKILL.md`.

## Failure And Delivery

Retain the accepted task ID and poll that task. A failed generation is not a
deliverable. On moderation failure, inspect the actual inputs and exact error;
remove unnecessary prompt constraints or try another compatible model when the
user has authorized recovery. Do not blame ordinary clothing, faces or products
without evidence, and never repost an unchanged request in a retry loop.

Deliver the final audible MP4 with the requested text after checking dialogue,
caption readability/sync, presenter and product consistency. Keep the real
failure or quality gap visible while recovering it.
