import sharp from 'sharp';
import { create, type Font } from 'fontkit';
import { resolveRemotionFontManifestForDesign } from './remotion-font-resolver';
import type { RemotionFontCatalogFace } from '@/remotion/font-catalog';

export interface LayerizeTextFit {
  family: string;
  weight: number;
  fontSize: number;
  matrix: [number, number, number, number, number, number];
  score: number;
  color: string;
}
const fontCache = new Map<string, Promise<Font>>();
const FALLBACK_FAMILIES = ['Montserrat', 'Inter', 'Roboto', 'Lato', 'Poppins'];
const substitute: Record<string, string> = { calibri: 'Carlito', arial: 'Arimo', 'arial narrow': 'Roboto Condensed' };
export function layerizeFontCandidates(hint: string): string[] {
  const family = substitute[hint.toLowerCase()] || hint;
  return [...new Set([family, ...FALLBACK_FAMILIES])];
}
async function fontFor(face: RemotionFontCatalogFace): Promise<Font> {
  let pending = fontCache.get(face.sha256);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(face.url, { signal: AbortSignal.timeout(6_000) });
      if (!response.ok) throw new Error('Text matching font could not be loaded');
      return create(Buffer.from(await response.arrayBuffer())) as Font;
    })();
    fontCache.set(face.sha256, pending);
    if (fontCache.size > 40) fontCache.delete(fontCache.keys().next().value!);
  }
  try { return await pending; } catch (error) { fontCache.delete(face.sha256); throw error; }
}
export async function layerizeMatchingFaces(hints: string[]): Promise<RemotionFontCatalogFace[]> {
  const families = [...new Set(hints.flatMap(layerizeFontCandidates))];
  const known = families.filter(f => /^[\w -]{1,80}$/.test(f));
  const resolved = await resolveRemotionFontManifestForDesign({ code: known.map(f => `const f = {fontFamily:${JSON.stringify(f)}};`).join('\n') });
  const manifest = resolved.manifest || await (await fetch(resolved.manifestUrl, { signal: AbortSignal.timeout(15_000) })).json();
  return (manifest.faces as RemotionFontCatalogFace[]).filter(f => known.includes(f.family) && f.subset === 'latin' && f.style === 'normal' && [400, 500, 600, 700, 800, 900].includes(f.weight));
}
function inkBounds(data: Uint8Array, width: number, height: number) {
  let left = width, top = height, right = 0, bottom = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[y * width + x] > 32) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
  }
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}
export function textInkAngle(data: Uint8Array, width: number, height: number): number {
  let n = 0, x = 0, y = 0, xx = 0, yy = 0, xy = 0;
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const a = data[j * width + i] / 255; if (a < .1) continue;
    n += a; x += a * i; y += a * j; xx += a * i * i; yy += a * j * j; xy += a * i * j;
  }
  if (!n) return 0;
  const angle = Math.atan2(2 * (xy / n - x * y / n / n), xx / n - x * x / n / n - yy / n + y * y / n / n) / 2 * 180 / Math.PI;
  return Math.abs(angle) < 5 ? 0 : Math.max(-65, Math.min(65, angle));
}
function glyphPaths(font: Font, text: string) {
  const run = font.layout(text); let pen = 0;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const paths = run.glyphs.map((g, i) => {
    const p = run.positions[i], x = pen + p.xOffset, y = -p.yOffset, b = g.bbox;
    left = Math.min(left, x + b.minX); top = Math.min(top, y - b.maxY);
    right = Math.max(right, x + b.maxX); bottom = Math.max(bottom, y - b.minY);
    pen += p.xAdvance;
    return `<path transform="translate(${x},${y}) scale(1,-1)" d="${g.path.toSVG()}"/>`;
  }).join('');
  return { paths, left, top, width: right - left, height: bottom - top };
}
function silhouetteScore(target: Uint8Array, candidate: Uint8Array): number {
  if (target.length !== candidate.length) throw new Error('Text matching masks have different dimensions');
  let intersection = 0, union = 0;
  for (let i = 0; i < target.length; i++) { intersection += Math.min(target[i], candidate[i]); union += Math.max(target[i], candidate[i]); }
  return union ? intersection / union : 0;
}
/** Fit actual isolated glyph pixels, rather than trusting OCR's approximate size/italic flags. */
export async function fitLayerizeText(bytes: Buffer, text: string, hint: string, color: string, faces: RemotionFontCatalogFace[]): Promise<LayerizeTextFit | null> {
  if (!text.trim() || text.length > 300 || !/^[\p{Script=Latin}\p{N}\p{P}\p{Z}\p{S}]+$/u.test(text)) return null;
  const { data, info } = await sharp(bytes).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true });
  const initialAngle = textInkAngle(data, info.width, info.height);
  const angles = initialAngle === 0 ? [0] : [-3, -1.5, 0, 1.5, 3].map(d => initialAngle + d);
  const families = layerizeFontCandidates(hint);
  const candidates = faces.filter(f => families.includes(f.family));
  const fonts = await Promise.all(candidates.map(async face => {
    try { const base = await fontFor(face); return { face, font: base.variationAxes?.wght ? base.getVariation({ wght: face.weight }) : base }; } catch { return null; }
  }));
  let best: (LayerizeTextFit & { ranking: number }) | null = null;
  for (const angle of angles) {
    const rotated = await sharp(bytes).rotate(-angle, { background: '#00000000' }).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true });
    const box = inkBounds(rotated.data, rotated.info.width, rotated.info.height); if (!box) continue;
    const sampleHeight = 72, sampleWidth = Math.max(1, Math.min(1000, Math.round(box.width / box.height * sampleHeight)));
    const target = await sharp(rotated.data, { raw: { width: rotated.info.width, height: rotated.info.height, channels: 1 } }).extract(box).resize(sampleWidth, sampleHeight).greyscale().raw().toBuffer();
    for (const loaded of fonts) {
      if (!loaded) continue;
      const { face, font } = loaded;
      if (Array.from(text).some(c => !font.hasGlyphForCodePoint(c.codePointAt(0)!))) continue;
      const glyph = glyphPaths(font, text); if (!glyph.width || !glyph.height) continue;
      for (const shear of [0, -.2126]) {
        const xs = [glyph.left + shear * glyph.top, glyph.left + glyph.width + shear * glyph.top, glyph.left + shear * (glyph.top + glyph.height), glyph.left + glyph.width + shear * (glyph.top + glyph.height)];
        const left = Math.min(...xs), width = Math.max(...xs) - left;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sampleWidth}" height="${sampleHeight}" viewBox="${left} ${glyph.top} ${width} ${glyph.height}" preserveAspectRatio="none"><g fill="white" transform="matrix(1,0,${shear},1,0,0)">${glyph.paths}</g></svg>`;
        const candidate = await sharp(Buffer.from(svg)).ensureAlpha().extractChannel('alpha').raw().toBuffer();
        const score = silhouetteScore(target, candidate);
        const stretch = box.width / box.height / (width / glyph.height);
        const ranking = score - .025 * Math.abs(Math.log(stretch));
        if (best && ranking <= best.ranking) continue;
        const sx = box.width / width, sy = box.height / glyph.height, radians = angle * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
        const tx = box.left - rotated.info.width / 2 - left * sx;
        const ty = box.top - rotated.info.height / 2 - glyph.top * sy;
        best = { family: face.family, weight: face.weight, fontSize: font.unitsPerEm, color, score, ranking,
          matrix: [c * sx, s * sx, c * shear * sx - s * sy, s * shear * sx + c * sy, c * tx - s * ty + info.width / 2, s * tx + c * ty + info.height / 2].map(v => Number(v.toFixed(6))) as LayerizeTextFit['matrix'] };
      }
    }
  }
  if (!best) return null;
  const { ranking: _ranking, ...fit } = best;
  return fit;
}
