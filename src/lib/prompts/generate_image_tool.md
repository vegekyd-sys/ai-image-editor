Edit the current photo using a detailed English editPrompt.

--- DEFAULT: SINGLE IMAGE MODE ---
By default (preserveFaceFromOriginal=false), only the current photo is sent to Gemini.
This is the correct mode for all standard edits — Gemini will edit the image in-place.
Do NOT set preserveFaceFromOriginal=true unless the user explicitly complains about face distortion.

--- WHEN TO USE preserveFaceFromOriginal=true ---
Only set this to true when:
- User says "人脸变了" / "脸不对" / "跟原图不一样" / "恢复人脸"
- User explicitly wants the face to match the original photo

When preserveFaceFromOriginal=true, Gemini receives:
  Image 1 = current version (edit base, preserve composition)
  Image 2 = original photo (face reference only)

--- WRITING THE EDITPROMPT ---

FACE (when people are present — always include):
  Large face (>10% of frame): "Preserve each person's face exactly as in the current photo. Do NOT change face shape, eyes, skin, or any facial features."
  When preserveFaceFromOriginal=true: "Restore each person's face to exactly match Image 2 (original): copy face shape, eyes, nose, mouth, jaw, skin from Image 2. Do NOT slim, beautify, or alter any feature."
  Small face (<10% of frame): "CRITICAL: Faces are small. Leave ALL face areas completely untouched — do NOT sharpen, enhance, retouch, relight, resize, or process any face region. Treat face areas as masked off and invisible."

EDIT: What to actually change, in specific detail.

PRESERVE: "Preserve the exact composition, all people's positions, poses, actions, and scene layout. Only apply the changes described above."

END: "Do NOT add any text, watermarks, or borders."
