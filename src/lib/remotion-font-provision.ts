import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectAclCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getAvailableFonts } from '@remotion/google-fonts';
import {
  REMOTION_FONT_CATALOG,
  REMOTION_FONT_CATALOG_VERSION,
  internalRemotionFontFamily,
  remotionFontManifestUrlFromServeUrl,
  validateRemotionFontManifest,
  type RemotionFontCatalogManifest,
} from '@/remotion/font-catalog';

const AVAILABLE_GOOGLE_FONTS = getAvailableFonts();
const GOOGLE_FONT_BY_NAME = new Map(
  AVAILABLE_GOOGLE_FONTS.map((font) => [font.fontFamily.toLowerCase(), font]),
);

interface GoogleFontInfo {
  unicodeRanges: Record<string, string>;
  fonts: Record<string, Record<string, Record<string, string>>>;
}

interface SourceFontFace {
  family: string;
  internalFamily: string;
  style: 'normal';
  weight: number;
  subset: string;
  unicodeRange: string;
  sourceUrl: string;
}

interface RequestedFontDefinition {
  family: string;
  weights?: number[];
}

export interface ProvisionedRemotionFontCatalog {
  manifest: RemotionFontCatalogManifest;
  manifestUrl: string;
  assetCount: number;
  uploadedAssetCount: number;
  totalBytes: number;
  reusedExistingManifest: boolean;
  elapsedMs: number;
}

function cleanEnv(value: string | undefined): string | undefined {
  const clean = value?.replace(/\\[rn]|[\u0000-\u001F\u007F]/g, '').trim();
  return clean || undefined;
}

function normalizeAwsCredentials(): void {
  const pairs = [
    ['AWS_ACCESS_KEY_ID', 'REMOTION_AWS_ACCESS_KEY_ID'],
    ['AWS_SECRET_ACCESS_KEY', 'REMOTION_AWS_SECRET_ACCESS_KEY'],
    ['AWS_SESSION_TOKEN', 'REMOTION_AWS_SESSION_TOKEN'],
  ] as const;
  for (const [awsName, remotionName] of pairs) {
    const existing = cleanEnv(process.env[awsName]);
    const remotion = cleanEnv(process.env[remotionName]);
    // This provisioner only writes to the Remotion bucket. A generic AWS_* key
    // may belong to Bedrock or another provider and must not win here.
    if (remotion) process.env[awsName] = remotion;
    else if (existing) process.env[awsName] = existing;
  }
}

function closestWeight(requested: number, available: number[]): number {
  return available.reduce((best, candidate) =>
    Math.abs(candidate - requested) < Math.abs(best - requested) ? candidate : best, available[0]);
}

async function collectSourceFaces(
  definitions: RequestedFontDefinition[],
): Promise<SourceFontFace[]> {
  const faces: SourceFontFace[] = [];

  for (const definition of definitions) {
    const available = GOOGLE_FONT_BY_NAME.get(definition.family.toLowerCase());
    if (!available) throw new Error(`@remotion/google-fonts is missing ${definition.family}`);
    const fontModule = await available.load();
    const info = fontModule.getInfo() as GoogleFontInfo;
    const normal = info.fonts.normal;
    if (!normal) throw new Error(`Remotion font ${definition.family} has no normal style`);
    const availableWeights = Object.keys(normal).map(Number).filter(Number.isFinite);
    if (availableWeights.length === 0) throw new Error(`Remotion font ${definition.family} has no weights`);

    const requestedWeights = definition.weights || availableWeights;
    for (const requestedWeight of requestedWeights) {
      const sourceWeight = closestWeight(requestedWeight, availableWeights);
      const subsets = normal[String(sourceWeight)];
      for (const [subset, sourceUrl] of Object.entries(subsets)) {
        const unicodeRange = info.unicodeRanges[subset];
        if (!unicodeRange) {
          throw new Error(`Remotion font ${definition.family} is missing unicode range ${subset}`);
        }
        faces.push({
          family: definition.family,
          internalFamily: internalRemotionFontFamily(definition.family),
          style: 'normal',
          weight: requestedWeight,
          subset,
          unicodeRange,
          sourceUrl,
        });
      }
    }
  }
  return faces;
}

