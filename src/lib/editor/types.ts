import type { VideoModel, VideoResolution } from '@/types'

export interface AnimationState {
  imageUrls: string[]
  prompt: string
  userHint: string
  taskId: string | null
  snapshotId?: string | null
  videoUrl: string | null
  status: 'idle' | 'generating_prompt' | 'ready' | 'submitting' | 'polling' | 'done' | 'error'
  error: string | null
  duration: number | null  // null = smart mode (API decides 3-15s)
  pollSeconds: number
  videoModel: VideoModel
  videoResolution?: VideoResolution
}

export interface HeroAnim {
  src: string;
  fromRect: { l: number; t: number; w: number; h: number };
  toRect:   { l: number; t: number; w: number; h: number };
  fromImg:  { l: number; t: number; w: number; h: number };
  toImg:    { l: number; t: number; w: number; h: number };
  fromRadius: string;
  toRadius: string;
  active: boolean;
  objectCover?: boolean;
}
