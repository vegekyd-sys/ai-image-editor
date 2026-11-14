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
  /** Advances in the same units as fontSize, used for deterministic wrapping. */
  advances?: Record<string, number>;
  lineHeight?: number;
  letterSpacing?: number;
}
const fontCache = new Map<string, Promise<Font>>();
const FALLBACK_FAMILIES = ['Montserrat', 'Inter', 'Roboto', 'Lato', 'Poppins'];
const substitute: Record<string, string> = { calibri: 'Carlito', arial: 'Arimo', 'arial narrow': 'Roboto Condensed' };
export function layerizeFontCandidates(hint: string, text = ''): string[] {
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)) {
    const known = ['Noto Sans SC', 'Noto Serif SC', 'LXGW WenKai TC', 'Ma Shan Zheng', 'ZCOOL XiaoWei'];
    return known.includes(hint) ? [hint] : /serif|song|ming|宋|明朝/i.test(hint) && !/sans/i.test(hint) ? ['Noto Serif SC'] : ['Noto Sans SC'];
  }
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
export async function layerizeMatchingFaces(hints: string[], texts: string[] = []): Promise<RemotionFontCatalogFace[]> {
  const families = [...new Set(hints.flatMap((hint, i) => layerizeFontCandidates(hint, texts[i])))];
  const known = families.filter(f => /^[\w -]{1,80}$/.test(f));
  const resolved = await resolveRemotionFontManifestForDesign({ code: known.map(f => `const f = {fontFamily:${JSON.stringify(f)}};`).join('\n') });
  const manifest = resolved.manifest || await (await fetch(resolved.manifestUrl, { signal: AbortSignal.timeout(15_000) })).json();
  return (manifest.faces as RemotionFontCatalogFace[]).filter(f => known.includes(f.family) && f.style === 'normal' && [400, 500, 600, 700, 800, 900].includes(f.weight));
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
/** CSS unicode-range fonts are a single family assembled from several subset files. */
function glyphPaths(fonts: Font[], text: string, letterSpacing = 0) {
  const groups: Array<{ font: Font; text: string }> = [];
  for (const char of Array.from(text)) {
    const font = fonts.find(f => f.hasGlyphForCodePoint(char.codePointAt(0)!));
    if (!font) return null;
    const last = groups.at(-1);
    if (last?.font === font) last.text += char; else groups.push({ font, text: char });
  }
  let pen = 0, left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const advances: Record<string, number> = {};
  const paths = groups.map(({ font, text }) => {
    for (const char of Array.from(text)) advances[char] = font.layout(char).positions.reduce((n, p) => n + p.xAdvance, 0);
    const run = font.layout(text);
    return run.glyphs.map((g, i) => {
      const p = run.positions[i], x = pen + p.xOffset, y = -p.yOffset, b = g.bbox;
      if (b.maxX > b.minX && b.maxY > b.minY) {
        left = Math.min(left, x + b.minX); top = Math.min(top, y - b.maxY);
        right = Math.max(right, x + b.maxX); bottom = Math.max(bottom, y - b.minY);
      }
      pen += p.xAdvance + letterSpacing;
      return `<path transform="translate(${x},${y}) scale(1,-1)" d="${g.path.toSVG()}"/>`;
    }).join('');
  }).join('');
  return { paths, left, top, width: right - left, height: bottom - top, advances };
}
function intersectsText(face: RemotionFontCatalogFace, text: string): boolean {
  return !face.unicodeRange || Array.from(text).some(char => {
    const cp = char.codePointAt(0)!;
    return face.unicodeRange.split(',').some(range => {
      const match = /U\+([\da-f]+)(?:-([\da-f]+))?/i.exec(range);
      return !!match && cp >= parseInt(match[1], 16) && cp <= parseInt(match[2] || match[1], 16);
    });
  });
}
function silhouetteScore(target: Uint8Array, candidate: Uint8Array): number {
  if (target.length !== candidate.length) throw new Error('Text matching masks have different dimensions');
  let intersection = 0, union = 0;
  for (let i = 0; i < target.length; i++) { intersection += Math.min(target[i], candidate[i]); union += Math.max(target[i], candidate[i]); }
  return union ? intersection / union : 0;
}
/** Fit actual isolated glyph pixels, rather than trusting OCR's approximate size/italic flags. */
export async function fitLayerizeText(bytes: Buffer, text: string, hint: string, color: string, faces: RemotionFontCatalogFace[]): Promise<LayerizeTextFit | null> {
  if (!text.trim() || text.length > 300) return null;
  const { data, info } = await sharp(bytes).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true });
  const initialBox = inkBounds(data, info.width, info.height);
  const initialAngle = initialBox && initialBox.width > initialBox.height * 2 ? textInkAngle(data, info.width, info.height) : 0;
  const angles = initialAngle === 0 ? [0] : [-3, -1.5, 0, 1.5, 3].map(d => initialAngle + d);
  const families = layerizeFontCandidates(hint, text);
  const candidates = faces.filter(f => families.includes(f.family) && intersectsText(f, text));
  const loaded = await Promise.all(candidates.map(async face => {
    try { const base = await fontFor(face); return { face, font: base.variationAxes?.wght ? base.getVariation({ wght: face.weight }) : base }; } catch { return null; }
  }));
  const groups = new Map<string, { face: RemotionFontCatalogFace; fonts: Font[] }>();
  for (const item of loaded) if (item) {
    const key = `${item.face.family}:${item.face.weight}`;
    const group = groups.get(key) || { face: item.face, fonts: [] };
    group.fonts.push(item.font); groups.set(key, group);
  }
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text);
  let best: (LayerizeTextFit & { ranking: number }) | null = null;
  for (const angle of angles) {
    const rotated = await sharp(bytes).rotate(-angle, { background: '#00000000' }).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true });
    const box = inkBounds(rotated.data, rotated.info.width, rotated.info.height); if (!box) continue;
    const sampleHeight = 72, sampleWidth = Math.max(1, Math.min(1000, Math.round(box.width / box.height * sampleHeight)));
    const target = await sharp(rotated.data, { raw: { width: rotated.info.width, height: rotated.info.height, channels: 1 } }).extract(box).resize(sampleWidth, sampleHeight).greyscale().raw().toBuffer();
    for (const { face, fonts } of groups.values()) {
      const font = fonts[0];
      let glyph = glyphPaths(fonts, text); if (!glyph?.width || !glyph.height) continue;
      // Match row advance with spacing, never by flattening CJK glyphs.
      const letterSpacing = cjk && Array.from(text).length > 1 ? Math.max(-font.unitsPerEm * .15, Math.min(font.unitsPerEm * .15, (box.width * glyph.height / box.height - glyph.width) / (Array.from(text).length - 1))) : 0;
      if (letterSpacing) glyph = glyphPaths(fonts, text, letterSpacing)!;
      for (const shear of cjk ? [0] : [0, -.2126]) {
        const xs = [glyph.left + shear * glyph.top, glyph.left + glyph.width + shear * glyph.top, glyph.left + shear * (glyph.top + glyph.height), glyph.left + glyph.width + shear * (glyph.top + glyph.height)];
        const left = Math.min(...xs), width = Math.max(...xs) - left;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sampleWidth}" height="${sampleHeight}" viewBox="${left} ${glyph.top} ${width} ${glyph.height}" preserveAspectRatio="none"><g fill="white" transform="matrix(1,0,${shear},1,0,0)">${glyph.paths}</g></svg>`;
        const candidate = await sharp(Buffer.from(svg)).ensureAlpha().extractChannel('alpha').raw().toBuffer();
        const score = silhouetteScore(target, candidate);
        const stretch = box.width / box.height / (width / glyph.height);
        const targetInk = target.reduce((n, v) => n + v, 0), candidateInk = candidate.reduce((n, v) => n + v, 0);
        const ranking = score - .025 * Math.abs(Math.log(stretch)) - (cjk ? .25 * Math.abs(candidateInk / Math.max(1, targetInk) - 1) : 0);
        if (best && ranking <= best.ranking) continue;
        const sy = box.height / glyph.height, sx = cjk ? sy : box.width / width, radians = angle * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
        const tx = box.left - rotated.info.width / 2 - left * sx;
        const ty = box.top - rotated.info.height / 2 - glyph.top * sy;
        best = { family: face.family, weight: face.weight, fontSize: font.unitsPerEm, color, score, ranking, advances: glyph.advances, letterSpacing, lineHeight: font.unitsPerEm * 1.4,
          matrix: [c * sx, s * sx, c * shear * sx - s * sy, s * shear * sx + c * sy, c * tx - s * ty + info.width / 2, s * tx + c * ty + info.height / 2].map(v => Number(v.toFixed(6))) as LayerizeTextFit['matrix'] };
      }
    }
  }
  if (!best) return null;
  const { ranking: _ranking, ...fit } = best;
  return fit;
}
