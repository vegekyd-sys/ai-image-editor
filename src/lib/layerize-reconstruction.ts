import sharp from 'sharp';
import type { LayerizeLayer } from './layerize-design';

/** Pixel comparison only: no generation, semantic guesses, or extra provider fee. */
export async function inferLayerizeStack(source: Buffer, width: number, height: number,
  layers: Array<Pick<LayerizeLayer, 'z' | 'bounds'> & { bytes: Buffer }>) {
  const sorted = [...layers].sort((a, b) => a.z - b.z);
  const original = sorted.map(layer => layer.z);
  const meta = await sharp(source).metadata();
  const oriented = meta.autoOrient;
  if (!oriented.width || !oriented.height || Math.abs((oriented.width / oriented.height) / (width / height) - 1) > .02) {
    return { order: original, changed: false, reason: 'source-aspect-mismatch' as const };
  }
  const scale = Math.min(1, 256 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const target = await sharp(source).rotate().resize(w, h, { fit: 'fill' }).toColourspace('srgb').ensureAlpha().raw().toBuffer();
  const pixels = w * h;
  const frames = await Promise.all(sorted.map(async layer => {
    const [x0, y0, x1, y1] = layer.bounds;
    const left = Math.min(w - 1, Math.round(x0 / width * w)), top = Math.min(h - 1, Math.round(y0 / height * h));
    const rw = Math.max(1, Math.min(w - left, Math.round(x1 / width * w) - left));
    const rh = Math.max(1, Math.min(h - top, Math.round(y1 / height * h) - top));
    const crop = await sharp(layer.bytes).resize(rw, rh, { fit: 'fill' }).toColourspace('srgb').ensureAlpha().raw().toBuffer();
    const frame = Buffer.alloc(pixels * 4);
    for (let y = 0; y < rh; y++) crop.copy(frame, ((top + y) * w + left) * 4, y * rw * 4, (y + 1) * rw * 4);
    return frame;
  }));
  const n = sorted.length - 1, costs = Array.from({ length: n }, () => new Float64Array(n));
  const best = new Float64Array(pixels).fill(Infinity);
  const error = (frame: Buffer, p: number) => (frame[p] - target[p]) ** 2 + (frame[p + 1] - target[p + 1]) ** 2 + (frame[p + 2] - target[p + 2]) ** 2;
  for (const frame of frames.slice(1)) for (let p = 0; p < pixels; p++) {
    if (frame[p * 4 + 3] > 200) best[p] = Math.min(best[p], error(frame, p * 4));
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = frames[i + 1], b = frames[j + 1];
    for (let k = 0; k < pixels; k++) {
      const p = k * 4, aa = a[p + 3] / 255, ba = b[p + 3] / 255;
      if (aa < .35 || ba < .35 || target[p + 3] < 200) continue;
      // Pixels visibly owned by a third object should not vote on this pair.
      if (best[k] + 300 < Math.min(error(a, p), error(b, p)) * .65) continue;
      let ab = 0, be = 0;
      for (let c = 0; c < 3; c++) {
        const base = frames[0][p + c], residual = (1 - aa) * (1 - ba) * base;
        ab += (b[p + c] * ba + a[p + c] * aa * (1 - ba) + residual - target[p + c]) ** 2;
        be += (a[p + c] * aa + b[p + c] * ba * (1 - aa) + residual - target[p + c]) ** 2;
      }
      costs[i][j] += ab; costs[j][i] += be;
    }
  }
  let candidate = Array.from({ length: n }, (_, i) => i);
  if (n <= 12) {
    const size = 1 << n, dp = new Float64Array(size).fill(Infinity), last = new Int16Array(size).fill(-1);
    dp[0] = 0;
    for (let mask = 1; mask < size; mask++) for (let top = 0; top < n; top++) {
      if (!(mask & (1 << top))) continue;
      const rest = mask ^ (1 << top); let cost = dp[rest];
      for (let under = 0; under < n; under++) if (rest & (1 << under)) cost += costs[under][top];
      // Prefer the provider order on ties (larger source index on top).
      if (cost <= dp[mask]) { dp[mask] = cost; last[mask] = top; }
    }
    candidate = [];
    for (let mask = size - 1; mask;) { const top = last[mask]; candidate.unshift(top); mask ^= 1 << top; }
  } else {
    // Bound work for up to 100 outputs: insertion descent from provider order.
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (let from = 0; from < n; from++) {
        const layer = candidate[from]; let delta = 0, bestDelta = 0, to = from;
        for (let j = from - 1; j >= 0; j--) { const other = candidate[j]; delta += costs[layer][other] - costs[other][layer]; if (delta < bestDelta) { bestDelta = delta; to = j; } }
        delta = 0;
        for (let j = from + 1; j < n; j++) { const other = candidate[j]; delta += costs[other][layer] - costs[layer][other]; if (delta < bestDelta) { bestDelta = delta; to = j; } }
        if (to !== from) { candidate.splice(from, 1); candidate.splice(to, 0, layer); changed = true; }
      }
      if (!changed) break;
    }
  }
  const score = (order: number[]) => {
    const composed = Float32Array.from(frames[0]);
    for (const index of order) {
      const frame = frames[index + 1];
      for (let p = 0; p < pixels * 4; p += 4) {
        const alpha = frame[p + 3] / 255;
        for (let c = 0; c < 3; c++) composed[p + c] = frame[p + c] * alpha + composed[p + c] * (1 - alpha);
      }
    }
    let sum = 0, count = 0;
    for (let p = 0; p < pixels * 4; p += 4) if (target[p + 3] > 200) {
      for (let c = 0; c < 3; c++) sum += (composed[p + c] - target[p + c]) ** 2;
      count += 3;
    }
    return count ? sum / count : 0;
  };
  const before = score(Array.from({ length: n }, (_, i) => i)), after = score(candidate);
  // A changed stack must measurably improve the complete composition, not just pairs.
  const changed = after < before * .99 && before - after > 1;
  return { order: changed ? [0, ...candidate.map(i => sorted[i + 1].z)] : original,
    changed, scoreBefore: before, scoreAfter: changed ? after : before };
}
