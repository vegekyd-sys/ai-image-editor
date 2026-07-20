import catalogData from '@/remotion/font-catalog.json';

export type RemotionFontStyle = 'normal' | 'italic';

export interface RemotionFontCatalogDefinition {
  family: string;
  weights: number[];
}

export interface RemotionFontCatalogFace {
  family: string;
  internalFamily: string;
  style: RemotionFontStyle;
  weight: number;
  subset: string;
  unicodeRange: string;
  url: string;
  sha256: string;
}

export interface RemotionFontCatalogManifest {
  version: string;
  generatedAt: string;
  faces: RemotionFontCatalogFace[];
}

export interface PreparedRemotionFonts {
  code: string;
  defaultFontFamily: string;
  usedFamilies: string[];
}

export const REMOTION_FONT_CATALOG_VERSION = catalogData.version;
export const REMOTION_FONT_CATALOG = catalogData.families as RemotionFontCatalogDefinition[];
export const REMOTION_DEFAULT_SANS = 'Inter';
export const REMOTION_DEFAULT_CJK_SANS = 'Noto Sans SC';
export const REMOTION_DEFAULT_CJK_SERIF = 'Noto Serif SC';
export const REMOTION_DEFAULT_EMOJI = 'Noto Color Emoji';

const GENERIC_FAMILIES = new Set(['sans-serif', 'serif', 'monospace', 'cursive']);
const manifestCache = new Map<string, Promise<RemotionFontCatalogManifest>>();
const documentLoadCache = new WeakMap<Document, Map<string, Promise<void>>>();

function cleanFamily(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '').trim();
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function internalRemotionFontFamily(family: string, version = REMOTION_FONT_CATALOG_VERSION): string {
  return `Makaron_${slug(version)}_${slug(family)}`;
}

export function remotionFontManifestUrlFromServeUrl(serveUrl: string): string {
  return `${new URL(serveUrl).origin}/sites/_font-catalog/${REMOTION_FONT_CATALOG_VERSION}/manifest.json`;
}

export function validateRemotionFontManifest(value: unknown): RemotionFontCatalogManifest {
  if (!value || typeof value !== 'object') throw new Error('Invalid Remotion font manifest');
  const manifest = value as Partial<RemotionFontCatalogManifest>;
  if (manifest.version !== REMOTION_FONT_CATALOG_VERSION || !Array.isArray(manifest.faces)) {
    throw new Error(`Unsupported Remotion font manifest version: ${String(manifest.version)}`);
  }
  for (const face of manifest.faces) {
    if (!face || typeof face.family !== 'string' || typeof face.internalFamily !== 'string'
      || face.internalFamily !== internalRemotionFontFamily(face.family, manifest.version)
      || face.style !== 'normal' || !Number.isInteger(face.weight)
      || typeof face.subset !== 'string' || typeof face.unicodeRange !== 'string'
      || typeof face.url !== 'string' || !/^[a-f0-9]{64}$/.test(face.sha256 || '')) {
      throw new Error('Malformed Remotion font manifest face');
    }
    const fileName = new URL(face.url).pathname.split('/').pop() || '';
    if (fileName !== `${face.sha256}.woff2`) {
      throw new Error(`Remotion font asset is not content-addressed: ${face.url}`);
    }
  }
  return manifest as RemotionFontCatalogManifest;
}

export async function fetchRemotionFontManifest(url: string): Promise<RemotionFontCatalogManifest> {
  let pending = manifestCache.get(url);
  if (!pending) {
    pending = fetch(url, { cache: 'force-cache' }).then(async (response) => {
      if (!response.ok) throw new Error(`Remotion font manifest failed: ${response.status}`);
      return validateRemotionFontManifest(await response.json());
    });
    manifestCache.set(url, pending);
  }
  try {
    return await pending;
  } catch (error) {
    manifestCache.delete(url);
    throw error;
  }
}

function manifestFamilies(manifest: RemotionFontCatalogManifest): Map<string, string> {
  const families = new Map<string, string>();
  for (const face of manifest.faces) families.set(face.family.toLowerCase(), face.family);
  return families;
}

function genericForStack(families: string[]): string {
  return families.find((family) => GENERIC_FAMILIES.has(family.toLowerCase()))?.toLowerCase() || 'sans-serif';
}

