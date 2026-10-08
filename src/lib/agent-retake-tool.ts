import { createHash } from 'node:crypto';
import { tool } from 'ai';
import { z } from 'zod';
import { RETAKE_MODELS, DEFAULT_RETAKE_MODEL } from './video-retake-contract';
import { retakeInspectionScope, verifyRetakeInspection } from './video-retake-inspection';
import type { AgentContext } from './agent-tools';
import type { submitMcpVideo } from './billing/mcp-video';
import type { VideoSourceRange } from '@/types';

interface RetakeToolDependencies {
  ctx: AgentContext;
  serializeVideoSubmission: <T>(operation: () => Promise<T>) => Promise<T>;
  resolveSource: (ctx: AgentContext, index: number) => Promise<{ videoUrl?: string; error?: string; sourceRange?: VideoSourceRange }>;
  submit: typeof submitMcpVideo;
}

export function createInspectedRetakeVideoTool({ ctx, serializeVideoSubmission, resolveSource, submit }: RetakeToolDependencies) {
  return tool({
    description: 'Retake an INSPECTED interval of a ready video, automatically delivering the complete video with original audio/duration and footage outside the selection. Call inspect_retake for this exact source/selection/model first, view its frames, then supply its inspection_id plus a concrete source_observation. start/end use original-source seconds; prompt shot times use OUTPUT seconds from the inspection plan. The prompt is the complete final instruction passed directly to the provider without a creative wrapper. For requested multi-camera coverage, use what you actually saw to choose distinct camera setups and explicit CUT beats within outputSelection, advancing the same action. Keep observations separate from the requested changes. Do not copy the reference shot coverage when the user requests new angles. Default FAL H3 Max; Seedance 2.5 is available for close motion preservation/small edits. Interval 0.1–15s, source at most 120s; sources under 2s require Seedance. No screenshot relocation, run_code cutting, or second merge confirmation. Poll the returned task; never regenerate to retry delivery.',
    inputSchema: z.object({
      media_index: z.number().int().positive(),
      start: z.number().nonnegative(),
      end: z.number().positive(),
      prompt: z.string().min(1),
      inspection_id: z.string().optional().describe('Exact receipt returned by inspect_retake for this source, range and model. Required before any paid submission.'),
      source_observation: z.string().optional().describe('Describe the actual inspected subjects, action progression, camera coverage and boundary states. Do not substitute the requested changes for observed facts.'),
      model: z.enum(RETAKE_MODELS).default(DEFAULT_RETAKE_MODEL),
      request_id: z.string().uuid().optional(),
    }),
    execute: async ({ media_index, start, end, prompt, model, request_id, inspection_id, source_observation }) => serializeVideoSubmission(async () => {
      if (!ctx.userId || !ctx.projectId) return { success: false, message: 'Retake requires an authenticated project.' };
      const source = await resolveSource(ctx, media_index);
      if (!source.videoUrl) return { success: false, message: source.error ?? 'Select a ready video.' };
      if (source.sourceRange && (start < source.sourceRange.start_sec || end > source.sourceRange.end_sec)) {
        return { success: false, message: 'Retake interval must be within the visible original-source range.' };
      }
      if (!verifyRetakeInspection(inspection_id, retakeInspectionScope(ctx, source.videoUrl, start, end, model), process.env.SUPABASE_SERVICE_ROLE_KEY || '') || !source_observation || source_observation.trim().length < 24) {
        return { success: false, errorCode: 'retake_inspection_required', message: 'No provider was submitted. Call inspect_retake for this exact media_index/start/end/model, read the actual frames, and provide its inspection_id plus a concrete source_observation before writing the final prompt.' };
      }
      const hash = ctx.execution ? createHash('sha256').update(JSON.stringify([ctx.execution.runId, ctx.execution.inputEpoch, media_index, start, end, prompt, model])).digest('hex') : undefined;
      const stableId = hash ? `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}` : undefined;
      const result = await submit({ images: [], script: prompt, videoUrl: source.videoUrl,
        retake: { start, end }, videoModel: model, projectId: ctx.projectId, billingRequestId: request_id ?? stableId,
      }, { userId: ctx.userId, apiKeyId: null, toolName: 'retake_video' });
      const snapshotId = result.snapshotId ?? result.taskId?.replace(/^video-retake-/, '');
      if (result.success && result.taskId && snapshotId) {
        const row = await ctx.supabase?.from('snapshots').select('video_meta').eq('id', snapshotId).eq('project_id', ctx.projectId).maybeSingle();
        if (row?.data?.video_meta) ctx.pendingVideoSnapshot = { snapshotId, taskId: result.taskId, videoMeta: row.data.video_meta };
      }
      return result;
    }),
  });
}
