import { getAvailableFonts, type FontInfo } from '@remotion/google-fonts';

export const REMOTION_FONT_FALLBACK = "Inter, 'Noto Sans SC', sans-serif";

const AVAILABLE_FONTS = getAvailableFonts();
const AVAILABLE_FONT_NAMES = new Set(AVAILABLE_FONTS.map((font) => font.fontFamily));
const AVAILABLE_FONT_NAMES_BY_LOWER = new Map(AVAILABLE_FONTS.map((font) => [font.fontFamily.toLowerCase(), font.fontFamily]));
const loadedRequestsByDocument = new WeakMap<Document, Map<string, Promise<void>>>();
const loadedStylesheetsByDocument = new WeakMap<Document, Map<string, Promise<void>>>();

export interface RemotionFontAsset {
  family: string;
  style: 'normal' | 'italic';
  weight: string;
  subset: string;
  sourceUrl: string;
  unicodeRange: string;
}

const SYSTEM_FONT_ALIASES = new Map<string, string>([
  ['-apple-system', 'Inter'],
  ['blinkmacsystemfont', 'Inter'],
  ['sf pro display', 'Inter'],
  ['sf pro text', 'Inter'],
  ['system-ui', 'Inter'],
  ['segoe ui', 'Inter'],
  ['roboto', 'Inter'],
  ['arial', 'Inter'],
  ['helvetica', 'Inter'],
  ['pingfang sc', 'Noto Sans SC'],
  ['hiragino sans gb', 'Noto Sans SC'],
  ['microsoft yahei', 'Noto Sans SC'],
  ['ui-monospace', 'JetBrains Mono'],
  ['sfmono-regular', 'JetBrains Mono'],
  ['menlo', 'JetBrains Mono'],
  ['monaco', 'JetBrains Mono'],
  ['consolas', 'JetBrains Mono'],
  ['impact', 'Anton'],
  ['arial black', 'Anton'],
  ['times new roman', 'Noto Serif'],
  ['times', 'Noto Serif'],
  ['georgia', 'Noto Serif'],
]);

function cleanFamilyName(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '').trim();
}

function pushUnique(target: string[], value: string): void {
  if (!target.some((item) => item.toLowerCase() === value.toLowerCase())) target.push(value);
}

function normalizeFontStack(value: string): string {
  const families: string[] = [];
  for (const raw of value.split(',')) {
    const family = cleanFamilyName(raw);
    if (!family) continue;
    pushUnique(families, SYSTEM_FONT_ALIASES.get(family.toLowerCase()) || family);
  }

  const generic = families.find((family) =>
    ['sans-serif', 'serif', 'monospace', 'cursive'].includes(family.toLowerCase()),
  )?.toLowerCase();

  if (generic === 'sans-serif') {
    const genericIndex = families.findIndex((family) => family.toLowerCase() === generic);
    if (!families.some((family) => family === 'Noto Sans SC')) families.splice(genericIndex, 0, 'Noto Sans SC');
    if (!families.some((family) => AVAILABLE_FONT_NAMES.has(family) && family !== 'Noto Sans SC')) {
      families.unshift('Inter');
    }
  } else if (generic === 'serif') {
    const genericIndex = families.findIndex((family) => family.toLowerCase() === generic);
    if (!families.includes('Noto Serif SC')) families.splice(genericIndex, 0, 'Noto Serif SC');
    if (!families.some((family) => AVAILABLE_FONT_NAMES.has(family) && family !== 'Noto Serif SC')) {
      families.unshift('Noto Serif');
    }
  } else if (generic === 'monospace') {
    const genericIndex = families.findIndex((family) => family.toLowerCase() === generic);
    if (!families.includes('Noto Sans SC')) families.splice(genericIndex, 0, 'Noto Sans SC');
    if (!families.includes('JetBrains Mono')) families.unshift('JetBrains Mono');
  } else if (generic === 'cursive') {
    const genericIndex = families.findIndex((family) => family.toLowerCase() === generic);
    if (!families.includes('Noto Sans SC')) families.splice(genericIndex, 0, 'Noto Sans SC');
    if (!families.some((family) => AVAILABLE_FONT_NAMES.has(family) && family !== 'Noto Sans SC')) {
      families.unshift('Caveat');
    }
  }

  return families.join(', ');
}

