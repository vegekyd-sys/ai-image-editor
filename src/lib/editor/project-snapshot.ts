import type { DbSnapshot, DesignPayload, Snapshot } from '@/types'
import { VIDEO_PLACEHOLDER_IMAGE } from './timeline-derivations'

export interface OpeningLayerProject {
  projectId: string
  ownerId: string
  isPublic: boolean
  title: string
  timelineVersion: number
  snapshots: Snapshot[]
  snapshotId: string
  designPath: string
  design: DesignPayload
}

export function restoreProjectSnapshot(s: DbSnapshot): Snapshot {
  const imageUrl = s.image_url || (s.type === 'video' ? VIDEO_PLACEHOLDER_IMAGE : '')
  return {
    id: s.id,
    image: imageUrl,
    tips: (Array.isArray(s.tips) ? s.tips : []).map(t => ({
      ...t,
      previewStatus: t.previewImage ? 'done' as const
        : t.editPrompt ? 'none' as const : undefined,
    })),
    messageId: s.message_id || '',
    imageUrl: imageUrl || undefined,
    description: s.description ?? undefined,
    ...(s.type ? { type: s.type as Snapshot['type'] } : {}),
    ...(s.design_path ? { designPath: s.design_path } : {}),
    ...(s.video_meta ? { videoMeta: s.video_meta } : {}),
    ...(s.metadata ? { metadata: s.metadata } : {}),
  }
}
