import { createHash } from 'node:crypto';
import { tool } from 'ai';
import { z } from 'zod';
import { RETAKE_MODELS, DEFAULT_RETAKE_MODEL } from './video-retake-contract';
import { retakeInspectionScope, verifyRetakeInspection, resolveRetakeInspectionReceipt, readRetakeInspectionClock } from './video-retake-inspection';
import { RETAKE_PROMPT_WRITING, retakeShotPlanError } from './video-retake-prompt-planning';
import type { AgentContext } from './agent-tools';
import type { submitMcpVideo } from './billing/mcp-video';
import type { VideoSourceRange } from '@/types';
import { bindRetakeReferences } from './video-retake-references';

interface RetakeToolDependencies {
  ctx: AgentContext;
  serializeVideoSubmission: <T>(operation: () => Promise<T>) => Promise<T>;
  resolveSource: (ctx: AgentContext, index: number) => Promise<{ videoUrl?: string; error?: string; sourceRange?: VideoSourceRange }>;
  submit: typeof submitMcpVideo;
}

export function createInspectedRetakeVideoTool({ ctx, serializeVideoSubmission, resolveSource, submit }: RetakeToolDependencies) {
  return tool({
    description: 'Retake an INSPECTED interval of a ready video, automatically delivering the complete video with original audio/duration and footage outside the selection. Call inspect_retake for this exact source/selection/model first, view its frames, then supply its inspection_id plus a concrete source_observation. start/end use original-source seconds. The prompt is the complete final instruction passed directly to the provider without a creative wrapper. Default FAL H3 Max; When Seedance is requested, prefer seedance-2.5-eco for lower-cost close motion preservation/small edits; use native seedance-2.5 only if explicitly requested. Interval 0.1–15s, source at most 120s; sources under 2s require Seedance. No screenshot relocation, run_code cutting, or second merge confirmation. Poll the returned task; never regenerate to retry delivery.\n' + RETAKE_PROMPT_WRITING,
    inputSchema: z.object({
      media_index: z.number().int().positive(),
      start: z.number().nonnegative(),
      end: z.number().positive(),
      prompt: z.string().min(1).describe('Final expanded prompt: requested visible change first, explicit output-time action/shot beats next, essential identity constraints last. Avoid copying the source synopsis or conflicting camera locks.'),
      shot_plan: z.array(z.object({ start: z.number().nonnegative(), end: z.number().positive(), instruction: z.string().min(1) })).min(1).max(8)
        .describe('Output-local beats matching the final prompt, covering exactly outputSelection from inspect_retake. Do NOT reset its start to zero. Choose beats from the requested temporal development; one continuous beat is enough for a persistent change. Beat count does not imply camera count.'),
      camera_change: z.boolean().default(false).describe('Declare whether the scene-informed plan changes camera coverage. Temporal content phases alone are false. This flag does not require generating an image.'),
      edit_mode: z.enum(['modify','replace']).describe('Choose from USER INTENT, independently of camera_change. modify edits inside the existing sequence (including multi-angle coverage, layers or added content) and retains original first/last compositions for continuity. replace discards the selected shot and creates a new shot: original first/last compositions need not match. Camera changes alone do not mean replacement. Seedance keeps its source-video edit route but must follow the same intent in the prompt.'),
      boundary_mode: z.enum(['exact','scene']).optional().describe('Legacy compatibility only. Omit for new requests: edit_mode determines endpoint policy (modify=exact, replace=scene). A conflicting override is rejected before submission.'),
      inspection_id: z.string().optional().describe('Exact receipt returned by inspect_retake for this source, range and model. Required before any paid submission.'),
      source_observation: z.string().optional().describe('Timestamped visible evidence: subject identity, original camera coverage, selected opening/middle/closing action states, travel direction/contact/occlusion, and uncertainty. Keep contextual boundary states separate. Do not substitute requested changes for observed facts.'),
      model: z.enum(RETAKE_MODELS).default(DEFAULT_RETAKE_MODEL),
      reference_media_indices: z.array(z.number().int().positive()).max(6).optional().describe('Timeline IMAGE references to incorporate into the edited scene, such as the supplied logo, product or ending card. Read their pixels first. Mention each as <<<media_N>>> in prompt. These are creative image references, not screenshot locators, source videos or camera middle keyframes.'),
      end_frame_media_index: z.number().int().positive().optional().describe('The ready IMAGE explicitly selected by the user as the final frame of the whole video. The selection must reach the video end. Pass that existing image directly, mention <<<media_N>>> in prompt, and transition into its actual composition. The provider makes the transition; delivery settles on the original image without regenerating its text/layout. Supported with H3 and Seedance. Do not generate a substitute image. A content reference to integrate inside a scene is reference_media_indices instead.'),
      middle_frame_media_index: z.number().int().positive().optional().describe('Optional H3 desired intermediate visual state, using a suitable ready image or a checked source-led generated image only when needed. Read its pixels and verify compatibility with this scene and action phase. This is native Image 3; using it is not mandatory for camera or content edits.'),
      middle_frame_time: z.number().positive().optional().describe('Output-local time for the optional H3 intermediate visual state, strictly between output endpoints. Match the chosen state to the scene, action and requested temporal development.'),
      request_id: z.string().uuid().optional(),
    }),
    execute: async ({ media_index, start, end, prompt, shot_plan, camera_change, edit_mode, boundary_mode: legacy_boundary_mode, model, request_id, inspection_id, source_observation, reference_media_indices = [], end_frame_media_index, middle_frame_media_index, middle_frame_time }) => serializeVideoSubmission(async () => {
      if (!ctx.userId || !ctx.projectId) return { success: false, message: 'Retake requires an authenticated project.' };
      const boundary_mode = edit_mode ? edit_mode === 'modify' ? 'exact' : 'scene' : legacy_boundary_mode ?? 'exact';
      if (edit_mode && legacy_boundary_mode && legacy_boundary_mode !== boundary_mode) return {success:false,errorCode:'retake_edit_mode_conflict',message:'No provider submitted. Choose edit_mode from user intent; omit boundary_mode. modify preserves endpoints, replace does not lock original endpoints.'};
      const source = await resolveSource(ctx, media_index);
      if (!source.videoUrl) return { success: false, message: source.error ?? 'Select a ready video.' };
      if (source.sourceRange && (start < source.sourceRange.start_sec || end > source.sourceRange.end_sec)) {
        return { success: false, message: 'Retake interval must be within the visible original-source range.' };
      }
      const receipt = await resolveRetakeInspectionReceipt(inspection_id,ctx,retakeInspectionScope(ctx, source.videoUrl, start, end, model));
      if (!verifyRetakeInspection(receipt, retakeInspectionScope(ctx, source.videoUrl, start, end, model), process.env.SUPABASE_SERVICE_ROLE_KEY || '') || !source_observation || source_observation.trim().length < 24) {
        return { success: false, errorCode: 'retake_inspection_required', message: 'No provider was submitted. Call inspect_retake for this exact media_index/start/end/model, read the actual frames, and provide its inspection_id plus a concrete source_observation before writing the final prompt.' };
      }
      const clock = readRetakeInspectionClock(receipt, retakeInspectionScope(ctx, source.videoUrl, start, end, model), process.env.SUPABASE_SERVICE_ROLE_KEY || '')
      if (!clock) return { success: false, errorCode: 'retake_inspection_required', message: 'No provider was submitted. Re-run inspect_retake to obtain the measured output clock before planning the edit.' }
      const timingError = retakeShotPlanError(shot_plan, prompt, clock.outputSelection)
      if (timingError) return { success: false, errorCode: 'retake_prompt_timing_invalid', message: `No provider was submitted. ${timingError} Required outputSelection: ${clock.outputSelection.start}–${clock.outputSelection.end}s. Correct shot_plan and prompt before submitting.` }
      // DualWriter can finish persisting an image after the generation tool
      // refreshed its in-memory index. Resolve the owned timeline row again
      // here instead of rejecting a stale same-turn data URL as a video.
      const imageRows = (reference_media_indices.length || end_frame_media_index || middle_frame_media_index) && ctx.supabase
        ? await ctx.supabase.from('snapshots').select('type,video_meta,image_url').eq('project_id',ctx.projectId).order('sort_order')
        : undefined;
      if (imageRows?.error) return {success:false,message:'Cannot verify the selected image references.'};
      const imageUrlFor = (index: number) => {
        const row = imageRows?.data?.[index - 1];
        if (index === media_index || row?.type === 'video' || row?.video_meta) return undefined;
        return typeof row?.image_url === 'string' && row.image_url.startsWith('http')
          ? row.image_url : ctx.snapshotImages[index - 1];
      };
      let middleFrame: {imageUrl:string;time:number} | undefined;
      if (boundary_mode === 'scene' && (middle_frame_media_index || end_frame_media_index)) return {success:false,message:'Scene continuity does not lock frames. Choose exact for native middle/final-image controls, or pass suitable images as creative references.'};
      if (middle_frame_media_index || middle_frame_time != null) {
        const imageUrl = imageUrlFor(middle_frame_media_index!);
        if (model !== 'fal-h3-max' || !imageUrl || !Number.isFinite(middle_frame_time) || middle_frame_time! <= 0 || Math.round(middle_frame_time!*24) >= clock.generationDuration*24-1) return {success:false,message:'Choose a ready H3 image keyframe and a time strictly inside its native output before video submission.'};
        middleFrame = {imageUrl,time:middle_frame_time!};
      }
      const creativeIndices = reference_media_indices.filter(index=>index!==end_frame_media_index);
      const referenceImages: string[] = [];
      for (const index of [...creativeIndices,...(end_frame_media_index ? [end_frame_media_index] : [])]) {
        const imageUrl = imageUrlFor(index);
        if (!imageUrl?.startsWith('http')) {
          return {success:false,message:`Reference @${index} must be a ready image, not a video or video poster.`};
        }
        if (index!==end_frame_media_index) referenceImages.push(imageUrl);
      }
      let providerPrompt: string;
      try {
        providerPrompt = bindRetakeReferences({prompt, model, sourceIndex:media_index,
          referenceIndices:creativeIndices, cameraChange:camera_change, boundaryMode:boundary_mode, middleIndex:middle_frame_media_index,endIndex:end_frame_media_index});
      } catch (error) { return {success:false,message:(error as Error).message}; }
      const endFrame = end_frame_media_index ? {imageUrl:imageUrlFor(end_frame_media_index)!} : undefined;
      const hash = ctx.execution ? createHash('sha256').update(JSON.stringify([ctx.execution.runId, ctx.execution.inputEpoch, media_index, start, end, providerPrompt, model, camera_change, boundary_mode ?? 'exact', edit_mode, middleFrame, ...(referenceImages.length ? [referenceImages] : []),...(endFrame ? [endFrame] : [])])).digest('hex') : undefined;
      const stableId = hash ? `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}` : undefined;
      const result = await submit({ images: referenceImages, script: providerPrompt, videoUrl: source.videoUrl,
        retake: { start, end, ...(edit_mode ? {editMode:edit_mode} : {}), ...(camera_change ? {cameraChange:true} : {}), ...(boundary_mode === 'scene' ? {boundaryMode:'scene' as const} : {}), ...(middleFrame ? {middleFrame} : {}),...(endFrame ? {endFrame} : {}) }, videoModel: model, projectId: ctx.projectId, billingRequestId: request_id ?? stableId,
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