export async function collectRemotionFontSourceFaces(): Promise<SourceFontFace[]> {
  return collectSourceFaces(REMOTION_FONT_CATALOG);
}

export async function collectRemotionFontSourceFacesForFamilies(
  families: string[],
): Promise<SourceFontFace[]> {
  const uniqueFamilies = [...new Set(families.map((family) => family.trim()).filter(Boolean))];
  return collectSourceFaces(uniqueFamilies.map((family) => ({ family })));
}

function manifestCoversCatalog(manifest: RemotionFontCatalogManifest): boolean {
  return REMOTION_FONT_CATALOG.every((definition) =>
    definition.weights.every((weight) =>
      manifest.faces.some((face) => face.family === definition.family && face.weight === weight),
    ),
  );
}

async function fetchExistingManifest(url: string): Promise<RemotionFontCatalogManifest | null> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    const manifest = validateRemotionFontManifest(await response.json());
    return manifestCoversCatalog(manifest) ? manifest : null;
  } catch {
    return null;
  }
}

async function readExistingManifestFromS3(
  s3: S3Client,
  bucketName: string,
): Promise<RemotionFontCatalogManifest | null> {
  try {
    const response = await s3.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: `sites/_font-catalog/${REMOTION_FONT_CATALOG_VERSION}/manifest.json`,
    }));
    const content = await response.Body?.transformToString();
    if (!content) return null;
    const manifest = validateRemotionFontManifest(JSON.parse(content));
    return manifestCoversCatalog(manifest) ? manifest : null;
  } catch {
    return null;
  }
}

async function makeManifestPublic(input: {
  s3: S3Client;
  bucketName: string;
  manifest: RemotionFontCatalogManifest;
  concurrency: number;
  onProgress?: (message: string) => void;
}): Promise<void> {
  const keys = [
    `sites/_font-catalog/${REMOTION_FONT_CATALOG_VERSION}/manifest.json`,
    ...[...new Set(input.manifest.faces.map((face) => assetKey(face.sha256)))],
  ];
  let completed = 0;
  await mapWithConcurrency(keys, input.concurrency, async (key) => {
    await input.s3.send(new PutObjectAclCommand({
      Bucket: input.bucketName,
      Key: key,
      ACL: 'public-read',
    }));
    completed++;
    if (completed % 100 === 0 || completed === keys.length) {
      input.onProgress?.(`font ACL ${completed}/${keys.length}`);
    }
  });
}

async function uploadPublicManifest(
  s3: S3Client,
  bucketName: string,
  manifest: RemotionFontCatalogManifest,
  key = `sites/_font-catalog/${REMOTION_FONT_CATALOG_VERSION}/manifest.json`,
  immutable = false,
): Promise<void> {
  const compressed = gzipSync(Buffer.from(JSON.stringify(manifest)));
  await s3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: compressed,
    ContentType: 'application/json; charset=utf-8',
    ContentEncoding: 'gzip',
    CacheControl: immutable
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400',
    ACL: 'public-read',
  }));
}

async function fetchFontBytes(url: string): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`font source returned ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw new Error(`Failed to download ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function assetKey(sha256: string): string {
  return `sites/_font-catalog/${REMOTION_FONT_CATALOG_VERSION}/assets/${sha256}.woff2`;
}

function publicObjectUrl(serveUrl: string, key: string): string {
  return new URL(`/${key}`, new URL(serveUrl).origin).toString();
}

async function objectExists(s3: S3Client, bucketName: string, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
    return true;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return false;
    throw error;
  }
}

