import { resolveMediaMarkersInString } from '../media-markers';

interface PreparedAssetEvidence {
  assetId: string;
  mode: 'cutout' | 'edge-video';
  preparedUrl: string;
  status: 'processing' | 'ready' | 'failed';
  hasAlpha?: boolean;
  quality: {
    status: 'pass' | 'revise' | 'fail';
    contactSheetPath?: string;
    contactSheetUrl?: string;
  };
}

interface ManifestAsset {
  id: string;
  path: string;
  prepared?: PreparedAssetEvidence;
}

interface StoryboardScene {
  id: string;
  assetIds: string[];
  visualPlan?: {
    carrier: 'native' | 'plate' | 'cutout' | 'edge-video';
    primaryAssetId?: string;
  };
}

type PreparedAssetResolver = (assetId: string) => Promise<PreparedAssetEvidence | null>;

interface CompositionVisualAsset extends ManifestAsset {
  type: 'image' | 'video' | 'audio' | 'music' | 'font' | 'code';
  sceneIds: string[];
  status: 'ready' | 'missing' | 'failed';
  role?: 'hero' | 'support' | 'decoration';
}

interface CompositionDesign {
  code?: unknown;
  props?: unknown;
  editables?: unknown;
}

function serializedContains(value: unknown, expected: string): boolean {
  if (!expected) return false;
  if (typeof value === 'string') return value.includes(expected);
  try {
    return JSON.stringify(value).includes(expected);
  } catch {
    return false;
  }
}

function editableConsumesAsset(
  design: CompositionDesign,
  asset: CompositionVisualAsset,
  resolvedPath: string,
): boolean {
  if (!Array.isArray(design.editables) || !design.props || typeof design.props !== 'object') {
    return false;
  }
  const props = design.props as Record<string, unknown>;
  return design.editables.some((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false;
    const editable = candidate as Record<string, unknown>;
    if (editable.type !== asset.type || typeof editable.propKey !== 'string') return false;
    return serializedContains(props[editable.propKey], resolvedPath);
  });
}

export function assertCompositionConsumesVisualAssets(input: {
  storyboard: { scenes: StoryboardScene[] };
  manifest: { assets: CompositionVisualAsset[] };
  composition: { mode: 'editable' | 'atelier' | 'templated'; sceneIds: string[] };
  design: CompositionDesign;
  mediaUrls: string[];
}): void {
  const compositionSceneIds = new Set(input.composition.sceneIds);
  const assetsById = new Map(input.manifest.assets.map(asset => [asset.id, asset]));
  const requiredAssetIds = new Set<string>();

  for (const scene of input.storyboard.scenes) {
    if (!compositionSceneIds.has(scene.id)) continue;
    const carrier = scene.visualPlan?.carrier;
    for (const assetId of scene.assetIds) {
      const asset = assetsById.get(assetId);
      if (!asset || asset.status !== 'ready' || (asset.type !== 'image' && asset.type !== 'video')) continue;
      if (
        carrier === 'plate'
        || carrier === 'cutout'
        || carrier === 'edge-video'
        || scene.visualPlan?.primaryAssetId === assetId
        || asset.role === 'hero'
      ) {
        requiredAssetIds.add(assetId);
      }
    }
  }

  for (const asset of input.manifest.assets) {
    if (
      asset.status === 'ready'
      && asset.role === 'hero'
      && (asset.type === 'image' || asset.type === 'video')
      && asset.sceneIds.some(sceneId => compositionSceneIds.has(sceneId))
    ) {
      requiredAssetIds.add(asset.id);
    }
  }

  const issues: string[] = [];
  for (const assetId of requiredAssetIds) {
    const asset = assetsById.get(assetId)!;
    const resolvedPath = resolveMediaMarkersInString(asset.path, input.mediaUrls);
    const linkedScenes = asset.sceneIds.filter(sceneId => compositionSceneIds.has(sceneId));
    const sceneSummary = linkedScenes.length > 0 ? linkedScenes.join(', ') : 'the persisted Storyboard';

    if (/<<<media_\d+>>>/.test(resolvedPath)) {
      issues.push(`required ${asset.type} asset ${asset.id} (${asset.path}) could not be resolved from the Media Index`);
      continue;
    }
    if (
      !serializedContains(input.design.code, resolvedPath)
      && !serializedContains(input.design.props, resolvedPath)
    ) {
      issues.push(`required ${asset.type} asset ${asset.id} (${asset.path}) is absent from the saved Composition for ${sceneSummary}`);
      continue;
    }
    if (
      input.composition.mode === 'editable'
      && !editableConsumesAsset(input.design, asset, resolvedPath)
    ) {
      issues.push(`required ${asset.type} asset ${asset.id} (${asset.path}) is not exposed as an editable ${asset.type} in the saved Composition`);
    }
  }

  if (issues.length > 0) {
    throw new Error(
      `Composition asset consumption failed:\n${issues.map(issue => `- ${issue}`).join('\n')}\n`
      + 'Patch the same saved Composition to render the existing manifest assets with <Img>/<Video>; do not regenerate or replace them with procedural graphics.',
    );
  }
}

