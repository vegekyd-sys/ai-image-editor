---
name: animated-gif
description: >
  Turn multiple timeline snapshots into an animated GIF with proper frame-by-frame animation.
  Uses manual GIF89a binary encoding to avoid sharp's multi-frame limitations.
  Activate when user mentions: GIF, 动图, 做个gif, 拼成gif, animate these, combine into gif.
allowed-tools: run_code analyze_image
metadata:
  makaron:
    icon: "🎞️"
    color: "#FF6B35"
    tipsEnabled: false
    tags: [gif, animation, export, workflow]
---

# Animated GIF Creator

Create proper animated GIFs from multiple timeline snapshots using `run_code` with sharp + manual GIF89a binary encoding.

## Why Manual Encoding?

Sharp (libvips) has limited support for **creating** multi-frame animated GIFs. Common issues:
- `sharp().gif()` with stacked raw pixel data produces single-frame output
- `pageHeight` option doesn't work reliably in all sharp versions
- Frames share a single Global Color Table → later frames get corrupted colors (花屏)

**Solution**: Build the GIF89a binary manually, giving each frame its own Local Color Table (LCT).

## Workflow

1. **Collect snapshots**: User specifies which `<<<image_N>>>` to include (e.g. "19到22"). Use `image_refs` in `run_code` to fetch them as Buffers.
2. **Resize frames**: Use sharp to resize all frames to the same dimensions (400-600px wide recommended for reasonable file size).
3. **Convert to indexed color**: Use sharp to convert each frame to a 256-color palette PNG, then extract the palette and pixel data.
4. **Build GIF89a binary**: Manually construct the binary with proper headers, frame descriptors, and Local Color Tables.
5. **Save to public path & provide download link**: Upload to workspace's exports folder with `saveToWorkspace()`, return the public URL for user to download.

## Core Code Template