function defaultFamilyForGeneric(generic: string): string {
  if (generic === 'serif') return REMOTION_DEFAULT_CJK_SERIF;
  if (generic === 'monospace') return 'JetBrains Mono';
  if (generic === 'cursive') return 'Caveat';
  return REMOTION_DEFAULT_SANS;
}

function resolveRequestedFamily(input: {
  stack: string;
  manifest: RemotionFontCatalogManifest;
  substitutions: Record<string, string>;
}): { family: string; generic: string } {
  const available = manifestFamilies(input.manifest);
  const substitutions = new Map(
    Object.entries(input.substitutions).map(([source, target]) => [source.toLowerCase(), target]),
  );
  const rawFamilies = input.stack.split(',').map(cleanFamily).filter(Boolean);
  const generic = genericForStack(rawFamilies);

  for (const rawFamily of rawFamilies) {
    if (GENERIC_FAMILIES.has(rawFamily.toLowerCase())) continue;
    const substituted = substitutions.get(rawFamily.toLowerCase()) || rawFamily;
    const canonical = available.get(substituted.toLowerCase());
    if (canonical) return { family: canonical, generic };
    throw new Error(
      `Unsupported Remotion font "${rawFamily}". `
      + `Choose a catalog font or persist an explicit fontSubstitutions entry.`,
    );
  }

  const fallback = defaultFamilyForGeneric(generic);
  const canonical = available.get(fallback.toLowerCase());
  if (!canonical) throw new Error(`Remotion font catalog is missing required fallback: ${fallback}`);
  return { family: canonical, generic };
}

function quotedFamily(family: string): string {
  return JSON.stringify(family);
}

function internalStack(
  family: string,
  generic: string,
  manifest: RemotionFontCatalogManifest,
): string {
  const available = manifestFamilies(manifest);
  const primary = internalRemotionFontFamily(family, manifest.version);
  const fallbackName = generic === 'serif' ? REMOTION_DEFAULT_CJK_SERIF : REMOTION_DEFAULT_CJK_SANS;
  const fallback = available.has(fallbackName.toLowerCase())
    ? internalRemotionFontFamily(fallbackName, manifest.version)
    : primary;
  const emoji = available.has(REMOTION_DEFAULT_EMOJI.toLowerCase())
    ? internalRemotionFontFamily(REMOTION_DEFAULT_EMOJI, manifest.version)
    : fallback;
  return [...new Set([primary, fallback, emoji])].map(quotedFamily).join(', ') + `, ${generic}`;
}