export function assertVisualAssetBridgeEvidence(input: {
  storyboard: { scenes: StoryboardScene[] };
  manifest: { assets: ManifestAsset[] };
}): void {
  const assetsById = new Map(input.manifest.assets.map(asset => [asset.id, asset]));
  const issues: string[] = [];

  for (const scene of input.storyboard.scenes) {
    const mode = scene.visualPlan?.carrier;
    if (mode !== 'cutout' && mode !== 'edge-video') continue;

    const primaryAssetId = scene.visualPlan?.primaryAssetId;
    if (!primaryAssetId) {
      issues.push(`Storyboard scene ${scene.id} uses ${mode} but visualPlan.primaryAssetId is missing`);
      continue;
    }
    if (!scene.assetIds.includes(primaryAssetId)) {
      issues.push(`Storyboard scene ${scene.id} primaryAssetId ${primaryAssetId} is not listed in scene.assetIds`);
      continue;
    }

    const asset = assetsById.get(primaryAssetId);
    if (!asset) {
      issues.push(`Assets manifest is missing primary ${mode} asset ${primaryAssetId}`);
      continue;
    }
    const prepared = asset.prepared;
    if (!prepared) {
      issues.push(`Asset ${primaryAssetId} must use prepare_visual_asset; ad hoc keying cannot satisfy a ${mode} visual plan`);
      continue;
    }
    if (prepared.assetId !== primaryAssetId) {
      issues.push(`Prepared asset identity ${prepared.assetId} does not match manifest asset ${primaryAssetId}`);
    }
    if (prepared.mode !== mode) {
      issues.push(`Prepared asset ${primaryAssetId} mode ${prepared.mode} does not match Storyboard carrier ${mode}`);
    }
    if (prepared.status !== 'ready' || prepared.quality.status !== 'pass') {
      issues.push(`Prepared asset ${primaryAssetId} has not passed Visual Asset Bridge QA`);
    }
    if (!prepared.quality.contactSheetPath || !prepared.quality.contactSheetUrl) {
      issues.push(`Prepared asset ${primaryAssetId} is missing its QA contact sheet`);
    }
    if (asset.path !== prepared.preparedUrl) {
      issues.push(`Manifest path for ${primaryAssetId} must be the Bridge preparedUrl`);
    }
    if (mode === 'cutout' && prepared.hasAlpha !== true) {
      issues.push(`Prepared cutout ${primaryAssetId} must have alpha`);
    }
  }

  if (issues.length > 0) {
    throw new Error(`Visual Asset Bridge evidence failed: ${issues.join('; ')}`);
  }
}

export async function assertPersistedVisualAssetBridgeEvidence(input: {
  storyboard: { scenes: StoryboardScene[] };
  manifest: { assets: ManifestAsset[] };
  resolvePreparedAsset: PreparedAssetResolver;
}): Promise<void> {
  assertVisualAssetBridgeEvidence(input);

  const assetsById = new Map(input.manifest.assets.map(asset => [asset.id, asset]));
  const requiredAssets = new Map<string, 'cutout' | 'edge-video'>();
  for (const scene of input.storyboard.scenes) {
    const mode = scene.visualPlan?.carrier;
    const assetId = scene.visualPlan?.primaryAssetId;
    if ((mode === 'cutout' || mode === 'edge-video') && assetId) {
      requiredAssets.set(assetId, mode);
    }
  }

  const issues: string[] = [];
  for (const [assetId, mode] of requiredAssets) {
    const manifestAsset = assetsById.get(assetId)!;
    const manifestPrepared = manifestAsset.prepared!;
    const persisted = await input.resolvePreparedAsset(assetId);
    if (!persisted) {
      issues.push(`Prepared asset ${assetId} has no persisted by-id record`);
      continue;
    }
    if (persisted.assetId !== assetId || persisted.mode !== mode) {
      issues.push(`Persisted asset ${assetId} identity or mode does not match the Storyboard`);
    }
    if (persisted.status !== 'ready' || persisted.quality.status !== 'pass') {
      issues.push(`Persisted asset ${assetId} has not passed Visual Asset Bridge QA`);
    }
    if (!persisted.quality.contactSheetPath || !persisted.quality.contactSheetUrl) {
      issues.push(`Persisted asset ${assetId} is missing its QA contact sheet`);
    }
    if (manifestAsset.path !== persisted.preparedUrl || manifestPrepared.preparedUrl !== persisted.preparedUrl) {
      issues.push(`Manifest asset ${assetId} does not reference the persisted Bridge output`);
    }
    if (
      manifestPrepared.quality.contactSheetPath !== persisted.quality.contactSheetPath
      || manifestPrepared.quality.contactSheetUrl !== persisted.quality.contactSheetUrl
    ) {
      issues.push(`Manifest asset ${assetId} QA evidence does not match the persisted Bridge record`);
    }
    if (mode === 'cutout' && persisted.hasAlpha !== true) {
      issues.push(`Persisted cutout ${assetId} must have alpha`);
    }
  }

  if (issues.length > 0) {
    throw new Error(`Persisted Visual Asset Bridge evidence failed: ${issues.join('; ')}`);
  }
}