```javascript
// Parameters to customize:
// - images[]       : pre-fetched Buffers from image_refs
// - targetW        : output width (400-600px recommended)
// - delay          : frame delay in 1/100th seconds (80 = 800ms, 50 = 500ms)
// - filename       : output filename

const targetW = 400;
const meta0 = await sharp(images[0]).metadata();
const targetH = Math.round(targetW * meta0.height / meta0.width);
const delay = 80; // 800ms per frame

// Step 1: Convert each frame to 256-color palette PNG via sharp
const gifFrames = [];
for (const imgBuf of images) {
  const pngBuf = await sharp(imgBuf)
    .resize(targetW, targetH, { fit: 'cover' })
    .png({ palette: true, colours: 256 })
    .toBuffer();
  gifFrames.push(pngBuf);
}

// Step 2: Extract palette and pixel indices from each PNG
function parsePalettePNG(pngBuffer) {
  let offset = 8;
  let palette = null;

  while (offset < pngBuffer.length) {
    const chunkLen = pngBuffer.readUInt32BE(offset);
    const chunkType = pngBuffer.slice(offset + 4, offset + 8).toString('ascii');

    if (chunkType === 'PLTE') {
      palette = pngBuffer.slice(offset + 8, offset + 8 + chunkLen);
    }
    offset += 12 + chunkLen;
  }

  return { palette };
}

// Step 3: Build GIF89a binary with Local Color Tables
async function buildAnimatedGif(frames, width, height, frameDelay) {
  const parts = [];

  // GIF Header
  parts.push(Buffer.from('GIF89a'));

  // Logical Screen Descriptor
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(width, 0);
  lsd.writeUInt16LE(height, 2);
  lsd[4] = 0x00;
  lsd[5] = 0x00;
  lsd[6] = 0x00;
  parts.push(lsd);

  // Netscape Application Extension (for looping)
  parts.push(Buffer.from([
    0x21, 0xFF, 0x0B,
    0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45,
    0x32, 0x2E, 0x30,
    0x03, 0x01,
    0x00, 0x00,
    0x00
  ]));

  for (const frameBuf of frames) {
    const raw = await sharp(frameBuf)
      .resize(width, height, { fit: 'cover' })
      .png({ palette: true, colours: 256 })
      .toBuffer();

    const { palette } = parsePalettePNG(raw);
    if (!palette) continue;

    const fullPalette = Buffer.alloc(768, 0);
    palette.copy(fullPalette, 0, 0, Math.min(palette.length, 768));
    const colorCount = Math.ceil(palette.length / 3);
    const colorBits = Math.max(Math.ceil(Math.log2(colorCount)), 2);

    const rawPixels = await sharp(frameBuf)
      .resize(width, height, { fit: 'cover' })
      .raw()
      .toBuffer();

    const paletteColors = [];
    for (let i = 0; i < Math.min(colorCount, 256); i++) {
      paletteColors.push({
        r: fullPalette[i * 3],
        g: fullPalette[i * 3 + 1],
        b: fullPalette[i * 3 + 2]
      });
    }

    const indexedPixels = Buffer.alloc(width * height);
    for (let i = 0; i < width * height; i++) {
      const r = rawPixels[i * 3];
      const g = rawPixels[i * 3 + 1];
      const b = rawPixels[i * 3 + 2];

      let bestIdx = 0;
      let bestDist = Infinity;
      for (let j = 0; j < paletteColors.length; j++) {
        const dr = r - paletteColors[j].r;
        const dg = g - paletteColors[j].g;
        const db = b - paletteColors[j].b;
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = j;
        }
      }
      indexedPixels[i] = bestIdx;
    }

    const gce = Buffer.from([
      0x21, 0xF9, 0x04,
      0x08,
      frameDelay & 0xFF, (frameDelay >> 8) & 0xFF,
      0x00,
      0x00
    ]);
    parts.push(gce);

    const imgDesc = Buffer.alloc(10);
    imgDesc[0] = 0x2C;
    imgDesc.writeUInt16LE(0, 1);
    imgDesc.writeUInt16LE(0, 3);
    imgDesc.writeUInt16LE(width, 5);
    imgDesc.writeUInt16LE(height, 7);
    imgDesc[9] = 0x87;
    parts.push(imgDesc);

    parts.push(fullPalette);

    const minCodeSize = Math.max(colorBits, 2);
    const lzwData = lzwEncode(indexedPixels, minCodeSize);

    parts.push(Buffer.from([minCodeSize]));

    let pos = 0;
    while (pos < lzwData.length) {
      const blockSize = Math.min(255, lzwData.length - pos);
      parts.push(Buffer.from([blockSize]));
      parts.push(lzwData.slice(pos, pos + blockSize));
      pos += blockSize;
    }
    parts.push(Buffer.from([0x00]));
  }

  parts.push(Buffer.from([0x3B]));
  return Buffer.concat(parts);
}

// LZW Encoder for GIF
function lzwEncode(pixels, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  const maxCodeSize = 12;

  let dict = new Map();
  for (let i = 0; i < clearCode; i++) {
    dict.set(String(i), i);
  }

  const output = [];
  let bitBuffer = 0;
  let bitCount = 0;

  function writeBits(code, size) {
    bitBuffer |= (code << bitCount);
    bitCount += size;
    while (bitCount >= 8) {
      output.push(bitBuffer & 0xFF);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  }

  writeBits(clearCode, codeSize);

  let current = String(pixels[0]);
  for (let i = 1; i < pixels.length; i++) {
    const next = String(pixels[i]);
    const combined = current + ',' + next;

    if (dict.has(combined)) {
      current = combined;
    } else {
      writeBits(dict.get(current), codeSize);

      if (nextCode < (1 << maxCodeSize)) {
        dict.set(combined, nextCode);
        nextCode++;
        if (nextCode > (1 << codeSize) && codeSize < maxCodeSize) {
          codeSize++;
        }
      } else {
        writeBits(clearCode, codeSize);
        dict = new Map();
        for (let j = 0; j < clearCode; j++) {
          dict.set(String(j), j);
        }
        codeSize = minCodeSize + 1;
        nextCode = eoiCode + 1;
      }

      current = next;
    }
  }

  writeBits(dict.get(current), codeSize);
  writeBits(eoiCode, codeSize);
  if (bitCount > 0) {
    output.push(bitBuffer & 0xFF);
  }

  return Buffer.from(output);
}

// Step 4: Build and save to public path
const gifBuffer = await buildAnimatedGif(gifFrames, targetW, targetH, delay);
const filename = 'my-animation.gif';
const { storageUrl } = await saveToWorkspace(
  \`\${ctx.projectId}/exports/\${filename}\`,
  gifBuffer,
  'image/gif'
);

// Step 5: Verify frame count
const verifyMeta = await sharp(gifBuffer, { animated: true }).metadata();
const frameCount = verifyMeta.pages || 1;

// Step 6: Return result with public download link
return {
  type: 'text',
  content: \`✅ Animated GIF created!\n\` +
    \`Frames: \${frameCount}\n\` +
    \`Size: \${(gifBuffer.length / 1024).toFixed(0)}KB\n\` +
    \`Dimensions: \${targetW}×\${targetH}\n\` +
    \`Frame delay: \${delay * 10}ms\n\` +
    \`\n⬇️ Download: \${storageUrl}\`
};
```

