import sharp from 'sharp';
import type { PixelRect, VisualAssetQuality } from './contracts';

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface ChromaKeyOptions {
  keyColor?: string;
  tolerance?: number;
  softness?: number;
  despillStrength?: number;
  interiorKeyMinArea?: number;
  edgeDecorationMaxArea?: number;
  softEdgeRadius?: number;
  despillRadius?: number;
  despillMinExcess?: number;
}

export interface ChromaKeyResult {
  png: Buffer;
  width: number;
  height: number;
  keyColor: string;
  subjectBox?: PixelRect;
  safeArea?: PixelRect;
  quality: VisualAssetQuality;
}

export const CUTOUT_QA_BACKGROUNDS = [
  { name: 'black', color: '#000000' },
  { name: 'white', color: '#ffffff' },
  { name: 'gray', color: '#777777' },
  { name: 'brand', color: '#2b1248' },
  { name: 'contrast', color: '#00b8d9' },
] as const;

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function parseHexColor(value: string): RgbColor {
  const normalized = value.trim().replace(/^#/, '');
  const expanded = normalized.length === 3
    ? normalized.split('').map(char => `${char}${char}`).join('')
    : normalized;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) throw new Error(`Invalid color: ${value}`);
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

export function colorToHex(color: RgbColor): string {
  return `#${[color.r, color.g, color.b].map(channel => clampByte(channel).toString(16).padStart(2, '0')).join('')}`;
}

export function colorDistance(a: RgbColor, b: RgbColor): number {
  return Math.sqrt(((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2) / 3);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

function estimateBorderColor(data: Buffer, width: number, height: number, channels: number): RgbColor {
  const band = Math.max(2, Math.round(Math.min(width, height) * 0.025));
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  const stride = Math.max(1, Math.floor(Math.min(width, height) / 256));

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      if (x >= band && x < width - band && y >= band && y < height - band) continue;
      const offset = (y * width + x) * channels;
      if (channels >= 4 && data[offset + 3] === 0) continue;
      r.push(data[offset]);
      g.push(data[offset + 1]);
      b.push(data[offset + 2]);
    }
  }

  if (r.length === 0) throw new Error('Cannot estimate chroma key color from an empty border');
  return { r: median(r), g: median(g), b: median(b) };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

interface KeyBackgroundMaskResult {
  mask: Uint8Array;
  enclosedRegionCount: number;
  enclosedPixelCount: number;
}

function keyBackgroundMask(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  key: RgbColor,
  innerDistance: number,
  outerDistance: number,
  interiorKeyMinArea: number,
  softEdgeRadius: number,
): KeyBackgroundMaskResult {
  const count = width * height;
  const candidates = new Uint8Array(count);
  const strongCandidates = new Uint8Array(count);
  const strongBackground = new Uint8Array(count);
  const visited = new Uint8Array(count);
  const queue = new Int32Array(count);
  const component = new Int32Array(count);
  let head = 0;
  let tail = 0;
  let enclosedRegionCount = 0;
  let enclosedPixelCount = 0;

  for (let index = 0; index < count; index++) {
    const offset = index * channels;
    const alpha = channels >= 4 ? data[offset + 3] : 255;
    if (alpha === 0) continue;
    const distance = colorDistance({ r: data[offset], g: data[offset + 1], b: data[offset + 2] }, key);
    if (distance <= outerDistance) candidates[index] = 1;
    if (distance <= innerDistance) strongCandidates[index] = 1;
  }

  const enqueueStrong = (index: number) => {
    if (!strongCandidates[index] || strongBackground[index]) return;
    strongBackground[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x++) {
    enqueueStrong(x);
    enqueueStrong((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueueStrong(y * width);
    enqueueStrong(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueueStrong(index - 1);
    if (x + 1 < width) enqueueStrong(index + 1);
    if (y > 0) enqueueStrong(index - width);
    if (y + 1 < height) enqueueStrong(index + width);
  }

  // Foreground effects can form a closed loop around otherwise ordinary
  // chroma background. Remove sizeable high-confidence pockets as well as the
  // border-connected background. A separately bounded pass grows only a few
  // pixels into their antialiased halo, so cyan, yellow, or pale effects cannot
  // become a long bridge that recolors the foreground.
  for (let start = 0; start < count; start++) {
    if (!strongCandidates[start] || strongBackground[start] || visited[start]) continue;
    head = 0;
    tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    let componentSize = 0;

    while (head < tail) {
      const index = queue[head++];
      component[componentSize++] = index;
      const x = index % width;
      const y = Math.floor(index / width);
      const inspect = (neighbor: number) => {
        if (!strongCandidates[neighbor] || strongBackground[neighbor] || visited[neighbor]) return;
        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      };
      if (x > 0) inspect(index - 1);
      if (x + 1 < width) inspect(index + 1);
      if (y > 0) inspect(index - width);
      if (y + 1 < height) inspect(index + width);
    }

    if (componentSize < interiorKeyMinArea) continue;
    enclosedRegionCount++;
    enclosedPixelCount += componentSize;
    for (let index = 0; index < componentSize; index++) {
      strongBackground[component[index]] = 1;
    }
  }

  const background = new Uint8Array(strongBackground);
  const depth = new Uint8Array(count);
  head = 0;
  tail = 0;
  for (let index = 0; index < count; index++) {
    if (strongBackground[index]) queue[tail++] = index;
  }
  while (head < tail) {
    const index = queue[head++];
    const nextDepth = depth[index] + 1;
    if (nextDepth > softEdgeRadius) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    const grow = (neighbor: number) => {
      if (!candidates[neighbor] || background[neighbor]) return;
      background[neighbor] = 1;
      depth[neighbor] = nextDepth;
      queue[tail++] = neighbor;
    };
    if (x > 0) grow(index - 1);
    if (x + 1 < width) grow(index + 1);
    if (y > 0) grow(index - width);
    if (y + 1 < height) grow(index + width);
  }

  return { mask: background, enclosedRegionCount, enclosedPixelCount };
}

function calculateSubjectBox(data: Buffer, width: number, height: number): PixelRect | undefined {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= 12) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return undefined;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function expandRect(rect: PixelRect, width: number, height: number): PixelRect {
  const padding = Math.max(4, Math.round(Math.max(rect.width, rect.height) * 0.04));
  const x = Math.max(0, rect.x - padding);
  const y = Math.max(0, rect.y - padding);
  return {
    x,
    y,
    width: Math.min(width - x, rect.width + padding * 2),
    height: Math.min(height - y, rect.height + padding * 2),
  };
}

interface EdgeDecorationCleanupResult {
  regionCount: number;
  pixelCount: number;
}

function removeTinyEdgeDecorations(
  rgba: Buffer,
  width: number,
  height: number,
  edgeBand: number,
  maximumArea: number,
): EdgeDecorationCleanupResult {
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const component = new Int32Array(pixelCount);
  const removable: Array<{ pixels: number[]; area: number }> = [];
  let largestArea = 0;

  for (let start = 0; start < pixelCount; start++) {
    if (visited[start] || rgba[start * 4 + 3] <= 12) continue;
    let head = 0;
    let tail = 0;
    let componentSize = 0;
    let touchesEdgeBand = false;
    queue[tail++] = start;
    visited[start] = 1;

    while (head < tail) {
      const index = queue[head++];
      component[componentSize++] = index;
      const x = index % width;
      const y = Math.floor(index / width);
      if (x < edgeBand || y < edgeBand || x >= width - edgeBand || y >= height - edgeBand) {
        touchesEdgeBand = true;
      }
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbor = ny * width + nx;
          if (visited[neighbor] || rgba[neighbor * 4 + 3] <= 12) continue;
          visited[neighbor] = 1;
          queue[tail++] = neighbor;
        }
      }
    }

    largestArea = Math.max(largestArea, componentSize);
    if (touchesEdgeBand && componentSize <= maximumArea) {
      removable.push({ pixels: Array.from(component.subarray(0, componentSize)), area: componentSize });
    }
  }

  let regionCount = 0;
  let removedPixels = 0;
  for (const candidate of removable) {
    if (candidate.area === largestArea) continue;
    regionCount++;
    removedPixels += candidate.area;
    for (const index of candidate.pixels) rgba.fill(0, index * 4, index * 4 + 4);
  }
  return { regionCount, pixelCount: removedPixels };
}

function despillPixel(color: RgbColor, key: RgbColor, amount: number): RgbColor {
  const keyChannels = [key.r, key.g, key.b];
  const dominant = keyChannels.indexOf(Math.max(...keyChannels));
  const channels = [color.r, color.g, color.b];
  const otherMax = Math.max(...channels.filter((_, index) => index !== dominant));
  const excess = Math.max(0, channels[dominant] - otherMax);
  channels[dominant] -= excess * amount;
  return { r: channels[0], g: channels[1], b: channels[2] };
}

function keyChannelExcess(color: RgbColor, key: RgbColor): number {
  const keyChannels = [key.r, key.g, key.b];
  const dominant = keyChannels.indexOf(Math.max(...keyChannels));
  const channels = [color.r, color.g, color.b];
  return Math.max(0, channels[dominant] - Math.max(...channels.filter((_, index) => index !== dominant)));
}

function distanceFromMask(
  mask: Uint8Array,
  width: number,
  height: number,
  maximumDistance: number,
): Uint8Array {
  const count = width * height;
  const unset = 255;
  const distances = new Uint8Array(count);
  distances.fill(unset);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;

  for (let index = 0; index < count; index++) {
    if (!mask[index]) continue;
    distances[index] = 0;
    queue[tail++] = index;
  }

  while (head < tail) {
    const index = queue[head++];
    const nextDistance = distances[index] + 1;
    if (nextDistance > maximumDistance) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (distances[neighbor] !== unset) continue;
        distances[neighbor] = nextDistance;
        queue[tail++] = neighbor;
      }
    }
  }

  return distances;
}

export async function prepareChromaKeyCutout(
  input: Buffer,
  options: ChromaKeyOptions = {},
): Promise<ChromaKeyResult> {
  const source = sharp(input, { failOn: 'error' }).ensureAlpha();
  const { data, info } = await source.raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const channels = info.channels;
  if (width < 8 || height < 8 || channels < 4) throw new Error('Cutout source must be a valid image');

  const key = options.keyColor ? parseHexColor(options.keyColor) : estimateBorderColor(data, width, height, channels);
  const tolerance = Math.max(4, Math.min(100, options.tolerance ?? 28));
  const softness = Math.max(8, Math.min(140, options.softness ?? 92));
  const despillStrength = Math.max(0, Math.min(1, options.despillStrength ?? 0.9));
  const outerDistance = tolerance + softness;
  const interiorKeyMinArea = Math.max(
    1,
    Math.round(options.interiorKeyMinArea ?? Math.max(24, Math.min(width, height) * 0.015)),
  );
  const edgeDecorationMaxArea = Math.max(
    1,
    Math.round(options.edgeDecorationMaxArea ?? Math.max(24, width * height * 0.0005)),
  );
  const softEdgeRadius = Math.max(
    1,
    Math.min(6, Math.round(options.softEdgeRadius ?? Math.max(2, Math.min(width, height) * 0.0035))),
  );
  const despillRadius = Math.max(
    softEdgeRadius,
    Math.min(32, Math.round(options.despillRadius ?? Math.max(8, Math.min(width, height) * 0.03))),
  );
  const despillMinExcess = Math.max(2, Math.min(64, Math.round(options.despillMinExcess ?? 8)));
  const keyMask = keyBackgroundMask(
    data,
    width,
    height,
    channels,
    key,
    tolerance,
    outerDistance,
    interiorKeyMinArea,
    softEdgeRadius,
  );
  const backgroundMask = keyMask.mask;
  const spillDistances = distanceFromMask(backgroundMask, width, height, despillRadius);
  const output = Buffer.alloc(width * height * 4);
  const colorAdjustmentMask = new Uint8Array(width * height);
  let despilledForegroundPixels = 0;
  let foregroundDespillDelta = 0;

  for (let index = 0; index < width * height; index++) {
    const sourceOffset = index * channels;
    const outputOffset = index * 4;
    const originalAlpha = data[sourceOffset + 3] / 255;
    let r = data[sourceOffset];
    let g = data[sourceOffset + 1];
    let b = data[sourceOffset + 2];
    let matte = 1;

    if (backgroundMask[index]) {
      const distance = colorDistance({ r, g, b }, key);
      matte = smoothstep(tolerance, outerDistance, distance);
      if (matte > 0.015 && matte < 0.995) {
        const before = { r, g, b };
        const despilled = despillPixel({ r, g, b }, key, despillStrength * (1 - matte * 0.35));
        r = despilled.r;
        g = despilled.g;
        b = despilled.b;
        if (colorDistance(before, despilled) > 0.5) colorAdjustmentMask[index] = 1;
      }
    } else {
      const spillDistance = spillDistances[index];
      const color = { r, g, b };
      const excess = keyChannelExcess(color, key);
      if (spillDistance > 0 && spillDistance <= despillRadius && excess >= despillMinExcess) {
        const proximity = (despillRadius + 1 - spillDistance) / despillRadius;
        const edgeFalloff = Math.min(1, proximity * 4);
        const despilled = despillPixel(color, key, despillStrength * edgeFalloff);
        const delta = colorDistance(color, despilled);
        if (delta > 0.5) {
          r = despilled.r;
          g = despilled.g;
          b = despilled.b;
          colorAdjustmentMask[index] = 1;
          despilledForegroundPixels++;
          foregroundDespillDelta += delta;
        }
      }
    }

    const alpha = originalAlpha * matte;
    if (alpha <= 0.025) {
      output[outputOffset] = 0;
      output[outputOffset + 1] = 0;
      output[outputOffset + 2] = 0;
      output[outputOffset + 3] = 0;
      continue;
    }

    const color = { r: clampByte(r), g: clampByte(g), b: clampByte(b) };
    output[outputOffset] = color.r;
    output[outputOffset + 1] = color.g;
    output[outputOffset + 2] = color.b;
    output[outputOffset + 3] = clampByte(alpha * 255);
  }

  const minimumMargin = Math.max(3, Math.round(Math.min(width, height) * 0.008));
  const edgeCleanup = removeTinyEdgeDecorations(
    output,
    width,
    height,
    minimumMargin,
    edgeDecorationMaxArea,
  );
  let transparentPixels = 0;
  let visiblePixels = 0;
  let edgePixels = 0;
  let spillPixels = 0;
  let opaquePixels = 0;
  let residualChromaPixels = 0;
  let colorStableOpaquePixels = 0;
  let opaqueColorDelta = 0;
  let opaqueColorChangedPixels = 0;
  let coreOpaquePixels = 0;
  let coreOpaqueColorDelta = 0;
  let coreOpaqueColorChangedPixels = 0;
  let partialColorDelta = 0;
  const dominantKey = Math.max(key.r, key.g, key.b);
  const normalizedKey = dominantKey > 0
    ? { r: key.r / dominantKey * 255, g: key.g / dominantKey * 255, b: key.b / dominantKey * 255 }
    : key;
  for (let index = 0; index < width * height; index++) {
    const offset = index * 4;
    const alpha = output[offset + 3] / 255;
    if (alpha <= 0.025) {
      transparentPixels++;
      continue;
    }
    visiblePixels++;
    const color = { r: output[offset], g: output[offset + 1], b: output[offset + 2] };
    const sourceOffset = index * channels;
    const sourceColor = { r: data[sourceOffset], g: data[sourceOffset + 1], b: data[sourceOffset + 2] };
    if (alpha >= 0.5) {
      opaquePixels++;
      if (colorDistance(color, key) <= tolerance) residualChromaPixels++;
    }
    if (alpha >= 0.98) {
      colorStableOpaquePixels++;
      const delta = colorDistance(color, sourceColor);
      opaqueColorDelta += delta;
      if (delta > 3) opaqueColorChangedPixels++;
      if (!colorAdjustmentMask[index]) {
        coreOpaquePixels++;
        coreOpaqueColorDelta += delta;
        if (delta > 3) coreOpaqueColorChangedPixels++;
      }
    }
    if (alpha >= 0.08 && alpha < 0.98) {
      edgePixels++;
      partialColorDelta += colorDistance(color, sourceColor);
      if (colorDistance(color, normalizedKey) < 58) spillPixels++;
    }
  }

  const sourceSubjectBox = calculateSubjectBox(output, width, height);
  const sourceSafeArea = sourceSubjectBox ? expandRect(sourceSubjectBox, width, height) : undefined;
  const pixelCount = width * height;
  const transparentRatio = transparentPixels / pixelCount;
  const subjectCoverage = visiblePixels / pixelCount;
  const spillRatio = edgePixels > 0 ? spillPixels / edgePixels : 0;
  const residualChromaRatio = opaquePixels > 0 ? residualChromaPixels / opaquePixels : 0;
  const meanOpaqueColorDelta = colorStableOpaquePixels > 0 ? opaqueColorDelta / colorStableOpaquePixels : 0;
  const opaqueColorChangedRatio = colorStableOpaquePixels > 0 ? opaqueColorChangedPixels / colorStableOpaquePixels : 0;
  const meanCoreOpaqueColorDelta = coreOpaquePixels > 0 ? coreOpaqueColorDelta / coreOpaquePixels : 0;
  const coreOpaqueColorChangedRatio = coreOpaquePixels > 0 ? coreOpaqueColorChangedPixels / coreOpaquePixels : 0;
  const meanPartialColorDelta = edgePixels > 0 ? partialColorDelta / edgePixels : 0;
  const despilledForegroundRatio = visiblePixels > 0 ? despilledForegroundPixels / visiblePixels : 0;
  const meanForegroundDespillDelta = despilledForegroundPixels > 0
    ? foregroundDespillDelta / despilledForegroundPixels
    : 0;
  const touchesEdge = Boolean(sourceSubjectBox && (
    sourceSubjectBox.x < minimumMargin
    || sourceSubjectBox.y < minimumMargin
    || width - (sourceSubjectBox.x + sourceSubjectBox.width) < minimumMargin
    || height - (sourceSubjectBox.y + sourceSubjectBox.height) < minimumMargin
  ));
  const issues: string[] = [];
  if (!sourceSubjectBox || subjectCoverage < 0.003) issues.push('No usable foreground subject remains after keying.');
  if (transparentRatio < 0.08) issues.push('Too little background became transparent; check the key color or regenerate a cleaner chroma background.');
  if (touchesEdge) issues.push('The foreground subject touches the canvas edge and may be clipped in composition.');
  if (spillRatio > 0.03) issues.push('Visible semi-transparent edges still contain too much chroma spill.');
  if (residualChromaRatio > 0.001) issues.push('Opaque chroma-colored pixels remain inside the prepared cutout.');
  if (coreOpaqueColorChangedRatio > 0.001 || meanCoreOpaqueColorDelta > 0.5) {
    issues.push('Opaque foreground colors changed too much during chroma preparation.');
  }

  const crop = sourceSafeArea || { x: 0, y: 0, width, height };
  const preparedRaw = sourceSafeArea
    ? await sharp(output, { raw: { width, height, channels: 4 } }).extract({
      left: crop.x,
      top: crop.y,
      width: crop.width,
      height: crop.height,
    }).raw().toBuffer()
    : output;
  const preparedWidth = crop.width;
  const preparedHeight = crop.height;
  const subjectBox = calculateSubjectBox(preparedRaw, preparedWidth, preparedHeight);
  const safeArea = subjectBox ? expandRect(subjectBox, preparedWidth, preparedHeight) : undefined;
  const png = await sharp(preparedRaw, {
    raw: { width: preparedWidth, height: preparedHeight, channels: 4 },
  }).png().toBuffer();

  return {
    png,
    width: preparedWidth,
    height: preparedHeight,
    keyColor: colorToHex(key),
    subjectBox,
    safeArea,
    quality: {
      status: issues.length === 0 ? 'pass' : sourceSubjectBox ? 'revise' : 'fail',
      issues,
      metrics: {
        transparentRatio,
        subjectCoverage,
        spillRatio,
        residualChromaRatio,
        enclosedKeyRegionCount: keyMask.enclosedRegionCount,
        enclosedKeyPixelRatio: keyMask.enclosedPixelCount / pixelCount,
        removedEdgeDecorationRegionCount: edgeCleanup.regionCount,
        removedEdgeDecorationPixelRatio: edgeCleanup.pixelCount / pixelCount,
        softEdgeRadius,
        despillRadius,
        despilledForegroundRatio,
        meanForegroundDespillDelta,
        meanOpaqueColorDelta,
        opaqueColorChangedRatio,
        meanCoreOpaqueColorDelta,
        coreOpaqueColorChangedRatio,
        meanPartialColorDelta,
        subjectTouchesEdge: touchesEdge ? 1 : 0,
      },
    },
  };
}

function labelSvg(width: number, label: string): Buffer {
  const safe = label.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char] || char));
  return Buffer.from(`<svg width="${width}" height="34" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#111318" fill-opacity="0.92"/>
    <text x="16" y="23" fill="#ffffff" font-size="15" font-family="Arial, sans-serif">${safe}</text>
  </svg>`);
}

