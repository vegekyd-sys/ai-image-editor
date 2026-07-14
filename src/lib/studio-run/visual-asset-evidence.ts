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
