import sharp from 'sharp';
import type { LayerizeLayer } from './layerize-design';

type Raster = Pick<LayerizeLayer, 'z' | 'bounds' | 'width' | 'height'> & { bytes: Buffer; canCast: boolean };

// Dark translucent pixels extending past the antialiasing fringe indicate an existing
// shadow. Preserve that PNG instead of adding a second, guessed shadow from reflections.
function hasNativeShadow(data: Buffer, width: number, height: number) {
  const required = Math.max(12, Math.ceil(width * height * .0008));
  let count = 0;
  for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
    const p = (y * width + x) * 4;
    const [r, g, b, a] = [data[p], data[p + 1], data[p + 2], data[p + 3]];
    if (a < 12 || a > 177 || r + g + b >= 240 || Math.max(r, g, b) - Math.min(r, g, b) >= 30) continue;
    let touchesCore = false;
    for (let dy = -2; dy <= 2 && !touchesCore; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (data[p + 4 * (dy * width + dx) + 3] > 210) { touchesCore = true; break; }
    }
    if (!touchesCore && ++count >= required) return true;
  }
  return false;
}

/** Transfer missing soft darkening from the source onto the adjacent movable cutout.
 * Only the exposed background votes. Foreground details and reconstructed hidden surfaces
 * have no reliable source evidence and must retain the provider pixels. */
export async function recoverLayerizeShadows(source: Buffer, width: number, height: number, stack: Raster[]) {
  const repaired = new Map<number, Buffer>();
  const scale = Math.min(1, 512 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const n = w * h;
  const sample = (bytes: Buffer, sw: number, sh: number) => sharp(bytes).rotate()
    .resize(sw, sh, { fit: 'fill' }).toColourspace('srgb').ensureAlpha().raw().toBuffer();
  const [original, plate] = await Promise.all([sample(source, w, h), sample(stack[0].bytes, w, h)]);
  const occupied = new Uint8Array(n), owner = new Uint8Array(n);
  const boxes = stack.map(({ bounds: [x0, y0, x1, y1] }) => {
    const left = Math.min(w - 1, Math.round(x0 * w / width)), top = Math.min(h - 1, Math.round(y0 * h / height));
    return { left, top, right: Math.max(left + 1, Math.round(x1 * w / width)), bottom: Math.max(top + 1, Math.round(y1 * h / height)) };
  });
  for (let i = 1; i < stack.length; i++) {
    const b = boxes[i], rw = b.right - b.left;
    const data = await sample(stack[i].bytes, rw, b.bottom - b.top);
    const canCast = stack[i].canCast && !hasNativeShadow(data, rw, b.bottom - b.top);
    for (let y = b.top; y < b.bottom; y++) for (let x = b.left; x < b.right; x++) {
      const a = data[((y - b.top) * rw + x - b.left) * 4 + 3], p = y * w + x;
      if (a > 12) {
        occupied[p] = 1;
        owner[p] = canCast ? i : 0;
      }
    }
  }

  const darkness = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const p = k * 4;
    if (occupied[k] || original[p + 3] < 250 || plate[p + 3] < 250) continue;
    const sum = plate[p] + plate[p + 1] + plate[p + 2];
    const loss = sum - original[p] - original[p + 1] - original[p + 2];
    const alpha = loss / Math.max(1, sum);
    if (loss < 13 || alpha < .11 || alpha > .85) continue;
    // A black translucent veil must explain all channels. This rejects most colored outlines.
    let mismatch = 0;
    for (let c = 0; c < 3; c++) mismatch = Math.max(mismatch, Math.abs(original[p + c] - plate[p + c] * (1 - alpha)));
    if (mismatch <= 3 + loss * .026) darkness[k] = Math.round(255 * alpha * Math.min(1, (alpha - .11) / .13));
  }

  // Multi-source flood starts at visible opaque edges. Detached dark marks are never copied.
  const queue = new Int32Array(n), depth = new Uint8Array(n);
  let head = 0, tail = 0;
  for (let p = 0; p < n; p++) if (owner[p]) queue[tail++] = p;
  const reach = boxes.map(b => Math.min(100, Math.ceil(Math.max(b.right - b.left, b.bottom - b.top) * .24)));
  const masks = new Map<number, Buffer>();
  while (head < tail) {
    const p = queue[head++], i = owner[p], b = boxes[i], d = depth[p], x = p % w, y = Math.floor(p / w);
    if (d >= reach[i]) continue;
    for (const next of [x > b.left ? p - 1 : -1, x + 1 < b.right ? p + 1 : -1,
      y > b.top ? p - w : -1, y + 1 < b.bottom ? p + w : -1]) {
      if (next < 0 || owner[next] || !darkness[next]) continue;
      owner[next] = i; depth[next] = d + 1; queue[tail++] = next;
      let mask = masks.get(i);
      if (!mask) { mask = Buffer.alloc((b.right - b.left) * (b.bottom - b.top)); masks.set(i, mask); }
      mask[(Math.floor(next / w) - b.top) * (b.right - b.left) + next % w - b.left] = Math.round(darkness[next] * Math.min(1, (reach[i] - d) / Math.max(3, reach[i] * .25)));
    }
  }
  for (const [i, mask] of masks) {
    const b = boxes[i], layer = stack[i];
    // A median filter discards isolated pixels/edge noise before enlarging the shadow matte.
    const shortest = Math.min(b.right - b.left, b.bottom - b.top);
    if (shortest < 5) continue;
    const kernel = shortest >= 96 ? 9 : 5;
    const alpha = await sharp(mask, { raw: { width: b.right - b.left, height: b.bottom - b.top, channels: 1 } })
      .median(kernel).blur(.9).greyscale().raw().toBuffer();
    let dense = 0;
    for (const a of alpha) if (a >= 50) dense++;
    if (dense < Math.max(20, alpha.length * .002)) continue;
    const black = Buffer.alloc(alpha.length * 4);
    for (let p = 0; p < alpha.length; p++) black[p * 4 + 3] = alpha[p];
    const shadow = await sharp(black, { raw: { width: b.right - b.left, height: b.bottom - b.top, channels: 4 } })
      .resize(layer.width, layer.height, { fit: 'fill' }).png().toBuffer();
    repaired.set(layer.z, await sharp(layer.bytes).composite([{ input: shadow, blend: 'dest-over' }]).png().toBuffer());
  }
  return repaired;
}