export async function renderCutoutContactSheet(
  png: Buffer,
  backgrounds: ReadonlyArray<{ name: string; color: string }> = CUTOUT_QA_BACKGROUNDS,
): Promise<Buffer> {
  const tileWidth = 320;
  const tileHeight = 320;
  const labelHeight = 34;
  const columns = 3;
  const rows = Math.ceil(backgrounds.length / columns);
  const metadata = await sharp(png).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Cannot render QA sheet for an invalid cutout');
  const availableWidth = tileWidth - 32;
  const availableHeight = tileHeight - labelHeight - 24;
  const scale = Math.min(availableWidth / metadata.width, availableHeight / metadata.height, 1);
  const subjectWidth = Math.max(1, Math.round(metadata.width * scale));
  const subjectHeight = Math.max(1, Math.round(metadata.height * scale));
  const subject = await sharp(png)
    .resize(subjectWidth, subjectHeight, { fit: 'fill' })
    .png()
    .toBuffer();
  const subjectLeft = Math.round((tileWidth - subjectWidth) / 2);
  const subjectTop = Math.round((tileHeight - labelHeight - subjectHeight) / 2);

  const tiles = await Promise.all(backgrounds.map(async background => sharp({
    create: {
      width: tileWidth,
      height: tileHeight,
      channels: 4,
      background: background.color,
    },
  }).composite([
    { input: subject, left: subjectLeft, top: subjectTop },
    { input: labelSvg(tileWidth, `${background.name}  ${background.color}`), left: 0, top: tileHeight - labelHeight },
  ]).png().toBuffer()));

  return sharp({
    create: {
      width: tileWidth * columns,
      height: tileHeight * rows,
      channels: 4,
      background: '#17191f',
    },
  }).composite(tiles.map((input, index) => ({
    input,
    left: index % columns * tileWidth,
    top: Math.floor(index / columns) * tileHeight,
  }))).png().toBuffer();
}
