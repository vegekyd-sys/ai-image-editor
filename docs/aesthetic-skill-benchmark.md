# Aesthetic Skill Benchmark

## Goal

Compare aesthetic direction skills inside the same durable Makaron explainer
harness. Human preference decides the winner; the Agent does not self-rank.

## Controlled Input

- Reference: `/Users/tianyicai/Downloads/20260712-012336.png`
- Duration: 30 seconds
- Canvas: 16:9, 1920x1080, 30 FPS
- Language: Chinese
- Subject: Makaron, a one-person AI creative studio
- Reference role: Pixel Wizard and Spark must be recognizable visual subjects,
  with exactly three meaningful derivative character/image roles generated from
  the reference.
- Workflow: `explainer-video`, auto approval, editable Remotion, voiceover,
  background music, ASR-timed subtitles, final MP4
- Asset budget: the reference board plus exactly three generated derivative
  character/image roles; no provider-generated video inserts

## Locked Prompt

```text
做一条30秒中文16:9的Makaron explainer video。使用我上传的Makaron mascot参考图：Pixel Wizard是引导角色，Spark是创作能量；基于参考图生成恰好3个有意义的衍生角色素材，不使用provider生成的视频插入。旁白全文固定为：“一个想法，常常卡在制作的第一步。打开 Makaron，Pixel Wizard 把它变成创作任务。Spark 点亮图像，AI 让画面动起来，再加入旁白、音乐和字幕。调整节奏、构图与细节，让图片、视频、声音和编辑汇成完整作品。从念头到交付，这就是 Makaron，一人也能拥有的 AI 创作工作室。”不得改写、增删或调换旁白。要有背景音乐、与声音同步且符合画面主题的字幕，并在结尾明确出现Makaron。自动推进到最终MP4，不要向我确认。
```

Do not add the lens name, benchmark language, or extra creative direction to the
prompt. Select only one active skill per fresh project.

## Variants

1. Baseline: `explainer-video`
2. Rampstack: `explainer-aesthetic-rampstack`
3. LottieFiles: `explainer-aesthetic-lottiefiles`
4. Character Motion: `explainer-aesthetic-disney`

## Timing

For every fresh project retain:

- CLI submit time and Agent run ID
- first Studio artifact
- first Composition autosave
- MP4 ready
- Studio Delivery complete
- total wall time
- attempts, previews, patches/revisions, materializations

## Human Review Matrix

- theme relevance
- mascot identity and meaningful use
- composition scale and frame utilization
- material, lighting, and typography
- motion craft and visual impact
- narrative completeness
- audio/subtitle/visual cohesion
- production time and failure count

## Executed Results (2026-07-13)

All four official runs used the same deployed harness revision, a fresh project,
the same uploaded reference, and the locked prompt above. After removing the
automatically injected `[Active skill: ...]` line, every recorded prompt has
the same SHA-256:
`2153f1137f7731cd797519899bafe42108aaeab23ecd66ef2a5de868df5bb9c0`.

| Variant | Project | First MP4 | Delivery complete | Exports | Human finding |
| --- | --- | ---: | ---: | ---: | --- |
| Baseline | [project](https://ai-image-editor-rembp5abl-vegekyd-sys-projects.vercel.app/projects/ca89859b-70b0-4cd7-8ef0-8dd71e490e9c) / [MP4](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/ca89859b-70b0-4cd7-8ef0-8dd71e490e9c/media/remotion-makaron-explainer-30s-final-1080p-d196d911.mp4) | 11:50 | 13:02 | 2 | Best overall hierarchy and narrative legibility in this sample. Still dark, with underused abstract beats; captions are visually too small and word-led. |
| Rampstack | [project](https://ai-image-editor-rembp5abl-vegekyd-sys-projects.vercel.app/projects/d3fe4e34-928f-49b3-9044-1ed4a02d4e9e) / [MP4](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/d3fe4e34-928f-49b3-9044-1ed4a02d4e9e/media/remotion-makaron-explainer-30s-source-32fc7244.mp4) | 11:07 | 12:40 | 2 | Best of the imported lenses. Derivative assets carry clearer task, spark, and convergence roles, but the dark palette and an empty convergence beat prevent a decisive win. |
| LottieFiles | [project](https://ai-image-editor-rembp5abl-vegekyd-sys-projects.vercel.app/projects/caf46312-5263-4c64-b01b-7e7ff055abf3) / [MP4](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/caf46312-5263-4c64-b01b-7e7ff055abf3/media/remotion-makaron-explainer-lottiefiles-30s-final-9db81821.mp4) | 13:38 | 14:53 | 1 | More explicit motion staging, but smaller subjects, competing text layers, and a near-empty beat make the finished video weaker than baseline. |
| Character Motion | [project](https://ai-image-editor-rembp5abl-vegekyd-sys-projects.vercel.app/projects/1b2d8c3d-5ad1-487b-a606-12d504620138) / [MP4](https://cdn.makaron.app/storage/v1/object/public/images/5955d413-cad2-4814-b094-7fdf62d20400/workspace/1b2d8c3d-5ad1-487b-a606-12d504620138/media/remotion-makaron-explainer-30s-final-84b11e1d.mp4) | 10:47 | 11:57 | 1 | Fastest run and clearer character intent, but the characters remain too small and too much of the frame is unused. It is not an aesthetic improvement over baseline. |

The official runs cluster between 11:57 and 14:53. Their differences are too
small and provider-dependent to claim that an aesthetic lens improves speed.
A separate pre-fix baseline diagnostic took 37:25 because caption hydration,
resolution validation, and repeated export repair happened late in Review. The
latest harness moved caption failures forward and completed the fair baseline
in 13:02; that is a harness reliability improvement, not a lens win.

## Acceptance Evidence

- All four Studio Runs completed every stage through Delivery without manual
  approval.
- Every run generated exactly three derivative images and no provider video
  insert.
- Every final file is H.264, 1920x1080, 30 FPS, about 30 seconds, with stereo
  AAC audio.
- FFmpeg black-frame detection found no sustained black interval in any final
  MP4.
- FFmpeg silence detection found no interval over one second except a 1.73s
  trailing silent hold in the baseline.
- Manual contact-sheet review confirmed timed captions, recognizable mascot
  use, complete narrative beats, and an explicit Makaron ending in every run.
- Prompt equality, project freshness, asset count, stage completion, output
  metadata, and elapsed time were verified from CLI response records.

## Decision

Do not replace the default explainer composition direction with any imported
lens from this round. Keep Rampstack as an optional experimental direction; it
is the only imported lens that produced a small, theme-relevant improvement.
Keep LottieFiles and Character Motion hidden for controlled experiments until a
shared composition-scale contract prevents tiny subjects, weak frame usage,
and decorative motion from outranking visual hierarchy.

## Third-Party Sources

- LottieFiles Motion Design, MIT, commit
  `f9a8a041b85185ee4881b3471d3415e939aac772`
  <https://github.com/LottieFiles/motion-design-skill>
- Rampstack Creative Direction + Art Direction, MIT, commit
  `bc6d96180124d7469b19f2641678963d7bdcf924`
  <https://github.com/rampstackco/claude-skills>
- Dylan Tarre Animation Principles, MIT, commit
  `83597134ba8ff59838270f94d7ac7282ffa3b54d`
  <https://github.com/dylantarre/animation-principles>

Excluded from this round: skills without an explicit compatible license,
HyperFrames-based templates, runtime-specific GSAP/Framer skills, and web-first
UI design systems.