export async function provisionRemotionFontCatalog(input: {
  region: string;
  bucketName: string;
  serveUrl: string;
  force?: boolean;
  concurrency?: number;
  onProgress?: (message: string) => void;
}): Promise<ProvisionedRemotionFontCatalog> {
  const startedAt = Date.now();
  const manifestUrl = remotionFontManifestUrlFromServeUrl(input.serveUrl);
  normalizeAwsCredentials();
  const s3 = new S3Client({ region: input.region });
  if (!input.force) {
    const existing = await fetchExistingManifest(manifestUrl);
    if (existing) {
      await uploadPublicManifest(s3, input.bucketName, existing);
      return {
        manifest: existing,
        manifestUrl,
        assetCount: new Set(existing.faces.map((face) => face.sha256)).size,
        uploadedAssetCount: 0,
        totalBytes: 0,
        reusedExistingManifest: true,
        elapsedMs: Date.now() - startedAt,
      };
    }
    const privateExisting = await readExistingManifestFromS3(s3, input.bucketName);
    if (privateExisting) {
      await uploadPublicManifest(s3, input.bucketName, privateExisting);
      await makeManifestPublic({
        s3,
        bucketName: input.bucketName,
        manifest: privateExisting,
        concurrency: Math.max(1, input.concurrency || 24),
        onProgress: input.onProgress,
      });
      return {
        manifest: privateExisting,
        manifestUrl,
        assetCount: new Set(privateExisting.faces.map((face) => face.sha256)).size,
        uploadedAssetCount: 0,
        totalBytes: 0,
        reusedExistingManifest: true,
        elapsedMs: Date.now() - startedAt,
      };
    }
  }

  const sourceFaces = await collectRemotionFontSourceFaces();
  const sourceUrls = [...new Set(sourceFaces.map((face) => face.sourceUrl))];
  let uploadedAssetCount = 0;
  let totalBytes = 0;
  let completed = 0;

  const assets = await mapWithConcurrency(
    sourceUrls,
    Math.max(1, input.concurrency || 12),
    async (sourceUrl) => {
      const bytes = await fetchFontBytes(sourceUrl);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const key = assetKey(sha256);
      if (!(await objectExists(s3, input.bucketName, key))) {
        await s3.send(new PutObjectCommand({
          Bucket: input.bucketName,
          Key: key,
          Body: bytes,
          ContentType: 'font/woff2',
          CacheControl: 'public, max-age=31536000, immutable',
          ACL: 'public-read',
        }));
        uploadedAssetCount++;
      }
      totalBytes += bytes.byteLength;
      completed++;
      if (completed % 50 === 0 || completed === sourceUrls.length) {
        input.onProgress?.(`fonts ${completed}/${sourceUrls.length}`);
      }
      return [sourceUrl, { sha256, url: publicObjectUrl(input.serveUrl, key) }] as const;
    },
  );
  const assetsBySource = new Map(assets);
  const manifest: RemotionFontCatalogManifest = {
    version: REMOTION_FONT_CATALOG_VERSION,
    generatedAt: new Date().toISOString(),
    faces: sourceFaces.map(({ sourceUrl, ...face }) => {
      const asset = assetsBySource.get(sourceUrl);
      if (!asset) throw new Error(`Missing provisioned font asset for ${sourceUrl}`);
      return { ...face, ...asset };
    }),
  };
  validateRemotionFontManifest(manifest);

  await uploadPublicManifest(s3, input.bucketName, manifest);

  return {
    manifest,
    manifestUrl,
    assetCount: sourceUrls.length,
    uploadedAssetCount,
    totalBytes,
    reusedExistingManifest: false,
    elapsedMs: Date.now() - startedAt,
  };
}

export interface ProvisionedRemotionFontManifest {
  manifest: RemotionFontCatalogManifest;
  manifestUrl: string;
  requestedFamilies: string[];
  addedFamilies: string[];
  uploadedAssetCount: number;
  totalBytes: number;
  reusedExistingManifest: boolean;
}

/**
 * Extends the deploy-time base catalog with arbitrary Google Font families.
 * Assets remain content-addressed and the derived manifest is immutable, so
 * browser preview, Sandbox, local render, and Lambda all consume identical
 * bytes without growing the base catalog to every Google Font up front.
 */
