import { createHash } from 'crypto';
import path from 'path';
import sharp from 'sharp';
import { isDeepStrictEqual } from 'util';
import * as workspace from '../workspace';
import { preparedVisualAssetSchema, type PreparedVisualAsset, type VisualAssetMode } from './contracts';
import { inspectEdgeVideoBuffer } from './edge-video';
import { prepareChromaKeyCutout, prepareNativeAlphaCutout, renderCutoutContactSheet } from './image-cutout';

type SupabaseClient = any;

export interface PrepareVisualAssetInput {
  projectId: string;
  userId: string;
  supabase: SupabaseClient;
  sourceUrl: string;
  mode: VisualAssetMode;
  assetId?: string;
  role?: 'hero' | 'support' | 'decoration';
  sourceSnapshotId?: string;
  keyColor?: string;
  targetBackground?: string;
  forceRefresh?: boolean;
}

export interface PrepareVisualAssetResult {
  asset: PreparedVisualAsset;
  cached: boolean;
}

interface DownloadedMedia {
  buffer: Buffer;
  contentType: string;
}

interface VisualAssetWorkspaceInput {
  projectId: string;
  userId: string;
  supabase: SupabaseClient;
}

function cleanAssetId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'visual-asset';
}

export function preparedVisualAssetPointerPath(projectId: string, assetId: string): string {
  return `${projectId}/visual-assets/by-id/${cleanAssetId(assetId)}.json`;
}

function extensionForContentType(contentType: string, sourceUrl: string): string {
  if (contentType.includes('quicktime')) return '.mov';
  if (contentType.includes('webm')) return '.webm';
  if (contentType.includes('mp4')) return '.mp4';
  const extension = path.extname(sourceUrl.split('?')[0] || '').toLowerCase();
  return ['.mp4', '.mov', '.webm', '.m4v'].includes(extension) ? extension : '.mp4';
}

function imageExtensionForContentType(contentType: string, sourceUrl: string): string {
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('avif')) return '.avif';
  if (contentType.includes('gif')) return '.gif';
  const extension = path.extname(sourceUrl.split('?')[0] || '').toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif'].includes(extension) ? extension : '.img';
}

