import catalogData from './font-catalog.json';

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

type RemotionFontFamilyManifest = {
  version: string;
  faces: Array<Pick<RemotionFontCatalogFace, 'family'>>;
};

export interface PreparedRemotionFonts {
  code: string;
  defaultFontFamily: string;
  usedFamilies: string[];
  dynamicFamilyAliases: Array<{
    alias: string;
    family: string;
  }>;
}

export interface RemotionFontFaceTiming {
  family: string;
  weight: number;
  subset: string;
  sha256: string;
  loadMs: number;
  resourceDurationMs: number | null;
  transferSize: number | null;
  encodedBodySize: number | null;
}

export interface RemotionFontLoadTiming {
  requestCacheHit: boolean;
  waitMs: number;
  selectionMs: number;
  fontFacesMs: number;
  fontsReadyMs: number;
  fontsCheckMs: number;
  faceCount: number;
  uniqueResourceCount: number;
  faces: RemotionFontFaceTiming[];
}

export interface RemotionFontTiming {
  version: 1;
  totalMs: number;
  manifestMs: number;
  manifestCacheHit: boolean;
  prepareMs: number;
  usedFamilies: string[];
  load: RemotionFontLoadTiming;
}

export const REMOTION_FONT_CATALOG_VERSION = catalogData.version;
export const REMOTION_FONT_RUNTIME_VERSION = 'remotion-font-runtime-r8-editable-provenance';
export const REMOTION_FONT_CATALOG = catalogData.families as RemotionFontCatalogDefinition[];
export const REMOTION_DEFAULT_SANS = 'Inter';
export const REMOTION_DEFAULT_CJK_SANS = 'Noto Sans SC';
export const REMOTION_DEFAULT_CJK_SERIF = 'Noto Serif SC';
export const REMOTION_DEFAULT_EMOJI = 'Noto Color Emoji';

const BUNDLED_REMOTION_FONT_FAMILY_MANIFEST: RemotionFontFamilyManifest = {
  version: REMOTION_FONT_CATALOG_VERSION,
  faces: REMOTION_FONT_CATALOG.map(({ family }) => ({ family })),
};

const GENERIC_FAMILIES = new Set(['sans-serif', 'serif', 'monospace', 'cursive']);
const LEGACY_PLATFORM_FONT_SUBSTITUTIONS: Record<string, string> = {
  'system-ui': REMOTION_DEFAULT_SANS,
  '-apple-system': REMOTION_DEFAULT_SANS,
  BlinkMacSystemFont: REMOTION_DEFAULT_SANS,
  'SF Pro Display': REMOTION_DEFAULT_SANS,
  'SF Pro Text': REMOTION_DEFAULT_SANS,
  'PingFang SC': REMOTION_DEFAULT_CJK_SANS,
  'Microsoft YaHei': REMOTION_DEFAULT_CJK_SANS,
};
const manifestCache = new Map<string, Promise<RemotionFontCatalogManifest>>();
type RemotionFontLoadExecution = Omit<
  RemotionFontLoadTiming,
  'requestCacheHit' | 'waitMs' | 'selectionMs'
>;
const documentLoadCache = new WeakMap<Document, Map<string, Promise<RemotionFontLoadExecution>>>();

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function roundedMs(value: number): number {
  return Math.round(value * 100) / 100;
}

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
    const fileName = new URL(face.url, 'https://makaron.invalid').pathname.split('/').pop() || '';
    if (fileName !== face.sha256 && fileName !== `${face.sha256}.woff2`) {
      throw new Error(`Remotion font asset is not content-addressed: ${face.url}`);
    }
  }
  return manifest as RemotionFontCatalogManifest;
}

export async function fetchRemotionFontManifestWithTiming(url: string): Promise<{
  manifest: RemotionFontCatalogManifest;
  durationMs: number;
  cacheHit: boolean;
}> {
  const startedAt = nowMs();
  const cacheHit = manifestCache.has(url);
  let pending = manifestCache.get(url);
  if (!pending) {
    pending = fetch(url, { cache: 'force-cache' }).then(async (response) => {
      if (!response.ok) throw new Error(`Remotion font manifest failed: ${response.status}`);
      return validateRemotionFontManifest(await response.json());
    });
    manifestCache.set(url, pending);
  }
  try {
    return {
      manifest: await pending,
      durationMs: roundedMs(nowMs() - startedAt),
      cacheHit,
    };
  } catch (error) {
    manifestCache.delete(url);
    throw error;
  }
}

