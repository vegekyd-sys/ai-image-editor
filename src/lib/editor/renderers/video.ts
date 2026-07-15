import type { Snapshot } from '@/types';
import type { RendererContext, CanvasOverrides } from '../renderer-registry';

export const videoMatcher = {
  type: 'video' as const,

  matchesSnapshot(snap: Snapshot, ctx: RendererContext): boolean {
    // v2: snapshot has type='video'
    if (ctx.timelineVersion >= 2 && !ctx.isAtDraftSlot && snap.type === 'video') return true;
    return false;
  },

  getCanvasProps(snap: Snapshot, ctx: RendererContext): CanvasOverrides {
    if (ctx.timelineVersion >= 2) {
      return {
        isVideoEntry: true,
        videoUrl: snap.videoMeta?.videoUrl ?? null,
        videoProcessing: snap.videoMeta?.status === 'processing',
        videoFailed: snap.videoMeta?.status === 'failed',
        videoTaskId: snap.videoMeta?.taskId ?? null,
        videoPosterImage: snap.image || snap.imageUrl,
      };
    }
    // v1: props come from selected animation
    const currentVideo = (ctx.selectedVideoId && ctx.animations.find(a => a.id === ctx.selectedVideoId))
      || ctx.animations.find(a => a.status === 'completed' && !!a.videoUrl);
    return {
      isVideoEntry: true,
      videoUrl: currentVideo?.videoUrl ?? null,
      videoProcessing: !currentVideo?.videoUrl && ctx.animations.some(a => a.status === 'processing'),
      videoFailed: false,
      videoTaskId: currentVideo?.taskId ?? null,
      videoPosterImage: undefined,
    };
  },
};
