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

/** Older published compositions sometimes point their poster at a labeled QA sheet. */
export function isDesignContactSheet(url?: string | null): boolean {
  return !!url && /\/drafts\/design-contact-sheet-\d+\.jpg(?:[?#]|$)/i.test(url)
}

export function restoreDesignPoster(snapshot: Snapshot): Snapshot {
  if ((snapshot.designPath || snapshot.design) &&
      (isDesignContactSheet(snapshot.imageUrl) || isDesignContactSheet(snapshot.image))) {
    return { ...snapshot, image: '', imageUrl: undefined, legacyContactSheetPoster: true }
  }
  return snapshot
}

export function restoreProjectSnapshot(s: DbSnapshot): Snapshot {
  const imageUrl = s.image_url || (s.type === 'video' ? VIDEO_PLACEHOLDER_IMAGE : '')
  return restoreDesignPoster({
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
  })
}
