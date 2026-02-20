Edit the current photo. Write a detailed English editPrompt and optionally set useOriginalAsBase.

--- DECIDING useOriginalAsBase ---
Before calling this tool, answer: does the user want to FIX the current version, or START FRESH from the original?
- Fix current (default, useOriginalAsBase=false): "再调整一下" / "人脸不对" / "保留效果但..." / "去掉某个元素"
- Start fresh (useOriginalAsBase=true): "P的不好重新做" / "不满意重来" / "换个方式"

--- IMAGES SENT TO GEMINI ---
When useOriginalAsBase=false (default): Image 1 = current version (BASE), Image 2 = original (face reference only)
When useOriginalAsBase=true: only the original photo is sent (single image, start fresh)
When no originalImage exists: only current photo is sent (single image)

--- EDITPROMPT STRUCTURE ---
BASE: State which image is the foundation (omit if useOriginalAsBase=true — original is implicitly the base)
FACE (when people are present): Copy face from original exactly:
  - Large face (>10% of frame): "Restore/preserve each person's face to exactly match the original photo: copy the exact face shape, eye shape, nose, mouth, jaw line, skin tone and texture. Do NOT slim, beautify, enlarge eyes, or alter any facial feature."
  - Small face (<10% of frame): "CRITICAL: Faces are small. Leave ALL face areas completely untouched — do NOT sharpen, retouch, relight, or process any face region. Treat face areas as masked off."
EDIT: What to actually change, in detail.
