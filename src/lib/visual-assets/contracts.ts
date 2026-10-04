import { z } from 'zod';

export const visualAssetModeSchema = z.enum(['cutout', 'edge-video']);
export type VisualAssetMode = z.infer<typeof visualAssetModeSchema>;

export const visualCarrierSchema = z.enum(['native', 'plate', 'cutout', 'edge-video']);
export type VisualCarrier = z.infer<typeof visualCarrierSchema>;

export const shotScaleSchema = z.enum(['extreme-close', 'close', 'medium', 'wide']);
export type ShotScale = z.infer<typeof shotScaleSchema>;

export const pixelRectSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type PixelRect = z.infer<typeof pixelRectSchema>;

export const sceneVisualPlanSchema = z.object({
  carrier: visualCarrierSchema,
  primaryAssetId: z.string().min(1).optional(),
  subject: z.string().min(1),
  shotScale: shotScaleSchema,
  compositionIntent: z.string().min(1),
  backgroundIntent: z.string().min(1),
  motionIntent: z.string().min(1),
  integrationIntent: z.string().min(1).optional(),
});
export type SceneVisualPlan = z.infer<typeof sceneVisualPlanSchema>;

export const visualAssetQualitySchema = z.object({
  status: z.enum(['pass', 'revise', 'fail']),
  contactSheetPath: z.string().min(1).optional(),
  contactSheetUrl: z.string().url().optional(),
  issues: z.array(z.string()),
  metrics: z.record(z.string(), z.number()).optional(),
});
export type VisualAssetQuality = z.infer<typeof visualAssetQualitySchema>;

export const preparedVisualAssetSchema = z.object({
  version: z.literal('1.0'),
  assetId: z.string().min(1),
  role: z.enum(['hero', 'support', 'decoration']),
  kind: z.enum(['image', 'video']),
  mode: visualAssetModeSchema,
  sourceUrl: z.string().min(1),
  sourceWorkspacePath: z.string().min(1),
  sourceWorkspaceUrl: z.string().url(),
  preparedUrl: z.string().min(1),
  workspacePath: z.string().min(1),
  cacheKey: z.string().min(8),
  status: z.enum(['processing', 'ready', 'failed']),
  sourceSnapshotId: z.string().min(1).optional(),
  hasAlpha: z.boolean().optional(),
  alphaSource: z.enum(['native', 'chroma-key']).optional(),
  subjectBox: pixelRectSchema.optional(),
  safeArea: pixelRectSchema.optional(),
  edgePalette: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).optional(),
  targetBackground: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  recommendedFeatherPx: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSeconds: z.number().positive().optional(),
  quality: visualAssetQualitySchema,
});
export type PreparedVisualAsset = z.infer<typeof preparedVisualAssetSchema>;