/** Replace OS-dependent font stacks without changing explicit Google Font choices. */
export function normalizeRemotionFontFamilies(code: string): string {
  return code.replace(
    /(fontFamily\s*:\s*)(['"`])([\s\S]*?)\2/g,
    (match, prefix: string, quote: string, value: string) => {
      if (quote === '`' && value.includes('${')) return match;
      return `${prefix}${quote}${normalizeFontStack(value)}${quote}`;
    },
  );
}

export function remotionFontSearchText(
  code: string,
  props: Record<string, unknown> = {},
): string {
  return `${code}\n${JSON.stringify(props)}`;
}

function hasCjk(text: string): boolean {
  return /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(text);
}

function hasEmoji(text: string): boolean {
  return /\p{Extended_Pictographic}/u.test(text);
}

function requestedWeights(text: string): number[] {
  const weights = new Set<number>([400]);
  for (const match of text.matchAll(/fontWeight\s*:\s*['"]?(\d{3})/g)) {
    const weight = Number(match[1]);
    if (weight >= 100 && weight <= 900) weights.add(weight);
  }
  if (/fontWeight\s*:\s*['"]bold['"]/i.test(text)) weights.add(700);
  return [...weights].sort((a, b) => a - b);
}

function requestedStyles(text: string): Array<'normal' | 'italic'> {
  return /fontStyle\s*:\s*['"]italic['"]/i.test(text) ? ['normal', 'italic'] : ['normal'];
}

function declaredFontFamilies(text: string): string[] {
  const families: string[] = [];
  for (const match of text.matchAll(/fontFamily\s*:\s*(['"`])([\s\S]*?)\1/g)) {
    if (match[1] === '`' && match[2].includes('${')) continue;
    for (const rawFamily of match[2].split(',')) {
      const family = cleanFamilyName(rawFamily);
      const canonicalFamily = AVAILABLE_FONT_NAMES_BY_LOWER.get(family.toLowerCase());
      if (canonicalFamily) pushUnique(families, canonicalFamily);
    }
  }
  return families;
}

function codePointInRange(codePoint: number, range: string): boolean {
  for (const rawPart of range.split(',')) {
    const part = rawPart.trim().replace(/^U\+/i, '');
    if (!part) continue;
    if (part.includes('?')) {
      const start = Number.parseInt(part.replace(/\?/g, '0'), 16);
      const end = Number.parseInt(part.replace(/\?/g, 'F'), 16);
      if (codePoint >= start && codePoint <= end) return true;
      continue;
    }
    const [startRaw, endRaw] = part.split('-');
    const start = Number.parseInt(startRaw, 16);
    const end = Number.parseInt(endRaw || startRaw, 16);
    if (codePoint >= start && codePoint <= end) return true;
  }
  return false;
}

export function selectUnicodeSubsets(info: FontInfo, text: string, available: string[]): string[] {
  const codePoints = [...new Set([...text].map((char) => char.codePointAt(0)).filter((value): value is number => value !== undefined))];
  const selected = available.filter((subset) => {
    const range = info.unicodeRanges[subset];
    return range ? codePoints.some((codePoint) => codePointInRange(codePoint, range)) : false;
  });

  if (selected.length > 0) return selected;
  if (available.includes('latin')) return ['latin'];
  return available.slice(0, 1);
}

function closestAvailableWeights(requested: number[], available: string[]): string[] {
  const numeric = available.map(Number).filter(Number.isFinite);
  if (numeric.length === 0) return available.slice(0, 1);
  return [...new Set(requested.map((weight) =>
    numeric.reduce((best, candidate) =>
      Math.abs(candidate - weight) < Math.abs(best - weight) ? candidate : best,
    numeric[0]),
  ))].map(String);
}

function fontFamiliesToLoad(text: string): string[] {
  const families = declaredFontFamilies(text);

  // Unstyled elements inherit this deterministic default in both preview and Lambda.
  pushUnique(families, 'Inter');
  if (hasCjk(text)) pushUnique(families, 'Noto Sans SC');
  if (hasEmoji(text)) pushUnique(families, 'Noto Color Emoji');
  return families;
}

export async function resolveRemotionFontAssets(text: string): Promise<RemotionFontAsset[]> {
  const weights = requestedWeights(text);
  const styles = requestedStyles(text);
  const families = fontFamiliesToLoad(text);
  const assets: RemotionFontAsset[] = [];

  await Promise.all(families.map(async (family) => {
    const available = AVAILABLE_FONTS.find((font) => font.fontFamily === family);
    if (!available) throw new Error(`Unsupported Remotion font: ${family}`);
    const font = await available.load();
    const info = font.getInfo();

    for (const style of styles) {
      const styleFonts = info.fonts[style];
      if (!styleFonts) continue;
      const selectedWeights = closestAvailableWeights(weights, Object.keys(styleFonts));
      const availableSubsets = [...new Set(selectedWeights.flatMap((weight) => Object.keys(styleFonts[weight] || {})))];
      const subsets = selectUnicodeSubsets(info, text, availableSubsets);
      for (const weight of selectedWeights) {
        for (const subset of subsets) {
          const sourceUrl = styleFonts[weight]?.[subset];
          const unicodeRange = info.unicodeRanges[subset];
          if (!sourceUrl || !unicodeRange) continue;
          assets.push({ family, style, weight, subset, sourceUrl, unicodeRange });
        }
      }
    }
  }));

  return assets;
}

async function loadFontAsset(
  asset: RemotionFontAsset,
  targetDocument: Document,
  assetBaseUrl?: string,
): Promise<void> {
  let url = asset.sourceUrl;
  if (assetBaseUrl) {
    const bytes = new TextEncoder().encode(asset.sourceUrl);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
    url = `${assetBaseUrl.replace(/\/$/, '')}/${hash}.woff2`;
  }
  const requestKey = `${asset.family}:${asset.style}:${asset.weight}:${asset.subset}:${url}`;
  let documentRequests = loadedRequestsByDocument.get(targetDocument);
  if (!documentRequests) {
    documentRequests = new Map();
    loadedRequestsByDocument.set(targetDocument, documentRequests);
  }

  let pending = documentRequests.get(requestKey);
  if (!pending) {
    pending = (async () => {
      const fontFace = new FontFace(asset.family, `url(${JSON.stringify(url)}) format('woff2')`, {
        weight: asset.weight,
        style: asset.style,
        unicodeRange: asset.unicodeRange,
      });
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Timed out loading Remotion font: ${asset.family}`)), 30_000);
      });
      await Promise.race([fontFace.load(), timeout]);
      targetDocument.fonts.add(fontFace);
    })();
    documentRequests.set(requestKey, pending);
  }

  try {
    await pending;
  } catch (error) {
    documentRequests.delete(requestKey);
    throw error;
  }
}

/** Load only the font families, weights and Unicode shards used by this composition. */
export async function loadRemotionGoogleFonts(
  text: string,
  targetDocument: Document = document,
  assetBaseUrl?: string,
): Promise<void> {
  const families = fontFamiliesToLoad(text);
  const assets = await resolveRemotionFontAssets(text);
  await Promise.all(assets.map((asset) => loadFontAsset(asset, targetDocument, assetBaseUrl)));

  await targetDocument.fonts.ready;
  const missing = families.filter((family) => !targetDocument.fonts.check(`400 16px "${family}"`));
  if (missing.length > 0) throw new Error(`Remotion fonts failed to register: ${missing.join(', ')}`);
}

/** Load a same-origin font manifest and let Chromium fetch only faces used by the rendered DOM. */
export async function loadRemotionFontStylesheet(
  stylesheetUrl: string,
  targetDocument: Document = document,
): Promise<void> {
  let documentStylesheets = loadedStylesheetsByDocument.get(targetDocument);
  if (!documentStylesheets) {
    documentStylesheets = new Map();
    loadedStylesheetsByDocument.set(targetDocument, documentStylesheets);
  }

  let pending = documentStylesheets.get(stylesheetUrl);
  if (!pending) {
    pending = new Promise<void>((resolve, reject) => {
      const link = targetDocument.createElement('link');
      link.rel = 'stylesheet';
      link.href = stylesheetUrl;
      link.onload = () => resolve();
      link.onerror = () => reject(new Error(`Failed to load Remotion font manifest: ${stylesheetUrl}`));
      targetDocument.head.appendChild(link);
    });
    documentStylesheets.set(stylesheetUrl, pending);
  }

  try {
    await pending;
    await targetDocument.fonts.ready;
  } catch (error) {
    documentStylesheets.delete(stylesheetUrl);
    throw error;
  }
}
