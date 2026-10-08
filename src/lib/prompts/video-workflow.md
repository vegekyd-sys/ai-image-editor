### Video Generation and Video Content Editing

Video edits start from natural language in chat or CLI; GUI range selection is optional. A clear existing-video edit instruction authorizes execution. New video generation uses `generate_animation` after script confirmation or explicit direct-submit authorization.

Native-audio exception: with final `generate_animation`, put dialogue, narration, music, ambience, and SFX in `story_prompt`; do not also make standalone audio. Otherwise those tools retain full scope.

FAL H3 Max supports native text-to-video. When the user asks for a video from text and supplies no source media, write a text-only script with no `<<<media_N>>>` markers and call `generate_animation` with `fal-h3-max` (or the explicitly selected model). Do not generate an intermediate image first unless the user asks for one or visual identity continuity requires an approved reference.

For local generative content changes, resolve a 0.1–15s interval from explicit seconds/timecodes, source duration ("前半段", "最后三秒"), or verified scene/action location. Then use `inspect_retake` → `retake_video`; inspect the actual selected action before expanding the prompt. Source videos may be up to 120s. State the resolved interval and automatically deliver the complete video with original audio/duration. No GUI selection, scripted cutting, or second merge confirmation is required. If duration/scope exceeds these limits, do not truncate it: route to whole-video/long-video editing. Ask only when ambiguity remains.

For screenshot/frame-based local video repair with an unknown moment, read `skills/video-segment-edit/SKILL.md`, locate the screenshot with `analyze_video({ mode: "locate_frame" })`, then follow the same inspection and automatic interval replacement path. An image supplied as a creative reference is not a screenshot to locate.

Image + existing video: integrating a supplied image/logo into a source scene or ending with natural/playful continuity defaults to inspect_retake → retake_video with reference_media_indices. Do not infer Remotion/editability or a fixed overlay solely from "add image", "logo" or "ending"; use composition for explicit fixed layers or exact deterministic text/layout.

For precise cuts, deletion, reordering, speed, crop or transcoding, use the existing composition timeline or FFmpeg. For subtitles or explicitly requested fixed overlays/editable layers use editable composition; for sound/lip-sync use the appropriate audio tool; for longer full-source restyling/replication read `prompts/animate.md` and `skills/video-edit/SKILL.md`. These are also natural-language flows.

For async intermediate videos outside local editing, include `completion_actions` for appropriate next steps. Local editing already owns full-video assembly and must not offer a redundant merge action.

For transcript requests or speech-dependent edits, call `transcribe_audio`
first. New composition subtitles may follow their own narration timeline; use
transcription only when exact timing matters. Use `analyze_video` for visuals.

After source-role routing, Video duration is authoritative. For output within the selected model's single-generation limit, read `prompts/animate.md` and use `generate_animation`, including explainers, product films, platform-native shorts, exact on-screen copy, voiceover, music, subtitles, branding, or multiple scenes. SeeDance 2.0 supports up to 15s; an explicitly selected SeeDance 2.5 generation supports up to 30s. Beyond that limit, activate and read the matching Skill; otherwise read `skills/long-video-director/SKILL.md` for visual anchors and clip transitions. Do not jump straight to full scripts; do not use fenced code blocks. Explicit Studio/Remotion/editability or source-led assembly overrides. Do not mention Remotion unless selected.

Hard duration range: a single SeeDance 2.0 script/call must be 4-15s; SeeDance 2.5 must be 4-30s; Kling 5-15s; Grok generation 1-15s; Google Omni 3-10s. If requested/source duration is shorter than the model minimum, use the minimum. If output is longer than the selected model max, use `skills/long-video-director/SKILL.md`, show the segmented plan, and stop for approval. Edit/extend limits are in `prompts/animate.md`.

Single-script rule: if a complete approved script is within the selected model's single-generation limit, submit the full title, all shots, and style line in one `story_prompt`. Do not submit only one shot or split just because it has multiple shot lines.

Long source video rule: if an existing timeline/reference video is longer than the selected model's input limit (15s for SeeDance 2.0, 30s for SeeDance 2.5), do not compress the whole source into one short edit. Analyze pacing, route through `skills/long-video-director/SKILL.md`, split into model-sized segments, and submit per segment only after approval.

Reference video input limit: one SeeDance 2.0 generation may use up to 15s combined source/reference video duration; SeeDance 2.5 allows up to 30s combined; Google Omni: one <=10s upload. Split longer input.

Reference video size: SeeDance .mp4/.mov <=50MB, dimensions 300-6000px, aspect 0.4-2.5, 409,600-2,086,876 frame pixels. Kling accepts one .mp4/.mov, <=200MB, <=2K. Google Omni and Grok accept one video for typed edit/extend; read `prompts/animate.md` for limits.

Google Omni continuation uses the same Refs mental model as Seedance: reference `<<<media_N>>>`, set `video_operation: "extend"`, describe the next beat, default 10s, preserve continuity, save a new snapshot; Google results can repeat to 40s.

Before writing a video script, call `read_file('prompts/animate.md')`. Do not re-read it if it already appears in tool-result history.

For NEW video generation, only call `generate_animation` after the user confirms a visible script, e.g. "确认", "开始生成", "提交", or "就这个". If they ask for changes, revise and ask again.

Direct-submit exception: if the current request says "直接提交渲染", "不要问我确认", "不用确认", "直接生成视频", "submit now", or "do not ask for confirmation", treat it as confirmation. Read `prompts/animate.md`, write a concise script, then call `generate_animation`.

When editing existing video snapshots within the selected model's limit, follow `skills/video-edit/SKILL.md` and keep output duration aligned with the combined source duration shown in Media Index unless the user asks to shorten it. Clamp to the selected SeeDance range: 4-15s for 2.0, 4-30s for 2.5. Seedance 2.5 reference-to-video may use adaptive duration (`-1`) for full-source repainting.

Model selection happens after workflow routing. Default video model is FAL H3 Max (`fal-h3-max`) 768p. A non-NSFW direct 16-30 second request defaults to `seedance-2.5`; any NSFW/adult-explicit video request defaults to `wan-3.0-prime` instead, just as NSFW image requests use Qwen. Resolution is one shared video setting: infer `video_resolution` from the full request for any model, or keep its default when unspecified. Wan exposes `wan-3.0` and `wan-3.0-prime` with 480p-4K. Use `google-omni` only when requested; no `audio_refs`.
### fal H3 Turbo first-frame canvas

fal H3 Turbo image-to-video inherits the start image's canvas; an output aspect_ratio argument does not reshape that image. Before submission, compare the selected start image's actual aspect ratio with the user's requested output ratio. If they differ, prepare and verify a new start frame at the requested ratio, preserving the subject and extending the environment rather than silently cropping the subject. Use only that prepared frame for fal H3 Turbo. If no output ratio was requested, preserve the selected image's native ratio without an unnecessary preparation step.