async function downloadMedia(sourceUrl: string): Promise<DownloadedMedia> {
  if (sourceUrl.startsWith('data:')) {
    const match = sourceUrl.match(/^data:([^;,]+);base64,([\s\S]+)$/);
    if (!match) throw new Error('Visual asset data URL must be base64 encoded');
    return { contentType: match[1], buffer: Buffer.from(match[2], 'base64') };
  }
  if (!/^https?:\/\//i.test(sourceUrl)) throw new Error('Visual asset source must be a public URL or data URL');
  const response = await fetch(sourceUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to download visual asset: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error('Downloaded visual asset is empty');
  if (buffer.length > 250 * 1024 * 1024) throw new Error('Visual asset exceeds the 250MB preparation limit');
  return { buffer, contentType: response.headers.get('content-type') || 'application/octet-stream' };
}

function cacheKeyFor(input: PrepareVisualAssetInput, media: DownloadedMedia): string {
  return createHash('sha256')
    .update('visual-asset-bridge-v4\0')
    .update(input.mode)
    .update('\0')
    .update(input.keyColor || '')
    .update('\0')
    .update(input.targetBackground || '')
    .update('\0')
    .update(media.buffer)
    .digest('hex')
    .slice(0, 24);
}

async function requireWrite(
  filePath: string,
  content: string | Buffer,
  contentType: string,
  input: VisualAssetWorkspaceInput,
): Promise<string> {
  const result = await workspace.writeFile(filePath, content, input.supabase, input.userId, contentType);
  if (!result.success || !result.storageUrl) throw new Error(`Failed to write ${filePath}: ${result.error || 'missing storage URL'}`);
  return result.storageUrl;
}

async function readCachedMetadata(
  filePath: string,
  input: VisualAssetWorkspaceInput,
): Promise<PreparedVisualAsset | null> {
  const cached = await workspace.readFile(filePath, input.supabase, input.userId);
  if (!cached?.content) return null;
  try {
    return preparedVisualAssetSchema.parse(JSON.parse(cached.content));
  } catch {
    return null;
  }
}

async function writeAssetPointer(
  asset: PreparedVisualAsset,
  input: VisualAssetWorkspaceInput,
): Promise<void> {
  const pointerPath = preparedVisualAssetPointerPath(input.projectId, asset.assetId);
  const current = await readCachedMetadata(pointerPath, input);
  if (current && isDeepStrictEqual(current, asset)) return;
  await requireWrite(pointerPath, JSON.stringify(asset, null, 2), 'application/json', input);
}

export async function resolvePreparedVisualAssetById(
  input: VisualAssetWorkspaceInput & { assetId: string },
): Promise<PreparedVisualAsset | null> {
  return readCachedMetadata(preparedVisualAssetPointerPath(input.projectId, input.assetId), input);
}

export async function prepareVisualAsset(input: PrepareVisualAssetInput): Promise<PrepareVisualAssetResult> {
  const media = await downloadMedia(input.sourceUrl);
  const cacheKey = cacheKeyFor(input, media);
  const assetId = cleanAssetId(input.assetId || `${input.mode}-${cacheKey.slice(0, 10)}`);
  const root = `${input.projectId}/visual-assets/${input.mode}/${cacheKey}`;
  const metadataPath = `${root}/asset.json`;
  if (!input.forceRefresh) {
    const cached = await readCachedMetadata(metadataPath, input);
    if (cached) {
      await writeAssetPointer(cached, input);
      return { asset: cached, cached: true };
    }
  }

  const sourceExtension = input.mode === 'cutout'
    ? imageExtensionForContentType(media.contentType, input.sourceUrl)
    : extensionForContentType(media.contentType, input.sourceUrl);
  const sourceWorkspacePath = `${root}/source${sourceExtension}`;
  const sourceWorkspaceUrl = await requireWrite(
    sourceWorkspacePath,
    media.buffer,
    media.contentType,
    input,
  );
  const sourceRecordUrl = input.sourceUrl.startsWith('data:') ? sourceWorkspaceUrl : input.sourceUrl;

  let asset: PreparedVisualAsset;
  if (input.mode === 'cutout') {
    if (!media.contentType.startsWith('image/') && media.contentType !== 'application/octet-stream') {
      throw new Error(`cutout mode requires an image, received ${media.contentType}`);
    }
    const metadata = await sharp(media.buffer, { failOn: 'error' }).metadata();
    const nativeCandidate = metadata.hasAlpha
      ? await prepareNativeAlphaCutout(media.buffer)
      : null;
    // Any real non-opaque pixel is provider-authored alpha and must never be
    // reinterpreted as a chroma plate. The 8% background threshold remains a
    // QA signal inside prepareNativeAlphaCutout, not a routing threshold.
    const useNativeAlpha = Boolean(
      nativeCandidate
      && (nativeCandidate.quality.metrics?.nonOpaqueRatio ?? 0) > 0,
    );
    const cutout = useNativeAlpha
      ? nativeCandidate!
      : await prepareChromaKeyCutout(media.buffer, { keyColor: input.keyColor });
    const contactSheet = await renderCutoutContactSheet(cutout.png);
    const workspacePath = `${root}/${assetId}.png`;
    const contactSheetPath = `${root}/${assetId}-qa.png`;
    const [preparedUrl, contactSheetUrl] = await Promise.all([
      requireWrite(workspacePath, cutout.png, 'image/png', input),
      requireWrite(contactSheetPath, contactSheet, 'image/png', input),
    ]);
    asset = {
      version: '1.0',
      assetId,
      role: input.role || 'support',
      kind: 'image',
      mode: 'cutout',
      sourceUrl: sourceRecordUrl,
      sourceWorkspacePath,
      sourceWorkspaceUrl,
      preparedUrl,
      workspacePath,
      cacheKey,
      status: cutout.quality.status === 'pass' ? 'ready' : 'failed',
      sourceSnapshotId: input.sourceSnapshotId,
      hasAlpha: true,
      alphaSource: useNativeAlpha ? 'native' : 'chroma-key',
      subjectBox: cutout.subjectBox,
      safeArea: cutout.safeArea,
      edgePalette: useNativeAlpha ? undefined : [(cutout as Awaited<ReturnType<typeof prepareChromaKeyCutout>>).keyColor],
      width: cutout.width,
      height: cutout.height,
      quality: {
        ...cutout.quality,
        contactSheetPath,
        contactSheetUrl,
      },
    };
  } else {
    if (!media.contentType.startsWith('video/') && media.contentType !== 'application/octet-stream') {
      throw new Error(`edge-video mode requires a video, received ${media.contentType}`);
    }
    const inspection = await inspectEdgeVideoBuffer(media.buffer, input.targetBackground);
    const extension = extensionForContentType(media.contentType, input.sourceUrl);
    const workspacePath = `${root}/${assetId}${extension}`;
    const contactSheetPath = `${root}/${assetId}-qa.jpg`;
    const [preparedUrl, contactSheetUrl] = await Promise.all([
      requireWrite(workspacePath, media.buffer, media.contentType.startsWith('video/') ? media.contentType : 'video/mp4', input),
      requireWrite(contactSheetPath, inspection.contactSheet, 'image/jpeg', input),
    ]);
    asset = {
      version: '1.0',
      assetId,
      role: input.role || 'hero',
      kind: 'video',
      mode: 'edge-video',
      sourceUrl: sourceRecordUrl,
      sourceWorkspacePath,
      sourceWorkspaceUrl,
      preparedUrl,
      workspacePath,
      cacheKey,
      status: inspection.quality.status === 'pass' ? 'ready' : 'failed',
      sourceSnapshotId: input.sourceSnapshotId,
      edgePalette: inspection.edgePalette,
      targetBackground: inspection.targetBackground,
      recommendedFeatherPx: inspection.recommendedFeatherPx,
      width: inspection.width,
      height: inspection.height,
      durationSeconds: inspection.durationSeconds,
      quality: {
        ...inspection.quality,
        contactSheetPath,
        contactSheetUrl,
      },
    };
  }

  preparedVisualAssetSchema.parse(asset);
  await Promise.all([
    requireWrite(metadataPath, JSON.stringify(asset, null, 2), 'application/json', input),
    writeAssetPointer(asset, input),
  ]);
  workspace.clearWorkspaceCache();
  return { asset, cached: false };
}