export async function provisionRemotionFontFamilies(input: {
  region: string;
  bucketName: string;
  serveUrl: string;
  baseManifestUrl: string;
  families: string[];
  concurrency?: number;
}): Promise<ProvisionedRemotionFontManifest> {
  const requestedFamilies = [...new Set(input.families.map((family) => {
    const canonical = GOOGLE_FONT_BY_NAME.get(family.trim().toLowerCase())?.fontFamily;
    if (!canonical) throw new Error(`Unsupported Google Font "${family}"`);
    return canonical;
  }))].sort((a, b) => a.localeCompare(b));

  const baseResponse = await fetch(input.baseManifestUrl, { cache: 'no-store' });
  if (!baseResponse.ok) {
    throw new Error(`Remotion base font manifest returned ${baseResponse.status}`);
  }
  const baseManifest = validateRemotionFontManifest(await baseResponse.json());
  const baseFamilies = new Set(baseManifest.faces.map((face) => face.family.toLowerCase()));
  const addedFamilies = requestedFamilies.filter((family) => !baseFamilies.has(family.toLowerCase()));
  if (addedFamilies.length === 0) {
    return {
      manifest: baseManifest,
      manifestUrl: input.baseManifestUrl,
      requestedFamilies,
      addedFamilies,
      uploadedAssetCount: 0,
      totalBytes: 0,
      reusedExistingManifest: true,
    };
  }

  const requestHash = createHash('sha256')
    .update(`${REMOTION_FONT_CATALOG_VERSION}\n${addedFamilies.join('\n')}`)
    .digest('hex');
  const manifestKey = `sites/_font-catalog/${REMOTION_FONT_CATALOG_VERSION}/manifests/${requestHash}.json`;
  const manifestUrl = publicObjectUrl(input.serveUrl, manifestKey);
  try {
    const existingResponse = await fetch(manifestUrl, { cache: 'no-store' });
    if (existingResponse.ok) {
      const existing = validateRemotionFontManifest(await existingResponse.json());
      const existingFamilies = new Set(existing.faces.map((face) => face.family.toLowerCase()));
      if (addedFamilies.every((family) => existingFamilies.has(family.toLowerCase()))) {
        return {
          manifest: existing,
          manifestUrl,
          requestedFamilies,
          addedFamilies,
          uploadedAssetCount: 0,
          totalBytes: 0,
          reusedExistingManifest: true,
        };
      }
    }
  } catch {
    // First use is expected to miss; continue with deterministic provisioning.
  }

  normalizeAwsCredentials();
  const s3 = new S3Client({ region: input.region });
  const sourceFaces = await collectRemotionFontSourceFacesForFamilies(addedFamilies);
  const sourceUrls = [...new Set(sourceFaces.map((face) => face.sourceUrl))];
  let uploadedAssetCount = 0;
  let totalBytes = 0;
  const assets = await mapWithConcurrency(
    sourceUrls,
    Math.max(1, input.concurrency || 12),
    async (sourceUrl) => {
      const bytes = await fetchFontBytes(sourceUrl);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const key = assetKey(sha256);
      if (!(await objectExists(s3, input.bucketName, key))) {
        await s3.send(new PutObjectCommand({
          Bucket: input.bucketName,
          Key: key,
          Body: bytes,
          ContentType: 'font/woff2',
          CacheControl: 'public, max-age=31536000, immutable',
          ACL: 'public-read',
        }));
        uploadedAssetCount++;
      }
      totalBytes += bytes.byteLength;
      return [sourceUrl, { sha256, url: publicObjectUrl(input.serveUrl, key) }] as const;
    },
  );
  const assetsBySource = new Map(assets);
  const dynamicFaces = sourceFaces.map(({ sourceUrl, ...face }) => {
    const asset = assetsBySource.get(sourceUrl);
    if (!asset) throw new Error(`Missing provisioned font asset for ${sourceUrl}`);
    return { ...face, ...asset };
  });
  const manifest: RemotionFontCatalogManifest = {
    version: REMOTION_FONT_CATALOG_VERSION,
    generatedAt: new Date().toISOString(),
    faces: [...baseManifest.faces, ...dynamicFaces],
  };
  validateRemotionFontManifest(manifest);
  await uploadPublicManifest(s3, input.bucketName, manifest, manifestKey, true);

  return {
    manifest,
    manifestUrl,
    requestedFamilies,
    addedFamilies,
    uploadedAssetCount,
    totalBytes,
    reusedExistingManifest: false,
  };
}
