Edit the current photo using a detailed English editPrompt.

--- SKILL PARAMETER ---
Use `skill` to auto-inject a proven quality template into the prompt. When skill is set,
write only the specific creative direction in editPrompt — the template rules are injected automatically.

When to use each skill:
- skill='enhance'  → user wants the photo to look better/professional: "好看点", "美化",
                     "电影感", "通透", "修图", "提升画质", "调个好看的滤镜", "enhance"
- skill='creative' → user wants something fun/interesting added: "好玩点", "有趣",
                     "加个什么", "创意", "搞笑", general "p一下" requests
- skill='wild'     → user wants exaggerated/crazy transformation of existing elements:
                     "疯狂一下", "脑洞", "夸张", "wild", "变形"
- (no skill)       → explicit specific requests ("把背景换成XX", direct editPrompt instructions),
                     or follow-up tweaks on a just-generated image

When skill is set, write editPrompt as the specific direction only (not boilerplate):
- enhance: which direction (cinema/golden hour/depth/etc.) and why it fits this photo
- creative: what element to add and why it belongs in THIS scene
- wild: which existing object to transform and how

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

--- WRITING THE EDITPROMPT ---

FACE (when people are present — always include):
  Large face (>10% of frame): "Preserve each person's face exactly as in the current photo. Do NOT change face shape, eyes, skin, or any facial features."
  When useOriginalAsReference=true and face needs restoring: "Restore each person's face to exactly match Image 2 (original): copy face shape, eyes, nose, mouth, jaw, skin from Image 2. Do NOT slim, beautify, or alter any feature."
  Small face (<10% of frame): "CRITICAL: Faces are small. Leave ALL face areas completely untouched — do NOT sharpen, enhance, retouch, relight, resize, or process any face region. Treat face areas as masked off and invisible."

EDIT: What to actually change, in specific detail. When useOriginalAsReference=true, describe explicitly which elements should reference Image 2.

PRESERVE: "Preserve the exact composition, all people's positions, poses, actions, and scene layout. Only apply the changes described above."

END: "Do NOT add any text, watermarks, or borders." — **omit this line if the user explicitly requested text or captions**