export async function fetchRemotionFontManifest(url: string): Promise<RemotionFontCatalogManifest> {
  return (await fetchRemotionFontManifestWithTiming(url)).manifest;
}

function manifestFamilies(manifest: RemotionFontFamilyManifest): Map<string, string> {
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
  manifest: RemotionFontFamilyManifest;
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
  manifest: RemotionFontFamilyManifest,
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
  props?: Record<string, unknown>;
  manifest: RemotionFontFamilyManifest;
  substitutions?: Record<string, string>;
}): PreparedRemotionFonts {
  const usedFamilies: string[] = [];
  // Old compositions commonly used browser platform stacks before Makaron
  // introduced its pinned font catalog. Keep this compatibility set narrow;
  // stylistic legacy fonts still require an explicit persisted substitution.
  const substitutions = {
    ...LEGACY_PLATFORM_FONT_SUBSTITUTIONS,
    ...(input.substitutions || {}),
  };
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

  // Agent compositions commonly pass a catalog font through a helper prop:
  //   <Title chineseFont="Ma Shan Zheng" />
  //   style={{fontFamily: chineseFont}}
  // Those runtime values cannot be rewritten statically. Detect the remaining
  // explicit string literals and register the same pinned face under that
  // public family name as well as the versioned internal name.
  const remainingStringLiterals = new Set(
    Array.from(code.matchAll(/(['"`])([\s\S]*?)\1/g), match => match[2]),
  );
  const collectPropStrings = (value: unknown): void => {
    if (typeof value === 'string') {
      remainingStringLiterals.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collectPropStrings(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) collectPropStrings(item);
    }
  };
  collectPropStrings(input.props);
  const dynamicFamilyAliases: PreparedRemotionFonts['dynamicFamilyAliases'] = [];
  const addDynamicAlias = (alias: string, family: string) => {
    if (!dynamicFamilyAliases.some(entry => entry.alias === alias && entry.family === family)) {
      dynamicFamilyAliases.push({ alias, family });
    }
    if (!usedFamilies.includes(family)) usedFamilies.push(family);
  };
  for (const family of manifestFamilies(input.manifest).values()) {
    if (remainingStringLiterals.has(family)) addDynamicAlias(family, family);
  }
  for (const [source, target] of Object.entries(substitutions)) {
    if (!remainingStringLiterals.has(source)) continue;
    const canonical = manifestFamilies(input.manifest).get(target.toLowerCase());
    if (canonical) addDynamicAlias(source, canonical);
  }

  const defaultFamilies = [REMOTION_DEFAULT_SANS, REMOTION_DEFAULT_CJK_SANS, REMOTION_DEFAULT_EMOJI];
  for (const family of defaultFamilies) if (!usedFamilies.includes(family)) usedFamilies.push(family);
  return {
    code,
    defaultFontFamily: internalStack(REMOTION_DEFAULT_SANS, 'sans-serif', input.manifest),
    usedFamilies,
    dynamicFamilyAliases,
  };
}

/**
 * Rewrites preview code to the same versioned font-family names used by the
 * remote manifest without waiting for that manifest or any WOFF2 files.
 * Until the FontFace entries arrive the browser uses each stack's generic
 * fallback; once registered, the existing DOM reflows in place.
 */
export function prepareRemotionFontCodeFromBundledCatalog(input: {
  code: string;
  props?: Record<string, unknown>;
  substitutions?: Record<string, string>;
}): PreparedRemotionFonts {
  return prepareRemotionFontCode({
    ...input,
    manifest: BUNDLED_REMOTION_FONT_FAMILY_MANIFEST,
  });
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

function uniqueCodePoints(text: string): number[] {
  return [...new Set([...text].map((char) => char.codePointAt(0) || 0))];
}

function faceMatchesCodePoints(face: RemotionFontCatalogFace, codePoints: number[]): boolean {
  if (!face.unicodeRange) return true;
  return codePoints.some((codePoint) => codePointInRange(codePoint, face.unicodeRange));
}

function containsEmoji(text: string): boolean {
  return /\p{Extended_Pictographic}/u.test(text);
}

function closestWeight(requested: number, available: number[]): number {
  return available.reduce((best, candidate) =>
    Math.abs(candidate - requested) < Math.abs(best - requested) ? candidate : best, available[0]);
}

function resourceTimingFor(url: string): {
  durationMs: number | null;
  transferSize: number | null;
  encodedBodySize: number | null;
} {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByName !== 'function') {
    return { durationMs: null, transferSize: null, encodedBodySize: null };
  }
  const entries = performance.getEntriesByName(url, 'resource');
  const entry = entries[entries.length - 1] as PerformanceResourceTiming | undefined;
  if (!entry) return { durationMs: null, transferSize: null, encodedBodySize: null };
  return {
    durationMs: Number.isFinite(entry.duration) ? roundedMs(entry.duration) : null,
    transferSize: Number.isFinite(entry.transferSize) ? entry.transferSize : null,
    encodedBodySize: Number.isFinite(entry.encodedBodySize) ? entry.encodedBodySize : null,
  };
}

export async function loadPreparedRemotionFonts(input: {
  manifest: RemotionFontCatalogManifest;
  prepared: PreparedRemotionFonts;
  text: string;
  targetDocument?: Document;
}): Promise<RemotionFontLoadTiming> {
  const waitStartedAt = nowMs();
  const selectionStartedAt = nowMs();
  const targetDocument = input.targetDocument || document;
  const usedFamilies = input.prepared.usedFamilies.filter(
    (family) => family !== REMOTION_DEFAULT_EMOJI || containsEmoji(input.text),
  );
  const codePoints = uniqueCodePoints(input.text);
  const facesToLoad: RemotionFontCatalogFace[] = [];
  const loadedFacesByFamily = new Map<string, RemotionFontCatalogFace[]>();
  const aliasesByFamily = new Map<string, string[]>();
  for (const { alias, family } of input.prepared.dynamicFamilyAliases) {
    const aliases = aliasesByFamily.get(family) || [];
    if (!aliases.includes(alias)) aliases.push(alias);
    aliasesByFamily.set(family, aliases);
  }
  for (const family of usedFamilies) {
    const familyFaces = input.manifest.faces.filter((face) => face.family === family && face.style === 'normal');
    if (familyFaces.length === 0) throw new Error(`Remotion font manifest has no faces for ${family}`);
    const availableWeights = [...new Set(familyFaces.map((face) => face.weight))];
    const selectedWeights = [...new Set(requestedWeights(input.text).map((weight) => closestWeight(weight, availableWeights)))];
    const selectedFaces = familyFaces.filter(
      (face) => selectedWeights.includes(face.weight) && faceMatchesCodePoints(face, codePoints),
    );
    const faces = selectedFaces.length > 0
      ? selectedFaces
      : familyFaces.filter((face) => face.weight === selectedWeights[0]).slice(0, 1);
    facesToLoad.push(...faces);
    loadedFacesByFamily.set(family, faces);
  }
  const requestKey = `${input.manifest.version}:${facesToLoad
    .map((face) => {
      const aliases = (aliasesByFamily.get(face.family) || []).sort().join(',');
      return `${face.internalFamily}:${aliases}:${face.weight}:${face.subset}:${face.sha256}`;
    })
    .sort()
    .join('|')}`;
  const selectionMs = roundedMs(nowMs() - selectionStartedAt);
  let requests = documentLoadCache.get(targetDocument);
  if (!requests) {
    requests = new Map();
    documentLoadCache.set(targetDocument, requests);
  }
  const requestCacheHit = requests.has(requestKey);
  let pending = requests.get(requestKey);
  if (!pending) {
    pending = (async () => {
      const fontFacesStartedAt = nowMs();
      const loadedFaces = await Promise.all(facesToLoad.map(async (face): Promise<{
        timing: RemotionFontFaceTiming;
        registrationCount: number;
      }> => {
        const faceStartedAt = nowMs();
        const registeredFamilies = [
          face.internalFamily,
          ...(aliasesByFamily.get(face.family) || []),
        ];
        const fontFaces = registeredFamilies.map(family => new FontFace(
          family,
          `url(${JSON.stringify(face.url)}) format('woff2')`,
          {
            style: face.style,
            weight: String(face.weight),
            unicodeRange: face.unicodeRange,
            display: 'block',
          },
        ));
        try {
          await Promise.all(fontFaces.map(fontFace => fontFace.load()));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Remotion font failed to load: ${face.family} ${face.weight} ${face.subset} `
            + `from ${face.url}. ${message}`,
            { cause: error },
          );
        }
        for (const fontFace of fontFaces) targetDocument.fonts.add(fontFace);
        const resource = resourceTimingFor(face.url);
        return {
          timing: {
            family: face.family,
            weight: face.weight,
            subset: face.subset,
            sha256: face.sha256,
            loadMs: roundedMs(nowMs() - faceStartedAt),
            resourceDurationMs: resource.durationMs,
            transferSize: resource.transferSize,
            encodedBodySize: resource.encodedBodySize,
          },
          registrationCount: fontFaces.length,
        };
      }));
      const faces = loadedFaces.map(face => face.timing);
      const faceCount = loadedFaces.reduce((count, face) => count + face.registrationCount, 0);
      const fontFacesMs = roundedMs(nowMs() - fontFacesStartedAt);

      const fontsReadyStartedAt = nowMs();
      await targetDocument.fonts.ready;
      const fontsReadyMs = roundedMs(nowMs() - fontsReadyStartedAt);

      const fontsCheckStartedAt = nowMs();
      const missing = usedFamilies.filter((family) => {
        const internal = internalRemotionFontFamily(family, input.manifest.version);
        const faces = loadedFacesByFamily.get(family) || [];
        const sample = codePoints
          .filter((codePoint) => faces.some((face) => faceMatchesCodePoints(face, [codePoint])))
          .slice(0, 32)
          .map((codePoint) => String.fromCodePoint(codePoint))
          .join('') || 'A';
        return !targetDocument.fonts.check(`400 16px ${JSON.stringify(internal)}`, sample);
      });
      const missingAliases = input.prepared.dynamicFamilyAliases.filter(({ alias, family }) => {
        const faces = loadedFacesByFamily.get(family) || [];
        const sample = codePoints
          .filter((codePoint) => faces.some((face) => faceMatchesCodePoints(face, [codePoint])))
          .slice(0, 32)
          .map((codePoint) => String.fromCodePoint(codePoint))
          .join('') || 'A';
        return !targetDocument.fonts.check(`400 16px ${JSON.stringify(alias)}`, sample);
      });
      const fontsCheckMs = roundedMs(nowMs() - fontsCheckStartedAt);
      if (missing.length > 0) throw new Error(`Remotion fonts failed to load: ${missing.join(', ')}`);
      if (missingAliases.length > 0) {
        throw new Error(`Remotion dynamic font aliases failed to load: ${missingAliases.map(entry => entry.alias).join(', ')}`);
      }
      return {
        fontFacesMs,
        fontsReadyMs,
        fontsCheckMs,
        faceCount,
        uniqueResourceCount: new Set(facesToLoad.map((face) => face.url)).size,
        faces,
      };
    })();
    requests.set(requestKey, pending);
  }
  try {
    const execution = await pending;
    return {
      ...execution,
      requestCacheHit,
      waitMs: roundedMs(nowMs() - waitStartedAt),
      selectionMs,
    };
  } catch (error) {
    requests.delete(requestKey);
    throw error;
  }
}

export async function prepareAndLoadRemotionFontsWithTiming(input: {
  code: string;
  props?: Record<string, unknown>;
  manifestUrl: string;
  substitutions?: Record<string, string>;
  targetDocument?: Document;
}): Promise<{ prepared: PreparedRemotionFonts; timing: RemotionFontTiming }> {
  const totalStartedAt = nowMs();
  const manifestResult = await fetchRemotionFontManifestWithTiming(input.manifestUrl);
  const prepareStartedAt = nowMs();
  const prepared = prepareRemotionFontCode({
    code: input.code,
    props: input.props,
    manifest: manifestResult.manifest,
    substitutions: input.substitutions,
  });
  const prepareMs = roundedMs(nowMs() - prepareStartedAt);
  const load = await loadPreparedRemotionFonts({
    manifest: manifestResult.manifest,
    prepared,
    text: `${input.code}\n${JSON.stringify(input.props || {})}`,
    targetDocument: input.targetDocument,
  });
  return {
    prepared,
    timing: {
      version: 1,
      totalMs: roundedMs(nowMs() - totalStartedAt),
      manifestMs: manifestResult.durationMs,
      manifestCacheHit: manifestResult.cacheHit,
      prepareMs,
      usedFamilies: prepared.usedFamilies,
      load,
    },
  };
}

export async function prepareAndLoadRemotionFonts(input: {
  code: string;
  props?: Record<string, unknown>;
  manifestUrl: string;
  substitutions?: Record<string, string>;
  targetDocument?: Document;
}): Promise<PreparedRemotionFonts> {
  return (await prepareAndLoadRemotionFontsWithTiming(input)).prepared;
}