export function prepareRemotionFontCode(input: {
  code: string;
  manifest: RemotionFontCatalogManifest;
  substitutions?: Record<string, string>;
}): PreparedRemotionFonts {
  const usedFamilies: string[] = [];
  const substitutions = input.substitutions || {};
  const code = input.code.replace(
    /(fontFamily\s*:\s*)(['"`])([\s\S]*?)\2/g,
    (match, prefix: string, quote: string, stack: string) => {
      if (quote === '`' && stack.includes('${')) {
        throw new Error('Dynamic template fontFamily values are not supported');
      }
      const resolved = resolveRequestedFamily({ stack, manifest: input.manifest, substitutions });
      if (!usedFamilies.includes(resolved.family)) usedFamilies.push(resolved.family);
      return `${prefix}${JSON.stringify(internalStack(resolved.family, resolved.generic, input.manifest))}`;
    },
  );

  const defaultFamilies = [REMOTION_DEFAULT_SANS, REMOTION_DEFAULT_CJK_SANS, REMOTION_DEFAULT_EMOJI];
  for (const family of defaultFamilies) if (!usedFamilies.includes(family)) usedFamilies.push(family);
  return {
    code,
    defaultFontFamily: internalStack(REMOTION_DEFAULT_SANS, 'sans-serif', input.manifest),
    usedFamilies,
  };
}

function requestedWeights(text: string): number[] {
  const weights = new Set<number>([400]);
  for (const match of text.matchAll(/fontWeight\s*:\s*['"]?(\d{3})/g)) weights.add(Number(match[1]));
  if (/fontWeight\s*:\s*['"]bold['"]/i.test(text)) weights.add(700);
  return [...weights].filter((weight) => weight >= 100 && weight <= 900);
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

function faceMatchesText(face: RemotionFontCatalogFace, text: string): boolean {
  if (!face.unicodeRange) return true;
  return [...text].some((char) => codePointInRange(char.codePointAt(0) || 0, face.unicodeRange));
}

function containsEmoji(text: string): boolean {
  return /\p{Extended_Pictographic}/u.test(text);
}

function closestWeight(requested: number, available: number[]): number {
  return available.reduce((best, candidate) =>
    Math.abs(candidate - requested) < Math.abs(best - requested) ? candidate : best, available[0]);
}

export async function loadPreparedRemotionFonts(input: {
  manifest: RemotionFontCatalogManifest;
  prepared: PreparedRemotionFonts;
  text: string;
  targetDocument?: Document;
}): Promise<void> {
  const targetDocument = input.targetDocument || document;
  const usedFamilies = input.prepared.usedFamilies.filter(
    (family) => family !== REMOTION_DEFAULT_EMOJI || containsEmoji(input.text),
  );
  const facesToLoad: RemotionFontCatalogFace[] = [];
  const loadedFacesByFamily = new Map<string, RemotionFontCatalogFace[]>();
  for (const family of usedFamilies) {
    const familyFaces = input.manifest.faces.filter((face) => face.family === family && face.style === 'normal');
    if (familyFaces.length === 0) throw new Error(`Remotion font manifest has no faces for ${family}`);
    const availableWeights = [...new Set(familyFaces.map((face) => face.weight))];
    const selectedWeights = [...new Set(requestedWeights(input.text).map((weight) => closestWeight(weight, availableWeights)))];
    const selectedFaces = familyFaces.filter((face) => selectedWeights.includes(face.weight) && faceMatchesText(face, input.text));
    const faces = selectedFaces.length > 0
      ? selectedFaces
      : familyFaces.filter((face) => face.weight === selectedWeights[0]).slice(0, 1);
    facesToLoad.push(...faces);
    loadedFacesByFamily.set(family, faces);
  }
  const requestKey = `${input.manifest.version}:${facesToLoad
    .map((face) => `${face.internalFamily}:${face.weight}:${face.subset}:${face.sha256}`)
    .sort()
    .join('|')}`;
  let requests = documentLoadCache.get(targetDocument);
  if (!requests) {
    requests = new Map();
    documentLoadCache.set(targetDocument, requests);
  }
  let pending = requests.get(requestKey);
  if (!pending) {
    pending = (async () => {
      await Promise.all(facesToLoad.map(async (face) => {
        const fontFace = new FontFace(face.internalFamily, `url(${JSON.stringify(face.url)}) format('woff2')`, {
          style: face.style,
          weight: String(face.weight),
          unicodeRange: face.unicodeRange,
          display: 'block',
        });
        await fontFace.load();
        targetDocument.fonts.add(fontFace);
      }));
      await targetDocument.fonts.ready;

      const missing = usedFamilies.filter((family) => {
        const internal = internalRemotionFontFamily(family, input.manifest.version);
        const faces = loadedFacesByFamily.get(family) || [];
        const sample = [...input.text]
          .filter((char) => faces.some((face) => faceMatchesText(face, char)))
          .slice(0, 32)
          .join('') || 'A';
        return !targetDocument.fonts.check(`400 16px ${JSON.stringify(internal)}`, sample);
      });
      if (missing.length > 0) throw new Error(`Remotion fonts failed to load: ${missing.join(', ')}`);
    })();
    requests.set(requestKey, pending);
  }
  try {
    await pending;
  } catch (error) {
    requests.delete(requestKey);
    throw error;
  }
}

export async function prepareAndLoadRemotionFonts(input: {
  code: string;
  props?: Record<string, unknown>;
  manifestUrl: string;
  substitutions?: Record<string, string>;
  targetDocument?: Document;
}): Promise<PreparedRemotionFonts> {
  const manifest = await fetchRemotionFontManifest(input.manifestUrl);
  const prepared = prepareRemotionFontCode({ code: input.code, manifest, substitutions: input.substitutions });
  await loadPreparedRemotionFonts({
    manifest,
    prepared,
    text: `${input.code}\n${JSON.stringify(input.props || {})}`,
    targetDocument: input.targetDocument,
  });
  return prepared;
}