## Key Technical Details

### Frame-by-frame Local Color Table
Each frame gets its own 256-color palette (`imgDesc[9] = 0x87`). This is critical when mixing frames with very different color profiles (e.g. grayscale + full color + neon effects). Without per-frame LCT, later frames inherit the first frame's palette and display corrupted colors.

### LZW Compression
GIF requires LZW encoding for pixel data. The encoder:
- Starts with a clear code, then builds a dictionary of pixel sequences
- When the dictionary fills up (4096 entries at max 12-bit codes), it emits a clear code and resets
- Ends with an End-of-Information (EOI) code

### Disposal Method
`0x08` in the Graphic Control Extension = "restore to background color" between frames. This prevents ghosting artifacts when frames have different content.

### Palette Extraction
Sharp's `png({ palette: true, colours: 256 })` does the heavy lifting of color quantization. We parse the PNG's PLTE chunk to get the 256-color palette, then map raw RGB pixels to the nearest palette entry.

### Raw Pixel Mapping
After extracting the palette, we get raw RGB pixels from sharp and do nearest-color matching. This is a simple Euclidean distance in RGB space — not perceptually perfect but good enough for most photos.

## Public Download Link (IMPORTANT)

The final step **MUST** use `saveToWorkspace()` to save the GIF to a public path and return the `storageUrl` as a download link for the user. This ensures the user can directly download the GIF without any extra steps.

**Always include the download URL in the return message.** Format it clearly so the user knows they can click/long-press to save:

```javascript
return {
  type: 'text',
  content: \`✅ GIF 动图已生成！\n\` +
    \`📊 \${frameCount}帧 | \${(gifBuffer.length / 1024).toFixed(0)}KB | \${targetW}×\${targetH}\n\` +
    \`⏱️ 每帧 \${delay * 10}ms\n\` +
    \`\n⬇️ 下载链接: \${storageUrl}\n\` +
    \`(长按链接或右键另存为即可保存)\`
};
```

The `storageUrl` returned by `saveToWorkspace()` is a public Supabase Storage URL that can be accessed by anyone — no authentication needed. This is the correct way to provide downloadable files to users.

## Customization Options

| Parameter | Default | Description |
|-----------|---------|-------------|
| `targetW` | 400-600 | Output width in pixels. Larger = bigger file |
| `delay` | 80 | Frame delay in 1/100s (80=800ms, 50=500ms, 100=1s) |
| `fit` | 'cover' | Sharp resize fit mode: 'cover', 'contain', 'fill' |

## Size Optimization Tips

- **Width 400px**: Good balance of quality vs file size (~500KB-1MB for 4 frames)
- **Width 600px**: Better quality, larger files (~1-2MB for 4 frames)
- **Width 800px+**: High quality but GIF format is inefficient — consider WebP animation instead
- Fewer colors per frame = smaller file, but can cause banding
- Shorter delays with more frames = smoother animation but larger files

## Verification

After creating the GIF, always verify with sharp:
```javascript
const meta = await sharp(gifBuffer, { animated: true }).metadata();
console.log(`Frames: \${meta.pages}, Size: \${meta.width}x\${meta.height}`);
```

If `meta.pages` equals the expected frame count, the GIF is correctly structured.

## Common Pitfalls

1. **Don't use sharp's native GIF animation** — it doesn't reliably create multi-frame GIFs from separate images
2. **Always pad palette to 256 colors** — GIF expects exact 2^N color table sizes
3. **Use `raw()` for RGB pixels** (3 channels), not `rawWithAlpha()` — simpler palette mapping
4. **LZW dictionary reset** — must emit clear code when dictionary fills up, or decoder will error
5. **Frame disposal** — use `0x08` (restore to background) for frames with very different content
6. **Always save to public path** — use `saveToWorkspace()` and return the `storageUrl` so user can download directly
