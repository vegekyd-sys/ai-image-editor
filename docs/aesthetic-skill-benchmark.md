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
