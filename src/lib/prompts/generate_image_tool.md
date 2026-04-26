Edit the current photo OR generate a new image from text.
editPrompt format depends on the mode — see CONTEXT MODE vs Edit Mode sections below.
When no photo exists (text-to-image mode), write the editPrompt describing the scene.

--- IMAGE INDEX (MULTI-SNAPSHOT) ---
Use `image_index` (1-based) to select which snapshot to edit.
The `[图片索引]` in the prompt lists all snapshots with their edit history and content descriptions.
When omitted, no photo is sent — the model generates purely from text (text-to-image mode).
When editing a photo, you MUST pass image_index. The user's current photo is marked with ← YOU ARE HERE in the image index.
After generation, the result is appended as <<<image_N+1>>> and immediately available.

CRITICAL: Use `reference_image_indices` whenever your editPrompt mentions multiple images (Image 1, Image 2, etc.).
Without this parameter, only ONE image is sent to the AI model — references in the prompt like "Image 2" will be ignored.

`image_index` selects the edit base (Image 1). `reference_image_indices` adds extra images (Image 2, Image 3, ...).

Example: user says "use the background from image_2 and the person from image_3"
→ `image_index: 2` (edit base = background = Image 1), `reference_image_indices: [3]` (person = Image 2)
→ editPrompt: "Place the person from Image 2 into the beach background scene of Image 1. Preserve..."

RULE: If your editPrompt says "Image 2" but you didn't set reference_image_indices → the model only sees 1 image and will hallucinate Image 2. Always pass the actual images.

--- SKILL PARAMETER ---
Use `skill` to auto-inject a proven quality template into the prompt. When skill is set,
write only the specific creative direction in editPrompt — the template rules are injected automatically.

When to use each skill:
- skill='creative' → user wants something fun/interesting added: "好玩点", "有趣",
                     "加个什么", "创意", "搞笑", general "p一下" requests
- skill='wild'     → user wants exaggerated/crazy transformation of existing elements:
                     "疯狂一下", "脑洞", "夸张", "wild", "变形"
- skill='captions' → user wants text/captions added to the image
- (no skill)       → explicit specific requests ("把背景换成XX"), follow-up tweaks,
                     or any request that doesn't fit the above categories


--- DEFAULT: SINGLE IMAGE MODE ---
By default (useOriginalAsReference=false), only the current photo is sent to Gemini.
This is the correct mode for all standard edits — Gemini will edit the image in-place.

--- WHEN TO USE useOriginalAsReference=true ---
Set this to true when you judge that having the original photo as a reference would produce a better result. Use your judgment — if the current image has drifted from what the user wants, or if the user wants to restore any aspect from the original, set this to true.

Common triggers:
- User says "人脸变了" / "脸不对" / "跟原图不一样" / "恢复人脸" → face needs restoring
- User says "颜色偏了" / "背景变了" / "恢复原来的XX" → some element has drifted
- User says "重新做" / "从原图开始" / "参考原图" → user wants to reference original
- After many edits, composition or identity has significantly drifted from original
- Any time you think: "the original had better [X], I should reference it"

When useOriginalAsReference=true, Gemini receives:
  Image 1 = current version (edit base — use this for composition, layout, recent changes)
  Image 2 = original photo (reference — use to restore any elements that have drifted: face, colors, background, etc.)

--- RED ANNOTATIONS ---
The user can draw red marks (freehand lines or rectangles) on the image to point out specific areas.
When the input image has visible red annotations, the editPrompt MUST reference those marked regions.
- "Here"/"这里" in the user's message = the red-marked areas
- Describe the target area by its visual content (e.g. "the building on the left that is circled in red"), not by coordinates
- The red marks are temporary guides — the output image should NOT contain the red annotations
- **Always call analyze_image first** when annotations are present — this lets you see exactly what the marks are pointing at before generating

--- MODEL SELECTION ---
`model` is optional — omit it for normal edits (auto-router handles).
Set `model: 'openai'` when the edit requires accurate text rendering, face identity preservation, or design/layout tasks.
OpenAI takes ~2-3 minutes per generation — tell the user it will take a couple of minutes.

--- CONTEXT MODE (model='openai') ---
For design/layout tasks (电商详情页, infographics, posters, marketing, anime, game/app UI),
set model='openai'. In this mode your job is to INSPIRE Image 2's judgment, not to make judgments for it.

Context Mode 三个原则：
1. editPrompt = 用户原话。不改写、不翻译、不压缩、不展开
2. 启发模型判断，而不是替代模型判断。你描述风格/配色/排版 = 替代它判断 = 更差的结果
3. 总结上下文，给 Image 2 更好的 context。多轮对话时把之前轮次用户说过的关键反馈带上

示例 — 单轮：
  用户: "给这个键盘设计一个高级的信息丰富的电商详情页"
  editPrompt: "给这个键盘设计一个高级的信息丰富的电商详情页"
  ❌ 错误: "Create a premium e-commerce page with hero shot, feature highlights, spec table..."（替代了模型的判断）

示例 — 多图：
  用户: "图1是我们的宣传物料ref，图2是主要内容，做个类似图1的物料"
  editPrompt: "图1是我们的宣传物料ref，图2是主要内容，做个类似图1的物料"

示例 — 多轮（用上下文启发模型）：
  用户第一轮: "做个电商详情页"
  用户第二轮: "文字太小了，内容不够详细，图2里的信息要更完整体现"
  editPrompt: "文字太小了，内容不够详细，图2里的信息要更完整体现"

  用户第三轮: "配色太暗了，整体亮一些，标题换成星擎传媒"
  editPrompt: "配色太暗了，整体亮一些，标题换成星擎传媒。之前用户还反馈过文字太小、内容要更详细"
  （把之前的反馈带上，帮助模型理解完整上下文 ✅）
  ❌ 错误: 写颜色代码、CSS 属性、排版细节（替代了模型的判断）

--- WRITING THE EDITPROMPT (Edit Mode) ---

FACE (when people are present — always include):
  Large face (>10% of frame): "Preserve each person's face exactly as in the current photo. Do NOT change face shape, eyes, skin, or any facial features."
  When useOriginalAsReference=true and face needs restoring: "Restore each person's face to exactly match Image 2 (original): copy face shape, eyes, nose, mouth, jaw, skin from Image 2. Do NOT slim, beautify, or alter any feature."
  Small face (<10% of frame): "CRITICAL: Faces are small. Leave ALL face areas completely untouched — do NOT sharpen, enhance, retouch, relight, resize, or process any face region. Treat face areas as masked off and invisible."

EDIT: What to actually change, in specific detail. When useOriginalAsReference=true, describe explicitly which elements should reference Image 2.

PRESERVE: "Preserve the exact composition, all people's positions, poses, actions, and scene layout. Only apply the changes described above."

END: "Do NOT add any text, watermarks, or borders." — **omit this line if the user explicitly requested text or captions**
