# Layerize text rendering

Layer decomposition preserves supplier PNGs. `buildLayerizeDesign(manifest)` keeps text as image layers; native text is an explicit mode, not a promise to recover an original font file. OCR metadata can identify text without replacing its pixels. The Agent entry point owns the default selection of that mode.

## Optional native text

- Unchanged wording and pending font matching show the extracted original PNG. Matching remains an independent background sidecar task; publishing the initial layered design does not wait for it.
- Matching assembles CJK font families from their Unicode-range subset files. A Latin-only subset is not a Chinese font. All characters must have a glyph before a candidate can be measured.
- CJK glyphs use a uniform matrix scale. Row advance differences use bounded letter spacing instead of squeezing glyphs horizontally. A short glyph's principal axis is not treated as the rotation of a text line.
- Quote every named CSS family, including `Noto Sans Symbols 2`. The trailing numeric token makes an unquoted CSS family list invalid and the browser can silently discard the whole declaration.
- Native edited wording keeps its fitted font size, weight, baseline and matrix. Explicit line breaks and longer rows produce additional SVG `tspan` rows. This does not reflow neighboring independent editables; their positions remain under user control. Longer wording can therefore require the user to move adjacent layers. No silent font shrinking or cross-layer movement occurs.
- The same generated `LayerizeText` component runs through the ordinary React Proxy, Player, preview and export paths. Font results update system metadata only; values, transforms, layer order, deletions and edit history stay local.

These changes affect newly generated compositions. Existing saved compositions contain their renderer code; a font sidecar update does not migrate that code. Do not overwrite an authored or saved design to apply this change. For a controlled private comparison, rebuild from the retained manifest and merge the existing user props after verifying that editable IDs and geometry match.

## Image-model text edits

An image-model request can reproduce handwriting and lettering on a textured or tilted surface without choosing a font. It can also change adjacent pixels, layout or glyph thickness. A successful generation does not establish preservation of the rest of the composition.

For a text-only transparent PNG, inspect actual output alpha, glyph bounds and the original layer coordinate system. Any crop/normalization must use uniform scaling and preserve the saved layer transform. If longer wording exceeds its allotted bounds, surface the layout decision rather than stretching it into the old box. Restrict source replacement to the selected layer, keep the original raster, and validate save/reopen, undo/redo and export in the owning editor flow.
