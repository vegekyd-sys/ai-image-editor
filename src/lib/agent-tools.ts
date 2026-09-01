import { tool } from 'ai';
import { after } from 'next/server';
import { z } from 'zod';
import sharp from 'sharp';
import { validateDesign } from './design-harness';
import type { ImageBackground, ModelId } from './models/types';
import { editImage } from './skills/edit-image';
import { rotateCamera } from './skills/rotate-camera';
import { createVideo } from './skills/create-video';
import { estimateVideoProviderCostUsd, getRequiredVideoCredits, normalizeVideoModelId, resolveAgentVideoSelection, resolvePersistedVideoDuration, resolveVideoGenerationRoute, resolveVideoOutputDuration, supportsNativeTextToVideo, validateVideoModelRequest } from './video-model-capabilities';
import {
  deductFixedCredits,
  isInsufficientCreditsError,
  refundCredits,
  requireCredits,
} from './billing/credits';
import { deductSeedAudioCredits } from './billing/seed-audio';
import { createAudio, SEED_AUDIO_AGENT_PROMPT_MAX_CHARS } from './skills/create-audio';
import { formatAudioCapabilitiesForAgent } from './audio-model-capabilities';
import {
  isAsrTranscriptCacheCompatible,
  transcribeWithVolcengineAsr,
  type VolcengineAsrTranscript,
} from './volcengine-asr';
import {
  formatInlineWordTimingCoverageNotice,
  formatTranscriptForModel,
} from './transcript-inline';
import {
  buildNarrationCueSheet,
  normalizeExpectedNarrationSections,
  type ExpectedNarrationSection,
} from './narration-cues';
import { prepareVisualAsset, resolvePreparedVisualAssetById } from './visual-assets/bridge';
import generateImageToolPrompt from './prompts/generate_image_tool.md';
import { normalizeGenerateImageMediaIndex } from './generate-image-input';
import type { DesignPayload, VideoMeta, VideoModel, VideoSourceRange } from '@/types';
import { isPermanentUrl, toPublicStorageUrl, uploadVideo } from '@/lib/supabase/storage';
import { formatAspectRatio } from './media-aspect';
import { filterWorkspaceFilesForAgentScope } from './agent-workspace-scope';
import { normalizeCompositionAnimation } from './composition-duration';
import { createRemotionExportJob } from '@/lib/remotion-export';
import { VIDEO_PLACEHOLDER_IMAGE } from '@/lib/editor/timeline-derivations';
import {
  rebuildAgentSnapshotUrls,
  type AgentSnapshotIndexRow,
} from './agent-media-index';
import { mergePatchProps } from './patch-props';
import { persistCompositionDraft } from './composition-draft';
import {
  assembleCompositionParts,
  COMPOSITION_PART_FILENAME_PATTERN,
  COMPOSITION_PART_MAX_CHARS,
  compositionPartsPrefix,
} from './composition-parts';
import { compileSavedCompositionPart } from './composition-workspace-runner';
import { resolveMediaMarkersInString, resolveMediaMarkersInValue } from './media-markers';
import { isDirectRemotionCompositionSource } from './remotion-code-normalization';
import {
  type AgentModelRuntime,
} from './agent-model-runtime';
import { resolveAnalyzeImageProvider } from './agent-image-analysis';
import {
  AgentExecutionStore,
  normalizeExecutionSnapshot,
  type DurableExecutionRef,
} from './agent-execution';
import {
  buildStudioCreativeArtifacts,
  studioCreativePacketSchema,
} from './studio-run/creative-packet';
import {
  getReplyLanguageInstruction,
  normalizeLocale,
  translate,
} from './locales';
import { stableDraftPromotionSnapshotId } from './draft-promotion';
import { sourceRangeFromVideoMeta } from './media-source-range';
import { materializeSeedAudioReference } from './seed-audio-reference';
import { resolveAudioRefs } from './audio-reference-resolver';

const MAX_VIDEO_DIMENSION_PROBE_BYTES = 220 * 1024 * 1024;

function runRemotionExportAfterResponse(jobId: string) {
  after(async () => {
    try {
      const { runRemotionExportJob } = await import('@/lib/remotion-export');
      await runRemotionExportJob(jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('already rendering')) {
        console.error(`[agent] Remotion export worker failed for ${jobId}:`, error);
      }
    }
  });
}

function runGoogleOmniVideoSnapshotAfterResponse(options: {
  userId: string;
  projectId: string;
  snapshotId: string;
  taskId: string;
  videoMeta: VideoMeta;
  createVideoInput: Parameters<typeof createVideo>[0];
}) {
  after(async () => {
    const { getSupabaseAdmin } = await import('@/lib/supabase/service');
    const admin = getSupabaseAdmin();
    console.log(`[google-omni] snapshot job started: ${options.snapshotId} (${options.taskId})`);
    try {
      const result = await createVideo(options.createVideoInput);
      if (!result.success || !result.videoUrl) {
        const { handleVideoFailure } = await import('@/lib/video-lifecycle');
        console.error(`[google-omni] snapshot job failed before output: ${options.snapshotId}: ${result.message || 'missing video URL'}`);
        await handleVideoFailure(
          options.snapshotId,
          result.message || 'Google Omni video generation failed',
        );
        return;
      }

      const { probeMP4Dimensions } = await import('@/lib/mp4-probe');
      const providerVideoUrl = result.videoUrl;
      const buffer = providerVideoUrl.startsWith('https://generativelanguage.googleapis.com/') || providerVideoUrl.startsWith('data:')
        ? await (await import('@/lib/google-omni-video')).fetchGoogleOmniVideoBytes(providerVideoUrl)
        : new Uint8Array(await (await fetch(providerVideoUrl)).arrayBuffer());
      const dims = probeMP4Dimensions(buffer);
      const permanentUrl = await uploadVideo(admin, options.userId, options.projectId, options.snapshotId, buffer);
      const finalUrl = permanentUrl || providerVideoUrl;
      const finalMeta: VideoMeta = {
        ...options.videoMeta,
        taskId: result.taskId || options.taskId,
        status: 'completed',
        videoUrl: finalUrl,
        providerUrl: providerVideoUrl,
        videoPath: permanentUrl ? `${options.userId}/${options.projectId}/videos/${options.snapshotId}.mp4` : options.videoMeta.videoPath,
        ...(dims?.width ? { width: dims.width } : {}),
        ...(dims?.height ? { height: dims.height } : {}),
      };
      await admin.from('snapshots').update({ video_meta: finalMeta }).eq('id', options.snapshotId);
      console.log(`[google-omni] snapshot job completed: ${options.snapshotId} (${result.taskId || options.taskId})`);

      if (permanentUrl) {
        try {
          const { extractVideoPoster } = await import('@/lib/video-poster');
          const posterBuffer = await extractVideoPoster(permanentUrl);
          const posterPath = `${options.userId}/${options.projectId}/posters/${options.snapshotId}.jpg`;
          const { error: posterErr } = await admin.storage.from('images').upload(posterPath, posterBuffer, { contentType: 'image/jpeg', upsert: true });
          if (!posterErr) {
            const { data: urlData } = admin.storage.from('images').getPublicUrl(posterPath);
            if (urlData?.publicUrl) {
              await admin.from('snapshots').update({ image_url: urlData.publicUrl }).eq('id', options.snapshotId);
            }
          }
        } catch (posterErr) {
          console.warn('[google-omni] poster extraction failed:', posterErr);
        }
      }
    } catch (error) {
      console.error(`[google-omni] snapshot job crashed: ${options.snapshotId}:`, error);
      const { handleVideoFailure } = await import('@/lib/video-lifecycle');
      try {
        await handleVideoFailure(
          options.snapshotId,
          error instanceof Error ? error.message : String(error),
        );
      } catch (lifecycleError) {
        console.error(`[google-omni] failed to persist terminal state: ${options.snapshotId}:`, lifecycleError);
        throw lifecycleError;
      }
    }
  });
}

function modelFileContent(base64Data: string, mediaType: string) {
  return {
    type: 'file' as const,
    data: { type: 'data' as const, data: base64Data },
    mediaType,
  };
}

// Agent tool registry and tool-side execution dependencies.
// The public runner remains in agent.ts.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentContext {
  currentImage: string;       // base64 data URL – updated after each generation
  referenceImages?: string[]; // base64 data URLs – user-uploaded references (up to 3)
  projectId: string;

  supabase?: any;             // Supabase client for workspace operations
  userId?: string;            // Current user ID for workspace
  /** Images generated during this run (base64). Streamed to frontend out-of-band. */
  generatedImages: string[];
  /** Background contract for the most recently generated image. */
  lastImageBackground?: ImageBackground;
  /** Which model was used for the last image generation */
  lastUsedModel?: ModelId;
  /** User's preferred model override */
  preferredModel?: ModelId;
  /** Supabase Storage URLs for animation (set when in animation mode) */
  animationImageUrls?: string[];
  /** User/app selected video model. Defaults to seedance-fast when absent. */
  videoModel?: VideoModel;
  /** User/app selected video resolution. Defaults to auto. */
  videoResolution?: import('@/types').VideoResolution;
  /** True when the app video selector is in automatic mode. */
  videoAuto?: boolean;
  /** Project-scoped audio references imported through CLI/app music infrastructure. Not Timeline Media Index. */
  audioAttachments?: AudioAttachment[];
  /** Task ID + prompt set by generate_animation tool, emitted as animation_task event (v1) */
  // Legacy v1 fields — no longer set by generate_animation, but kept for SSE event type compat
  animationTaskId?: string;
  animationPrompt?: string;
  animationImageUrls_?: string[];
  animationModel?: string;
  /** Video snapshot pending emit (v2) */
  pendingVideoSnapshot?: { snapshotId: string; taskId: string; videoMeta: import('@/types').VideoMeta };
  pendingVideoSnapshots?: { snapshotId: string; taskId: string; videoMeta: import('@/types').VideoMeta }[];
  /** Workspace image snapshots already inserted into DB; emit so live timeline matches refresh state. */
  pendingImageSnapshots?: { snapshotId: string; imageUrl: string; description?: string }[];
  /** All snapshot images (URL preferred, base64 fallback). index 0 = <<<media_1>>> */
  snapshotImages: string[];
  /** Media Index entries explicitly introduced or referenced by the current user turn. */
  explicitMediaIndices: number[];
  /** 0-based index of the snapshot the user is currently viewing */
  currentSnapshotIndex: number;
  /** NSFW flag — set when Gemini refuses content. All subsequent calls skip Gemini. */
  isNsfw?: boolean;
  /** Timeline version: 1 = legacy (project_animations), 2 = video-in-timeline (snapshots) */
  timelineVersion?: number;
  /** Published or autosaved composition used as the source for this turn. */
  currentDesignPath?: string;
  /** Export attempts for an unchanged composition during this agent turn. */
  materializeAttempts?: Map<string, number>;
  /** Seedance image URLs rejected during this turn; unchanged resubmission is blocked. */
  invalidVideoImageUrls?: Set<string>;
  execution?: DurableExecutionRef;
  /** The sole model-facing Agent Run that owns nested workflow invocations. */
  agentRunId?: string;
}

interface StudioRunCheckpoint {
  studioRunId?: string;
  studioRunStage?: string;
  studioRunStatePath?: string;
  deliveryPromise?: { width: number; height: number };
}

function studioCompositionPromiseError(
  checkpoint: StudioRunCheckpoint,
  design: { width?: unknown; height?: unknown },
): string | undefined {
  if (!['composition', 'review'].includes(checkpoint.studioRunStage || '') || !checkpoint.deliveryPromise) return;
  const width = Number(design.width);
  const height = Number(design.height);
  if (width === checkpoint.deliveryPromise.width && height === checkpoint.deliveryPromise.height) return;
  return `Studio Composition must keep the locked delivery resolution ${checkpoint.deliveryPromise.width}x${checkpoint.deliveryPromise.height}; received ${width || 'missing'}x${height || 'missing'}. Reuse the Brief/Proposal delivery promise before previewing or publishing.`;
}

export interface StreamedCodeCheckpoint {
  streamedCodePath?: string;
  streamedCodeChars?: number;
  streamedCodeTargetPath?: string;
}

export async function getStudioRunCheckpoint(ctx: AgentContext): Promise<StudioRunCheckpoint> {
  if (!ctx.supabase || !ctx.userId || !ctx.projectId || !ctx.agentRunId) return {};
  try {
    const studio = await import('./studio-run');
    const store = new studio.WorkspaceStudioRunStore(ctx.supabase, ctx.userId);
    const run = (await store.listRuns(ctx.projectId)).find(candidate => (
      candidate.agentRunId === ctx.agentRunId
    ));
    if (!run || !run.currentStage || run.status !== 'running') return {};
    return {
      studioRunId: run.id,
      studioRunStage: run.currentStage,
      studioRunStatePath: studio.studioRunStatePath(run.projectId, run.id),
      deliveryPromise: {
        width: run.deliveryPromise.width,
        height: run.deliveryPromise.height,
      },
    };
  } catch (error) {
    console.warn('[agent] failed to resolve Studio Run recovery checkpoint:', error);
    return {};
  }
}

export interface AudioAttachment {
  audioUrl: string;
  title?: string;
  duration?: number;
  trackIndex?: number;
}

interface WorkspaceMediaOutputDraft {
  path?: string;
  storageUrl: string;
  contentType: string;
  description?: string;
  duration?: number | null;
  width?: number;
  height?: number;
  updatedAt?: string;
}

export type AgentStreamEvent =
  | { type: 'status'; text: string }
  | { type: 'content'; text: string }
  | { type: 'new_turn' }  // signals start of a new assistant response (after tool result)
  | { type: 'image'; image: string; usedModel?: string; snapshotId?: string; imageUrl?: string; description?: string; metadata?: import('@/types').PhotoMetadata }
  | { type: 'tool_call'; tool: string; input: Record<string, unknown>; displayInput?: Record<string, unknown>; images?: string[]; toolCallId?: string; step?: number }
  | { type: 'tool_result'; tool: string; toolCallId?: string; step?: number; output?: unknown }
  | { type: 'animation_task'; taskId: string; prompt: string; imageUrls?: string[]; model?: string }
  | { type: 'video_snapshot'; snapshotId: string; taskId: string; videoMeta: import('@/types').VideoMeta }
  | { type: 'image_analyzed'; imageIndex: number }  // emitted after analyze_image completes (1-based)
  | { type: 'capture_frame'; frame: number; uploadPath: string; captureId: string }  // request frontend to capture a frame via renderStillOnWeb
  | { type: 'preview_frame_captured'; workspaceUrl: string }  // emitted after preview_frame completes — CUI shows inline
  | { type: 'nsfw_detected' }  // emitted when Gemini blocks content — session switches to Qwen-only
  | { type: 'reasoning_start' }           // new thinking round started
  | { type: 'reasoning'; text: string }  // extended thinking delta
  | { type: 'coding'; text: string }  // tool-input-delta heartbeat — Agent writing code params
  | { type: 'code_stream'; text: string; done?: boolean }  // run_code code streamed in chunks (avoids large SSE events on iOS)
  | { type: 'render' | 'composition'; code: string; width: number; height: number; props?: Record<string, unknown>; animation?: { fps: number; durationInSeconds: number; format?: string }; editables?: import('@/types').EditableField[]; fontSubstitutions?: Record<string, string>; description?: string; snapshotId?: string; sourceDesignPath?: string; published?: boolean; previewUrl?: string }  // Agent React composition for browser rendering
  | { type: 'design'; code: string; width: number; height: number; props?: Record<string, unknown>; animation?: { fps: number; durationInSeconds: number; format?: string }; editables?: import('@/types').EditableField[]; fontSubstitutions?: Record<string, string>; published?: boolean }  // @deprecated — backward compat alias for 'render'
  | { type: 'music_task'; taskId: string }  // emitted when generate_music tool creates a task — frontend polls
  | {
      type: 'context_compaction';
      provider: 'anthropic' | 'openai';
      modelId?: string;
      compactedThrough?: string;
      summary?: string;
      appliedEdits?: Array<Record<string, unknown>>;
      item?: {
        kind: 'openai.compaction';
        providerKey: string;
        itemId: string;
        encryptedContent: string;
      };
      inputTokens?: number;
    }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; cacheWriteTelemetryComplete?: boolean; providerCostUsd?: number; model: string }  // token usage for billing (inputTokens = noCache only)
  | { type: 'done' }
  | {
      type: 'error';
      message: string;
      code?: string;
      recoverable?: boolean;
      checkpoint?: {
        draftPath?: string;
        previewUrl?: string;
        lastTool?: string;
        finishReason?: string;
        rawFinishReason?: string;
        studioRunId?: string;
        studioRunStage?: string;
        studioRunStatePath?: string;
        streamedCodePath?: string;
        streamedCodeChars?: number;
        compositionPartPaths?: string[];
        errorDetail?: string;
      };
    };

// Skill types (workspace replaces hardcoded SKILL_PROMPTS map)
// Workspace service — unified access to skills, memory, assets
import * as workspace from './workspace';
import { evolvingSkillBundlePaths, recordEvolvingSkillUsage } from './skill-evolution';

// ---------------------------------------------------------------------------
// Shared image reference utilities
// ---------------------------------------------------------------------------

/** Validate a 1-based snapshot index. Returns 0-based index or error. */
function validateImageIndex(snapshotImages: string[], index: number): { idx: number; error?: string } {
  const idx = index - 1;
  if (idx < 0 || idx >= snapshotImages.length) {
    return { idx: -1, error: `Invalid index ${index}. Available: 1-${snapshotImages.length}` };
  }
  if (!snapshotImages[idx]) return { idx: -1, error: 'No image at this index' };
  return { idx };
}

function resolveSeedAudioReferences(
  audioAttachments: AudioAttachment[] | undefined,
  refs: string[] | undefined,
): { references: string[]; error?: string } {
  if (!refs?.length) return { references: [] };
  const attachments = audioAttachments || [];
  const references: string[] = [];
  const invalid: string[] = [];
  for (const rawRef of refs) {
    const ref = String(rawRef).trim();
    const match = ref.match(/^audio_(\d+)$/i);
    if (match) {
      const audio = attachments[Number(match[1]) - 1];
      if (!audio?.audioUrl) {
        invalid.push(ref);
      } else {
        references.push(audio.audioUrl);
      }
      continue;
    }
    if (/^https:\/\//i.test(ref) || /^[a-z0-9][a-z0-9._:/-]{2,}$/i.test(ref)) {
      references.push(ref);
    } else {
      invalid.push(ref);
    }
  }
  if (invalid.length) {
    const available = attachments.map((audio, i) => `audio_${i + 1}${audio.title ? ` (${audio.title})` : ''}`).join(', ') || 'none';
    return {
      references,
      error: `Invalid reference_voices: ${invalid.join(', ')}. Use Audio Index labels (${available}) or a provider preset voice ID.`,
    };
  }
  return { references };
}

function addAudioAttachment(ctx: AgentContext, audio: AudioAttachment | null | undefined): number {
  if (!audio?.audioUrl || !/^https?:\/\//.test(audio.audioUrl)) {
    return ctx.audioAttachments?.length || 0;
  }

  const next = [...(ctx.audioAttachments || [])];
  const existing = next.findIndex(item => item.audioUrl === audio.audioUrl);
  if (existing >= 0) {
    next[existing] = { ...next[existing], ...audio };
    ctx.audioAttachments = next;
    return existing + 1;
  }

  next.push(audio);
  ctx.audioAttachments = next;
  return next.length;
}

function cleanMusicField(value: unknown, fallback = ''): string {
  return String(value ?? fallback).replace(/[|\n\r]/g, ' ').trim();
}

function getPlayableAudioUrl(record: Record<string, unknown>): string {
  return typeof record.audioUrl === 'string' && /^https?:\/\//.test(record.audioUrl)
    ? record.audioUrl
    : typeof record.streamAudioUrl === 'string' && /^https?:\/\//.test(record.streamAudioUrl)
      ? record.streamAudioUrl
      : typeof record.url === 'string' && /^https?:\/\//.test(record.url)
        ? record.url
        : '';
}

function formatMusicLine(record: Record<string, unknown>, fallbackTrackIndex = 0): string | null {
  const audioUrl = getPlayableAudioUrl(record);
  if (!audioUrl) return null;

  const title = cleanMusicField(record.title, 'Generated audio');
  const duration = Number(record.duration);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0;
  const trackIndex = Number(record.trackIndex);
  const safeTrackIndex = Number.isInteger(trackIndex) && trackIndex >= 0 ? trackIndex : fallbackTrackIndex;
  const tags = cleanMusicField(record.tags, 'audio,generated');
  const playUrl = typeof record.streamAudioUrl === 'string' && /^https?:\/\//.test(record.streamAudioUrl)
    ? record.streamAudioUrl
    : audioUrl;
  const finalUrl = typeof record.providerAudioUrl === 'string' && /^https?:\/\//.test(record.providerAudioUrl)
    ? record.providerAudioUrl
    : (playUrl === audioUrl ? audioUrl : '');

  return `music:${safeTrackIndex}|${title}|${safeDuration}|${tags}|${playUrl}|${finalUrl}`;
}

export function formatGeneratedAudioForCui(toolName: string | undefined, output: unknown, locale = normalizeLocale('en')): string | null {
  if (!toolName || !['generate_voiceover', 'generate_audio', 'generate_music'].includes(toolName)) return null;
  if (!output || typeof output !== 'object') return null;
  const record = output as Record<string, unknown>;
  if (record.success === false) return null;

  const tracks = Array.isArray(record.tracks)
    ? record.tracks
        .map((track, index) => track && typeof track === 'object' ? formatMusicLine(track as Record<string, unknown>, index) : null)
        .filter((line): line is string => !!line)
    : [];
  if (tracks.length) {
    return `\n\n🎵 ${translate(locale, 'agent.audio.generated')}\n${tracks.join('\n')}\n`;
  }

  const audioUrl = getPlayableAudioUrl(record);
  if (!audioUrl) return null;
  const title = cleanMusicField(
    record.title,
    toolName === 'generate_voiceover' ? 'Generated voiceover' : 'Generated audio',
  );
  const line = formatMusicLine({
    ...record,
    title,
    tags: cleanMusicField(record.tags, toolName === 'generate_voiceover' ? 'voiceover,tts' : 'audio,generated'),
    audioUrl,
  });
  if (!line) return null;

  return `\n\n🎵 ${translate(locale, 'agent.audio.generatedNamed', title)}\n${line}\n`;
}

function formatGeneratedAudioForModel(toolName: string, output: unknown): string {
  if (!output || typeof output !== 'object') return 'Audio tool completed.';
  const record = output as Record<string, unknown>;
  if (record.success === false) {
    return `Audio generation failed: ${String(record.message || 'unknown error')}`;
  }
  if (Array.isArray(record.tracks)) {
    const trackLines = record.tracks
      .map((track, index) => {
        if (!track || typeof track !== 'object') return '';
        const item = track as Record<string, unknown>;
        const audioUrl = getPlayableAudioUrl(item);
        if (!audioUrl) return '';
        const title = cleanMusicField(item.title, `Generated music ${index + 1}`);
        const duration = typeof item.duration === 'number' && Number.isFinite(item.duration)
          ? `${Math.round(item.duration)}s`
          : 'unknown duration';
        const audioIndex = typeof item.audioIndex === 'number' && Number.isFinite(item.audioIndex)
          ? item.audioIndex
          : index + 1;
        const providerFinal = typeof item.providerAudioUrl === 'string' && item.providerAudioUrl !== audioUrl
          ? `\n  Provider final URL, if already available: ${item.providerAudioUrl}`
          : '';
        return `- <<<audio_${audioIndex}>>> ${title} (${duration})\n  Resolved public audioUrl: ${audioUrl}${providerFinal}`;
      })
      .filter(Boolean);
    if (trackLines.length) {
      return [
        `${trackLines.length} audio track(s) are ready.`,
        'Choose the best track for the user request. Use the exact chosen audioUrl directly in Remotion <Audio src={...}> props/code.',
        'Do not put <<<audio_N>>> markers inside Remotion code; markers are only labels for choosing.',
        ...trackLines,
      ].filter(Boolean).join('\n');
    }
  }
  const title = cleanMusicField(record.title, toolName === 'generate_voiceover' ? 'Generated voiceover' : 'Generated audio');
  const audioUrl = getPlayableAudioUrl(record);
  const duration = typeof record.duration === 'number' && Number.isFinite(record.duration)
    ? `${Math.round(record.duration)}s`
    : 'unknown duration';
  const trackIndex = typeof record.trackIndex === 'number' && Number.isFinite(record.trackIndex)
    ? record.trackIndex
    : undefined;
  const marker = trackIndex != null ? `<<<audio_${trackIndex + 1}>>>` : 'Audio Index';
  const provider = cleanMusicField(record.provider || record.model, '');
  const resolved = audioUrl
    ? `Resolved public audioUrl: ${audioUrl}\nUse this exact URL directly in Remotion <Audio src={...}> props/code. Do not regenerate this audio unless the duration or style is wrong.`
    : 'No public audioUrl was returned; do not use this result as playable audio.';
  return [
    `${title} generated successfully (${duration}${provider ? `, ${provider}` : ''}).`,
    `Added to Audio Index as ${marker}.`,
    resolved,
    typeof record.message === 'string' ? `Tool message: ${record.message}` : '',
  ].filter(Boolean).join('\n');
}

function formatGeneratedImageForModel(output: unknown): string {
  if (!output || typeof output !== 'object') return 'Image tool completed.';
  const record = output as Record<string, unknown>;
  if (record.success === false) {
    return `Image generation failed: ${String(record.message || 'unknown error')}`;
  }
  const mediaIndex = typeof record.mediaIndex === 'number' && Number.isFinite(record.mediaIndex)
    ? record.mediaIndex
    : undefined;
  const marker = mediaIndex ? `<<<media_${mediaIndex}>>>` : 'the new Media Index item';
  const imageUrl = typeof record.imageUrl === 'string' && /^https?:\/\//.test(record.imageUrl)
    ? record.imageUrl
    : '';
  const urlLine = imageUrl
    ? `Resolved image URL: ${imageUrl}`
    : `A public image URL may not be available in this same tool result yet because upload happens asynchronously.`;
  return [
    `Image generated successfully and added to the timeline as ${marker}.`,
    urlLine,
    `For Remotion composition run_code, use ${imageUrl ? 'the resolved URL' : marker} directly in props/code; run_code resolves Media Index markers before rendering.`,
    `Do not call list_files or write_file(fromWorkspaceOutputs) to find this generated image. It is timeline media, not a workspace file output.`,
    typeof record.message === 'string' ? `Tool message: ${record.message}` : '',
  ].filter(Boolean).join('\n');
}

async function createNarrationCueArtifact(input: {
  ctx: AgentContext;
  transcript: VolcengineAsrTranscript;
  expectedSections?: ExpectedNarrationSection[];
  fps?: number;
}): Promise<{
  narrationCueSheet?: ReturnType<typeof buildNarrationCueSheet>;
  narrationCuePath?: string;
}> {
  if (!input.expectedSections?.length) return {};
  const narrationCueSheet = buildNarrationCueSheet({
    transcript: input.transcript,
    sections: input.expectedSections,
    fps: input.fps,
  });
  if (!input.ctx.supabase || !input.ctx.userId) return { narrationCueSheet };
  const narrationCuePath = `${input.ctx.projectId}/audio/narration-cues-${input.transcript.requestId}.json`;
  const saved = await workspace.writeFile(
    narrationCuePath,
    JSON.stringify(narrationCueSheet, null, 2),
    input.ctx.supabase,
    input.ctx.userId,
    'application/json',
  );
  if (!saved.success) {
    throw new Error(saved.error || 'Failed to persist narration cue sheet.')
  }
  return { narrationCueSheet, narrationCuePath };
}

async function createOptionalNarrationCueArtifact(input: {
  ctx: AgentContext;
  transcript: VolcengineAsrTranscript;
  expectedSections?: ExpectedNarrationSection[];
  fps?: number;
}): Promise<{
  narrationCueSheet?: ReturnType<typeof buildNarrationCueSheet>;
  narrationCuePath?: string;
  narrationWarning?: string;
}> {
  try {
    return await createNarrationCueArtifact(input);
  } catch (error) {
    const narrationWarning = `Optional narration alignment was skipped: ${error instanceof Error ? error.message : String(error)}`;
    console.warn('[transcribe_audio] optional narration alignment failed:', narrationWarning);
    return { narrationWarning };
  }
}

async function createTranscriptArtifact(input: {
  ctx: AgentContext;
  transcript: VolcengineAsrTranscript;
}): Promise<{ transcriptPath?: string; transcriptWarning?: string }> {
  if (!input.ctx.supabase || !input.ctx.userId) return {};
  const transcriptPath = `${input.ctx.projectId}/transcripts/asr-${input.transcript.requestId}.json`;
  const artifactTranscript = { ...input.transcript };
  delete artifactTranscript.sourceUrl;
  const saved = await workspace.writeFile(
    transcriptPath,
    JSON.stringify(artifactTranscript, null, 2),
    input.ctx.supabase,
    input.ctx.userId,
    'application/json',
  );
  if (!saved.success) {
    const transcriptWarning = saved.error || 'Failed to persist the full ASR transcript artifact.';
    console.warn('[transcribe_audio] transcript artifact persistence failed:', transcriptWarning);
    return { transcriptWarning };
  }
  return { transcriptPath };
}

async function validateCompositionMediaAspect(
  ctx: AgentContext,
  result: { code: string; props?: Record<string, unknown>; width?: number; height?: number },
): Promise<string | null> {
  const outputWidth = Number(result.width || 1080);
  const outputHeight = Number(result.height || 1350);
  if (!Number.isFinite(outputWidth) || !Number.isFinite(outputHeight) || outputWidth <= 0 || outputHeight <= 0) {
    return null;
  }
  if (!ctx.supabase || !ctx.projectId) return null;

  try {
    const { data: rows } = await ctx.supabase
      .from('snapshots')
      .select('id, video_meta')
      .eq('project_id', ctx.projectId)
      .eq('type', 'video');

    const haystack = JSON.stringify({ code: result.code, props: result.props ?? {} });
    const videoRows = (rows ?? []) as Array<{ id?: string; video_meta?: Record<string, unknown> | null }>;
    const matched: Array<{ url: string; width: number; height: number }> = [];

    for (const row of videoRows) {
      const meta = row.video_meta;
      if (!meta) continue;
      const url = typeof meta.videoUrl === 'string' ? meta.videoUrl : '';
      if (!url || !haystack.includes(url)) continue;

      let width = Number(meta.width);
      let height = Number(meta.height);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        const probed = await probeTimelineVideoDimensions(url);
        if (probed) {
          width = probed.width;
          height = probed.height;
          if (row.id) {
            const nextMeta = { ...meta, width, height };
            const { error } = await ctx.supabase
              .from('snapshots')
              .update({ video_meta: nextMeta })
              .eq('id', row.id);
            if (error) console.warn('[composition-aspect] failed to cache probed dimensions:', error.message);
          }
        }
      }

      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        matched.push({ url, width, height });
      }
    }

    if (!matched.length) return null;

    const sourceRatios = matched.map(item => item.width / item.height);
    const minRatio = Math.min(...sourceRatios);
    const maxRatio = Math.max(...sourceRatios);
    const sourceRatio = sourceRatios.reduce((sum, ratio) => sum + ratio, 0) / sourceRatios.length;
    const outputRatio = outputWidth / outputHeight;

    // Only hard-reject when selected videos clearly share one aspect. Mixed-ratio
    // timelines may intentionally use a platform canvas with contain/background.
    if ((maxRatio - minRatio) / sourceRatio > 0.03) return null;
    if (Math.abs(outputRatio / sourceRatio - 1) <= 0.05) return null;

    const first = matched[0];
    const sourceAspect = formatAspectRatio(first.width, first.height) || `${first.width}:${first.height}`;
    const outputAspect = formatAspectRatio(outputWidth, outputHeight) || `${outputWidth}:${outputHeight}`;
    const dims = matched.map(item => `${Math.round(item.width)}x${Math.round(item.height)}`).join(', ');
    const recommended = first.width < first.height
      ? '1080x1920'
      : first.width > first.height
        ? '1920x1080'
        : '1080x1080';

    return `Composition rejected: selected timeline video(s) are ${dims} (${sourceAspect}), but the returned canvas is ${Math.round(outputWidth)}x${Math.round(outputHeight)} (${outputAspect}). Preserve the selected video aspect ratio; use a proportional canvas such as ${recommended}, then rerun runtime:"composition".`;
  } catch {
    return null;
  }
}

async function probeTimelineVideoDimensions(url: string): Promise<{ width: number; height: number } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const length = Number(res.headers.get('content-length') || 0);
    if (length > MAX_VIDEO_DIMENSION_PROBE_BYTES) return null;

    const buffer = new Uint8Array(await res.arrayBuffer());
    if (buffer.length > MAX_VIDEO_DIMENSION_PROBE_BYTES) return null;

    const { probeMP4Dimensions } = await import('./mp4-probe');
    return probeMP4Dimensions(buffer);
  } catch {
    return null;
  }
}

/** Fetch an image source (URL or base64 data URL) into a JPEG Buffer.
 *  Always normalizes to JPEG to avoid MIME type mismatches (e.g. PNG labeled as JPEG). */
async function fetchImageBuffer(
  source: string,
  opts?: { maxBytes?: number; maxPx?: number; quality?: number },
): Promise<Buffer> {
  let buf: Buffer;
  if (source.startsWith('http')) {
    buf = Buffer.from(await (await fetch(source)).arrayBuffer());
  } else {
    buf = Buffer.from(source.replace(/^data:image\/\w+;base64,/, ''), 'base64');
  }
  // Always convert to JPEG so every vision-capable Agent model gets a consistent MIME type.
  const maxPx = opts?.maxPx ?? 2048;
  const quality = opts?.quality ?? 90;
  buf = Buffer.from(await sharp(buf)
    .resize(maxPx, maxPx, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer());
  return buf;
}

/** Refresh ctx.snapshotImages from DB — replaces base64 entries with Storage URLs, video snapshots with video URLs. */
async function refreshSnapshotUrls(ctx: AgentContext): Promise<AgentSnapshotIndexRow[]> {
  if (!ctx.supabase || !ctx.projectId) return [];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { data: dbSnaps, error } = await ctx.supabase
        .from('snapshots')
        .select('id, image_url, sort_order, type, video_meta')
        .eq('project_id', ctx.projectId)
        .order('sort_order');
      if (error) throw error;
      if (!dbSnaps?.length) return [];
      const rows = dbSnaps as AgentSnapshotIndexRow[];
      const nextUrls = rebuildAgentSnapshotUrls(rows, ctx.snapshotImages);
      ctx.snapshotImages.splice(0, ctx.snapshotImages.length, ...nextUrls);
      return rows;
    } catch (error) {
      if (attempt === 2) {
        console.warn('[agent] failed to refresh timeline Media Index after 3 attempts:', error);
      } else {
        await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
  }
  return [];
}

function isVideoUrl(url?: string): boolean {
  return /\.(mp4|mov|webm)(?:\?|$)/i.test(url || '');
}

async function resolveVideoUrlForMediaIndex(ctx: AgentContext, mediaIndex: number): Promise<{
  idx: number;
  videoUrl?: string;
  duration?: number;
  fps?: number;
  sourceRange?: VideoSourceRange;
  error?: string;
}> {
  const v = validateImageIndex(ctx.snapshotImages, mediaIndex);
  if (v.error) return { idx: -1, error: v.error };

  const directUrl = ctx.snapshotImages[v.idx];
  if (!ctx.supabase || !ctx.userId) {
    if (isVideoUrl(directUrl)) return { idx: v.idx, videoUrl: directUrl };
    return { idx: v.idx, error: `No video file found at <<<media_${mediaIndex}>>>. Use analyze_image for still images/posters, or preview_frame for Remotion compositions.` };
  }

  try {
    const { data: snaps, error: snapErr } = await ctx.supabase
      .from('snapshots')
      .select('type, image_url, video_meta')
      .eq('project_id', ctx.projectId)
      .order('sort_order', { ascending: true });
    if (snapErr) console.error('[resolveVideoUrlForMediaIndex] DB query error:', snapErr.message);

    const snap = snaps?.[v.idx] as { type?: string; image_url?: string; video_meta?: Record<string, unknown> } | undefined;
    const meta = snap?.video_meta;
    const videoUrl = typeof meta?.videoUrl === 'string' ? meta.videoUrl : '';
    const posterOrFallback = typeof snap?.image_url === 'string' ? snap.image_url : directUrl;
    const fallbackVideoUrl = isVideoUrl(posterOrFallback) ? posterOrFallback : '';
    const duration = Number(meta?.duration);
    const fps = Number(meta?.fps);
    const sourceRange = sourceRangeFromVideoMeta(meta);

    if (videoUrl || fallbackVideoUrl) {
      return {
        idx: v.idx,
        videoUrl: videoUrl || fallbackVideoUrl,
        duration: Number.isFinite(duration) ? duration : undefined,
        fps: Number.isFinite(fps) ? fps : undefined,
        sourceRange,
      };
    }
  } catch (e) {
    console.error('[resolveVideoUrlForMediaIndex] exception:', e);
  }

  if (isVideoUrl(directUrl)) return { idx: v.idx, videoUrl: directUrl };
  return { idx: v.idx, error: `No real video file found at <<<media_${mediaIndex}>>>. Use preview_frame only for Remotion compositions with design_path.` };
}

function scopeVideoQuestionToSourceRange(question: string | undefined, range: VideoSourceRange | undefined): string | undefined {
  if (!range) return question;
  const directive = `Analyze only the bounded original-source interval from ${range.start_sec}s through ${range.end_sec}s. Ignore content outside it. Report any timestamps in the original source timebase, not relative to zero.`;
  return question ? `${directive}\nFocus request: ${question}` : directive;
}

async function resolveCompositionSource(ctx: AgentContext, input: {
  media_index?: number;
  snapshot_id?: string;
  design_path?: string;
}): Promise<{
  mediaIndex?: number;
  snapshotId?: string;
  designPath?: string;
  design?: DesignPayload;
  error?: string;
}> {
  if (input.design_path) {
    // An exact workspace design path is the strongest source identity. Models
    // sometimes include a display index or guessed snapshot label alongside it;
    // forwarding that weaker identity makes the exporter look up a snapshot that
    // may not exist even though the editable composition is already available.
    return { designPath: input.design_path };
  }
  if (input.snapshot_id && !input.media_index) {
    if (!ctx.supabase) return { snapshotId: input.snapshot_id };
    const { data: snapshot, error } = await ctx.supabase
      .from('snapshots')
      .select('design_path')
      .eq('project_id', ctx.projectId)
      .eq('id', input.snapshot_id)
      .maybeSingle();
    if (error) return { error: `Snapshot lookup failed: ${error.message}` };
    return {
      snapshotId: input.snapshot_id,
      designPath: typeof snapshot?.design_path === 'string' ? snapshot.design_path : undefined,
    };
  }
  if (input.media_index !== undefined) {
    if (!ctx.supabase) return { error: 'Timeline lookup requires workspace access.' };

    const { data: snaps, error } = await ctx.supabase
      .from('snapshots')
      .select('id, type, design_path')
      .eq('project_id', ctx.projectId)
      .order('sort_order', { ascending: true });
    if (error) return { error: `Snapshot lookup failed: ${error.message}` };

    const idx = input.media_index - 1;
    const available = snaps?.length || 0;
    if (!Number.isInteger(input.media_index) || idx < 0 || idx >= available) {
      return { error: `Invalid index ${input.media_index}. Available: 1-${available}.` };
    }

    const snap = snaps?.[idx] as { id?: string; type?: string; design_path?: string | null } | undefined;
    if (!snap) return { error: `No snapshot found for <<<media_${input.media_index}>>>.` };
    if (!snap.design_path) {
      return { error: `<<<media_${input.media_index}>>> is ${snap.type || 'media'}, not an editable Remotion composition.` };
    }
    return { mediaIndex: input.media_index, snapshotId: snap.id, designPath: snap.design_path };
  }

  const design = (ctx as any).__lastDesignPayload as DesignPayload | undefined;
  if (design?.code) return { design };
  return { error: 'No composition source found. Use run_code first, or pass media_index/snapshot_id/design_path.' };
}

async function resolveImageForAnalysis(ctx: AgentContext, options: {
  imageUrl?: string;
  imageMediaIndex?: number;
  workspacePath?: string;
}): Promise<{ image?: string; source?: string; error?: string }> {
  if (options.imageUrl) {
    if (/^(https?:\/\/|data:image\/)/i.test(options.imageUrl)) {
      return { image: options.imageUrl, source: options.imageUrl.startsWith('data:') ? 'data-url' : 'image_url' };
    }
    return { error: 'image_url must be an http(s) URL or data:image URL.' };
  }

  if (options.workspacePath) {
    const result = await workspace.readFile(options.workspacePath, ctx.supabase, ctx.userId);
    if (!result) return { error: `Workspace image not found: ${options.workspacePath}` };
    if (!result.contentType.startsWith('image/')) return { error: `Workspace file is not an image: ${options.workspacePath}` };
    return { image: result.storageUrl || result.content, source: options.workspacePath };
  }

  if (options.imageMediaIndex !== undefined) {
    const v = validateImageIndex(ctx.snapshotImages, options.imageMediaIndex);
    if (v.error) return { error: v.error };
    const image = ctx.snapshotImages[v.idx];
    if (isVideoUrl(image)) return { error: `<<<media_${options.imageMediaIndex}>>> is a video. Use an image snapshot, screenshot URL, or workspace_path as the frame anchor.` };
    return { image, source: `<<<media_${options.imageMediaIndex}>>>` };
  }

  return { error: 'locate_frame requires image_url, image_media_index, or workspace_path.' };
}

function isImageContentType(contentType?: string): boolean {
  return !!contentType?.startsWith('image/');
}

function isVideoContentType(contentType?: string): boolean {
  return !!contentType?.startsWith('video/');
}

function mediaKindMatches(contentType: string | undefined, mediaType: 'image' | 'video' | 'all'): boolean {
  if (mediaType === 'all') return isImageContentType(contentType) || isVideoContentType(contentType);
  if (mediaType === 'image') return isImageContentType(contentType);
  return isVideoContentType(contentType);
}

function inferWorkspaceContentType(filePathOrUrl: string): string {
  const clean = filePathOrUrl.split('?')[0] || filePathOrUrl;
  if (/\.(mp4|m4v)$/i.test(clean)) return 'video/mp4';
  if (/\.mov$/i.test(clean)) return 'video/quicktime';
  if (/\.webm$/i.test(clean)) return 'video/webm';
  if (/\.(jpg|jpeg)$/i.test(clean)) return 'image/jpeg';
  if (/\.png$/i.test(clean)) return 'image/png';
  if (/\.webp$/i.test(clean)) return 'image/webp';
  if (/\.gif$/i.test(clean)) return 'image/gif';
  return 'application/octet-stream';
}

async function ensureWorkspaceFileIndex(ctx: AgentContext, output: WorkspaceMediaOutputDraft): Promise<void> {
  if (!ctx.supabase || !ctx.userId || !output.path || !output.storageUrl) return;
  const { data: existing, error: lookupError } = await ctx.supabase
    .from('workspace_files')
    .select('path')
    .eq('user_id', ctx.userId)
    .eq('path', output.path)
    .maybeSingle();
  if (!lookupError && existing?.path) return;

  const { error } = await ctx.supabase.from('workspace_files').upsert({
    user_id: ctx.userId,
    path: output.path,
    content_type: output.contentType || inferWorkspaceContentType(output.path || output.storageUrl),
    size_bytes: null,
    storage_url: toPublicStorageUrl(output.storageUrl),
    updated_at: output.updatedAt || new Date().toISOString(),
  }, { onConflict: 'user_id,path' });
  if (error) {
    console.warn('[agent] failed to ensure workspace file index:', output.path, error.message);
    return;
  }
  workspace.clearWorkspaceCache();
}

async function recoverWorkspaceMediaPath(ctx: AgentContext, filePath: string): Promise<WorkspaceMediaOutputDraft | null> {
  if (!ctx.supabase || !ctx.userId || /^https?:\/\//i.test(filePath)) return null;
  const contentType = inferWorkspaceContentType(filePath);
  if (!mediaKindMatches(contentType, 'all')) return null;

  const storagePath = `${ctx.userId}/workspace/${filePath}`;
  const { data } = ctx.supabase.storage.from('images').getPublicUrl(storagePath);
  const storageUrl = toPublicStorageUrl(data?.publicUrl || '');
  if (!storageUrl) return null;

  const recovered: WorkspaceMediaOutputDraft = {
    path: filePath,
    storageUrl,
    contentType,
    updatedAt: new Date().toISOString(),
  };
  const validationError = await validatePublishableMediaUrl(recovered);
  if (validationError) return null;

  await ensureWorkspaceFileIndex(ctx, recovered);
  return recovered;
}

async function validatePublishableMediaUrl(output: WorkspaceMediaOutputDraft): Promise<string | null> {
  if (!output.storageUrl) return 'Missing storage URL.';
  try {
    const res = await fetch(output.storageUrl, { method: 'HEAD', cache: 'no-store' });
    if (!res.ok) {
      return `URL is not reachable (${res.status}): ${output.storageUrl}`;
    }
    const actualType = res.headers.get('content-type') || '';
    if (isImageContentType(output.contentType) && actualType && !actualType.startsWith('image/')) {
      return `Expected image but URL returned ${actualType}: ${output.storageUrl}`;
    }
    if (isVideoContentType(output.contentType) && actualType && !actualType.startsWith('video/') && !actualType.includes('octet-stream')) {
      return `Expected video but URL returned ${actualType}: ${output.storageUrl}`;
    }
  } catch (err) {
    return `URL validation failed: ${err instanceof Error ? err.message : String(err)}`;
  }
  return null;
}

function getWorkspaceMediaOutputs(ctx: AgentContext): WorkspaceMediaOutputDraft[] {
  return ((ctx as any).__workspaceMediaOutputs || []) as WorkspaceMediaOutputDraft[];
}

function rememberWorkspaceMediaOutputs(ctx: AgentContext, outputs: WorkspaceMediaOutputDraft[]): void {
  if (!outputs.length) return;
  const existing = getWorkspaceMediaOutputs(ctx);
  const seen = new Set(existing.map(o => o.path || o.storageUrl));
  const merged = [...existing];
  for (const output of outputs) {
    const key = output.path || output.storageUrl;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(output);
  }
  (ctx as any).__workspaceMediaOutputs = merged.slice(-30);
}

function cleanMediaDescription(description: string): string {
  return description
    .replace(/\s*:\s*(?:undefined|null|NaN)s?\s*$/i, '')
    .replace(/\b(?:undefined|null|NaN)s?\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function outputDisplayName(output: WorkspaceMediaOutputDraft, fallback: string): string {
  if (output.description) {
    const cleaned = cleanMediaDescription(output.description);
    if (cleaned) return cleaned;
  }
  const path = output.path || output.storageUrl;
  const file = path.split('/').pop()?.replace(/\.[a-z0-9]+$/i, '') || fallback;
  return file.replace(/[-_]+/g, ' ').trim() || fallback;
}

function normalizeMediaIdentity(value?: string | null): string | null {
  if (!value) return null;
  return value.split('#')[0].split('?')[0];
}

async function publishWorkspaceMediaOutputs(ctx: AgentContext, options: {
  workspacePaths?: string[];
  limit?: number;
  mediaType?: 'image' | 'video' | 'all';
  name?: string;
}): Promise<{ success: boolean; message: string; published: Array<{ snapshotId: string; type: 'image' | 'video'; url: string; path?: string; mediaIndex: number; ref: string }> }> {
  if (!ctx.supabase || !ctx.userId) {
    return { success: false, message: 'Workspace not available (no Supabase connection).', published: [] };
  }

  const mediaType = options.mediaType || 'all';
  const requestedPaths = (options.workspacePaths || []).filter(Boolean);
  const limit = Math.max(1, Math.min(options.limit || requestedPaths.length || 10, 20));
  const remembered = getWorkspaceMediaOutputs(ctx);
  const rememberedByPath = new Map(remembered.filter(o => o.path).map(o => [o.path!, o]));
  const rememberedByUrl = new Map(remembered.map(o => [o.storageUrl, o]));

  const candidates: WorkspaceMediaOutputDraft[] = [];

  if (requestedPaths.length > 0) {
    const pathSet = new Set(requestedPaths);
    candidates.push(...remembered.filter(o => (o.path && pathSet.has(o.path)) || pathSet.has(o.storageUrl)));

    const workspaceOnlyPaths = requestedPaths.filter(p => !/^https?:\/\//i.test(p));
    if (workspaceOnlyPaths.length > 0) {
      const { data, error } = await ctx.supabase
        .from('workspace_files')
        .select('path, content_type, storage_url, updated_at')
        .eq('user_id', ctx.userId)
        .in('path', workspaceOnlyPaths);
      if (error) return { success: false, message: `Workspace lookup failed: ${error.message}`, published: [] };
      candidates.push(...(data || []).map((row: Record<string, string>) => ({
        path: row.path,
        storageUrl: toPublicStorageUrl(row.storage_url),
        contentType: row.content_type,
        updatedAt: row.updated_at,
        ...rememberedByPath.get(row.path),
      })));

      const foundPaths = new Set((data || []).map((row: Record<string, string>) => row.path));
      const missingPaths = workspaceOnlyPaths.filter(p => !foundPaths.has(p));
      for (const missingPath of missingPaths) {
        const recovered = await recoverWorkspaceMediaPath(ctx, missingPath);
        if (recovered) candidates.push(recovered);
      }
    }

    candidates.push(...requestedPaths
      .filter(p => /^https?:\/\//i.test(p))
      .map(url => rememberedByUrl.get(url) || {
        storageUrl: toPublicStorageUrl(url),
        contentType: /\.(mp4|mov|webm)(?:\?|$)/i.test(url) ? 'video/mp4' : 'image/jpeg',
      } satisfies WorkspaceMediaOutputDraft));

    const order = new Map(requestedPaths.map((p, i) => [p, i]));
    candidates.sort((a, b) => (order.get(a.path || a.storageUrl) ?? 999) - (order.get(b.path || b.storageUrl) ?? 999));
  } else {
    candidates.push(...remembered.filter(o => mediaKindMatches(o.contentType, mediaType)).slice(-limit));

    const lookupPrefixes = [
      `${ctx.projectId}/media/%`,
      ...(mediaType !== 'video' ? [`${ctx.projectId}/drafts/%`] : []),
    ];
    const workspaceRows: Array<Record<string, string>> = [];
    for (const prefix of lookupPrefixes) {
      const { data, error } = await ctx.supabase
        .from('workspace_files')
        .select('path, content_type, storage_url, updated_at')
        .eq('user_id', ctx.userId)
        .like('path', prefix)
        .order('updated_at', { ascending: false })
        .limit(Math.max(limit * 3, 20));
      if (error) return { success: false, message: `Workspace lookup failed: ${error.message}`, published: [] };
      workspaceRows.push(...((data || []) as Array<Record<string, string>>));
    }

    const rows: WorkspaceMediaOutputDraft[] = workspaceRows
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
      .map((row: Record<string, string>) => ({
        path: row.path,
        storageUrl: toPublicStorageUrl(row.storage_url),
        contentType: row.content_type,
        updatedAt: row.updated_at,
        ...rememberedByPath.get(row.path),
      }))
      .filter((o: WorkspaceMediaOutputDraft) => mediaKindMatches(o.contentType, mediaType))
      .slice(0, limit)
      .reverse();
    candidates.push(...rows);
  }

  const unique = new Map<string, WorkspaceMediaOutputDraft>();
  for (const candidate of candidates) {
    if (!candidate.storageUrl || !mediaKindMatches(candidate.contentType, mediaType)) continue;
    unique.set(candidate.path || candidate.storageUrl, candidate);
  }
  const outputs = [...unique.values()].slice(-limit);
  if (!outputs.length) {
    const typeLabel = mediaType === 'all' ? 'image/video' : mediaType;
    if (requestedPaths.length > 0) {
      return {
        success: false,
        message: `No publishable workspace ${typeLabel} outputs found for requested path(s): ${requestedPaths.join(', ')}. The file must exist in workspace_files or at storage path {userId}/workspace/{path}.`,
        published: [],
      };
    }
    return { success: false, message: `No recent workspace ${typeLabel} outputs found for this project.`, published: [] };
  }

  for (const output of outputs) {
    const validationError = await validatePublishableMediaUrl(output);
    if (validationError) {
      return {
        success: false,
        message: `Cannot publish workspace media: ${validationError}\nUse a real workspace output returned by run_code/list_files, or re-run the media export so the file is saved before publishing.`,
        published: [],
      };
    }
  }

  const { VIDEO_PLACEHOLDER_IMAGE } = await import('@/lib/editor/timeline-derivations');
  const published: Array<{ snapshotId: string; type: 'image' | 'video'; url: string; path?: string; mediaIndex: number; ref: string }> = [];
  const ensureMediaIndex = (url: string) => {
    const identity = normalizeMediaIdentity(url);
    let index = ctx.snapshotImages.findIndex(existing => normalizeMediaIdentity(existing) === identity);
    if (index < 0) {
      ctx.snapshotImages.push(url);
      index = ctx.snapshotImages.length - 1;
    }
    ctx.currentSnapshotIndex = index;
    const mediaIndex = index + 1;
    return { mediaIndex, ref: `<<<media_${mediaIndex}>>>` };
  };
  const { data: existingVideoSnaps } = await ctx.supabase
    .from('snapshots')
    .select('id, video_meta')
    .eq('project_id', ctx.projectId)
    .eq('type', 'video');
  const existingVideoIdentities = new Map<string, string>();
  for (const snap of existingVideoSnaps || []) {
    const meta = (snap as { id: string; video_meta?: { videoUrl?: string; videoPath?: string } }).video_meta;
    const urlKey = normalizeMediaIdentity(meta?.videoUrl);
    const pathKey = normalizeMediaIdentity(meta?.videoPath);
    if (urlKey) existingVideoIdentities.set(`url:${urlKey}`, (snap as { id: string }).id);
    if (pathKey) existingVideoIdentities.set(`path:${pathKey}`, (snap as { id: string }).id);
  }

  for (const [index, output] of outputs.entries()) {
    const snapshotId = crypto.randomUUID();
    const sortResult = await ctx.supabase.rpc('next_sort_order', { p_project_id: ctx.projectId });
    const sortOrder = sortResult.data ?? Date.now();
    const description = outputDisplayName(output, `${options.name || 'workspace output'} ${index + 1}`);

    if (isVideoContentType(output.contentType)) {
      const urlKey = normalizeMediaIdentity(output.storageUrl);
      const pathKey = normalizeMediaIdentity(output.path);
      const duplicateSnapshotId = (urlKey && existingVideoIdentities.get(`url:${urlKey}`)) || (pathKey && existingVideoIdentities.get(`path:${pathKey}`));
      if (duplicateSnapshotId) {
        published.push({
          snapshotId: duplicateSnapshotId,
          type: 'video',
          url: output.storageUrl,
          path: output.path,
          ...ensureMediaIndex(output.storageUrl),
        });
        continue;
      }

      const taskId = `workspace-${snapshotId}`;
      const videoMeta: VideoMeta = {
        taskId,
        videoUrl: output.storageUrl,
        providerUrl: output.storageUrl,
        videoPath: output.path,
        prompt: description,
        sourceSnapshotIds: [],
        sourceUrls: [output.storageUrl],
        status: 'completed',
        duration: typeof output.duration === 'number' ? output.duration : null,
        model: 'upload',
        createdAt: new Date().toISOString(),
        width: output.width,
        height: output.height,
      };
      const { error } = await ctx.supabase.from('snapshots').insert({
        id: snapshotId,
        project_id: ctx.projectId,
        image_url: VIDEO_PLACEHOLDER_IMAGE,
        tips: [],
        message_id: '',
        sort_order: sortOrder,
        type: 'video',
        video_meta: videoMeta,
        description,
      });
      if (error) return { success: false, message: `Video publish failed: ${error.message}`, published };

      if (!ctx.pendingVideoSnapshots) ctx.pendingVideoSnapshots = [];
      ctx.pendingVideoSnapshots.push({ snapshotId, taskId, videoMeta });
      published.push({
        snapshotId,
        type: 'video',
        url: output.storageUrl,
        path: output.path,
        ...ensureMediaIndex(output.storageUrl),
      });
      if (urlKey) existingVideoIdentities.set(`url:${urlKey}`, snapshotId);
      if (pathKey) existingVideoIdentities.set(`path:${pathKey}`, snapshotId);
    } else if (isImageContentType(output.contentType)) {
      const { error } = await ctx.supabase.from('snapshots').insert({
        id: snapshotId,
        project_id: ctx.projectId,
        image_url: output.storageUrl,
        tips: [],
        message_id: '',
        sort_order: sortOrder,
        description,
      });
      if (error) return { success: false, message: `Image publish failed: ${error.message}`, published };

      if (!ctx.pendingImageSnapshots) ctx.pendingImageSnapshots = [];
      ctx.pendingImageSnapshots.push({ snapshotId, imageUrl: output.storageUrl, description });
      published.push({
        snapshotId,
        type: 'image',
        url: output.storageUrl,
        path: output.path,
        ...ensureMediaIndex(output.storageUrl),
      });
    }
  }

  return {
    success: true,
    message: `Published ${published.length} workspace media output${published.length === 1 ? '' : 's'} to timeline and current Media List:\n${published.map((p, i) => `${i + 1}. ${p.ref} ${p.type}: ${p.url}`).join('\n')}\nThese refs are available immediately to later tools in this Agent session.`,
    published,
  };
}

// ---------------------------------------------------------------------------
// Tools (Vercel AI SDK style, closure over AgentContext)
// ---------------------------------------------------------------------------

type SerializeVideoSubmission = <T>(operation: () => Promise<T>) => Promise<T>;

interface AgentToolFactoryScope {
  ctx: AgentContext;
  runtime: AgentModelRuntime;
  locale?: string;
  durableVisionBridge: boolean;
  serializeVideoSubmission: SerializeVideoSubmission;
}

function createGenerateImageTool(
  { ctx, runtime }: AgentToolFactoryScope,
) {
  return tool({
      description: generateImageToolPrompt,
      inputSchema: z.object({
        editPrompt: z.string().describe('The specific creative direction for this edit (English). When skill is set, you must have read and internalized that skill prompt once in this conversation; write an editPrompt that follows those rules.'),
        skill: z.string().optional().describe('Activate a skill template (e.g. enhance, creative, wild, captions). See tool description and available skills.'),
        model: z.enum(['gemini', 'gemini-lite', 'qwen', 'pony', 'wai', 'openai']).optional().describe('NEVER set this unless the user literally says a model name like "用pony" or "use qwen" or "用openai" or "nano banana lite", or the active long-video-director workflow is generating director storyboard images, which MUST set "openai". For NSFW after Gemini refusal, set "qwen". Otherwise ALWAYS omit — the router handles everything automatically. Setting this without explicit user request is a bug.'),
        aspectRatio: z.string().optional().describe('Target aspect ratio e.g. "4:5", "1:1", "16:9". For a pure existing-image cutout, omit this field to preserve the source canvas. If the user explicitly requests a new transparent layout/canvas ratio, pass it.'),
        background: z.enum(['auto', 'opaque', 'transparent']).optional().describe('Output background contract. Set "transparent" when the user asks for transparent/no background, background removal, subject cutout/isolation, 抠图/抠像/去背景, or a reusable PNG/sticker/overlay/alpha asset. With a source image also pass media_index for GPT Image 2 image-to-image cutout; without one omit media_index for text-to-image. Never return an opaque fallback.'),
        media_index: z.number().optional().describe('1-based index of the snapshot to edit (<<<media_1>>> = 1, <<<media_2>>> = 2, ...). Omit the field entirely for text-to-image (no photo sent); never send 0. For most edits, pass the current snapshot index.'),
        reference_media_indices: z.array(z.number()).optional().describe('1-based indices of snapshots to use as reference images (e.g. [1, 3] to reference <<<media_1>>> and <<<media_3>>>). Use when combining elements from multiple snapshots — e.g. "use the person from media_1 and the background from media_2". The editPrompt should describe how to combine them (e.g. "Place the person from Media 2 into the scene of Media 1").'),
      }),
      execute: async ({ editPrompt, skill, model, aspectRatio, background, media_index, reference_media_indices }) => {
        // GPT-5.6 currently fills omitted optional numeric tool fields with 0.
        // Treat that provider sentinel exactly like omission so empty projects
        // can still use pure text-to-image. Positive indices remain validated.
        const resolvedMediaIndex = normalizeGenerateImageMediaIndex(media_index);
        // Resolve which image to edit — agent must pass media_index to include a photo
        let editTarget: string | undefined;
        if (resolvedMediaIndex !== undefined) {
          const v = validateImageIndex(ctx.snapshotImages, resolvedMediaIndex);
          if (v.error) return { success: false as const, message: v.error };
          editTarget = ctx.snapshotImages[v.idx];
        } else if (ctx.currentImage && !ctx.snapshotImages.includes(ctx.currentImage)) {
          // Draft/preview mode: currentImage not in snapshotImages (e.g. tip preview)
          editTarget = ctx.currentImage;
        }

        // Resolve reference images: user-uploaded + snapshot indices
        const resolvedRefs = ctx.referenceImages ? [...ctx.referenceImages] : [];
        console.log(`🎯 [generate_image] skill="${skill || 'none'}" refs=${resolvedRefs.length} editPrompt="${editPrompt.slice(0, 80)}"`);
        if (reference_media_indices?.length) {
          for (const refIdx of reference_media_indices) {
            const v = validateImageIndex(ctx.snapshotImages, refIdx);
            if (!v.error) resolvedRefs.push(ctx.snapshotImages[v.idx]);
          }
        }

        // Priority: UI selector > agent tool param > auto-route
        const resolvedModel = (ctx.preferredModel ? ctx.preferredModel : model) as ModelId | undefined;
        const skillResult = await editImage(
          { editPrompt, skill: skill as 'enhance' | 'creative' | 'wild' | 'captions' | undefined, aspectRatio, background, preferredModel: resolvedModel, isNsfw: ctx.isNsfw },
          {
            currentImage: editTarget,
            referenceImages: resolvedRefs.length ? resolvedRefs : undefined,
            codexSubscription: runtime.spec.provider === 'codex-subscription' && ctx.userId
              ? {
                  userId: ctx.userId,
                  projectId: ctx.projectId,
                  agentModelId: runtime.spec.providerModelId,
                }
              : undefined,
          },
        );
        // Bill for image generation (separate from Agent LLM tokens)
        if (skillResult.usage && skillResult.provider !== 'codex-subscription') {
          import('./billing/credits').then(({ deductByTokens }) =>
            deductByTokens(
              ctx.userId ?? '',
              'generate_image',
              skillResult.usage!.modelId,
              skillResult.usage!.inputTokens,
              skillResult.usage!.outputTokens,
              undefined,
              undefined,
              undefined,
              skillResult.usage!.providerCostUsd,
            )
              .catch(e => console.error('[billing] generate_image deduct error:', e))
          );
        } else if (
          skillResult.provider !== 'codex-subscription'
          && skillResult.usedModel
          && skillResult.usedModel !== 'gemini'
        ) {
          // Per-action for ComfyUI models
          import('./billing/credits').then(({ deductCredits }) =>
            deductCredits(ctx.userId ?? '', null, `edit_image_${skillResult.usedModel}`)
              .catch(e => console.error('[billing] generate_image deduct error:', e))
          );
        }
        // NSFW detection: flag session so all subsequent calls skip Gemini
        if (skillResult.contentBlocked) ctx.isNsfw = true;
        if (skillResult.image) {
          ctx.currentImage = skillResult.image;
          ctx.snapshotImages.push(skillResult.image);
          ctx.generatedImages.push(skillResult.image);
          ctx.lastImageBackground = background;
          if (skillResult.usedModel) ctx.lastUsedModel = skillResult.usedModel;
          // Refresh URLs from DB — DualWriter uploads to Storage in parallel,
          // so base64 entries get replaced with http URLs for downstream tools
          await refreshSnapshotUrls(ctx);
        }
        const mediaIndex = skillResult.image ? ctx.snapshotImages.length : undefined;
        const imageUrl = mediaIndex ? ctx.snapshotImages[mediaIndex - 1] : undefined;
        const urlInfo = imageUrl?.startsWith('http')
          ? ` Resolved image URL: ${imageUrl}. Use this URL directly in Remotion composition props/code; do not use the <<<media_${mediaIndex}>>> marker inside composition code.`
          : '';
        const indexInfo = mediaIndex ? ` Now <<<media_${mediaIndex}>>>.${urlInfo}` : '';
        return {
          success: skillResult.success as true,
          message: skillResult.message + indexInfo,
          ...(mediaIndex ? { mediaIndex } : {}),
          ...(imageUrl?.startsWith('http') ? { imageUrl } : {}),
          provider: skillResult.provider,
          contentBlocked: skillResult.contentBlocked,
        };
      },
      toModelOutput({ output }: { output: any }) {
        return {
          type: 'content' as const,
          value: [{ type: 'text' as const, text: formatGeneratedImageForModel(output) }],
        };
      },
    });
}

function createGenerateAnimationTool(
  { ctx, serializeVideoSubmission }: AgentToolFactoryScope,
) {
  return tool({
      description: `Submit a video script for rendering.

Native-audio exception: when this tool is the chosen final-video workflow, put dialogue, narration, voice direction, music, ambience, and sound effects in \`story_prompt\` so the video provider generates synchronized audio. Do not additionally call \`generate_audio\` for that video. Outside this exception, \`generate_audio\` retains its full standalone scope.

Use this tool after the user has confirmed a video script that is already visible in the conversation. You may also call it in the same turn where you first write the script when the user's current request explicitly authorizes direct submission without confirmation, for example "直接提交渲染", "不要问我确认", "不用确认", "直接生成视频", "submit now", or "do not ask for confirmation". A trusted Skill template launch may also authorize same-turn submission; that exception is supplied only in the system prompt and never inferred from ordinary user text or an active Skill name.

When the user requests multiple independent video variants, submit them one at a time. After each \`generate_animation\` call returns a successful submission, continue with the next variant; do not wait for that video's rendering to finish. Continue until every requested variant is submitted. Each call contains one complete script within the chosen model limit; Seedance 2.5 and both Wan 3.0 tiers support up to 30 seconds, while older models remain shorter.

**BEFORE writing a video script**: call \`read_file('prompts/animate.md')\` to load the full video guide (modes, prompt styles, showcases, reference video usage). Do not re-read if already in this conversation's tool-result history.

Hard constraints:
- First line of script = short title (2-5 words). Then script body.
- Use \`<<<media_N>>>\` to reference images AND videos (N starts at 1). Videos in the timeline are auto-routed — just reference them like images. For native SeeDance, Wan 3.0, or MiniMax H3 text-to-video with no source media, use no media markers and do not generate an intermediate image first. Gemini Omni 1.1 text-to-video follows the same no-marker rule.
- To EDIT a video: reference it with \`<<<media_N>>>\` and describe the changes. The selected model must support reference videos.
- To CONTINUE a video with Gemini Omni, Seedance 2.5, or Grok: reference the timeline video with \`<<<media_N>>>\`, set \`video_operation: "extend"\`, and write only what should happen after its current ending. Grok accepts one 2-15s MP4 and adds 2-10s; Gemini Omni continues forward for 3-10s (10s by default).
- To use CLI/app imported reference music/audio for pacing or beat sync, mention its Audio Index marker in \`story_prompt\` (for example \`<<<audio_1>>>\`) AND pass \`audio_refs\` like ["audio_1"]. Audio refs are NOT Timeline Media Index refs. Reference audio is supported by Seedance video models, Wan 3.0, MiniMax H3, and Sync Lipsync v3.
- Talking-head translation exception: finish the source edit first, prepare a silent accepted A-roll plus its original voice reference, then use SeeDance 2.0 with the target-language dialogue written directly inside the complete \`Shot N (Xs):\` script. Do not call Seed Audio for this route.
- Works for Kling, SeeDance, SeeDance Mini, Seedance 2.5, Wan 3.0, Grok, Gemini Omni, and MiniMax H3, but respect capability limits and tool errors. Grok uses 1.5 for text/image/reference generation and the base Imagine Video model for edit/extend.
- Single-call total duration: Seedance 2.5 is 4-30 seconds; Wan 3.0 is 2-30 seconds; SeeDance 2.0 is 4-15 seconds; SeeDance/SeeDance Mini and MiniMax H3 are 4-15 seconds; Kling is 5-15 seconds; Grok 1.5 is 1-15 seconds; Google Omni is 3-10 seconds. For a non-NSFW direct 16-30 second request, choose Seedance 2.5 while the app selector remains automatic. For any NSFW/adult-explicit video request, choose Wan 3.0 instead; this semantic route has higher priority than the duration route, analogous to choosing Qwen for NSFW image requests.
- If a complete script fits the selected model's single-call limit, submit it as one video generation call. Put the whole title, every \`Shot N (Xs):\` line, and the \`Style:\` line into the same \`story_prompt\`; set \`duration\` to the total script duration when known. Do not submit only one shot, the first shot, or one line from the script.
- If the source video may exceed model limits, call \`read_file('skills/video-ffmpeg-lab/SKILL.md')\` and split it once with \`run_code({ runtime: "node" })\` before submitting generation.
- Total duration must fit the selected model's capability. Do not shrink a long source just to bypass a limit; split first.
- Long source video rule: if a timeline/reference video is longer than the selected model's input limit (15 seconds for SeeDance 2.0, MiniMax H3, or Wan 3.0; 30 seconds for Seedance 2.5), use \`skills/long-video-director/SKILL.md\`, analyze/split it into model-sized self-contained segments, and submit one script per segment after approval.
- Reference video input limit: for one SeeDance generation, combined source duration must be at most 15 seconds for SeeDance 2.0 or 30 seconds for SeeDance 2.5. Google Omni edit/extend accepts one source video up to 10 seconds when uploaded; a Google-generated result can continue statefully to 40 seconds cumulatively. Grok edit accepts one MP4 up to 8.7 seconds; Grok extend accepts one MP4 from 2 to 15 seconds and adds 2 to 10 seconds. For one MiniMax H3 generation, up to 3 reference videos may be used and their combined source duration must be 15 seconds or less.
- Wan 3.0 reference limit: use generation mode with up to 10 images, 5 videos, and 5 audio files (20 total). MuleRouter accepts provider-readable MP4/MOV references up to 100MB each, enforces a 15-second combined input budget, and requires reference-video duration + requested output duration <= 30 seconds. For example, a 5.04s reference permits at most duration=24 because output duration is submitted in whole seconds. Compute this before calling the tool; the runtime harness also rejects an invalid combination before credits or provider submission.
- Reference video size limit: for one SeeDance generation, every reference video must be .mp4/.mov, <=50MB, width and height each 300-6000px, aspect ratio 0.4-2.5, and frame pixels width*height between 409,600 and 2,086,876. MiniMax H3 reference videos must each be .mp4/.mov, <=50MB, width and height each 256-5760px, and aspect ratio 0.4-2.5. Kling video references must be <=200MB and <=2K; no explicit lower resolution is documented.
- Reference image input limit: EvoLink Seedance requires JPEG/PNG/WebP, width and height each 300-6000px, aspect ratio 0.4-2.5, and <=30MB per image. The runtime returns a specific errorReason such as too_small or too_large. If repairable=true, decide whether to prepare a new compliant image URL or ask the user for a better source; never resubmit the same rejected URL.
- Reference image input limit: MiniMax H3 accepts up to 9 reference images. The first 5 are free provider inputs; images 6-9 incur per-image provider cost. H3 also accepts up to 3 reference audio files, but audio cannot be the only reference input.
- Video edit duration lock: when editing timeline videos within the selected model's input limit, output duration should match the combined source duration from Media Index, clamped to 4-15s for SeeDance 2.0 or 4-30s for SeeDance 2.5. Dedicated Seedance 2.5 edit may use adaptive duration.
- Default model follows app selection, usually SeeDance 2.0 Fast (\`seedance-fast\`) at 720p; do not silently change it except for semantic capability routing. Use \`seedance-2.5\` when the user asks for Seedance 2.5, a non-NSFW single 16-30 second generation, more than the older reference limits, or its dedicated edit/extend features. Use \`wan-3.0\` when the selector/user asks for Wan 3.0 Standard or when the request is NSFW/adult-explicit; the NSFW route overrides the 16-30 second Seedance 2.5 route. Use \`wan-3.0-pro\` for explicit Pro, super-resolution, 2K, or 4K requests; it supports 1080p/2K/4K. Both Wan tiers generate 2-30s with up to 10 image + 5 video + 5 audio references and do not expose typed edit/extend or a content-filter toggle. Use \`minimax-h3\` only when the selector or user explicitly asks for MiniMax/H3/Hailuo H3; it supports public 768p and native 2K multimodal generation, defaulting to 768p. Use 2K only when explicitly requested or when the user asks for maximum/final quality.
- Grok modes: text-to-video supports 480p/720p/native 1080p. Any image or preset voice input uses reference-to-video and is capped at 720p, including a single image. Reference prompts must map every image to a role and may use a supported \`aspect_ratio\`. Optional \`reference_voice_ids\` accepts up to three xAI preset voices such as eve/leo; do not put uploaded audio URLs there.
- \`video_ref_url\`: ONLY for external videos not in Media Index (e.g. from workspace/list_files). Never put video URLs in prompt text.
- If the generated video is an intermediate artifact, pass \`completion_actions\` so CUI/CLI can show the next step after rendering finishes. These actions are user-confirmed by default; do not rely on the user remembering what to do next. For local video repair, include exact replaceStart/replaceEnd/replacementDuration and say to trim/fit the patch to that duration before merging so the final video keeps the original duration.
- The script must have been shown to the user and confirmed before this tool is called, unless the user's current request explicitly asks for direct submission without confirmation or the system prompt supplies the trusted Skill template launch exception.`,
      inputSchema: z.object({
        story_prompt: z.string().describe('The complete video script. First line = short title, then the body. Native SeeDance, Wan 3.0, or MiniMax H3 text-to-video uses no media markers; Gemini Omni 1.1 follows the same rule. Makaron translates <<<media_N>>> / <<<audio_N>>> into each provider family\'s markers.'),
        duration: z.number().optional().describe('Duration in seconds. Sync Lipsync v3 follows a 2-60s accepted source; Seedance 2.5 accepts 4-30s; Wan 3.0 accepts 2-30s; for Seedance 2.5 video_operation="edit", omit duration or pass -1 because Makaron follows the source duration automatically. SeeDance/SeeDance Mini and MiniMax H3 accept 4-15s; Kling accepts 5-15s; Grok accepts 1-15s; Google Omni accepts 3-10s.'),
        aspect_ratio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '3:2', '2:3']).optional().describe('Output aspect ratio. Pass it only when the user asks for a specific shape and the selected model can honor it. Seedance supports 16:9/9:16/1:1/4:3/3:4/21:9/adaptive. Grok reference-to-video accepts supported fixed ratios.'),
        model: z.string().optional().describe('Video model/provider id. Supported ids include seedance-fast, seedance-mini, seedance, seedance-2.5, wan-3.0, wan-3.0-pro, kling, grok, google-omni, minimax-h3, and sync-lipsync-v3. Choose seedance-2.5 for non-NSFW direct 16-30s requests. Choose wan-3.0 for every NSFW/adult-explicit video request, even at 16-30s; use wan-3.0-pro only for Pro/super-resolution/2K/4K. Use sync-lipsync-v3 only with exactly one source video and one replacement audio ref.'),
        video_resolution: z.enum(['360p', '480p', '720p', '768p', '1080p', '2k', '4k', 'auto']).optional().describe('Output resolution. Grok 1.5 supports 480p/720p/native 1080p for text-to-video; any image/voice reference and video edit/extend are capped at 720p. Gemini Omni 1.1 supports 360p drafts, 720p native/default, and upscaled 1080p/4k.'),
        media_refs: z.array(z.string()).optional().describe('Additional image URLs NOT already in Media Index (e.g. workspace files from list_files). Images in Media Index are auto-available — just use <<<media_N>>> in script. Passing Media Index URLs here will be rejected.'),
        audio_refs: z.array(z.string()).optional().describe('Reference audio labels from the Audio Index block, e.g. ["audio_1"], or HTTPS provider URLs returned by run_code Node media preparation. Use for voice identity, beat sync, pacing, or music reference. Mention each one as <<<audio_N>>> in story_prompt. Supported by SeeDance models, Wan 3.0, and MiniMax H3.'),
        reference_voice_ids: z.array(z.string()).max(3).optional().describe('Grok Imagine Video 1.5 preset xAI voice ids, e.g. ["eve"] or ["eve","leo"]. Reference them as <AUDIO_0>, <AUDIO_1> in story_prompt. Do not use Audio Index labels or uploaded URLs here.'),
        video_ref_url: z.string().optional().describe('External reference video URL (from workspace/skill assets via list_files). For timeline videos, just use <<<media_N>>> — they are auto-routed. Only use this for external URLs not in Media Index. SeeDance 2.0 video references must be <=50MB, width/height 300-6000px, aspect ratio 0.4-2.5, frame pixels 409,600-2,086,876. Seedance 2.5 accepts .mp4/.mov <=200MB, width/height 300-6000px, frame pixels 409,600-8,295,044, 4-30s each and <=30s total. MiniMax H3 video references must be <=50MB, width/height 256-5760px, aspect ratio 0.4-2.5, with at most 3 videos totaling <=15s. Kling video references must be <=200MB and <=2K; no explicit lower resolution is documented. Google Omni accepts one reference video in Makaron. Grok edit accepts one MP4 up to 8.7 seconds; Grok extend accepts one MP4 from 2 to 15 seconds.'),
        video_ref_type: z.enum(['base', 'feature']).optional().describe('How to use an external reference video. feature (default): reference motion/style. base: direct edit. For Gemini Omni or Seedance 2.5 continuation, also set video_operation="extend". Timeline videos are auto-routed from <<<media_N>>>.'),
        keep_original_sound: z.boolean().optional().describe('Keep audio from reference video. Default: false.'),
        motion_control: z.boolean().optional().describe('Use Kling Motion Control for precise action transfer from reference video. Requires video_ref_url. Duration = reference video length. No detailed prompt needed — just a title. Kling only.'),
        character_orientation: z.enum(['image', 'video']).optional().describe('For motion_control: match photo orientation (image, ≤10s) or video orientation (video, ≤30s). Default: image.'),
        video_operation: z.enum(['generate', 'edit', 'extend']).optional().describe('Typed video operation. Grok, Gemini Omni, and Seedance 2.5 support edit/extend; both require a video reference. Grok edit preserves source duration/aspect and caps output at 720p; Grok extend adds 2-10s.'),
        extend_direction: z.enum(['forward', 'backward']).optional().describe('Direction for Seedance 2.5 video extension. Gemini Omni only extends forward.'),
        generate_audio: z.boolean().optional().describe('Generate synchronized native audio; Seedance 2.5 defaults to true.'),
        content_filter: z.boolean().optional().describe('Seedance 2.5 output content filter. Default true. Set false only after explicit user confirmation, including the Mature Mode recovery action; it costs 10% more. Never infer or auto-enable Mature Mode from prompt wording.'),
        output_format: z.enum(['mp4', 'mov']).optional().describe('MP4 for playback or MOV for grading.'),
        web_search: z.boolean().optional().describe('Enable Seedance 2.5 text-to-video web grounding.'),
        completion_actions: z.array(z.object({
          label: z.string().describe('Short button label shown when the video finishes, e.g. "合入原视频" or "加入剪辑".'),
          prompt: z.string().describe('Natural-language instruction to send back to the agent if the user chooses this action. Include concrete media refs/timing when known. For video segment replacement, include replaceStart, replaceEnd, replacementDuration, and require trimming/fitting the patch before FFmpeg merge so the final duration matches the original.'),
          description: z.string().optional().describe('One short line explaining what this action will do.'),
          policy: z.enum(['confirm', 'auto']).optional().describe('confirm = show an action for the user to click. auto is reserved for explicitly authorized end-to-end workflows. Default confirm.'),
        })).optional().describe('Optional next-step actions to show when this async video finishes. Use this for intermediate artifacts such as a generated segment that should later be merged, or generated clips that can be assembled. Do not use it for ordinary final videos.'),
      }),
      execute: async ({ story_prompt, duration, aspect_ratio, model, video_resolution, media_refs, audio_refs, reference_voice_ids, video_ref_url, video_ref_type, keep_original_sound, motion_control, character_orientation, video_operation, extend_direction, generate_audio, content_filter, output_format, web_search, completion_actions }) => serializeVideoSubmission(async () => {
        // Refresh base64 → URL from DB before video submission
        await refreshSnapshotUrls(ctx);
        // GUI animation mode: use animationImageUrls; CUI mode: use full snapshotImages (no filter — preserve index alignment)
        let imageUrls = ctx.animationImageUrls;
        if (!imageUrls?.length) {
          imageUrls = [...ctx.snapshotImages];
        }
        if (media_refs?.length) {
          imageUrls = [...(imageUrls || []), ...media_refs.filter(u => u.startsWith('http'))];
        }
        const requestedModel = normalizeVideoModelId(model);
        const videoSelection = requestedModel === 'sync-lipsync-v3'
          ? { model: requestedModel, resolution: video_resolution ?? 'auto', locked: false }
          : resolveAgentVideoSelection({
            appModel: (ctx as any).videoModel,
            appResolution: (ctx as any).videoResolution,
            appAuto: (ctx as any).videoAuto,
            toolModel: model,
            toolResolution: video_resolution,
          });
        const videoModel = videoSelection.model;
        const isSeedance25Edit = videoModel === 'seedance-2.5' && video_operation === 'edit';
        const videoRoute = resolveVideoGenerationRoute({
          model: videoModel,
          resolution: videoSelection.resolution,
        });
        if (!imageUrls?.length && !video_ref_url && !supportsNativeTextToVideo(videoModel)) {
          return { success: false as const, message: `${videoRoute.label} requires an image or video reference. Use SeeDance, Wan 3.0, Grok Imagine Video, Gemini Omni, or MiniMax H3 for native text-to-video.` };
        }
        let reservedVideoCredits = 0;
        const reservationToolName = videoModel === 'grok' ? 'create_video_grok' : 'create_video';
        try {
          const selectedAspectRatio = aspect_ratio;
          const resolvedAudioRefs = resolveAudioRefs(ctx.audioAttachments, audio_refs);
          if (resolvedAudioRefs.error) {
            return { success: false as const, message: resolvedAudioRefs.error };
          }
          if (resolvedAudioRefs.audioUrls.length > 0 && videoRoute.provider !== 'seedance' && videoRoute.provider !== 'mulerouter' && videoRoute.provider !== 'minimax' && videoRoute.provider !== 'fal-sync') {
            return {
              success: false as const,
              message: videoRoute.provider === 'google-omni'
                ? 'Google Omni can generate native audio from the prompt, but uploaded audio_refs are not enabled in the current API. Choose seedance-fast, seedance-mini, or seedance for audio_refs, or remove audio_refs and describe the soundtrack for Omni.'
                : 'Reference audio is only supported by Seedance video models, Wan 3.0, or MiniMax H3, except exact replacement audio with Sync Lipsync v3. Choose a compatible model or remove audio_refs.',
            };
          }

          // Video harness: validate before calling API
          const { validateVideoScript } = await import('./video-harness');
          const harnessError = validateVideoScript({
            prompt: story_prompt,
            imageCount: imageUrls.length,
            availableMediaIndices: imageUrls.flatMap((url, index) =>
              url && url !== '/video-placeholder.png' ? [index + 1] : [],
            ),
            imageUrls,
            imageRefs: media_refs,
            videoRefUrl: video_ref_url,
            videoRefType: video_ref_type,
            model: videoModel,
            aspectRatio: selectedAspectRatio,
            motionControl: motion_control,
            duration,
            operation: video_operation,
          });
          if (harnessError) {
            return { success: false as const, message: harnessError };
          }

          // Save first valid image URL (not video) for poster
          const originalFirstUrl = imageUrls.find((u: string) => u?.startsWith('http') && !u.endsWith('.mp4')) || '';

          // Auto-route video references: query DB for snapshot types
          const originalImageUrlsByIndex = [...imageUrls];
          const scriptRefs = [...new Set(
            Array.from(story_prompt.matchAll(/<<<(?:image|media)_(\d+)>>>/g), m => Number(m[1]))
          )];
          const autoVideoUrls: string[] = [];
          const sourceVideoSnapshotIds: string[] = [];
          let googleOmniPreviousInteractionId: string | undefined;
          const videoRefIndices = new Set<number>();
          let totalVideoRefDuration = 0;
          const referenceVideoMetas: Array<{ width?: number | null; height?: number | null; fileSizeBytes?: number | null }> = [];
          if (ctx.supabase && ctx.projectId) {
            const { data: dbSnaps } = await ctx.supabase
              .from('snapshots')
              .select('id, type, video_meta')
              .eq('project_id', ctx.projectId)
              .order('sort_order');
            if (dbSnaps?.length) {
              for (const ref of scriptRefs) {
                const snap = dbSnaps[ref - 1];
                const meta = snap?.video_meta as Record<string, unknown> | null;
                const videoUrl = meta?.videoUrl as string | undefined;
                if (snap?.type === 'video' && videoUrl) {
                  autoVideoUrls.push(videoUrl);
                  videoRefIndices.add(ref);
                  if (snap.id) sourceVideoSnapshotIds.push(snap.id);
                  const sourceTaskId = typeof meta?.taskId === 'string' ? meta.taskId : '';
                  if (
                    videoModel === 'google-omni'
                    && video_operation === 'extend'
                    && sourceTaskId.startsWith('google-omni-')
                    && !sourceTaskId.startsWith('google-omni-job-')
                  ) {
                    googleOmniPreviousInteractionId = sourceTaskId.slice('google-omni-'.length);
                  }
                  referenceVideoMetas.push({
                    width: Number.isFinite(Number(meta?.width)) ? Number(meta?.width) : null,
                    height: Number.isFinite(Number(meta?.height)) ? Number(meta?.height) : null,
                    fileSizeBytes: Number.isFinite(Number(meta?.fileSizeBytes)) ? Number(meta?.fileSizeBytes) : null,
                  });
                  totalVideoRefDuration += (meta?.duration as number) || 0;
                  imageUrls[ref - 1] = '';
                }
              }
            }
          }
          const referencedImageUrlsForRetry = scriptRefs
            .map(ref => imageUrls[ref - 1])
            .filter((url): url is string => !!url && url.startsWith('http') && !url.endsWith('.mp4'));
          const repeatedInvalidUrl = referencedImageUrlsForRetry.find(url => ctx.invalidVideoImageUrls?.has(url));
          if (repeatedInvalidUrl) {
            return {
              success: false as const,
              retryable: false as const,
              repairable: false as const,
              terminal: true as const,
              errorCode: 'seedance_reference_image_unchanged_retry_blocked',
              errorReason: 'unchanged_invalid_input',
              message: 'The same Seedance reference image URL was already rejected in this turn. Do not submit it again. Use a newly resized/converted URL or ask the user for a better source.',
              userMessage: {
                en: 'The same invalid reference image was submitted again, so Makaron stopped the retry loop. Use a newly prepared image URL or replace the source.',
                zh: '同一张不合格参考图再次被提交，Makaron 已停止重试。请先生成新的合规图片 URL，或让用户更换原图。',
              },
            };
          }
          const allVideoUrls = [...(video_ref_url ? [video_ref_url] : []), ...autoVideoUrls];
          if (video_ref_url && autoVideoUrls.length > 0 && videoModel !== 'seedance-2.5' && videoModel !== 'wan-3.0' && videoModel !== 'wan-3.0-pro') {
            return {
              success: false as const,
              message: 'Do not mix video_ref_url with timeline video markers in one generation. For a local segment edit, pass only the extracted segment as video_ref_url and remove any <<<media_N>>> markers that point to timeline videos.',
            };
          }
          const referenceVideoDuration = totalVideoRefDuration > 0 ? totalVideoRefDuration : undefined;
          const isGoogleOmniStatefulExtend = Boolean(
            videoModel === 'google-omni'
            && video_operation === 'extend'
            && googleOmniPreviousInteractionId
            && allVideoUrls.length === 1
          );
          if (isGoogleOmniStatefulExtend) {
            console.log(`[generate_animation] using Google Omni stateful extension lineage from ${sourceVideoSnapshotIds[0] || 'timeline video'}`);
          }
          if (isGoogleOmniStatefulExtend && (referenceVideoDuration ?? 0) + (duration ?? 10) > 40) {
            return {
              success: false as const,
              message: 'Google Omni can extend a generated video up to 40 seconds cumulatively.',
            };
          }
          const modelError = validateVideoModelRequest({
            model: videoModel,
            resolution: videoRoute.resolution,
            aspectRatio: selectedAspectRatio,
            outputDuration: isSeedance25Edit ? -1 : duration,
            referenceVideoDuration: isGoogleOmniStatefulExtend
              ? Math.min(referenceVideoDuration ?? 10, 10)
              : referenceVideoDuration,
            referenceVideoMetas: referenceVideoMetas.length ? referenceVideoMetas : undefined,
            hasVideoReference: allVideoUrls.length > 0,
            videoReferenceCount: allVideoUrls.length,
            audioReferenceCount: resolvedAudioRefs.audioUrls.length,
            operation: video_operation,
          });
          if (modelError) {
            return {
              success: false as const,
              message: modelError,
            };
          }
          const effectiveDuration = resolveVideoOutputDuration({
            requestedDuration: isSeedance25Edit ? undefined : duration,
            referenceVideoDuration,
            model: videoModel,
            operation: video_operation,
          });
          let providerVideoRefUrl = video_ref_url;
          let providerAutoVideoUrls = autoVideoUrls;
          if (allVideoUrls.length > 0 && ctx.userId && ctx.projectId && !isGoogleOmniStatefulExtend) {
            const { prepareProviderVideoReferences } = await import('@/lib/provider-video-reference');
            const referenceSupabase = ctx.supabase || (await import('@/lib/supabase/service')).getSupabaseAdmin();
            const prepared = await prepareProviderVideoReferences({
              supabase: referenceSupabase,
              userId: ctx.userId,
              projectId: ctx.projectId,
              urls: allVideoUrls,
              reason: videoRoute.provider,
            });
            if (prepared.normalized.length > 0) {
              console.log(`[generate_animation] normalized ${prepared.normalized.length} video reference(s) for provider input`);
            }
            providerVideoRefUrl = video_ref_url ? prepared.urls[0] : undefined;
            providerAutoVideoUrls = video_ref_url ? prepared.urls.slice(1) : prepared.urls;
          }
          if (isGoogleOmniStatefulExtend) {
            providerVideoRefUrl = undefined;
            providerAutoVideoUrls = [];
          }

          const createVideoInput = {
            script: story_prompt,
            images: imageUrls,
            duration: effectiveDuration,
            aspectRatio: selectedAspectRatio,
            videoModel,
            videoResolution: videoRoute.resolution,
            videoUrl: providerVideoRefUrl,
            videoReferType: video_ref_type,
            videoUrls: providerAutoVideoUrls.length ? providerAutoVideoUrls : undefined,
            referenceVideoDuration,
            referenceVideoMetas: referenceVideoMetas.length ? referenceVideoMetas : undefined,
            keepOriginalSound: keep_original_sound,
            motionControl: motion_control,
            characterOrientation: character_orientation,
            audioUrls: resolvedAudioRefs.audioUrls.length ? resolvedAudioRefs.audioUrls : undefined,
            referenceVoiceIds: reference_voice_ids,
            videoOperation: video_operation,
            previousInteractionId: isGoogleOmniStatefulExtend ? googleOmniPreviousInteractionId : undefined,
            videoExtendDirection: extend_direction,
            generateAudio: generate_audio,
            contentFilter: content_filter,
            outputFormat: output_format,
            webSearch: web_search,
          };
          const isGoogleOmniAsync = videoRoute.provider === 'google-omni';
          if (isGoogleOmniAsync && !ctx.userId) {
            return { success: false as const, message: 'Google Omni video jobs require an authenticated workspace so the completed video can be saved to Storage.' };
          }

          const referencedImageUrls = scriptRefs
            .filter(ref => !videoRefIndices.has(ref))
            .map(ref => originalImageUrlsByIndex[ref - 1])
            .filter((u): u is string => !!u && u.startsWith('http') && !u.endsWith('.mp4'));
          const videoSec = effectiveDuration || 10;
          const creditsRequired = getRequiredVideoCredits({
            model: videoModel,
            resolution: videoRoute.resolution,
            durationSec: videoSec,
            imageCount: referencedImageUrls.length,
            referenceVideoDurationSec: isGoogleOmniStatefulExtend
              ? Math.min(referenceVideoDuration ?? 10, 10)
              : referenceVideoDuration,
            operation: video_operation,
            contentFilter: content_filter,
          });

          if (ctx.userId) {
            const creditCheck = await requireCredits(ctx.userId, creditsRequired);
            if (!creditCheck.ok) {
              return {
                success: false as const,
                message: `Insufficient credits. This video needs ${creditsRequired} credits, but the current balance is ${creditCheck.balance}.`,
              };
            }
            try {
              const reservation = await deductFixedCredits(
                ctx.userId,
                creditsRequired,
                reservationToolName,
                videoModel,
                undefined,
              );
              reservedVideoCredits = reservation.charged;
            } catch (error) {
              if (isInsufficientCreditsError(error)) {
                return {
                  success: false as const,
                  message: `Insufficient credits. This video needs ${error.required} credits, but the current balance is ${error.balance}.`,
                };
              }
              throw error;
            }
          }

          const skillResult = isGoogleOmniAsync
            ? {
              success: true as const,
              taskId: `google-omni-job-${crypto.randomUUID()}`,
              videoModel,
              providerModel: videoRoute.providerModel,
              status: 'processing' as const,
              message: 'Google Omni video job queued in Makaron.',
            }
            : await createVideo(createVideoInput);

          if (!skillResult.success || !skillResult.taskId) {
            console.error('[generate_animation] createVideo failed:', skillResult.message);
            if (reservedVideoCredits > 0 && ctx.userId) {
              await refundCredits(ctx.userId, reservedVideoCredits, reservationToolName);
              reservedVideoCredits = 0;
            }
            if (skillResult.invalidMediaUrls?.length) {
              ctx.invalidVideoImageUrls ??= new Set<string>();
              for (const url of skillResult.invalidMediaUrls) ctx.invalidVideoImageUrls.add(url);
            }
            return {
              success: false as const,
              message: skillResult.message,
              ...(skillResult.retryable === false ? { retryable: false as const } : {}),
              ...(skillResult.repairable != null ? { repairable: skillResult.repairable } : {}),
              ...(skillResult.terminal != null ? { terminal: skillResult.terminal } : {}),
              ...(skillResult.errorCode ? { errorCode: skillResult.errorCode } : {}),
              ...(skillResult.errorReason ? { errorReason: skillResult.errorReason } : {}),
              ...(skillResult.errorDetails ? { errorDetails: skillResult.errorDetails } : {}),
              ...(skillResult.suggestedAction ? { suggestedAction: skillResult.suggestedAction } : {}),
              ...(skillResult.userMessage ? { userMessage: skillResult.userMessage } : {}),
            };
          }

          const taskId = skillResult.taskId;
          const actualVideoModel = (skillResult.videoModel || videoModel) as string;
          const actualVideoRoute = resolveVideoGenerationRoute({
            model: actualVideoModel,
            resolution: videoRoute.resolution,
          });

          // Persist to DB as video snapshot (all new videos go here)
          // Store original prompt + full imageUrls so detail view shows correct @N indices
          // (createVideo already handles filterAndRemapImages internally for the model)
          const { getSupabaseAdmin } = await import('@/lib/supabase/service');
          const supabase = getSupabaseAdmin();
          const sourceUrls = [...referencedImageUrls, ...allVideoUrls].filter((u): u is string => !!u);

          const snapshotId = crypto.randomUUID();
          const { VIDEO_PLACEHOLDER_IMAGE } = await import('@/lib/editor/timeline-derivations');
          const videoMeta: import('@/types').VideoMeta = {
            taskId,
            videoUrl: skillResult.videoUrl || null,
            prompt: story_prompt,
            sourceSnapshotIds: sourceVideoSnapshotIds,
            sourceUrls: sourceUrls.length > 0 ? sourceUrls : (originalFirstUrl ? [originalFirstUrl] : []),
            status: skillResult.status === 'completed' && skillResult.videoUrl ? 'completed' : 'processing',
            duration: resolvePersistedVideoDuration({
              model: actualVideoModel,
              operation: video_operation,
              outputDuration: effectiveDuration,
              referenceVideoDuration,
            }) || null,
            model: actualVideoModel as import('@/types').VideoModel,
            resolution: actualVideoRoute.resolution,
            aspectRatio: selectedAspectRatio,
            providerModel: skillResult.providerModel || actualVideoRoute.providerModel,
            providerMode: actualVideoRoute.providerMode,
            operation: video_operation || 'generate',
            contentFilter: actualVideoModel === 'seedance-2.5' ? content_filter !== false : undefined,
            providerUrl: skillResult.videoUrl,
            createdAt: new Date().toISOString(),
            creditsCharged: reservedVideoCredits,
            ...(completion_actions?.length ? {
              completionActions: completion_actions.slice(0, 4).map(action => ({
                label: action.label,
                prompt: action.prompt,
                ...(action.description ? { description: action.description } : {}),
                policy: action.policy || 'confirm',
              })),
            } : {}),
          };

          const { data: sortData } = await supabase.rpc('next_sort_order', { p_project_id: ctx.projectId });

          const { error: insertError } = await supabase.from('snapshots').insert({
            id: snapshotId,
            project_id: ctx.projectId,
            image_url: VIDEO_PLACEHOLDER_IMAGE,
            tips: [],
            message_id: '',
            sort_order: sortData ?? 0,
            type: 'video',
            video_meta: videoMeta,
          });
          if (insertError) {
            console.error('[generate_animation] snapshot insert failed:', insertError.message);
            throw new Error(`DB insert failed: ${insertError.message}`);
          }
          reservedVideoCredits = 0;

          const providerCostUsd = estimateVideoProviderCostUsd({
            model: actualVideoModel,
            resolution: actualVideoRoute.resolution,
            durationSec: videoSec,
            imageCount: referencedImageUrls.length,
            referenceVideoDurationSec: referenceVideoDuration,
            operation: video_operation,
            contentFilter: content_filter,
          });
          if (providerCostUsd != null) videoMeta.providerCostUsd = providerCostUsd;

          if (!isGoogleOmniAsync && skillResult.status === 'completed' && skillResult.videoUrl && ctx.userId && !isPermanentUrl(skillResult.videoUrl)) {
            try {
              const { probeMP4Dimensions } = await import('@/lib/mp4-probe');
              const buffer = skillResult.videoUrl.startsWith('https://generativelanguage.googleapis.com/') || skillResult.videoUrl.startsWith('data:')
                ? await (await import('@/lib/google-omni-video')).fetchGoogleOmniVideoBytes(skillResult.videoUrl)
                : new Uint8Array(await (await fetch(skillResult.videoUrl)).arrayBuffer());
              const permanentUrl = await uploadVideo(supabase, ctx.userId, ctx.projectId, snapshotId, buffer);
              if (permanentUrl) {
                const dims = probeMP4Dimensions(buffer);
                videoMeta.videoUrl = permanentUrl;
                videoMeta.providerUrl = skillResult.videoUrl;
                videoMeta.videoPath = `${ctx.userId}/${ctx.projectId}/videos/${snapshotId}.mp4`;
                if (dims?.width) videoMeta.width = dims.width;
                if (dims?.height) videoMeta.height = dims.height;
              }
            } catch (persistError) {
              console.warn('[generate_animation] provider video persistence failed:', persistError);
            }
          }
          await supabase.from('snapshots').update({ video_meta: videoMeta }).eq('id', snapshotId);

          if (isGoogleOmniAsync && ctx.userId) {
            runGoogleOmniVideoSnapshotAfterResponse({
              userId: ctx.userId,
              projectId: ctx.projectId,
              snapshotId,
              taskId,
              videoMeta,
              createVideoInput,
            });
          }

          ctx.pendingVideoSnapshot = { snapshotId, taskId, videoMeta };

          const renderTimeMessage = actualVideoModel === 'grok'
            ? 'Grok is usually around 30-40 seconds.'
            : actualVideoModel === 'google-omni'
              ? 'Google Omni is usually around 30-70 seconds, then a short Storage handoff.'
              : 'Rendering usually takes 3-5 minutes.';
          return {
            success: true as const,
            taskId,
            message: `Video generation task created with ${actualVideoRoute.label} ${actualVideoRoute.resolution.toUpperCase()}. ${renderTimeMessage} The result will appear here when done.`,
          };
        } catch (e) {
          if (reservedVideoCredits > 0 && ctx.userId) {
            try {
              await refundCredits(ctx.userId, reservedVideoCredits, reservationToolName);
            } catch (refundError) {
              console.error('[billing] generate_animation reservation refund failed:', refundError);
            }
          }
          return { success: false as const, message: String(e) };
        }
      }),
    });
}

function createAnalyzeImageTool(
  { ctx, runtime, locale }: AgentToolFactoryScope,
) {
  return tool({
      description: 'See and analyze one timeline photo. Before calling, read that item\'s Media Index description: a specific description is existing media understanding regardless of which pipeline or Agent supplied it. Do not call this tool merely to restate covered content. Use it only when the description/evidence is missing, generic, failed, uncertain, or a concrete visual detail required by the user is not covered. A current upload batch is pre-analyzed in parallel into the Verified current upload batch block; consume that evidence instead of spending one tool round per image. This tool remains appropriate for red annotations, uncertain target regions, identity/detail inspection, ambiguous edits, or deeper questions. Do not call it before clear direct generate_image edits; generate_image already receives selected media. Use media_index to look at any snapshot in the timeline.',
      inputSchema: z.object({
        question: z.string().optional().describe('Optional focus area for the analysis'),
        media_index: z.number().optional().describe('1-based index of the snapshot to analyze (<<<media_1>>> = 1, etc.). Omit to analyze the current image.'),
      }),
      execute: async ({ question, media_index }) => {
        // Resolve which image to analyze
        let imageSource = ctx.currentImage;
        if (media_index !== undefined) {
          const v = validateImageIndex(ctx.snapshotImages, media_index);
          if (!v.error) imageSource = ctx.snapshotImages[v.idx];
        }

        if (!imageSource || imageSource.startsWith('__design_pending_')) {
          return { base64Data: '', mimeType: 'image/jpeg', question, error: 'No image available to analyze. Generate an image first using generate_image.' };
        }

        const buf = await fetchImageBuffer(imageSource, { maxBytes: 600_000, maxPx: 1024, quality: 75 });
        const analysisProvider = resolveAnalyzeImageProvider(runtime);
        if (analysisProvider === 'gemini-api') {
          const { analyzeImageContent } = await import('./gemini');
          const analysis = await analyzeImageContent(
            `data:image/jpeg;base64,${buf.toString('base64')}`,
            question,
            ctx.userId,
          );
          console.log(`[analyze_image] provider=gemini-api agentProvider=${runtime.spec.provider} mode=fallback`);
          return { analysis, question, analysisProvider };
        }
        console.log(`[analyze_image] provider=${runtime.spec.provider} model=${runtime.spec.providerModelId} mode=in-model`);
        return {
          base64Data: buf.toString('base64'),
          mimeType: 'image/jpeg',
          question,
          analysisProvider,
        };
      },

      toModelOutput({ output }: { output: any }) {
        if (output.analysis) {
          const languageRule = getReplyLanguageInstruction(locale).replace(/^Reply/, 'Answer the user');
          return {
            type: 'content' as const,
            value: [{
              type: 'text' as const,
              text: `${output.analysis}\n\nUse the analysis above as visual evidence. ${languageRule}`,
            }],
          };
        }
        // No image available — return text-only error
        if (!output.base64Data || output.error) {
          return {
            type: 'content' as const,
            value: [{ type: 'text' as const, text: output.error || 'No image available to analyze.' }],
          };
        }
        return {
          type: 'content' as const,
          value: [
            modelFileContent(output.base64Data, output.mimeType),
            {
              type: 'text' as const,
              text: output.question
                ? `Analyze the image above, focusing on: ${output.question}`
                : 'Analyze this image in detail for photo editing purposes.',
            },
          ],
        };
      },
    });
}

function createAnalyzeVideoTool(
  { ctx }: AgentToolFactoryScope,
) {
  return tool({
      description: `Analyze video content using Gemini vision.

Default mode describes scenes/actions/pacing/audio cues in a timeline video. Current upload batches are pre-analyzed in parallel into the Verified current upload batch block. If any video evidence is missing or failed, pass all affected video indices together in media_indices so the tool analyzes them concurrently. Otherwise do not call this before clear direct video edits such as adding glasses, changing outfit, or using Omni to edit a referenced video; generate_animation already receives selected video references. Use analyze_video only for inspection, comparison, diagnosis, ambiguous targets, or frame-location workflows.

Before calling describe mode, read each item's Media Index description. A specific description may already contain upstream video understanding such as summary, editorial purpose, scene evidence, and temporal bounds. Treat it as available evidence regardless of provider and do not call this tool merely to rediscover covered content. Call describe mode only when the description/evidence is missing, generic, failed, uncertain, or a concrete visual question required by the user remains uncovered.

Use mode="locate_frame" when the user provides a screenshot/frame and you need to find where that frame appears in a video. This is the primary locator for screenshot-based local video edits. Provide the video as media_index and the screenshot as image_url, image_media_index, or workspace_path. For checking a known timestamp visually, use preview_frame instead.`,
      inputSchema: z.object({
        media_index: z.number().optional().describe('1-based snapshot index of one video to analyze (<<<media_1>>> = 1).'),
        media_indices: z.array(z.number().int().positive()).max(20).optional().describe('For batch describe mode: all 1-based video Media Index entries to analyze concurrently in this one tool call.'),
        question: z.string().optional().describe('Specific aspect to focus on. In locate_frame mode, use this for the user note about what is wrong in the screenshot.'),
        mode: z.enum(['describe', 'locate_frame']).optional().describe('describe = normal video analysis. locate_frame = locate a screenshot inside this video. Default describe.'),
        image_url: z.string().optional().describe('For locate_frame: screenshot/frame image URL or data:image URL.'),
        image_media_index: z.number().optional().describe('For locate_frame: 1-based Media Index image snapshot to use as the screenshot/frame anchor.'),
        workspace_path: z.string().optional().describe('For locate_frame: workspace image path from preview_frame/read_file/list_files, e.g. project/drafts/frame.jpg.'),
      }),
      execute: async ({ media_index, media_indices, question, mode, image_url, image_media_index, workspace_path }) => {
        const requestedIndices = [...new Set([...(media_indices || []), ...(media_index ? [media_index] : [])])];
        if (!requestedIndices.length) return { error: 'Provide media_index or media_indices.' };
        if (mode === 'locate_frame' && requestedIndices.length !== 1) {
          return { error: 'locate_frame accepts exactly one video media_index.' };
        }

        if (mode !== 'locate_frame' && requestedIndices.length > 1) {
          const { analyzeVideoContent } = await import('./gemini');
          const analyses = await Promise.all(requestedIndices.map(async (index) => {
            const resolved = await resolveVideoUrlForMediaIndex(ctx, index);
            if (!resolved.videoUrl) return { media_index: index, error: resolved.error || 'Video not found.' };
            try {
              const analysis = await analyzeVideoContent(
                resolved.videoUrl,
                scopeVideoQuestionToSourceRange(question, resolved.sourceRange),
                ctx.userId,
              );
              return { media_index: index, analysis, videoUrl: resolved.videoUrl, source_range: resolved.sourceRange };
            } catch (err) {
              return { media_index: index, error: `Video analysis failed: ${err instanceof Error ? err.message : String(err)}` };
            }
          }));
          return { mode: 'batch_describe', analyses };
        }

        const mediaIndex = requestedIndices[0];
        const resolved = await resolveVideoUrlForMediaIndex(ctx, mediaIndex);
        if (!resolved.videoUrl) return { error: resolved.error || `No video found at <<<media_${mediaIndex}>>>.` };
        const videoUrl = resolved.videoUrl;

        try {
          if (mode === 'locate_frame') {
            const image = await resolveImageForAnalysis(ctx, {
              imageUrl: image_url,
              imageMediaIndex: image_media_index,
              workspacePath: workspace_path,
            });
            if (image.error || !image.image) return { error: image.error || 'No screenshot image provided for locate_frame.' };

            const { locateFrameInVideoContent, verifyFrameImageMatch } = await import('./gemini');
            let location = await locateFrameInVideoContent(
              videoUrl,
              image.image,
              scopeVideoQuestionToSourceRange(question, resolved.sourceRange),
              ctx.userId,
            );
            let verification: Record<string, unknown> | undefined;

            if ((location.verdict === 'located' || location.verdict === 'multiple_candidates') && typeof location.timestamp === 'number') {
              try {
                const { extractVideoFrame } = await import('./video-frame');
                const frameBuffer = await extractVideoFrame(videoUrl, { timestamp: location.timestamp });
                const candidateImage = `data:image/jpeg;base64,${frameBuffer.toString('base64')}`;
                const match = await verifyFrameImageMatch(image.image, candidateImage, question, ctx.userId);

                let candidateFrameUrl = '';
                let candidateFramePath = '';
                if (ctx.supabase && ctx.userId) {
                  candidateFramePath = `${ctx.projectId}/drafts/locate-verify-media${mediaIndex}-t${location.timestamp.toFixed(2).replace('.', '-')}-${Date.now()}.jpg`;
                  const ws = await workspace.writeFile(candidateFramePath, frameBuffer, ctx.supabase, ctx.userId, 'image/jpeg');
                  if (ws.storageUrl) candidateFrameUrl = toPublicStorageUrl(ws.storageUrl);
                }

                const verificationDetails = {
                  ...match,
                  candidateFramePath,
                  candidateFrameUrl,
                };
                verification = verificationDetails;
                location = { ...location, verification: verificationDetails };

                if (match.verdict !== 'match' || match.confidence < 0.72) {
                  location = {
                    ...location,
                    verdict: 'uncertain',
                    confidence: Math.min(location.confidence, match.confidence),
                    concerns: [
                      ...location.concerns,
                      `Verification failed: candidate frame did not confidently match the screenshot (${match.verdict}, ${match.confidence.toFixed(2)}).`,
                      ...match.concerns,
                    ].slice(0, 8),
                  };
                }
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                location = {
                  ...location,
                  verdict: 'uncertain',
                  confidence: Math.min(location.confidence, 0.4),
                  concerns: [...location.concerns, `Verification could not run: ${msg}`].slice(0, 8),
                };
              }
            }
            return {
              mode: 'locate_frame',
              location,
              verification,
              media_index: mediaIndex,
              videoUrl,
              source_range: resolved.sourceRange,
              imageSource: image.source,
            };
          }

          const { analyzeVideoContent } = await import('./gemini');
          const analysis = await analyzeVideoContent(
            videoUrl,
            scopeVideoQuestionToSourceRange(question, resolved.sourceRange),
            ctx.userId,
          );
          return { mode: 'describe', analysis, media_index: mediaIndex, videoUrl, source_range: resolved.sourceRange };
        } catch (err) {
          return { error: `Video analysis failed: ${err instanceof Error ? err.message : String(err)}` };
        }
      },

      toModelOutput({ output }: { output: any }) {
        if (output.error) {
          return { type: 'content' as const, value: [{ type: 'text' as const, text: output.error }] };
        }
        if (output.mode === 'locate_frame') {
          return {
            type: 'content' as const,
            value: [{
              type: 'text' as const,
              text: `Frame location for <<<media_${output.media_index}>>> using ${output.imageSource || 'screenshot'}:\n\n${JSON.stringify(output.location, null, 2)}`,
            }],
          };
        }
        if (output.mode === 'batch_describe') {
          return {
            type: 'content' as const,
            value: [{
              type: 'text' as const,
              text: output.analyses.map((item: any) => item.error
                ? `Video Analysis (<<<media_${item.media_index}>>>): ERROR — ${item.error}`
                : `Video Analysis (<<<media_${item.media_index}>>>):\n\n${item.analysis}`
              ).join('\n\n'),
            }],
          };
        }
        return {
          type: 'content' as const,
          value: [{ type: 'text' as const, text: `Video Analysis (<<<media_${output.media_index}>>>):\n\n${output.analysis}` }],
        };
      },
    });
}

function createTranscribeAudioTool(
  { ctx }: AgentToolFactoryScope,
) {
  return tool({
      description: `Transcribe audio or a timeline video with Volcengine ASR and return dialogue/subtitle timecodes.

Use this when the user asks for transcript, subtitles, dialogue, spoken words, lyrics-like speech timing, time-based editing such as "cut the part where they say X", or when \`prompts/audio.md\` requires verification of Seed Audio exact speech, brand names, numbers, multilingual lines, duration, or cue timing.

For narrated Remotion/Explainer work, pass expected_sections from the approved Script plus the Composition fps. The tool will align the measured speech to those section IDs, convert the same timebase to frames, and persist a narration cue sheet. That cue sheet is authoritative for Storyboard ranges, Remotion Sequences, subtitles, visual beats, and music ducking. Narration alignment is optional: if it fails, the successful ASR transcript is still returned with a warning.

For timeline videos, pass media_index. For external audio/video URLs, pass media_url. Results are cached into the video snapshot's video_meta.transcript when media_index is used. Use analyze_video instead for visual scene/action understanding.`,
      inputSchema: z.object({
        media_index: z.number().optional().describe('1-based Media Index index of the video to transcribe (<<<media_1>>> = 1). Preferred for timeline videos.'),
        media_url: z.string().optional().describe('External public audio/video URL to transcribe. Use only when the media is not in Media Index.'),
        language: z.string().optional().describe('Optional ASR language code such as zh-CN, en-US, ja-JP, ko-KR, id-ID. Omit for auto/default.'),
        force_refresh: z.boolean().optional().describe('Set true to ignore cached transcript and call ASR again. Default false.'),
        expected_sections: z.array(z.object({
          id: z.string().min(1).describe('Stable Script section ID.'),
          text: z.string().min(1).describe('Exact approved narration text for this Script section.'),
        })).min(1).max(100).optional().describe('Narrated Script sections in playback order. Pass these for Remotion/Explainer synchronization.'),
        fps: z.number().positive().max(120).optional().describe('Composition FPS used to convert measured speech seconds to frame ranges. Default 30.'),
      }),
      execute: async ({ media_index, media_url, language, force_refresh, expected_sections, fps }) => {
        const effectiveExpectedSections = normalizeExpectedNarrationSections(expected_sections);
        let resolvedUrl = media_url;
        let localMediaPath: string | undefined;
        let snapshotId: string | undefined;
        let videoMeta: Record<string, unknown> | undefined;
        let sourceRange: VideoSourceRange | undefined;
        if (!resolvedUrl && media_index !== undefined) {
          const v = validateImageIndex(ctx.snapshotImages, media_index);
          if (v.error) return { error: v.error };

          const mediaUrl = ctx.snapshotImages[v.idx];
          if (mediaUrl && /\.(mp4|webm|mov|mp3|wav|ogg|opus)(?:\?|$)/i.test(mediaUrl)) {
            resolvedUrl = mediaUrl;
          }

          if (ctx.supabase && ctx.userId) {
            const { data: snaps, error: snapErr } = await ctx.supabase
              .from('snapshots')
              .select('id, video_meta')
              .eq('project_id', ctx.projectId)
              .order('sort_order', { ascending: true });
            if (snapErr) console.error('[transcribe_audio] DB query error:', snapErr.message);
            const snap = snaps?.[v.idx];
            snapshotId = snap?.id as string | undefined;
            videoMeta = snap?.video_meta as Record<string, unknown> | undefined;
            sourceRange = sourceRangeFromVideoMeta(videoMeta);
            const cached = videoMeta?.transcript as VolcengineAsrTranscript | undefined;
            if (
              cached?.text
              && !force_refresh
              && isAsrTranscriptCacheCompatible(cached, language)
            ) {
              const transcriptArtifact = await createTranscriptArtifact({ ctx, transcript: cached });
              const cueArtifact = await createOptionalNarrationCueArtifact({
                ctx,
                transcript: cached,
                expectedSections: effectiveExpectedSections,
                fps,
              });
              return {
                transcript: cached,
                ...transcriptArtifact,
                ...cueArtifact,
                cached: true,
                media_index,
                videoUrl: cached.sourceUrl || resolvedUrl,
                source_range: sourceRange,
              };
            }
            resolvedUrl = resolvedUrl || (videoMeta?.videoUrl as string | undefined);
            const videoPath = typeof videoMeta?.videoPath === 'string' ? videoMeta.videoPath : '';
            if (videoPath) {
              try {
                const handle = await workspace.resolveWorkspaceFile(videoPath, ctx.supabase, ctx.userId, { hydrate: true });
                if (handle?.localAvailable && handle.localPath) localMediaPath = handle.localPath;
              } catch (error) {
                console.warn('[transcribe_audio] local workspace media unavailable; falling back to URL', error);
              }
            }
          }
        }

        if (!resolvedUrl || !/^https?:\/\//i.test(resolvedUrl)) {
          return { error: 'transcribe_audio requires a public audio/video URL or a valid video media_index.' };
        }

        try {
          const transcript = await transcribeWithVolcengineAsr({
            mediaUrl: resolvedUrl,
            localMediaPath,
            sourceRange: sourceRange ? { startSec: sourceRange.start_sec, endSec: sourceRange.end_sec } : undefined,
            uid: ctx.userId || 'makaron-agent',
            language,
          });
          const transcriptArtifact = await createTranscriptArtifact({ ctx, transcript });
          const cueArtifact = await createOptionalNarrationCueArtifact({
            ctx,
            transcript,
            expectedSections: effectiveExpectedSections,
            fps,
          });

          if (ctx.supabase && snapshotId && videoMeta) {
            const nextMeta = { ...videoMeta, transcript };
            const { error: updateError } = await ctx.supabase
              .from('snapshots')
              .update({ video_meta: nextMeta })
              .eq('id', snapshotId);
            if (updateError) console.error('[transcribe_audio] transcript cache update failed:', updateError.message);
          }

          return {
            transcript,
            ...transcriptArtifact,
            ...cueArtifact,
            cached: false,
            media_index,
            videoUrl: transcript.sourceUrl || resolvedUrl,
            source_range: sourceRange,
          };
        } catch (err) {
          return { error: `ASR transcription failed: ${err instanceof Error ? err.message : String(err)}` };
        }
      },

      toModelOutput({ output }: { output: any }) {
        if (output.error) {
          return { type: 'content' as const, value: [{ type: 'text' as const, text: output.error }] };
        }
        const transcript = output.transcript as VolcengineAsrTranscript | undefined;
        if (!transcript) {
          return { type: 'content' as const, value: [{ type: 'text' as const, text: 'No transcript returned.' }] };
        }
        const cueText = output.narrationCueSheet
          ? [
              '',
              `Authoritative narration cue sheet${output.narrationCuePath ? `: ${output.narrationCuePath}` : ''}:`,
              JSON.stringify(output.narrationCueSheet, null, 2),
              '',
              'Use these measured cue ranges and frame ranges for Storyboard, Remotion Sequences, subtitles, visual beats, and music ducking. Do not revert to planned Script timing.',
            ].join('\n')
          : '';
        const inlineTranscript = formatTranscriptForModel(transcript);
        const inlineCoverageText = formatInlineWordTimingCoverageNotice(
          inlineTranscript,
          output.transcriptPath,
        );
        const transcriptArtifactText = output.transcriptPath
          ? `\n\nFull word/utterance transcript artifact: ${output.transcriptPath}\nRead this file when the inline transcript is truncated or when later source-time ranges are needed. Reuse its existing startMs/endMs values; do not retranscribe or invent replacement timecodes.`
          : output.transcriptWarning
            ? `\n\nTranscript artifact warning: ${output.transcriptWarning}`
            : '';
        const narrationWarningText = output.narrationWarning
          ? `\n\nNarration alignment warning: ${output.narrationWarning}\nThe ASR transcript above succeeded and remains usable. Do not retranscribe unless the transcript itself is wrong.`
          : '';
        return {
          type: 'content' as const,
          value: [{
            type: 'text' as const,
            text: `${output.cached ? 'Cached ' : ''}ASR result${output.media_index ? ` for <<<media_${output.media_index}>>>` : ''}:\n\n${inlineTranscript.text}${inlineCoverageText}${cueText}${transcriptArtifactText}${narrationWarningText}`,
          }],
        };
      },
    });
}

function createPrepareVisualAssetTool(
  { ctx, runtime }: AgentToolFactoryScope,
) {
  return tool({
      description: `Prepare generated or supplied media for visual compositing without choosing the final layout.

Use mode "cutout" for a native transparent PNG/WebP or a controlled chroma-background image that should become a transparent PNG. Native alpha is preserved without re-keying; otherwise the deterministic bridge removes border-connected chroma plus sizeable enclosed high-confidence chroma pockets, despills semi-transparent edges, preserves only tiny isolated same-color subject details, computes subject/safe boxes, and renders a five-background QA sheet.

Use mode "edge-video" for an ordinary opaque clip generated with quiet edges close to the intended Remotion background. The bridge samples the clip over time, measures edge color/detail/drift, preserves a cached workspace copy, and returns target background, edge palette, feather guidance, and a QA contact sheet. It never creates transparent video or a fixed renderer.

Call this during the Studio Assets stage after reading skills/_shared/visual-asset-bridge/SKILL.md. On a resumed run, call it with mode + asset_id and no media source first; the bridge resolves the latest cached prepared record by semantic id. Use the returned preparedUrl in Composition. If quality is revise/fail, inspect the contact sheet and regenerate or reprepare the source instead of hiding the problem by shrinking it.`,
      inputSchema: z.object({
        mode: z.enum(['cutout', 'edge-video']),
        media_index: z.number().int().positive().optional().describe('Literal 1-based Media Index item to prepare.'),
        source_url: z.string().optional().describe('Public media URL or data URL. Use when the source is not in Media Index.'),
        asset_id: z.string().optional().describe('Stable semantic id used by Storyboard and Asset Manifest. With no media source, resolves the latest cached prepared asset after recovery.'),
        role: z.enum(['hero', 'support', 'decoration']).optional(),
        key_color: z.string().regex(/^#[0-9a-f]{6}$/i).optional().describe('Explicit chroma key color for cutout, e.g. #00ff00. Omit for border auto-detection.'),
        target_background: z.string().regex(/^#[0-9a-f]{6}$/i).optional().describe('Intended Remotion background for edge-video analysis.'),
        force_refresh: z.boolean().optional().describe('Ignore cached preparation and rebuild the asset.'),
      }),
      execute: async ({ mode, media_index, source_url, asset_id, role, key_color, target_background, force_refresh }) => {
        if (!ctx.supabase || !ctx.userId) return { success: false, error: 'Visual Asset Bridge requires an authenticated project workspace.' };
        let sourceUrl = source_url;
        let sourceSnapshotId: string | undefined;
        if (media_index !== undefined) {
          const snapshots = await refreshSnapshotUrls(ctx);
          const validated = validateImageIndex(ctx.snapshotImages, media_index);
          if (validated.error) return { success: false, error: validated.error };
          sourceUrl = ctx.snapshotImages[validated.idx];
          sourceSnapshotId = snapshots?.[validated.idx]?.id as string | undefined;
        }
        try {
          const cachedAsset = !sourceUrl && asset_id && !force_refresh
            ? await resolvePreparedVisualAssetById({
              projectId: ctx.projectId,
              userId: ctx.userId,
              supabase: ctx.supabase,
              assetId: asset_id,
            })
            : null;
          if (!sourceUrl && !asset_id) {
            return { success: false, error: 'Provide media_index, source_url, or asset_id to recover a prepared asset.' };
          }
          if (!sourceUrl && !cachedAsset) {
            return { success: false, error: `No prepared visual asset found for asset_id "${asset_id}". Provide its media_index or source_url once.` };
          }
          if (cachedAsset && cachedAsset.mode !== mode) {
            return { success: false, error: `Prepared asset "${asset_id}" uses mode ${cachedAsset.mode}, not ${mode}.` };
          }
          const result = cachedAsset
            ? { asset: cachedAsset, cached: true }
            : await prepareVisualAsset({
              projectId: ctx.projectId,
              userId: ctx.userId,
              supabase: ctx.supabase,
              sourceUrl: sourceUrl!,
              mode,
              assetId: asset_id,
              role,
              sourceSnapshotId,
              keyColor: key_color,
              targetBackground: target_background,
              forceRefresh: force_refresh,
            });
          rememberWorkspaceMediaOutputs(ctx, [
            {
              path: result.asset.sourceWorkspacePath,
              storageUrl: result.asset.sourceWorkspaceUrl,
              contentType: inferWorkspaceContentType(result.asset.sourceWorkspacePath),
              description: `${result.asset.assetId} source`,
            },
            {
              path: result.asset.workspacePath,
              storageUrl: result.asset.preparedUrl,
              contentType: result.asset.kind === 'image' ? 'image/png' : inferWorkspaceContentType(result.asset.workspacePath),
              description: `${result.asset.assetId} prepared ${result.asset.mode}`,
            },
            ...(result.asset.quality.contactSheetPath && result.asset.quality.contactSheetUrl ? [{
              path: result.asset.quality.contactSheetPath,
              storageUrl: result.asset.quality.contactSheetUrl,
              contentType: result.asset.mode === 'cutout' ? 'image/png' : 'image/jpeg',
              description: `${result.asset.assetId} visual asset QA`,
            }] : []),
          ]);
          let qaPreviewBase64: string | undefined;
          if (runtime.spec.supportsImageInput && result.asset.quality.contactSheetPath) {
            const qaFile = await workspace.resolveWorkspaceFile(
              result.asset.quality.contactSheetPath,
              ctx.supabase,
              ctx.userId,
              { hydrate: true },
            );
            if (qaFile?.localPath) {
              const qaPreview = await sharp(qaFile.localPath)
                .resize({ width: 640, withoutEnlargement: true })
                .jpeg({ quality: 78 })
                .toBuffer();
              qaPreviewBase64 = qaPreview.toString('base64');
            }
          }
          return {
            success: true,
            cached: result.cached,
            ready: result.asset.status === 'ready',
            asset: result.asset,
            qaPreviewBase64,
            message: result.asset.status === 'ready'
              ? `Prepared ${result.asset.assetId} is ready for Composition.`
              : `Prepared ${result.asset.assetId} needs revision. Inspect ${result.asset.quality.contactSheetPath}.`,
          };
        } catch (error) {
          return { success: false, error: `Visual asset preparation failed: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
      toModelOutput({ output }: { output: any }) {
        if (!output.success) {
          return { type: 'content' as const, value: [{ type: 'text' as const, text: output.error || 'Visual asset preparation failed.' }] };
        }
        return {
          type: 'content' as const,
          value: [
            ...(output.qaPreviewBase64 ? [modelFileContent(output.qaPreviewBase64, 'image/jpeg')] : []),
            {
              type: 'text' as const,
              text: `${output.message}\nCached: ${output.cached ? 'yes' : 'no'}\nThe image above is the QA contact sheet. Inspect it directly before declaring pass; status metadata alone is not visual approval.\nPreparedVisualAsset:\n${JSON.stringify(output.asset, null, 2)}`,
            },
          ],
        };
      },
    });
}

function createExecutionCheckpointTool(
  { ctx }: AgentToolFactoryScope,
) {
  return tool({
      description: `Persist concise continuation context for a durable Agent Run. Use it after meaningful progress, after a decision later attempts must preserve, and before a long or risky generation step. This is not a progress message for the user. Record durable workspace paths instead of copying file contents. Studio workflow stages belong in artifacts or next_action, not in Agent lifecycle state.`,
      inputSchema: z.object({
        objective: z.string().optional(),
        acceptance_criteria: z.array(z.string()).max(30).optional(),
        decisions: z.array(z.string()).max(30).optional(),
        completed_work: z.array(z.string()).max(50).optional(),
        artifacts: z.array(z.object({
          kind: z.string(),
          path: z.string().optional(),
          url: z.string().optional(),
          label: z.string().optional(),
        })).max(50).optional(),
        open_questions: z.array(z.string()).max(30).optional(),
        next_action: z.string(),
        attempt_summary: z.string().max(12_000).optional(),
      }),
      execute: async (input) => {
        if (!ctx.execution || !ctx.supabase || !ctx.userId) {
          return { success: false, error: 'No durable execution is active.' };
        }
        const store = new AgentExecutionStore(ctx.supabase, ctx.userId, ctx.projectId);
        const previous = await store.latestSnapshot(ctx.execution.runId);
        const snapshot = normalizeExecutionSnapshot({
          objective: input.objective || previous?.objective,
          acceptanceCriteria: input.acceptance_criteria || previous?.acceptanceCriteria,
          decisions: input.decisions || previous?.decisions,
          completedWork: input.completed_work || previous?.completedWork,
          artifacts: input.artifacts || previous?.artifacts,
          openQuestions: input.open_questions || previous?.openQuestions,
          currentWorkUnit: 'agent',
          nextAction: input.next_action,
          attemptSummary: input.attempt_summary,
          providerCompaction: previous?.providerCompaction,
        }, {
          objective: previous?.objective || 'Continue the durable execution objective.',
          currentWorkUnit: 'agent',
          nextAction: input.next_action,
        });
        const snapshotId = await store.saveSnapshot({
          runId: ctx.execution.runId,
          attemptId: ctx.execution.attemptId,
          projectId: ctx.projectId,
          kind: 'model_checkpoint',
          snapshot,
        });
        return {
          success: true,
          snapshotId,
          nextAction: snapshot.nextAction,
          message: 'Durable execution checkpoint saved.',
        };
      },
    });
}

function createStudioRunTool(
  { ctx }: AgentToolFactoryScope,
) {
  return tool({
      description: `Create and advance a Studio workflow invocation inside the current Agent Run for multi-stage video production.
Use this only when the user explicitly requests Studio, Remotion, an editable composition/timeline, precise programmatic compositing, launches a trusted Skill template, or requests a video longer than 15 seconds whose selected Skill requires Studio. A video up to and including 15 seconds stays on direct \`generate_animation\` even when it is an explainer or includes multiple scenes, voiceover, music, or subtitles.
The workflow persists typed artifacts in the existing project workspace and enforces dependencies, approval policy, resume state, and downstream invalidation. It is not a separate model-facing run and cannot be adopted by another Agent Run.
Operations:
- start: create the run before producing the creative packet. By default it returns only run state, keeping later stage schemas out of the model context. Set include_stage_schemas=true only for legacy/manual authoring.
- put_creative_packet: for approval_policy=auto, submit the brief, concept options, selected direction, and timed script once. The harness deterministically projects it into separate Brief, Proposal, and Script artifacts and emits one CUI event per stage.
- put_artifact: validate and persist an Agent-authored stage artifact. Agent-authored stages end at composition: brief, proposal, script, storyboard, assets, composition.
- put_artifacts: legacy/general batch operation for approval_policy=auto. Use put_creative_packet for new planning work; use this only when already holding complete adjacent Agent-authored stage artifacts.
- approve: approve a guided/manual stage that is awaiting approval.
- status: load the current run after a new turn or interrupted session. It returns the JSON Schema for the current stage.
- schema: return the JSON Schema for a requested stage before authoring its artifact.
- validate: validate a stage artifact without persisting it.
- invalidate: deliberately reopen a stage and invalidate only its downstream dependents.
Review means previewing and patching the Remotion source before export, not authoring a Review artifact. After Composition is persisted and visually satisfactory, call publish_draft once with the final design path so the editable result is durable. Then call materialize_media with the same path only when MP4 Delivery is requested. A successful export automatically completes the Review and Delivery UI states. Never author Review or Delivery JSON.`,
      inputSchema: z.object({
        operation: z.enum(['start', 'put_creative_packet', 'put_artifact', 'put_artifacts', 'approve', 'status', 'invalidate', 'schema', 'validate']),
        run_id: z.string().optional(),
        recipe: z.string().optional(),
        title: z.string().optional(),
        approval_policy: z.enum(['auto', 'guided', 'manual']).optional(),
        delivery_promise: z.object({
          durationSeconds: z.number().positive().max(600),
          width: z.number().int().positive(),
          height: z.number().int().positive(),
          fps: z.number().positive().max(120),
          renderRuntime: z.enum(['remotion', 'ffmpeg', 'provider-video']),
          compositionMode: z.enum(['editable', 'atelier', 'templated']),
          audioRequired: z.boolean(),
          subtitlesRequired: z.boolean(),
        }).optional(),
        include_stage_schemas: z.boolean().optional().describe('Legacy/manual mode only. Default false to avoid loading all six Agent-authored schemas before they are needed.'),
        creative_packet: studioCreativePacketSchema.optional().describe('One creative decision packet projected into Brief, Proposal, and Script artifacts by put_creative_packet.'),
        stage: z.enum(['brief', 'proposal', 'script', 'storyboard', 'assets', 'composition', 'review', 'delivery']).optional(),
        artifact: z.unknown().optional(),
        artifacts: z.array(z.object({
          stage: z.enum(['brief', 'proposal', 'script', 'storyboard', 'assets', 'composition', 'review', 'delivery']),
          artifact: z.unknown(),
        })).min(1).max(8).optional(),
        summary: z.string().optional(),
        reason: z.string().optional(),
      }),
      execute: async ({ operation, run_id, recipe, title, approval_policy, delivery_promise, include_stage_schemas, creative_packet, stage, artifact, artifacts, summary, reason }) => {
        if (!ctx.supabase || !ctx.userId || !ctx.projectId || !ctx.agentRunId) {
          return { success: false, error: 'Studio workflow requires an active Agent Run and authenticated project workspace.' };
        }
        try {
          const studio = await import('./studio-run');
          const store = new studio.WorkspaceStudioRunStore(ctx.supabase, ctx.userId);

          if (operation === 'start') {
            if (!delivery_promise) return { success: false, error: 'start requires delivery_promise' };
            const run = await studio.startPersistedStudioRun({
              store,
              agentRunId: ctx.agentRunId,
              projectId: ctx.projectId,
              recipe: recipe || 'explainer-video',
              title: title || 'Studio Run',
              approvalPolicy: approval_policy || 'guided',
              deliveryPromise: delivery_promise,
            });
            return {
              success: true,
              studioRun: studio.summarizeStudioRun(run),
              statePath: studio.studioRunStatePath(run.projectId, run.id),
              ...(include_stage_schemas ? {
                stageSchemas: Object.fromEntries(([
                  'brief',
                  'proposal',
                  'script',
                  'storyboard',
                  'assets',
                  'composition',
                ] as const).map(stageId => [stageId, studio.getStudioArtifactJsonSchema(stageId)])),
              } : {
                planningMode: 'creative-packet',
              }),
            };
          }

          let run = run_id
            ? await store.loadRun(ctx.projectId, run_id)
            : (await store.listRuns(ctx.projectId)).find(candidate => candidate.agentRunId === ctx.agentRunId);
          if (!run) return { success: false, error: 'Studio workflow not found in the current Agent Run. Start one first.' };
          if (run.agentRunId !== ctx.agentRunId) {
            return { success: false, error: 'Studio workflow belongs to a different Agent Run and cannot be adopted.' };
          }
          const runAtOperationStart = run;

          const loadStudioArtifact = async (artifactStage: 'script' | 'storyboard' | 'assets' | 'composition'): Promise<unknown> => {
            const ref = runAtOperationStart.artifacts[artifactStage];
            if (!ref) throw new Error(`Composition subtitle sync requires the persisted ${artifactStage} artifact.`);
            const file = await workspace.readFile(ref.path, ctx.supabase, ctx.userId);
            if (!file) throw new Error(`Could not read Studio Run ${artifactStage} artifact at ${ref.path}.`);
            return JSON.parse(file.content);
          };
          const assertCompositionSubtitleSync = async (
            candidate: unknown,
            overrides: { script?: unknown; storyboard?: unknown } = {},
          ): Promise<void> => {
            if (!runAtOperationStart.deliveryPromise.subtitlesRequired) return;
            const composition = studio.validateStudioArtifact('composition', candidate) as Record<string, any>;
            const script = studio.validateStudioArtifact(
              'script',
              overrides.script ?? await loadStudioArtifact('script'),
            ) as Record<string, any>;
            const storyboard = studio.validateStudioArtifact(
              'storyboard',
              overrides.storyboard ?? await loadStudioArtifact('storyboard'),
            ) as Record<string, any>;
            studio.assertSubtitleSyncEvidence({
              required: true,
              script: script as any,
              storyboard: storyboard as any,
              compositionSceneIds: composition.sceneIds,
              evidence: composition.draftGate.subtitleSyncEvidence,
            });
            const designFile = await workspace.readFile(composition.designPath, ctx.supabase, ctx.userId);
            if (!designFile) {
              throw new Error(`Composition subtitle sync requires the saved design at ${composition.designPath}.`);
            }
            try {
              JSON.parse(designFile.content);
            } catch {
              throw new Error(`Composition subtitle sync could not parse the saved design at ${composition.designPath}.`);
            }
          };
          const assertCompositionSubmissionReady = async (
            candidate: unknown,
            overrides: { script?: unknown; storyboard?: unknown; assets?: unknown } = {},
          ): Promise<void> => {
            const diagnostics: string[] = [];
            try {
              await assertCompositionSubtitleSync(candidate, overrides);
            } catch (error) {
              diagnostics.push(error instanceof Error ? error.message : String(error));
            }

            const designPath = candidate && typeof candidate === 'object'
              ? (candidate as Record<string, unknown>).designPath
              : undefined;
            if (typeof designPath === 'string') {
              const file = await workspace.readFile(designPath, ctx.supabase, ctx.userId);
              if (!file) {
                diagnostics.push(`Composition design was not found at ${designPath}.`);
              } else {
                try {
                  const design = JSON.parse(file.content) as Record<string, unknown>;
                  if (design.__makaronScaffold === true) {
                    diagnostics.push('Composition is still the structural scaffold. Continue the numbered source workspace until write_file reports compositionWorkspace.status="ready".');
                  } else {
                    const composition = studio.validateStudioArtifact('composition', candidate) as Record<string, any>;
                    const storyboard = studio.validateStudioArtifact(
                      'storyboard',
                      overrides.storyboard ?? await loadStudioArtifact('storyboard'),
                    ) as Record<string, any>;
                    const assets = studio.validateStudioArtifact(
                      'assets',
                      overrides.assets ?? await loadStudioArtifact('assets'),
                    ) as Record<string, any>;
                    studio.assertCompositionConsumesVisualAssets({
                      storyboard: storyboard as any,
                      manifest: assets as any,
                      composition: composition as any,
                      design,
                      mediaUrls: ctx.snapshotImages,
                    });
                  }
                } catch (error) {
                  diagnostics.push(
                    error instanceof SyntaxError
                      ? `Composition design at ${designPath} is not valid JSON.`
                      : error instanceof Error
                        ? error.message
                        : String(error),
                  );
                }
              }
            }

            const unique = [...new Set(diagnostics)];
            if (unique.length) {
              throw new Error(`Composition submission has ${unique.length} blocking issue${unique.length === 1 ? '' : 's'}:\n${unique.map(item => `- ${item}`).join('\n')}`);
            }
          };
          const assertStoryboardNarrationTiming = async (
            candidate: unknown,
            scriptOverride?: unknown,
          ): Promise<void> => {
            if (!runAtOperationStart.deliveryPromise.subtitlesRequired) return;
            const storyboard = studio.validateStudioArtifact('storyboard', candidate) as Record<string, any>;
            const script = studio.validateStudioArtifact(
              'script',
              scriptOverride ?? await loadStudioArtifact('script'),
            ) as Record<string, any>;
            studio.assertStoryboardNarrationTimingEvidence({
              required: true,
              script: script as any,
              storyboard: storyboard as any,
            });
          };
          const assertAssetsUseVisualBridge = async (
            candidate: unknown,
            storyboardOverride?: unknown,
          ): Promise<void> => {
            const manifest = studio.validateStudioArtifact('assets', candidate) as Record<string, any>;
            const storyboard = studio.validateStudioArtifact(
              'storyboard',
              storyboardOverride ?? await loadStudioArtifact('storyboard'),
            ) as Record<string, any>;
            await studio.assertPersistedVisualAssetBridgeEvidence({
              storyboard: storyboard as any,
              manifest: manifest as any,
              resolvePreparedAsset: assetId => resolvePreparedVisualAssetById({
                projectId: ctx.projectId,
                userId: ctx.userId!,
                supabase: ctx.supabase!,
                assetId,
              }),
            });
          };
          const isAutomaticStage = (candidate: string | null | undefined): candidate is 'review' | 'delivery' => (
            candidate === 'review' || candidate === 'delivery'
          );
          const currentStageSchema = (candidate: NonNullable<typeof run>) => (
            candidate.currentStage && !isAutomaticStage(candidate.currentStage)
              ? studio.getStudioArtifactJsonSchema(candidate.currentStage)
              : null
          );
          const materializeNextAction = (candidate: NonNullable<typeof run>) => (
            isAutomaticStage(candidate.currentStage)
              ? 'Review the Remotion source by previewing and patching it. When satisfied, call publish_draft once with the exact final design_path so the editable composition is durable in the timeline. Then call materialize_media once with that same design_path only when MP4 Delivery is requested; successful export completes Review and Delivery automatically.'
              : undefined
          );

          if (operation === 'status') {
            return {
              success: true,
              studioRun: studio.summarizeStudioRun(run),
              statePath: studio.studioRunStatePath(run.projectId, run.id),
              currentStageSchema: currentStageSchema(run),
              nextAction: materializeNextAction(run),
            };
          }
          if (operation === 'schema') {
            const schemaStage = stage || run.currentStage;
            if (!schemaStage) return { success: false, error: 'schema requires stage when the run is complete' };
            if (isAutomaticStage(schemaStage)) {
              return { success: false, error: 'Review and Delivery are automatic. Preview and patch the Remotion source, then call materialize_media once.' };
            }
            return {
              success: true,
              stage: schemaStage,
              schema: studio.getStudioArtifactJsonSchema(schemaStage),
            };
          }
          if (operation === 'validate') {
            const schemaStage = stage || run.currentStage;
            if (!schemaStage) return { success: false, error: 'validate requires stage when the run is complete' };
            if (artifact === undefined) return { success: false, error: 'validate requires artifact' };
            if (isAutomaticStage(schemaStage)) {
              return { success: false, error: 'Review and Delivery do not accept Agent-authored artifacts. Patch Remotion code, publish the gated design_path with publish_draft, then call materialize_media once when MP4 Delivery is requested.' };
            }
            const validated = studio.validateStudioArtifact(schemaStage, artifact);
            if (schemaStage === 'storyboard') await assertStoryboardNarrationTiming(validated);
            if (schemaStage === 'composition') await assertCompositionSubmissionReady(validated);
            if (schemaStage === 'assets') await assertAssetsUseVisualBridge(validated);
            return { success: true, valid: true, stage: schemaStage, artifact: validated };
          }
          if (operation === 'put_creative_packet') {
            if (!creative_packet) return { success: false, error: 'put_creative_packet requires creative_packet' };
            if (run.approvalPolicy !== 'auto') {
              return { success: false, error: 'put_creative_packet is only available for auto-approved Studio Runs' };
            }
            const planningArtifacts = buildStudioCreativeArtifacts({
              packet: creative_packet,
              deliveryPromise: run.deliveryPromise,
            });
            const result = await studio.putPersistedStudioArtifacts({
              store,
              run,
              artifacts: planningArtifacts,
            });
            const updates = result.updates.map(update => ({
              studioRun: studio.summarizeStudioRun(update.run, update.artifactPath),
              artifactPath: update.artifactPath,
              invalidated: update.invalidated,
            }));
            return {
              success: true,
              studioRun: studio.summarizeStudioRun(result.run),
              studioRunUpdates: updates,
              artifactPaths: updates.map(update => update.artifactPath),
              projectedStages: ['brief', 'proposal', 'script'],
              currentStageSchema: currentStageSchema(result.run),
              nextAction: materializeNextAction(result.run),
            };
          }
          if (operation === 'put_artifacts') {
            if (!artifacts?.length) return { success: false, error: 'put_artifacts requires artifacts' };
            if (artifacts.some(item => isAutomaticStage(item.stage))) {
              return { success: false, error: 'Review and Delivery are automatic. put_artifacts may only persist Agent-authored stages through Composition.' };
            }
            const storyboardItem = artifacts.find(item => item.stage === 'storyboard');
            if (storyboardItem) {
              await assertStoryboardNarrationTiming(
                storyboardItem.artifact,
                artifacts.find(item => item.stage === 'script')?.artifact,
              );
            }
            const compositionItem = artifacts.find(item => item.stage === 'composition');
            if (compositionItem) {
              await assertCompositionSubmissionReady(compositionItem.artifact, {
                script: artifacts.find(item => item.stage === 'script')?.artifact,
                storyboard: artifacts.find(item => item.stage === 'storyboard')?.artifact,
                assets: artifacts.find(item => item.stage === 'assets')?.artifact,
              });
            }
            const assetsItem = artifacts.find(item => item.stage === 'assets');
            if (assetsItem) {
              await assertAssetsUseVisualBridge(
                assetsItem.artifact,
                artifacts.find(item => item.stage === 'storyboard')?.artifact,
              );
            }
            const result = await studio.putPersistedStudioArtifacts({ store, run, artifacts });
            const updates = result.updates.map(update => ({
              studioRun: studio.summarizeStudioRun(update.run, update.artifactPath),
              artifactPath: update.artifactPath,
              invalidated: update.invalidated,
            }));
            return {
              success: true,
              studioRun: studio.summarizeStudioRun(result.run),
              studioRunUpdates: updates,
              artifactPaths: updates.map(update => update.artifactPath),
              currentStageSchema: currentStageSchema(result.run),
              nextAction: materializeNextAction(result.run),
            };
          }
          if (!stage) return { success: false, error: `${operation} requires stage` };

          if (operation === 'put_artifact') {
            if (artifact === undefined) return { success: false, error: 'put_artifact requires artifact' };
            if (isAutomaticStage(stage)) {
              return { success: false, error: 'Review and Delivery are automatic. Patch the Remotion source during review, publish the gated design_path with publish_draft, then call materialize_media once when MP4 Delivery is requested.' };
            }
            if (stage === 'storyboard') await assertStoryboardNarrationTiming(artifact);
            if (stage === 'assets') await assertAssetsUseVisualBridge(artifact);
            if (stage === 'composition') {
              await assertCompositionSubmissionReady(artifact);
            }
            const result = await studio.putPersistedStudioArtifact({ store, run, stage, artifact });
            return {
              success: true,
              studioRun: studio.summarizeStudioRun(result.run, result.artifactPath),
              artifactPath: result.artifactPath,
              invalidated: result.invalidated,
              currentStageSchema: currentStageSchema(result.run),
              nextAction: materializeNextAction(result.run),
            };
          }
          if (operation === 'approve') {
            run = await studio.approvePersistedStudioStage({ store, run, stage, summary });
            return { success: true, studioRun: studio.summarizeStudioRun(run) };
          }
          const result = await studio.invalidatePersistedStudioStage({
            store,
            run,
            stage,
            reason: reason || `Reopened ${stage} for revision`,
          });
          return {
            success: true,
            studioRun: studio.summarizeStudioRun(result.run),
            invalidated: result.invalidated,
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
      toModelOutput({ output }: { output: any }) {
        if (output.error) {
          return { type: 'content' as const, value: [{ type: 'text' as const, text: output.error }] };
        }
        if (output.schema || output.currentStageSchema || output.stageSchemas || output.nextAction) {
          return {
            type: 'content' as const,
            value: [{
              type: 'text' as const,
              text: JSON.stringify({
                ...(output.studioRun ? { studioRun: output.studioRun } : {}),
                ...(output.statePath ? { statePath: output.statePath } : {}),
                ...(output.stage ? { stage: output.stage } : {}),
                ...(output.schema ? { schema: output.schema } : {}),
                ...(output.currentStageSchema ? { currentStageSchema: output.currentStageSchema } : {}),
                ...(output.stageSchemas ? { stageSchemas: output.stageSchemas } : {}),
                ...(output.nextAction ? { nextAction: output.nextAction } : {}),
              }),
            }],
          };
        }
        if (Array.isArray(output.studioRunUpdates)) {
          const paths = output.studioRunUpdates
            .map((update: any) => update?.artifactPath)
            .filter((value: unknown): value is string => typeof value === 'string');
          const run = output.studioRun || {};
          return {
            type: 'content' as const,
            value: [{
              type: 'text' as const,
              text: `Studio Run persisted ${paths.length} stage artifact${paths.length === 1 ? '' : 's'}:\n${paths.map((path: string) => `- ${path}`).join('\n')}\nCurrent stage: ${run.currentStage || 'complete'}; status: ${run.status || 'unknown'}.`,
            }],
          };
        }
        if (output.valid) {
          return { type: 'content' as const, value: [{ type: 'text' as const, text: `Studio Run ${output.stage} artifact is valid.` }] };
        }
        const run = output.studioRun || {};
        return {
          type: 'content' as const,
          value: [{
            type: 'text' as const,
            text: `Studio Run ${run.runId || ''}: ${run.status || 'updated'}; current stage: ${run.currentStage || 'complete'}${output.artifactPath ? `; artifact: ${output.artifactPath}` : ''}.`,
          }],
        };
      },
    });
}

function createPublishDraftTool(
  { ctx }: AgentToolFactoryScope,
) {
  return tool({
      description: `Publish one durable editable Remotion composition draft into the project timeline.
This is the current promotion path for both Studio and non-Studio compositions. Pass the exact persisted design_path returned by composition autosave, the numbered composition workspace, or Studio Composition. The tool reloads that path from workspace, validates the design, and publishes a real editable design Snapshot without exporting MP4.
Call this explicitly after visual QA when the user should receive an editable composition. In Studio Run, publish the exact gated Composition once before waiting at Review or starting MP4 Delivery. Outside Studio Run, use it before claiming an editable Remotion result is delivered. Do not use legacy write_file({fromLastRunCode:true}) for durable or resumed runs.
Editable coverage is fail-soft: the harness keeps proven fields and omits unsafe or ambiguous fields without rejecting correct visual output. Never patch composition code merely to increase editable coverage or to clear an editable-only advisory; publish the reviewed composition as-is.
The same Agent Run and design_path resolve to the same Snapshot ID, so a retry or revision updates the same promoted draft instead of creating duplicates. This tool never runs automatically; omit it only when the user explicitly asks to keep the draft private/unpublished.`,
      inputSchema: z.object({
        design_path: z.string().min(1).describe('Exact persisted workspace design JSON path returned by composition autosave or Studio Composition.'),
        name: z.string().optional().describe('Short user-facing description for the editable draft.'),
      }),
      execute: async ({ design_path, name }) => {
        if (!ctx.supabase || !ctx.userId) {
          return { success: false, error: 'publish_draft requires an authenticated project workspace.' };
        }
        try {
          const file = await workspace.readFile(design_path, ctx.supabase, ctx.userId);
          if (!file) {
            return { success: false, error: `Editable composition was not found at ${design_path}.` };
          }
          let rawDesign: Record<string, unknown>;
          try {
            rawDesign = JSON.parse(file.content) as Record<string, unknown>;
          } catch {
            return { success: false, error: `Editable composition at ${design_path} is not valid JSON.` };
          }
          const design = rawDesign as unknown as DesignPayload;
          if (
            !design
            || typeof design.code !== 'string'
            || !design.code.trim()
            || !Number.isFinite(design.width)
            || !Number.isFinite(design.height)
          ) {
            return { success: false, error: `Editable composition at ${design_path} is missing code or dimensions.` };
          }
          if (rawDesign.__makaronScaffold === true) {
            return { success: false, error: 'Structural composition scaffolds cannot be published. Finish the numbered composition workspace first.' };
          }
          const harnessError = validateDesign(design);
          if (harnessError) {
            return { success: false, error: `Editable composition cannot be published: ${harnessError}` };
          }

          const studioCheckpoint = await getStudioRunCheckpoint(ctx);
          if (studioCheckpoint.studioRunId) {
            const studio = await import('./studio-run');
            const store = new studio.WorkspaceStudioRunStore(ctx.supabase, ctx.userId);
            const activeRun = await store.loadRun(ctx.projectId, studioCheckpoint.studioRunId);
            if (!activeRun || activeRun.agentRunId !== ctx.agentRunId) {
              return { success: false, error: 'The active Studio workflow could not be verified for this Agent Run.' };
            }
            const compositionRef = activeRun.artifacts.composition;
            if (activeRun.stages.composition.status !== 'completed' || !compositionRef) {
              return {
                success: false,
                error: `Studio draft promotion requires a completed Composition artifact. Persist the gated composition first with studio_run({ operation: "put_artifact", stage: "composition", artifact: { ... , designPath: "${design_path}" } }), then call publish_draft again with this exact path.`,
              };
            }
            const compositionFile = await workspace.readFile(compositionRef.path, ctx.supabase, ctx.userId);
            if (!compositionFile) {
              return { success: false, error: `Studio Composition artifact was not found at ${compositionRef.path}.` };
            }
            const compositionArtifact = JSON.parse(compositionFile.content) as Record<string, unknown>;
            if (compositionArtifact.designPath !== design_path) {
              return {
                success: false,
                error: `publish_draft design_path must match the persisted Studio Composition. Expected ${String(compositionArtifact.designPath || '')}, received ${design_path}.`,
              };
            }
            const storyboardRef = activeRun.artifacts.storyboard;
            const assetsRef = activeRun.artifacts.assets;
            if (!storyboardRef || !assetsRef) {
              return { success: false, error: 'Studio draft promotion requires persisted Storyboard and Assets artifacts.' };
            }
            const [storyboardFile, assetsFile] = await Promise.all([
              workspace.readFile(storyboardRef.path, ctx.supabase, ctx.userId),
              workspace.readFile(assetsRef.path, ctx.supabase, ctx.userId),
            ]);
            if (!storyboardFile || !assetsFile) {
              return { success: false, error: 'Studio draft promotion could not read the persisted Storyboard or Assets artifact.' };
            }
            const storyboard = studio.validateStudioArtifact('storyboard', JSON.parse(storyboardFile.content));
            const assets = studio.validateStudioArtifact('assets', JSON.parse(assetsFile.content));
            const composition = studio.validateStudioArtifact('composition', compositionArtifact);
            studio.assertCompositionConsumesVisualAssets({
              storyboard: storyboard as any,
              manifest: assets as any,
              composition: composition as any,
              design: rawDesign,
              mediaUrls: ctx.snapshotImages,
            });
          }

          const snapshotId = stableDraftPromotionSnapshotId({
            projectId: ctx.projectId,
            agentRunId: ctx.agentRunId || ctx.execution?.runId,
            designPath: design_path,
          });
          const promotedDesign = {
            ...design,
            description: name || (typeof rawDesign.description === 'string' ? rawDesign.description : '') || 'Editable Remotion composition',
          };
          (ctx as any).__pendingDesign = promotedDesign;
          (ctx as any).__pendingDesignPublished = true;
          (ctx as any).__pendingDesignSnapshotId = snapshotId;
          (ctx as any).__pendingDesignSourcePath = design_path;
          (ctx as any).__lastDesignPayload = promotedDesign;
          (ctx as any).__lastSavedDraftPath = design_path;
          return {
            success: true,
            published: true,
            artifactType: 'design',
            snapshotId,
            designPath: design_path,
            message: `Published editable composition draft from ${design_path}.`,
          };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    });
}

function createMaterializeMediaTool(
  { ctx }: AgentToolFactoryScope,
) {
  return tool({
      description: `Export an editable Remotion composition into a real MP4 video.
Use this when the user asks to save/export/materialize/turn a composition into MP4. It accepts a timeline media_index, snapshot_id, design_path, or the current unsaved composition from run_code.
The tool always queues a durable async export like video generation and returns immediately, so the user can keep chatting while polling/cron finishes the MP4. Ordinary CUI exports use fast_720p (short side 720, no upscale) for speed. Default publish=true so a processing video appears immediately and is replaced by the finished MP4. A repeated call for the same unchanged composition reuses the fingerprint-matched queued/completed job and does not render twice. If the same unchanged composition fails twice in one turn, stop retrying and report export as blocked.
For Studio Run, first preview and patch the Remotion source until it is satisfactory, call publish_draft once with the exact final design_path, then call materialize_media once with that same path when MP4 Delivery is requested. The runtime selects locked source resolution from typed Studio Run state. The queued export automatically completes Review and Delivery after the real MP4 is ready. After a successful queue submission, do not author Review/Delivery artifacts or continue reviewing. materialize_media publishes the MP4, not the editable draft.`,
      inputSchema: z.object({
        media_index: z.number().optional().describe('1-based media index, e.g. 3 for <<<media_3>>>. Must point to an editable Remotion composition.'),
        snapshot_id: z.string().optional().describe('Snapshot ID of an editable Remotion composition.'),
        design_path: z.string().optional().describe('Workspace design JSON path, e.g. code/<snapshotId>.json.'),
        name: z.string().optional().describe('Short output slug/name.'),
        publish: z.boolean().optional().describe('Default true. Publish exported MP4 into the project timeline.'),
      }),
      execute: async ({ media_index, snapshot_id, design_path, name, publish }) => {
        if (!ctx.supabase || !ctx.userId) {
          return { success: false, error: 'materialize_media requires an authenticated project workspace.' };
        }
        const studioCheckpoint = await getStudioRunCheckpoint(ctx);
        const latestDraftPath = (ctx as any).__lastSavedDraftPath as string | undefined;
        const shouldPreferLatestDraft = Boolean(studioCheckpoint.studioRunId)
          && Boolean(latestDraftPath)
          && media_index !== undefined
          && !snapshot_id
          && !design_path;
        const source = await resolveCompositionSource(ctx, {
          media_index: shouldPreferLatestDraft ? undefined : media_index,
          snapshot_id,
          design_path: shouldPreferLatestDraft ? latestDraftPath : design_path,
        });
        if (source.error) return { success: false, error: source.error };

        const sourceKey = source.designPath
          || source.snapshotId
          || (source.design ? JSON.stringify([source.design.code, source.design.props, source.design.animation]) : 'current-composition');
        const attempts = ctx.materializeAttempts || new Map<string, number>();
        ctx.materializeAttempts = attempts;
        const attemptCount = attempts.get(sourceKey) || 0;
        if (attemptCount >= 2) {
          return {
            success: false,
            blocked: true,
            error: 'MP4 export already failed twice for this unchanged composition in this turn. Do not call materialize_media again. Keep the editable composition and contact sheet, then report export as blocked.',
          };
        }
        attempts.set(sourceKey, attemptCount + 1);

        try {
          const shouldPublish = publish !== false;
          const renderProfile = studioCheckpoint.studioRunId
            ? 'source'
            : 'fast_720p';
          const publishSnapshotId = shouldPublish ? crypto.randomUUID() : undefined;
          const job = await createRemotionExportJob({
            userId: ctx.userId,
            projectId: ctx.projectId,
            snapshotId: source.snapshotId,
            designPath: source.designPath,
            design: source.design,
            outputType: 'video',
            renderProfile,
            publish: shouldPublish,
            publishSnapshotId,
            name: name || 'materialized-composition',
            studioRunId: studioCheckpoint.studioRunId,
          });

          const taskId = `remotion-export-${job.id}`;
          const videoMeta: VideoMeta = {
            taskId,
            videoUrl: job.storage_url || '',
            providerUrl: job.storage_url || '',
            videoPath: job.workspace_path || '',
            prompt: name || 'Materialized Remotion composition',
            sourceSnapshotIds: source.snapshotId ? [source.snapshotId] : [],
            sourceUrls: [],
            status: job.status === 'completed' && job.storage_url ? 'completed' : 'processing',
            duration: job.duration_seconds || null,
            model: 'upload',
            createdAt: new Date().toISOString(),
            width: job.width || undefined,
            height: job.height || undefined,
          };
          if (publishSnapshotId) {
            const pendingVideoMeta: VideoMeta = {
              ...videoMeta,
              taskId: `remotion-export-pending-${job.id}`,
              videoUrl: job.storage_url || '',
              providerUrl: job.storage_url || '',
            };
            if (job.status !== 'completed') {
              const { data: sortData } = await ctx.supabase.rpc('next_sort_order', { p_project_id: ctx.projectId });
              const { error: pendingInsertError } = await ctx.supabase.from('snapshots').upsert({
                id: publishSnapshotId,
                project_id: ctx.projectId,
                image_url: VIDEO_PLACEHOLDER_IMAGE,
                tips: [],
                message_id: '',
                sort_order: sortData ?? 0,
                type: 'video',
                video_meta: pendingVideoMeta,
                description: name || 'Materialized Remotion composition',
              }, { onConflict: 'id' });
              if (pendingInsertError) {
                throw new Error(`Pending export snapshot insert failed: ${pendingInsertError.message}`);
              }
            }
            ctx.pendingVideoSnapshot = {
              snapshotId: publishSnapshotId,
              taskId,
              videoMeta: pendingVideoMeta,
            };
          }
          if (job.status === 'queued') {
            runRemotionExportAfterResponse(job.id);
          }
          return {
            success: true,
            queued: job.status !== 'completed',
            jobId: job.id,
            status: job.status,
            taskId,
            publishSnapshotId,
            renderProfile,
            studioRunPending: Boolean(studioCheckpoint.studioRunId) && job.status !== 'completed',
            message: shouldPublish
              ? `MP4 export submitted. A processing video is in the timeline and will update automatically. Job: ${job.id}`
              : `MP4 export submitted. Job: ${job.id}`,
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    });
}

function createPreviewFrameTool(
  { ctx, durableVisionBridge }: AgentToolFactoryScope,
) {
  return tool({
      description: `Capture one visual frame or a 2-6 frame contact sheet.
Use media_index to target any timeline snapshot. Remotion compositions are rendered with Remotion; raw uploaded/generated videos are extracted with FFmpeg.
When design_path is provided it is authoritative; media_index is ignored. Do not combine them to identify the same composition.
For raw video snapshots: use timestamp to see specific moments in the actual MP4/MOV/WebM.
For understanding video content (what happens, scenes, pacing), use analyze_video instead.
Omit media_index to use the current (last edited) composition.
For Studio Run review, prefer one call with frames or timestamps for hook/body/end. It renders the frames concurrently and returns one labeled contact sheet plus the individual workspace paths.
Returns the rendered image so you can see it with your vision.`,
      inputSchema: z.object({
        media_index: z.number().optional().describe('1-based snapshot index (<<<media_1>>> = 1). Target a Remotion composition or raw video. Omit to use current composition.'),
        design_path: z.string().optional().describe('Workspace path of an autosaved or persisted Remotion composition. Use the exact path returned by run_code or shown in Recoverable Composition Draft.'),
        frame: z.number().optional().describe('0-based frame number.'),
        timestamp: z.number().optional().describe('Time in seconds (e.g. 2.5). Converted to frame using fps.'),
        frames: z.array(z.number()).min(2).max(6).optional().describe('For a composition contact sheet: 2-6 frame numbers rendered in one call. Prefer three representative hook/body/end frames for Studio Run review.'),
        timestamps: z.array(z.number()).min(2).max(6).optional().describe('For a composition contact sheet: 2-6 timestamps in seconds. Use instead of frames.'),
        question: z.string().optional().describe('What to focus on when viewing this frame.'),
      }),
      execute: async ({ media_index, design_path, frame, timestamp, frames, timestamps, question }) => {
        const analyzeDurablePreview = async (image: Buffer, fallback: string) => {
          if (!durableVisionBridge) return undefined;
          try {
            const { analyzeImageContent } = await import('./gemini');
            return await analyzeImageContent(
              `data:image/jpeg;base64,${image.toString('base64')}`,
              question || 'Check visual integrity, subject cropping, text readability, composition, and whether the rendered frame is safe to publish.',
              ctx.userId,
            );
          } catch (error) {
            console.warn('[preview_frame] durable vision bridge failed:', error);
            return fallback;
          }
        };
        let design = (ctx as any).__lastDesignPayload;
        let rawVideo: { url: string; duration?: number; fps?: number; sourceRange?: VideoSourceRange } | null = null;
        if (design_path) {
          try {
            const file = await workspace.readFile(design_path, ctx.supabase, ctx.userId);
            if (!file) return { error: `Composition not found: ${design_path}` };
            design = JSON.parse(file.content);
          } catch (err) {
            return { error: `Could not load composition ${design_path}: ${err instanceof Error ? err.message : String(err)}` };
          }
        }
        const targetMediaIndex = design_path
          ? undefined
          : (media_index ?? (!design ? ctx.currentSnapshotIndex + 1 : undefined));

        // Load composition payload from a specific snapshot if media_index provided.
        if (targetMediaIndex !== undefined && ctx.supabase && ctx.userId) {
          const v = validateImageIndex(ctx.snapshotImages, targetMediaIndex);
          if (v.error) return { error: v.error };
          try {
            const { data: snaps } = await ctx.supabase
              .from('snapshots')
              .select('type, image_url, design_path, video_meta')
              .eq('project_id', ctx.projectId)
              .order('sort_order', { ascending: true });
            const snap = snaps?.[v.idx] as { type?: string; image_url?: string; design_path?: string; video_meta?: Record<string, unknown> } | undefined;
            if (snap?.design_path) {
              const storagePath = `${ctx.userId}/workspace/${snap.design_path}`;
              const { data: urlData } = ctx.supabase.storage.from('images').getPublicUrl(storagePath);
              if (urlData?.publicUrl) {
                const res = await fetch(`${urlData.publicUrl}?t=${Date.now()}`);
                if (res.ok) design = await res.json();
              }
            } else {
              const meta = snap?.video_meta;
              const videoUrl = typeof meta?.videoUrl === 'string' ? meta.videoUrl : '';
              const fallbackUrl = isVideoUrl(ctx.snapshotImages[v.idx]) ? ctx.snapshotImages[v.idx] : (isVideoUrl(snap?.image_url) ? snap?.image_url || '' : '');
              const duration = Number(meta?.duration);
              const fps = Number(meta?.fps);
              const sourceRange = sourceRangeFromVideoMeta(meta);
              if (snap?.type === 'video' || videoUrl || fallbackUrl) {
                rawVideo = {
                  url: videoUrl || fallbackUrl,
                  duration: Number.isFinite(duration) ? duration : undefined,
                  fps: Number.isFinite(fps) ? fps : undefined,
                  sourceRange,
                };
              }
            }
          } catch (e) {
            console.warn(`[preview_frame] failed to load design for media_index=${targetMediaIndex}:`, e);
          }
        } else if (targetMediaIndex !== undefined) {
          const resolved = await resolveVideoUrlForMediaIndex(ctx, targetMediaIndex);
          if (resolved.videoUrl) {
            rawVideo = { url: resolved.videoUrl, duration: resolved.duration, fps: resolved.fps, sourceRange: resolved.sourceRange };
          }
        }

        if (targetMediaIndex !== undefined && !design && !rawVideo) {
          const resolved = await resolveVideoUrlForMediaIndex(ctx, targetMediaIndex);
          if (resolved.videoUrl) {
            rawVideo = { url: resolved.videoUrl, duration: resolved.duration, fps: resolved.fps, sourceRange: resolved.sourceRange };
          }
        }

        const batchRequested = Boolean(frames?.length || timestamps?.length);
        if (batchRequested && rawVideo) {
          return { error: 'Batch contact sheets currently target Remotion compositions. For raw video understanding use analyze_video, or call preview_frame once per required timestamp.' };
        }

        if (batchRequested && design) {
          const fps = design.animation?.fps || 30;
          const dur = design.animation?.durationInSeconds || 0;
          const totalFrames = dur > 0 ? Math.max(1, Math.round(fps * dur)) : 1;
          const requested = frames?.length
            ? frames
            : (timestamps || []).map(value => Math.round(value * fps));
          const targetFrames = [...new Set(requested.map(value => Math.max(0, Math.min(Math.round(value), totalFrames - 1))))];
          if (targetFrames.length < 2) return { error: 'Contact sheet frames collapse to fewer than two unique in-range frames.' };

          try {
            const { renderDesignFrame } = await import('./remotion-server');
            const { createContactSheet } = await import('./contact-sheet');
            const rendered = await Promise.all(targetFrames.map(targetFrame => renderDesignFrame(design, targetFrame)));
            const stamp = Date.now();
            const framePaths = targetFrames.map(targetFrame => `${ctx.projectId}/drafts/design-contact-frame${targetFrame}-${stamp}.jpg`);
            const frameUrls: string[] = [];
            const userId = ctx.userId;

            if (ctx.supabase && userId) {
              const writes = await Promise.all(rendered.map((jpegBuffer, index) =>
                workspace.writeFile(framePaths[index]!, jpegBuffer, ctx.supabase, userId, 'image/jpeg')
              ));
              writes.forEach((write, index) => {
                if (!write.storageUrl) return;
                const storageUrl = toPublicStorageUrl(write.storageUrl);
                frameUrls[index] = storageUrl;
                rememberWorkspaceMediaOutputs(ctx, [{
                  path: framePaths[index],
                  storageUrl,
                  contentType: 'image/jpeg',
                  description: `composition frame ${targetFrames[index]}`,
                  updatedAt: new Date().toISOString(),
                }]);
              });
            }

            const contactSheet = await createContactSheet(
              rendered.map((image, index) => ({
                image,
                label: `#${index + 1}  frame ${targetFrames[index]}  ${(targetFrames[index] / fps).toFixed(1)}s`,
              })),
              design.width || 1080,
              design.height || 1920,
            );
            const contactSheetPath = `${ctx.projectId}/drafts/design-contact-sheet-${stamp}.jpg`;
            let workspaceUrl = '';
            if (ctx.supabase && userId) {
              const write = await workspace.writeFile(contactSheetPath, contactSheet, ctx.supabase, userId, 'image/jpeg');
              if (write.storageUrl) {
                workspaceUrl = toPublicStorageUrl(write.storageUrl);
                rememberWorkspaceMediaOutputs(ctx, [{
                  path: contactSheetPath,
                  storageUrl: workspaceUrl,
                  contentType: 'image/jpeg',
                  description: `composition contact sheet for frames ${targetFrames.join(', ')}`,
                  updatedAt: new Date().toISOString(),
                }]);
              }
            }

            const drafts = (ctx as any).__runCodeDrafts || [];
            const previewBase64 = `data:image/jpeg;base64,${contactSheet.toString('base64')}`;
            if (drafts.length > 0) {
              drafts[drafts.length - 1].previewBase64 = previewBase64;
              if (workspaceUrl) drafts[drafts.length - 1].previewUrl = workspaceUrl;
            }

            console.log(`🖼️ [agent] preview_frame: contact sheet ${targetFrames.join(',')} (${(contactSheet.length / 1024).toFixed(0)} KB)`);
            const analysis = await analyzeDurablePreview(
              contactSheet,
              `The contact sheet rendered successfully for frames ${targetFrames.join(', ')}. Continue using the saved preview paths; do not repeat this preview solely because visual analysis was unavailable.`,
            );
            return {
              base64Data: contactSheet.toString('base64'),
              mimeType: 'image/jpeg',
              analysis,
              source: 'composition-contact-sheet',
              frames: targetFrames,
              framePaths,
              frameUrls,
              totalFrames,
              fps,
              question,
              workspaceUrl,
              workspacePath: contactSheetPath,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`⚠️ [agent] preview_frame contact sheet failed: ${msg}`);
            const { remotionPreviewFailure } = await import('./remotion-preview-error');
            return remotionPreviewFailure(msg, 'Failed to capture contact sheet');
          }
        }

        if (rawVideo) {
          if (!rawVideo.url) return { error: `No video URL found at <<<media_${targetMediaIndex}>>>.` };
          const videoFps = rawVideo.fps || 30;
          const maxTimestamp = rawVideo.duration && rawVideo.duration > 0 ? Math.max(0, rawVideo.duration - (1 / videoFps)) : undefined;
          const targetTimestamp = timestamp !== undefined
            ? timestamp
            : frame !== undefined
              ? frame / videoFps
              : 0.5;
          const clampedTimestamp = Math.max(0, maxTimestamp !== undefined ? Math.min(targetTimestamp, maxTimestamp) : targetTimestamp);
          const sourceTimestamp = (rawVideo.sourceRange?.start_sec || 0) + clampedTimestamp;
          const targetFrame = Math.max(0, Math.round(clampedTimestamp * videoFps));
          const totalFrames = rawVideo.duration && rawVideo.duration > 0 ? Math.max(1, Math.round(rawVideo.duration * videoFps)) : undefined;

          try {
            const { extractVideoFrame } = await import('./video-frame');
            const jpegBuffer = await extractVideoFrame(rawVideo.url, { timestamp: sourceTimestamp });

            let wsUrl = '';
            const wsPath = `${ctx.projectId}/drafts/video-media${targetMediaIndex || 'current'}-t${clampedTimestamp.toFixed(2).replace('.', '-')}-${Date.now()}.jpg`;
            if (ctx.supabase && ctx.userId) {
              const ws = await workspace.writeFile(wsPath, jpegBuffer, ctx.supabase, ctx.userId, 'image/jpeg');
              if (ws.storageUrl) {
                wsUrl = toPublicStorageUrl(ws.storageUrl);
                rememberWorkspaceMediaOutputs(ctx, [{
                  path: wsPath,
                  storageUrl: wsUrl,
                  contentType: 'image/jpeg',
                  description: rawVideo.sourceRange
                    ? `video range frame at ${clampedTimestamp.toFixed(2)}s (source ${sourceTimestamp.toFixed(2)}s)`
                    : `video frame at ${clampedTimestamp.toFixed(2)}s`,
                  updatedAt: new Date().toISOString(),
                }]);
              }
            }

            console.log(`🖼️ [agent] preview_frame: raw video t=${clampedTimestamp.toFixed(2)}s, ${(jpegBuffer.length / 1024).toFixed(0)} KB (ffmpeg)`);
            const analysis = await analyzeDurablePreview(
              jpegBuffer,
              `The video frame rendered successfully at ${clampedTimestamp.toFixed(2)}s. Continue using the saved preview path; do not repeat this preview solely because visual analysis was unavailable.`,
            );
            return {
              base64Data: jpegBuffer.toString('base64'),
              mimeType: 'image/jpeg',
              analysis,
              source: 'video',
              timestamp: clampedTimestamp,
              sourceTimestamp,
              sourceRange: rawVideo.sourceRange,
              frame: targetFrame,
              totalFrames,
              fps: videoFps,
              question,
              workspaceUrl: wsUrl,
              workspacePath: wsPath,
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`⚠️ [agent] preview_frame video extraction failed: ${msg}`);
            return { error: `Failed to extract video frame at ${clampedTimestamp.toFixed(2)}s: ${msg}` };
          }
        }

        if (!design) return { error: 'No composition or raw video found. Use run_code first, or specify media_index of a Remotion composition/raw video snapshot.' };

        const fps = design.animation?.fps || 30;
        const dur = design.animation?.durationInSeconds || 0;
        const totalFrames = dur > 0 ? Math.max(1, Math.round(fps * dur)) : 1;

        let targetFrame = 0;
        if (frame !== undefined) {
          targetFrame = Math.max(0, Math.min(frame, totalFrames - 1));
        } else if (timestamp !== undefined) {
          targetFrame = Math.max(0, Math.min(Math.round(timestamp * fps), totalFrames - 1));
        }

        try {
          // Server-side Sandbox rendering
          const { renderDesignFrame } = await import('./remotion-server');
          const jpegBuffer = await renderDesignFrame(design, targetFrame);

          const drafts = (ctx as any).__runCodeDrafts || [];
          const b64 = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
          if (drafts.length > 0) {
            drafts[drafts.length - 1].previewBase64 = b64;
          }

          let wsUrl = '';
          const snapN = ctx.snapshotImages.length;
          const wsPath = `${ctx.projectId}/drafts/design-snap${snapN}-frame${targetFrame}-${Date.now()}.jpg`;
          if (ctx.supabase && ctx.userId) {
            const ws = await workspace.writeFile(wsPath, jpegBuffer, ctx.supabase, ctx.userId, 'image/jpeg');
            if (ws.storageUrl) {
              wsUrl = toPublicStorageUrl(ws.storageUrl);
              if (drafts.length > 0) drafts[drafts.length - 1].previewUrl = wsUrl;
              rememberWorkspaceMediaOutputs(ctx, [{
                path: wsPath,
                storageUrl: wsUrl,
                contentType: 'image/jpeg',
                description: `composition frame ${targetFrame}`,
                updatedAt: new Date().toISOString(),
              }]);
            }
          }

          console.log(`🖼️ [agent] preview_frame: frame ${targetFrame}/${totalFrames} (${(targetFrame / fps).toFixed(1)}s), ${(jpegBuffer.length / 1024).toFixed(0)} KB (sandbox)`);
          const analysis = await analyzeDurablePreview(
            jpegBuffer,
            `Frame ${targetFrame} rendered successfully. Continue using the saved preview path; do not repeat this preview solely because visual analysis was unavailable.`,
          );
          return {
            base64Data: jpegBuffer.toString('base64'),
            mimeType: 'image/jpeg',
            analysis,
            source: 'composition',
            frame: targetFrame,
            totalFrames,
            fps,
            question,
            workspaceUrl: wsUrl,
            workspacePath: wsPath,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`⚠️ [agent] preview_frame failed: ${msg}`);
          const { remotionPreviewFailure } = await import('./remotion-preview-error');
          return remotionPreviewFailure(msg, `Failed to capture frame ${targetFrame}`);
        }
      },

      toModelOutput({ output }: { output: any }) {
        if (output.error) {
          return { type: 'content' as const, value: [{ type: 'text' as const, text: output.error }] };
        }
        if (Array.isArray(output.frames)) {
          const loc = output.workspacePath ? ` Saved: ${output.workspacePath}` : '';
          if (output.analysis) {
            return {
              type: 'content' as const,
              value: [{
                type: 'text' as const,
                text: `Visual QA for contact sheet frames ${output.frames.join(', ')} of ${output.totalFrames}:${loc}\n${output.analysis}\nUse this as visual evidence. If clean, publish without adding another preview call.`,
              }],
            };
          }
          return {
            type: 'content' as const,
            value: [
              modelFileContent(output.base64Data, output.mimeType),
              { type: 'text' as const, text: `Contact sheet frames ${output.frames.join(', ')} of ${output.totalFrames}.${loc} Individual frame paths: ${(output.framePaths || []).join(', ')}.${output.question ? ` Focus: ${output.question}.` : ''} Compare all frames together for scene distinctness, subject specificity, meaningful motion, readability, and slideshow risk. If clean, publish without adding another preview call.` },
            ],
          };
        }
        const time = (output.frame / output.fps).toFixed(1);
        const loc = output.workspacePath ? ` Saved: ${output.workspacePath}` : '';
        const nextStep = ' Render succeeded. Treat this as a successful preview_frame result; if the attached frame is usable and there is no explicit error above, do not rewrite the composition just because the tool did not provide a natural-language visual critique. Continue with write_file when the user asked to publish.';
        if (output.analysis) {
          return {
            type: 'content' as const,
            value: [{
              type: 'text' as const,
              text: `Visual QA for frame ${output.frame}/${output.totalFrames} (${time}s).${loc}\n${output.analysis}\nUse this as visual evidence.${nextStep}`,
            }],
          };
        }
        return {
          type: 'content' as const,
          value: [
            modelFileContent(output.base64Data, output.mimeType),
            { type: 'text' as const, text: `Frame ${output.frame}/${output.totalFrames} (${time}s).${loc}${output.question ? ` Focus: ${output.question}.` : ''}${nextStep}` },
          ],
        };
      },
    });
}

function createRotateCameraTool(
  { ctx }: AgentToolFactoryScope,
) {
  return tool({
      description: `Rotate the virtual camera around the subject to show a different perspective/angle.
Use this when the user wants to see the image from a different viewpoint — e.g. "show from the side", "bird's eye view", "rotate left", "show the back", "zoom in".
This uses Qwen Image Edit to regenerate the image from the requested camera angle.

Parameters:
- azimuth: horizontal rotation (0=front, 45=front-right, 90=right, 135=back-right, 180=back, 225=back-left, 270=left, 315=front-left)
- elevation: vertical angle (-30=low angle, 0=eye level, 30=elevated, 60=high angle)
- distance: zoom (0.6=close-up, 1.0=medium, 1.4=wide shot)`,
      inputSchema: z.object({
        azimuth: z.number().min(0).max(360).describe('Horizontal rotation degrees (0=front, 90=right, 180=back, 270=left)'),
        elevation: z.number().min(-30).max(60).describe('Vertical angle degrees (-30=low, 0=eye level, 30=elevated, 60=high)'),
        distance: z.number().min(0.6).max(1.4).describe('Zoom distance (0.6=close-up, 1.0=medium, 1.4=wide)'),
      }),
      execute: async ({ azimuth, elevation, distance }) => {
        const skillResult = await rotateCamera(
          { azimuth, elevation, distance },
          { currentImage: ctx.currentImage },
        );
        if (skillResult.image) {
          ctx.currentImage = skillResult.image;
          ctx.generatedImages.push(skillResult.image);
          ctx.lastImageBackground = undefined;
          // Bill for camera rotation (per-action)
          import('./billing/credits').then(({ deductCredits }) =>
            deductCredits(ctx.userId ?? '', null, 'rotate_camera')
              .catch(e => console.error('[billing] rotate_camera deduct error:', e))
          );
        }
        return { success: skillResult.success as true, message: skillResult.message };
      },
    });
}

function createListFilesTool(
  { ctx }: AgentToolFactoryScope,
) {
  return tool({
      description: `List files in your workspace. Discover available skills and reference images.
By default, this lists current-project files plus user-level/built-in files. Use pattern to filter: "skills/*" for all skills, "skills/enhance/*" for a specific skill, or "<projectId>/media/*" for project media.`,
      inputSchema: z.object({
        pattern: z.string().optional().describe('Glob-like filter: "skills/*", "skills/*/assets/*"'),
      }),
      execute: async ({ pattern }) => {
        const files = await workspace.listFiles(pattern, ctx.supabase, ctx.userId);
        const scopedFiles = filterWorkspaceFilesForAgentScope(files, ctx.projectId, pattern);

        const result = scopedFiles.map(f => ({
          path: f.path,
          type: f.contentType,
          size: f.size,
          local: f.localAvailable || false,
          localPath: f.localPath,
          providerUrl: f.storageUrl,
          builtIn: f.isBuiltIn || false,
        }));

        return { files: result, count: result.length };
      },
    });
}

function createReadFileTool(
  { ctx }: AgentToolFactoryScope,
) {
  return tool({
      description: `Read a file from your workspace. For .md files, returns text content. For images, returns the image so you can view it.
Use this to read skill instructions (SKILL.md), reference images, or your memory. For videos/audio, returns metadata and a local workspace path; do not read media bytes unless you are explicitly inspecting content.`,
      inputSchema: z.object({
        path: z.string().describe('File path from list_files, e.g. "skills/enhance/SKILL.md" or "skills/makaron-mascot/assets/character-sheet.jpg"'),
      }),
      execute: async ({ path: filePath }) => {
        const handle = await workspace.resolveWorkspaceFile(filePath, ctx.supabase, ctx.userId, { hydrate: true });
        if (handle && (handle.contentType.startsWith('video/') || handle.contentType.startsWith('audio/'))) {
          return {
            path: handle.path,
            type: handle.contentType,
            size: handle.size,
            storageUrl: handle.storageUrl,
            localPath: handle.localPath,
            local: handle.localAvailable,
            hydrated: handle.hydrated || false,
          };
        }

        const result = await workspace.readFile(filePath, ctx.supabase, ctx.userId);
        if (!result) return { error: `File not found: ${filePath}` };

        const bundlePaths = evolvingSkillBundlePaths(filePath);
        let componentContents: Record<string, string> | undefined;
        if (bundlePaths) {
          const paths = [...bundlePaths.ownedPaths, ...bundlePaths.dependencyPaths];
          const resolved = await Promise.all(paths.map(async path => {
            if (path === filePath) return [path, result.content] as const;
            const component = await workspace.readFile(path, ctx.supabase, ctx.userId);
            return component ? [path, component.content] as const : null;
          }));
          if (resolved.every((component): component is readonly [string, string] => component !== null)) {
            componentContents = Object.fromEntries(resolved);
          }
        }

        await recordEvolvingSkillUsage({
          runId: ctx.agentRunId || ctx.execution?.runId,
          projectId: ctx.projectId,
          userId: ctx.userId,
          sourcePath: filePath,
          content: result.content,
          componentContents,
          activationSource: 'read_file',
        });

        if (result.contentType.startsWith('image/')) {
          // Return image for vision — same pattern as analyze_image
          const raw = result.content.replace(/^data:image\/\w+;base64,/, '');
          return { base64Data: raw, mimeType: result.contentType, path: filePath };
        }

        return { content: result.content, type: result.contentType, path: filePath };
      },

      toModelOutput({ output }: { output: any }) {
        if (output.error) {
          return { type: 'content' as const, value: [{ type: 'text' as const, text: output.error }] };
        }
        if (output.base64Data) {
          return {
            type: 'content' as const,
            value: [
              modelFileContent(output.base64Data, output.mimeType),
              { type: 'text' as const, text: `Workspace image: ${output.path}` },
            ],
          };
        }
        if (output.localPath && (String(output.type || '').startsWith('video/') || String(output.type || '').startsWith('audio/'))) {
          const status = output.local ? 'available locally' : 'not available locally';
          return {
            type: 'content' as const,
            value: [{ type: 'text' as const, text: `Workspace media: ${output.path}\nType: ${output.type}\nSize: ${output.size ?? 'unknown'} bytes\nLocal path: ${output.localPath || '(none)'}\nStatus: ${status}` }],
          };
        }
        return {
          type: 'content' as const,
          value: [{ type: 'text' as const, text: `[${output.path}]\n\n${output.content}` }],
        };
      },
    });
}

function createWriteCodeFileTool(
  { ctx }: AgentToolFactoryScope,
) {
  return tool({
      description: `Create or replace a first-class code file in the project workspace.

Use this for substantial programmable video or media work: write the Remotion/Node source here, then call run_code with code_path. The source remains reusable, patchable, and recoverable across long Agent Runs instead of being trapped inside one execution call. Composition files may be natural JS/TS/JSX/TSX modules with imports/exports and a top-level Composition, or the legacy executable body that returns { type: 'render', code, width, height, ... }. Studio Run may continue using numbered composition parts for very long compositions; short patches and small utility scripts may still use inline run_code.`,
      inputSchema: z.object({
        description: z.string().optional().describe('User-facing one-sentence summary of the specific code artifact being written. Put this before content so progress is visible while source streams.'),
        path: z.string().optional().describe('Workspace path, e.g. "project-id/code/island-packaging.js". If omitted, a path is generated from name and runtime.'),
        name: z.string().optional().describe('Short slug used when path is omitted, e.g. "island-packaging".'),
        runtime: z.enum(['composition', 'node']).optional().describe('composition = Remotion/editable composition executable body. node = Node/FFmpeg script. Default composition.'),
        content: z.string().min(1).describe('Complete JS/TS/JSX/TSX source. Composition files may be natural Remotion modules or legacy executable bodies. Do not trim approved content to meet an aggregate source-size target.'),
      }),
      execute: async ({ description, path: filePath, name, runtime, content }) => {
        if (!ctx.supabase || !ctx.userId) {
          return { success: false, message: 'Workspace not available (no Supabase connection).' };
        }
        const kind = runtime || 'composition';
        const slug = (name || description || 'composition-code')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 48) || 'composition-code';
        const savePath = filePath || (kind === 'node'
          ? `${ctx.projectId}/media-code/${slug}.js`
          : `${ctx.projectId}/code/${slug}.js`);
        const result = await workspace.writeFile(savePath, content, ctx.supabase, ctx.userId, 'text/javascript');
        if (!result.success) {
          return { success: false, message: `Write failed: ${result.error}` };
        }
        (ctx as any).__lastCodeFilePath = savePath;
        (ctx as any).__lastCodeFileRuntime = kind;
        return {
          success: true,
          message: `Code file saved: ${savePath}. Execute it with run_code({ code_path: "${savePath}", runtime: "${kind}" }).`,
          path: savePath,
          runtime: kind,
          codeChars: content.length,
          storageUrl: toPublicStorageUrl(result.storageUrl || ''),
        };
      },
      toModelOutput({ output }: { output: any }) {
        return {
          type: 'content' as const,
          value: [{
            type: 'text' as const,
            text: output.success
              ? `${output.message}\nCode chars: ${output.codeChars}`
              : output.message || 'Code file write failed.',
          }],
        };
      },
    });
}

function createWriteFileTool(
  { ctx }: AgentToolFactoryScope,
) {
  return tool({
      description: `Write a file to your workspace. Use this to save memory, create skills, or organize your workspace.
For durable Composition work, write numbered source parts under \`<project-id>/drafts/composition-parts/\` one cohesive component per model step and wait for each result. Filenames MUST use a numeric prefix of at least two digits plus a slug, for example \`00-foundation.js\`, \`10-scenes-a.js\`, \`90-root.js\`, or \`120-chapter.js\`. Include compositionMetadata on the first part (and again only when metadata changes) so dimensions, props, and animation remain durable without a final assembly call. New compositions infer Editable metadata automatically; omit compositionMetadata.editables unless preserving an old composition's explicit metadata. Each part has a hard transport limit of 12000 source characters; focused parts around 3000-8000 characters are preferred, but visual detail must decide the size. There is no aggregate source-size or part-count limit. Parts share one scope: do not use import/export. Rewriting the same numbered path is retry-safe. Never shorten approved narration, subtitles, scenes, animation, or visual detail to reduce source size. If one unusually large part exceeds 12000, split that component across new numbered files; renaming unchanged oversized source will still fail. The workspace automatically assembles, validates, and autosaves the complete draft after every successful part write. compositionWorkspace.status="ready" means the current files compile mechanically; it is not permission to omit planned scenes or polish. Finish every planned part, repair blocking diagnostics, then preview the returned designPath. Non-blocking editable advisories do not invalidate a ready draft and must never trigger a scene rewrite, a new compatibility shim, or a manual \`data-editable\` patch. In particular, never attach one static editable id to a reusable image/video helper. Do not call run_code merely to assemble files.
Legacy compatibility only: fromLastRunCode=true can save an in-memory run_code output within the same attempt. Do not use it to publish durable or resumed Composition drafts; use publish_draft with the exact persisted design_path.
Composition source writes and numbered parts autosave a private draft. publish_draft is the explicit timeline promotion action.
Node media runtime: \`type: "files"\` outputs are already saved workspace files. If they are user-facing MP4 deliverables from split/trim/export/transcode, publish them with fromWorkspaceOutputs before final reply. \`type: "video"\` is a single final MP4 and can be published with write_file. Do not use node/FFmpeg as a fallback for ordinary editable timeline splicing of existing videos; patch or publish the Remotion composition instead.
Set fromWorkspaceOutputs=true to publish recent workspace image/video outputs to the timeline. Use this immediately after direct FFmpeg deliverables, or later when the user says "publish the videos/images you just exported"; do not re-run FFmpeg.
Path is auto-generated from the current project and output type. Just provide a short name.`,
      inputSchema: z.object({
        path: z.string().optional().describe('File path. Auto-generated when fromLastRunCode=true (just pass name for the slug).'),
        name: z.string().optional().describe('Short descriptive name for the saved code (e.g. "sunset-poster"). Used with fromLastRunCode.'),
        content: z.string().optional().describe('File content. Not needed if fromLastRunCode=true.'),
        fromLastRunCode: z.boolean().optional().describe('Legacy same-attempt compatibility only. For durable Composition promotion use publish_draft({design_path}).'),
        fromWorkspaceOutputs: z.boolean().optional().describe('Publish recent workspace image/video outputs to the timeline instead of writing text/code. Use immediately for user-facing FFmpeg split/trim/export MP4 outputs, and for previously exported outputs across turns. Prefer exact workspace paths returned by run_code/list_files; never guess a workspace URL from a file name.'),
        sourceRanges: z.array(z.object({
          source_url: z.string().url(),
          type: z.enum(['image', 'video']).optional(),
          media_type: z.enum(['image', 'video']).optional(),
          mediaType: z.enum(['image', 'video']).optional(),
          start: z.number().nonnegative().optional(),
          end: z.number().positive().optional(),
          description: z.string().min(1).optional(),
        })).max(20).optional().describe('Publish external image or video media directly to the current Media List without uploading derivatives. Preserve Scene type="image" or type="video" when available. Images need source_url + type + description; videos also require start + end. Older callers may omit type, in which case the server detects it once from MIME/file bytes. Put known media analysis into description so later Agent turns can use it without repeating Analyze.'),
        workspacePaths: z.array(z.string()).optional().describe('Specific workspace file paths to publish. If omitted with fromWorkspaceOutputs=true, publishes the most recent project media outputs.'),
        mediaType: z.enum(['image', 'video', 'all']).optional().describe('Filter workspace outputs when publishing. Default all.'),
        limit: z.number().int().min(1).max(20).optional().describe('Maximum recent workspace outputs to publish when workspacePaths is omitted. Use 3 for three exported clips, etc.'),
        publish: z.boolean().optional().describe('Whether to publish to timeline. Default true. Set false to save workspace output without creating a Snapshot.'),
        compositionMetadata: z.object({
          width: z.number().int().positive().optional(),
          height: z.number().int().positive().optional(),
          props: z.record(z.string(), z.unknown()).optional(),
          fontSubstitutions: z.record(z.string(), z.string()).optional().describe('Explicit persisted legacy-font migration only.'),
          editables: z.array(z.object({
            id: z.string().min(1),
            type: z.enum(['text', 'image', 'video']),
            label: z.string(),
            propKey: z.string().min(1),
            trimBeforePropKey: z.string().min(1).optional(),
            trimAfterPropKey: z.string().min(1).optional(),
          }).passthrough()).optional().describe('Legacy composition migration only. Omit for all new work; the runtime infers ownership from natural props and JSX.'),
          animation: z.object({
            fps: z.number().positive(),
            durationInSeconds: z.number().positive(),
            format: z.string().optional(),
          }).optional(),
          description: z.string().optional(),
        }).optional().describe('Durable metadata for numbered composition parts. Include on the first part and only repeat when it changes; source files are auto-assembled without a final run_code call.'),
      }),
      execute: async ({ path: filePath, name, content, fromLastRunCode, fromWorkspaceOutputs, sourceRanges, workspacePaths, mediaType, limit, publish: shouldPublish, compositionMetadata }) => {
        if (!ctx.supabase || !ctx.userId) {
          return { success: false, message: 'Workspace not available (no Supabase connection).' };
        }
        if (sourceRanges?.length) {
          if (fromWorkspaceOutputs || fromLastRunCode || filePath || content) {
            return { success: false, message: 'sourceRanges publishes external Media List entries directly. Do not combine it with file or workspace output modes.' };
          }
          if (shouldPublish === false) {
            return { success: false, message: 'sourceRanges is a Media List publish operation. Omit publish:false.' };
          }
          try {
            const { publishExternalVideoRanges } = await import('./external-video-range');
            const published = await publishExternalVideoRanges({
              supabase: ctx.supabase,
              projectId: ctx.projectId,
              ranges: sourceRanges,
            });
            await refreshSnapshotUrls(ctx);
            if (published.length) ctx.currentSnapshotIndex = published[published.length - 1].mediaIndex - 1;
            return {
              success: true,
              message: `Published ${published.length} external media item${published.length === 1 ? '' : 's'} to the current Media List without uploading derivatives:\n${published.map((item, index) => item.sourceRange
                ? `${index + 1}. ${item.ref} [video] source_url=${item.sourceRange.source_url} start=${item.sourceRange.start_sec} end=${item.sourceRange.end_sec}\n   Media description: ${item.description}`
                : `${index + 1}. ${item.ref} [image] source_url=${item.url}\n   Media description: ${item.description}`
              ).join('\n')}\nThese refs are available immediately to later tools in this same Agent session. Video refs are bounded to their source ranges; image refs use their source URL directly. Their Media List descriptions are existing media understanding; consume covered content directly and call Analyze only for missing or uncovered details.`,
              published,
            };
          } catch (error) {
            return { success: false, message: error instanceof Error ? error.message : String(error), published: [] };
          }
        }
        if (fromWorkspaceOutputs) {
          if (shouldPublish === false) {
            return { success: false, message: 'fromWorkspaceOutputs is for publishing existing workspace media to the timeline. Omit publish:false.' };
          }
          return publishWorkspaceMediaOutputs(ctx, {
            workspacePaths,
            mediaType: mediaType || 'all',
            limit,
            name,
          });
        }
        let fileContent = content || '';
        let savePath = filePath || '';
        if (fromLastRunCode) {
          const lastCode = (ctx as any).__lastRunCode;
          if (!lastCode) {
            return { success: false, message: 'No run_code output to save. Call run_code first.' };
          }
          fileContent = lastCode;
          const draftsForPath = (ctx as any).__runCodeDrafts || [];
          const lastDraftForPath = draftsForPath[draftsForPath.length - 1];
          if (savePath && /\.(mp4|mov|webm|m4v|jpg|jpeg|png|webp|gif|mp3|wav|m4a|aac)$/i.test(savePath)) {
            return {
              success: false,
              message: 'write_file({ fromLastRunCode: true }) saves the run_code source/publishable draft, not individual binary outputs from type:"files". Use the workspace paths returned by run_code, or return a single type:"video" final MP4 and publish that.',
            };
          }
          // Auto-generate path. Node/FFmpeg runs save the executable JS; composition runs save JSON payload.
          if (!savePath) {
            const snapshotIdx = ctx.snapshotImages.length;
            const slug = (name || 'composition').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
            const isVideoCode = lastDraftForPath?.type === 'video';
            savePath = isVideoCode
              ? `${ctx.projectId}/media-code/snapshot-${snapshotIdx}-${slug}.js`
              : `code/snapshot-${snapshotIdx}-${slug}.json`;
          }
        }
        if (!savePath) {
          return { success: false, message: 'Provide a path or use fromLastRunCode=true.' };
        }
        if (!fileContent) {
          return { success: false, message: 'No content to write. Provide content or set fromLastRunCode=true.' };
        }
        const partPrefix = compositionPartsPrefix(ctx.projectId);
        const isCompositionPart = savePath.startsWith(partPrefix);
        if (isCompositionPart) {
          const filename = savePath.slice(partPrefix.length);
          if (!COMPOSITION_PART_FILENAME_PATTERN.test(filename)) {
            return {
              success: false,
              message: `Composition part filename must use a numeric prefix of at least two digits plus a lowercase slug, such as 00-name.js or 120-scene.js: ${filename}`,
            };
          }
          const sourceChars = fileContent.trim().length;
          if (sourceChars > COMPOSITION_PART_MAX_CHARS) {
            return {
              success: false,
              message: `Composition part is ${sourceChars} characters; hard limit is ${COMPOSITION_PART_MAX_CHARS}. Split the content across new numbered files instead of renaming the same oversized source.`,
            };
          }
        }
        if (/\.json$/i.test(savePath) && /(^|\n)\s*(const|let|function)\s|type\s*:\s*['"`](render|composition|design)['"`]/.test(fileContent)) {
          return {
            success: false,
            message: 'Refusing to save raw Remotion source as JSON. Save source as a numbered composition part or publish the validated autosaved draft with publish_draft({ design_path }).',
          };
        }
        const result = await workspace.writeFile(savePath, fileContent, ctx.supabase, ctx.userId);
        if (!result.success) {
          return { success: false, message: `Write failed: ${result.error}` };
        }
        if (fromLastRunCode) {
          (ctx as any).__lastSavedDraftPath = savePath;
        }
        let compositionWorkspace: Record<string, unknown> | undefined;
        if (isCompositionPart) {
          const paths = new Set<string>((ctx as any).__compositionPartPaths || []);
          paths.add(savePath);
          (ctx as any).__compositionPartPaths = [...paths].sort();
          try {
            let workspaceId = (ctx as any).__compositionWorkspaceId as string | undefined;
            if (!workspaceId) {
              const checkpoint = await getStudioRunCheckpoint(ctx);
              workspaceId = checkpoint.studioRunId || ctx.execution?.runId || `agent:${crypto.randomUUID()}`;
              (ctx as any).__compositionWorkspaceId = workspaceId;
            }
            const compiled = await compileSavedCompositionPart({
              projectId: ctx.projectId,
              userId: ctx.userId,
              supabase: ctx.supabase,
              workspaceId,
              partPath: savePath,
              snapshotImages: ctx.snapshotImages,
              metadata: compositionMetadata,
            });
            (ctx as any).__compositionPartPaths = compiled.partPaths;
            compositionWorkspace = {
              status: compiled.status,
              partCount: compiled.partPaths.length,
              totalChars: compiled.totalChars,
              message: compiled.message,
              ...(compiled.status === 'ready' ? { designPath: compiled.designPath } : {}),
              ...(compiled.status === 'invalid' ? { diagnostics: compiled.diagnostics } : {}),
            };
            if (compiled.status === 'ready') {
              (ctx as any).__pendingDesign = compiled.design;
              (ctx as any).__pendingDesignPublished = false;
              (ctx as any).__lastDesignPayload = compiled.design;
              (ctx as any).__lastRunCode = JSON.stringify(compiled.design, null, 2);
              (ctx as any).__lastSavedDraftPath = compiled.designPath;
              const drafts = ((ctx as any).__runCodeDrafts ||= []);
              const nextDraft = { type: 'design', payload: compiled.design, codePath: compiled.designPath };
              if (drafts.length && drafts[drafts.length - 1]?.codePath === compiled.designPath) {
                drafts[drafts.length - 1] = nextDraft;
              } else {
                drafts.push(nextDraft);
              }
            }
          } catch (error) {
            compositionWorkspace = {
              status: 'invalid',
              partCount: ((ctx as any).__compositionPartPaths || []).length,
              totalChars: 0,
              message: 'Source saved, but the automatic composition workspace could not finish compiling.',
              diagnostics: [error instanceof Error ? error.message : String(error)],
            };
          }
        }

        let publishedArtifact = false;
        let publishedArtifactType: 'design' | 'image' | 'video' | undefined;

        // Publish: when fromLastRunCode and publish !== false, promote the last draft to a real Snapshot
        if (fromLastRunCode && shouldPublish !== false) {

          const drafts = (ctx as any).__runCodeDrafts || [];
          const lastDraft = drafts[drafts.length - 1];

          if (lastDraft?.type === 'design') {
            // Design draft → publish via pendingDesign (renders on frontend)
            const designPayload = lastDraft.payload;
            const preview = lastDraft.previewBase64 || '';

            ctx.snapshotImages.push(preview);
            ctx.currentSnapshotIndex = ctx.snapshotImages.length - 1;


            (ctx as any).__pendingDesign = designPayload;

            (ctx as any).__pendingDesignPublished = true;
            publishedArtifact = true;
            publishedArtifactType = 'design';

            console.log(`📌 [agent] design published via write_file: <<<media_${ctx.snapshotImages.length}>>>`);
          } else if (lastDraft?.type === 'image') {
            // Image draft → push to snapshotImages + emit via generatedImages
            const imageData = lastDraft.imageBase64;
            ctx.snapshotImages.push(imageData);
            ctx.currentSnapshotIndex = ctx.snapshotImages.length - 1;
            ctx.generatedImages.push(imageData);
            publishedArtifact = true;
            publishedArtifactType = 'image';

            console.log(`📌 [agent] image published via write_file: <<<media_${ctx.snapshotImages.length}>>>`);
          } else if (lastDraft?.type === 'video') {
            const videoUrl = lastDraft.videoUrl as string | undefined;
            if (!videoUrl) {
              return { success: false, message: 'Video draft has no videoUrl. Re-run node media code and return a video output.' };
            }

            const { getSupabaseAdmin } = await import('@/lib/supabase/service');
            const { VIDEO_PLACEHOLDER_IMAGE } = await import('@/lib/editor/timeline-derivations');
            const admin = getSupabaseAdmin();
            const snapshotId = crypto.randomUUID();
            const taskId = `ffmpeg-${snapshotId}`;
            const videoMeta: VideoMeta = {
              taskId,
              videoUrl,
              providerUrl: videoUrl,
              videoPath: lastDraft.workspacePath,
              prompt: cleanMediaDescription(lastDraft.description || name || 'FFmpeg video') || name || 'FFmpeg video',
              sourceSnapshotIds: [],
              sourceUrls: [videoUrl],
              status: 'completed',
              duration: typeof lastDraft.duration === 'number' ? lastDraft.duration : null,
              model: 'upload',
              createdAt: new Date().toISOString(),
              width: typeof lastDraft.width === 'number' ? lastDraft.width : undefined,
              height: typeof lastDraft.height === 'number' ? lastDraft.height : undefined,
            };
            const { data: sortData } = await admin.rpc('next_sort_order', { p_project_id: ctx.projectId });
            const { error: insertError } = await admin.from('snapshots').insert({
              id: snapshotId,
              project_id: ctx.projectId,
              image_url: VIDEO_PLACEHOLDER_IMAGE,
              tips: [],
              message_id: '',
              sort_order: sortData ?? 0,
              type: 'video',
              video_meta: videoMeta,
              description: cleanMediaDescription(lastDraft.description || name || 'FFmpeg video') || name || 'FFmpeg video',
            });
            if (insertError) {
              return { success: false, message: `Video publish failed: ${insertError.message}` };
            }

            ctx.snapshotImages.push(videoUrl);
            ctx.currentSnapshotIndex = ctx.snapshotImages.length - 1;
            ctx.pendingVideoSnapshot = { snapshotId, taskId, videoMeta };
            publishedArtifact = true;
            publishedArtifactType = 'video';

            console.log(`📌 [agent] video published via write_file: <<<media_${ctx.snapshotImages.length}>>>`);
          }
        }

        return {
          success: true,
          message: `Saved: ${savePath}`,
          path: savePath,
          storageUrl: toPublicStorageUrl(result.storageUrl || ''),
          published: publishedArtifact,
          artifactType: publishedArtifactType,
          ...(compositionWorkspace ? { compositionWorkspace } : {}),
        };
      },
    });
}

function createDeleteFileTool(
  { ctx }: AgentToolFactoryScope,
) {
  return tool({
      description: `Delete a file from your workspace. Use this to clean up outdated memory or reorganize.`,
      inputSchema: z.object({
        path: z.string().describe('File path to delete'),
      }),
      execute: async ({ path: filePath }) => {
        try {
          if (!ctx.supabase || !ctx.userId) {
            return { success: false, message: 'Workspace not available.' };
          }
          const ok = await workspace.deleteFile(filePath, ctx.supabase, ctx.userId);
          return ok ? { success: true, message: `Deleted: ${filePath}` } : { success: false, message: `File not found: ${filePath}` };
        } catch (e) {
          return { success: false, message: `Delete failed: ${e instanceof Error ? e.message : String(e)}` };
        }
      },
    });
}

function createRunCodeTool(
  { ctx }: AgentToolFactoryScope,
) {
  return tool({
      description: `Execute JavaScript.

Before first use, read \`prompts/agent-coding.md\`, plus \`prompts/remotion-composition.md\` for Remotion/editable compositions. For new compositions or major visual/timing patches, follow \`skills/_shared/remotion-director-contract.md\` and its required references. Studio Run uses the same original Composition and Director guidance; it does not replace them with a compact creative prompt. For real file-level MP4 splitting, exact trimming/export, transcode, frames, audio muxing, long-video preparation, or final assembly of generated chunks, also read \`skills/video-ffmpeg-lab/SKILL.md\`. Do not re-read a guide already present in tool-result history.

Runtimes:
- \`runtime: "composition"\`: Remotion/editable composition draft, animated template, overlay, sharp utility.
- \`runtime: "design"\` or omitted: legacy alias for \`runtime: "composition"\`.
- \`runtime: "node"\`: open backend Node with FFmpeg/FFprobe for real file-level media operations. Never use node as a fallback for ordinary editable timeline splicing of existing videos.

Return exactly one supported shape:
- \`{ type: 'render', code, width, height, props?, animation?, fontSubstitutions? }\`
- \`{ type: 'composition', code, width, height, props?, animation?, fontSubstitutions? }\` — alias for \`render\`
- \`{ type: 'patch', edits?, props?, fontSubstitutions?, code_path? }\`
- \`{ type: 'image', data, mimeType }\`
- \`{ type: 'video', path, contentType?, description?, duration?, width?, height? }\`
- \`{ type: 'files', outputs: [{ path, contentType, description? }] }\`
- \`{ type: 'text', content }\`
- \`{ type: 'error', message }\`

For substantial normal Agent Run coding, prefer \`write_code_file\` followed by \`run_code({ code_path })\`. This exposes real source progress, persists the program before execution, and keeps it patchable across turns. For a small patch or utility, inline \`code\` remains available. The top-level \`composition\` input remains available for direct first-draft payloads.

When \`write_code_file\` uses \`runtime: "composition"\`, it may contain a natural JS/TS/JSX/TSX Remotion module with imports/exports and a top-level Composition, or the legacy outer JavaScript body. For a new natural module, provide width/height/animation through the optional \`composition\` metadata on run_code; code_path supplies the source, so do not repeat it.

For durable Composition work, use \`write_file\` to author numbered source parts. Every file MUST be under \`<project-id>/drafts/composition-parts/\` and use a numeric prefix of at least two digits plus a lowercase slug. Each file has a hard transport limit of 12000 source characters. There is no aggregate source-size or part-count limit. Files are concatenated by numeric prefix into one scope, so do not use import/export. Preserve approved narration, subtitles, scenes, animation, and visual detail; never trim creative content to satisfy a source-size target. Saving a part automatically assembles, validates, and autosaves the workspace. The legacy composition_parts input remains available for recovery and explicit subsets, but do not call it merely to assemble a directory that write_file has already compiled.

For a 30s+ first composition, author numbered composition parts until write_file reports compositionWorkspace.status="ready". Use scene data arrays and shared components where they help, but do not impose an aggregate source-size target or trim approved creative detail. Preview or patch the returned designPath directly; no assembly-only run_code call is needed.

Composition hard rules: use Remotion \`<Img>\`, not \`<img>\`; the props-first editable text/image/video/trim contract lives in \`prompts/remotion-composition.md\` and applies by default to composition render/patch outputs. New composition output should omit explicit editables metadata; the runtime infers and persists it from natural prop reads. Do not add editables to \`runtime:"node"\` media exports or external image/video tool outputs. Use only the pinned font catalog in \`prompts/remotion-composition.md\`; never use Apple/local/system font names. \`fontSubstitutions\` is only for an explicit persisted migration of an old composition, never for silently choosing a lookalike. Keep mobile image layers light. Reference timeline media in composition code and props with the literal 1-based marker \`<<<media_N>>>\`; the runtime resolves markers to current URLs before validation, autosave, preview, and export. Never translate Media Index N into \`ctx.snapshotImages[N]\` because that JavaScript array is 0-based. Only \`Composition(props)\` may read \`props\` directly; helper components must receive values through their own parameters and must never reference outer \`props\` (prevents \`props is not defined\` in Lambda). For timeline videos, preserve the selected Media Index video aspect ratio when all selected videos share one aspect: 9:16 sources must return a 9:16 canvas such as 1080x1920, never a 16:9 canvas. For mixed-aspect sources, choose the user/platform/current composition target and use contain/background; do not claim the runtime forced one source's aspect.
For legacy first-draft calls without \`composition\`, send one complete executable JavaScript body that returns the render object. Do not send a fragment like \`const code = \\\`\` without the final \`return { type: 'render', code, ... }\`. Keep long videos concise by using arrays, helper components, and interpolations instead of writing frame-by-frame code.

Node media runtime provides a standard isolated Node environment with \`require\`, ESM/CommonJS, JS/TS/JSX/TSX compilation, \`process\`, \`ffmpegPath\`, \`inputFiles\`, \`outputDir\`, \`workDir\`, \`workspaceDir\`, \`saveOutput(localPath)\`, and \`probeVideo(path)\`. Normal Node built-ins are available. Bare npm packages may be required directly; a missing package is installed inside the disposable Sandbox on first use. Workspace files are local to the runtime: use \`workspace_paths\` and \`inputFiles[n].inputPath\`, never download or reconstruct Storage URLs. For \`runtime: "node"\`, any referenced timeline media like \`<<<media_1>>>\` MUST be passed as \`media_refs: [1]\`; any existing workspace file from \`list_files\` MUST be passed as \`workspace_paths: ["project/media/file.mp4"]\`. The system resolves both to local workspace-backed files before your code runs. \`ffprobePath\` may be empty in deployment; prefer \`probeVideo(path)\`. Use \`type: "files"\` for chunks and \`type: "video"\` for the final MP4. If execution reports a real code or dependency error, inspect it and keep repairing the same saved program until it succeeds; do not abandon the user-visible result. If ordinary timeline splicing was routed to composition, do not switch to node just because preview needs adjustment; patch the composition and continue.`,
      inputSchema: z.object({
        code: z.string().optional().describe('JavaScript code to execute. Required for node, patch, image, and legacy calls. For a first Remotion draft prefer the direct composition input instead.'),
        code_path: z.string().optional().describe('Workspace code file created by write_code_file. Preferred for substantial normal Agent Run coding; run_code reads and executes the saved source without repeating it in tool history.'),
        composition: z.object({
          code: z.string().min(1).optional().describe('Direct Remotion component source. Natural imports/exports are accepted. Omit when code_path supplies the source and this object only supplies metadata.'),
          width: z.number().int().positive(),
          height: z.number().int().positive(),
          props: z.record(z.string(), z.unknown()).optional(),
          fontSubstitutions: z.record(z.string(), z.string()).optional().describe('Explicit persisted migration for legacy font names only, e.g. {"STKaiti":"Ma Shan Zheng"}. Never infer or add silently.'),
          editables: z.array(z.object({
            id: z.string().min(1),
            type: z.enum(['text', 'image', 'video']),
            label: z.string(),
            propKey: z.string().min(1),
            trimBeforePropKey: z.string().min(1).optional(),
            trimAfterPropKey: z.string().min(1).optional(),
          }).passthrough()).optional().describe('Legacy composition migration only. Omit for all new work; the runtime infers ownership from natural props and JSX.'),
          animation: z.object({
            fps: z.number().positive(),
            durationInSeconds: z.number().positive(),
            format: z.string().optional(),
          }).optional(),
        }).optional().describe('Preferred first-draft Remotion payload or metadata for a natural module supplied by code_path.'),
        composition_parts: z.object({
          paths: z.array(z.string()).min(2).optional().describe('Optional explicit subset of numbered workspace .js files under <project-id>/drafts/composition-parts/. No part-count or aggregate-size limit. Files are assembled by numeric prefix.'),
          directory: z.string().optional().describe('Preferred for complete or long compositions: <project-id>/drafts/composition-parts. The server discovers every valid numbered .js part in this directory, so the model does not repeat a long paths array.'),
          width: z.number().int().positive(),
          height: z.number().int().positive(),
          props: z.record(z.string(), z.unknown()).optional(),
          fontSubstitutions: z.record(z.string(), z.string()).optional().describe('Explicit persisted migration for legacy font names only.'),
          editables: z.array(z.object({
            id: z.string().min(1),
            type: z.enum(['text', 'image', 'video']),
            label: z.string(),
            propKey: z.string().min(1),
            trimBeforePropKey: z.string().min(1).optional(),
            trimAfterPropKey: z.string().min(1).optional(),
          }).passthrough()).optional().describe('Legacy composition migration only. Omit for all new work; the runtime infers ownership from natural props and JSX.'),
          animation: z.object({
            fps: z.number().positive(),
            durationInSeconds: z.number().positive(),
            format: z.string().optional(),
          }).optional(),
        }).refine(value => Boolean(value.paths?.length || value.directory), {
          message: 'Provide composition_parts.paths or composition_parts.directory.',
        }).optional().describe('Durable multipart Remotion payload. Write one small numbered part per model step, then assemble by directory or explicit paths without repeating the source.'),
        description: z.string().optional().describe('Brief description of what this code does. For compositions/videos, describe the content and visual style (e.g. "15s cinematic video: 4 scenes of temple visit with Ken Burns + fade transitions, Japanese text overlays"). This is stored as the snapshot description — be specific.'),
        media_refs: z.array(z.number()).optional().describe('1-based Media Index indices referenced by the user (e.g. [1] for <<<media_1>>>). REQUIRED for runtime:"node" FFmpeg work on timeline media; the system resolves them to local workspace-backed inputFiles[0], inputFiles[1], ... . Do not hardcode Media Index URLs for FFmpeg inputs. For ordinary editable splicing of two timeline videos, use runtime:"composition" instead.'),
        workspace_paths: z.array(z.string()).optional().describe('Workspace file paths from list_files/read_file, e.g. ["project-id/media/clip.mp4"]. For runtime:"node", pass these instead of downloading or copying storage URLs; they are resolved to local inputFiles after media_refs.'),
        runtime: z.enum(['composition', 'design', 'node']).optional().describe('composition = safe Remotion/editable composition runtime. design = legacy alias for composition. node = fully open backend Node runtime with fs/child_process/ffmpeg for real MP4 editing.'),
      }).refine(value => Boolean(value.code || value.code_path || value.composition?.code || value.composition_parts), {
        message: 'Provide executable code, a code_path, a direct composition payload, or durable composition parts.',
      }),
      execute: async ({ code, code_path, composition, composition_parts, description: desc, media_refs, workspace_paths, runtime }) => {
        let executableCode = code || '';
        if (code_path) {
          if (!ctx.supabase || !ctx.userId) {
            return { type: 'text' as const, content: 'Workspace not available. Cannot read code_path.' };
          }
          const file = await workspace.readFile(code_path, ctx.supabase, ctx.userId);
          executableCode = file?.content || '';
          if (!executableCode.trim()) {
            return { type: 'text' as const, content: `Code file not found or empty: ${code_path}` };
          }
          (ctx as any).__lastCodeFilePath = code_path;
        }
        console.log(`🔧 [run_code] ${desc || 'executing code'}...`);
        const startTime = Date.now();
        let resolvedComposition = composition;
        if (resolvedComposition && !resolvedComposition.code && executableCode.trim()) {
          resolvedComposition = { ...resolvedComposition, code: executableCode };
        }
        if (
          !resolvedComposition
          && runtime !== 'node'
          && code_path
          && isDirectRemotionCompositionSource(executableCode)
        ) {
          const previous = (ctx as any).__lastDesignPayload as Record<string, any> | undefined;
          resolvedComposition = {
            code: executableCode,
            width: previous?.width || 1080,
            height: previous?.height || 1920,
            props: previous?.props,
            animation: previous?.animation,
            editables: previous?.editables,
          };
        }
        if (composition_parts) {
          if (runtime === 'node') {
            return { type: 'text' as const, content: 'composition_parts is only available in the composition runtime.' };
          }
          if (!ctx.supabase || !ctx.userId) {
            return { type: 'text' as const, content: 'Composition parts require workspace access.' };
          }
          try {
            let partPaths = composition_parts.paths ?? [];
            if (composition_parts.directory) {
              const expectedDirectory = compositionPartsPrefix(ctx.projectId).replace(/\/$/, '');
              const requestedDirectory = composition_parts.directory.replace(/\/+$/, '');
              if (requestedDirectory !== expectedDirectory) {
                return { type: 'text' as const, content: `Composition parts directory must be ${expectedDirectory}` };
              }
              const files = await workspace.listFiles(`${expectedDirectory}/*`, ctx.supabase, ctx.userId);
              partPaths = files
                .map(file => file.path)
                .filter(filePath => {
                  const filename = filePath.slice(`${expectedDirectory}/`.length);
                  return COMPOSITION_PART_FILENAME_PATTERN.test(filename);
                });
            }
            if (partPaths.length < 2) {
              return { type: 'text' as const, content: 'At least two valid numbered composition parts are required.' };
            }
            const loaded: Array<{ path: string; content: string }> = [];
            for (const partPath of partPaths) {
              const file = await workspace.readFile(partPath, ctx.supabase, ctx.userId);
              if (!file) return { type: 'text' as const, content: `Composition part not found: ${partPath}` };
              loaded.push({ path: partPath, content: file.content });
            }
            const assembled = assembleCompositionParts({ projectId: ctx.projectId, parts: loaded });
            const { paths: _paths, directory: _directory, ...metadata } = composition_parts;
            resolvedComposition = { ...metadata, code: assembled.code };
            (ctx as any).__compositionPartPaths = assembled.paths;
            console.log(`[run_code] assembled ${assembled.paths.length} composition parts (${assembled.totalChars} chars)`);
          } catch (error) {
            return { type: 'text' as const, content: `Composition parts failed: ${error instanceof Error ? error.message : String(error)}` };
          }
        }
        // Store raw code for write_file({ fromLastRunCode: true })
        (ctx as any).__lastRunCode = resolvedComposition ? JSON.stringify(resolvedComposition, null, 2) : executableCode;

        // Refresh snapshotImages URLs from DB — ensures URLs are valid
        if (ctx.supabase && ctx.projectId) {
          try {
            await refreshSnapshotUrls(ctx);
          } catch (e) {
            console.warn('⚠️ [run_code] failed to refresh snapshot URLs:', e);
          }
        }

        if (runtime === 'node') {
          if (!executableCode) {
            return { type: 'text' as const, content: 'Node media runtime requires executable code or code_path; composition is only for Remotion first drafts.' };
          }
          if (!ctx.supabase || !ctx.userId) {
            return { type: 'text' as const, content: 'Node media runtime requires workspace access. Please try again after the project finishes loading.' };
          }
          const { buildMediaItems, runNodeMediaCode } = await import('./media-sandbox');
          const mediaItems = await buildMediaItems({
            snapshotImages: ctx.snapshotImages,
            projectId: ctx.projectId,
            supabase: ctx.supabase,
          });
          const mediaResult = await runNodeMediaCode({
            code: executableCode,
            codePath: code_path,
            description: desc,
            mediaRefs: media_refs,
            workspacePaths: workspace_paths,
            mediaItems,
            projectId: ctx.projectId,
            userId: ctx.userId,
            supabase: ctx.supabase,
          });

	          if (mediaResult.type === 'error') {
	            return { type: 'text' as const, content: `Node media runtime error: ${mediaResult.content || 'unknown error'}` };
	          }

	          const workspaceOutputs = mediaResult.outputs
	            .filter(o => o.storageUrl && (isImageContentType(o.contentType) || isVideoContentType(o.contentType)))
	            .map(o => ({
	              path: o.workspacePath,
	              storageUrl: o.storageUrl!,
	              contentType: o.contentType || inferWorkspaceContentType(o.workspacePath || o.storageUrl || ''),
	              description: o.description || desc,
	              duration: o.duration ?? o.probe?.duration ?? null,
	              width: o.width ?? o.probe?.width,
	              height: o.height ?? o.probe?.height,
	            }));
	          for (const output of workspaceOutputs) {
	            await ensureWorkspaceFileIndex(ctx, output);
	          }
	          rememberWorkspaceMediaOutputs(ctx, workspaceOutputs);

	          const primary = mediaResult.primaryOutput;
          if (mediaResult.type === 'video' && primary?.contentType?.startsWith('video/') && primary.storageUrl) {
            if (!(ctx as any).__runCodeDrafts) (ctx as any).__runCodeDrafts = [];
            (ctx as any).__runCodeDrafts.push({
              type: 'video',
              videoUrl: primary.storageUrl,
              workspacePath: primary.workspacePath,
              description: primary.description || desc || 'FFmpeg video',
              duration: primary.duration ?? primary.probe?.duration ?? null,
              width: primary.width ?? primary.probe?.width,
              height: primary.height ?? primary.probe?.height,
              outputs: mediaResult.outputs,
            });
            const draftIdx = (ctx as any).__runCodeDrafts.length;
            const dur = typeof primary.duration === 'number' ? `, ${primary.duration.toFixed(1)}s` : '';
            const location = primary.workspacePath || '(workspace path unavailable)';
            const provider = primary.storageUrl ? `\nProvider URL for model tools only: ${primary.storageUrl}` : '';
            return {
              type: 'text' as const,
              content: `Node media run complete — final video output ${draftIdx} saved to workspace${dur}: ${location}${provider}\nIf this MP4 is the user-facing result, immediately publish it with write_file({ fromLastRunCode: true, name: "<descriptive-slug>" }) before telling the user it is done. If it is only an intermediate model-prep chunk, keep it in workspace and reuse the workspace path directly for FFmpeg.`,
            };
          }

          if (primary?.contentType?.startsWith('image/') && primary.storageUrl) {
            if (!(ctx as any).__runCodeDrafts) (ctx as any).__runCodeDrafts = [];
            (ctx as any).__runCodeDrafts.push({
              type: 'image',
              imageBase64: primary.storageUrl,
              previewUrl: primary.storageUrl,
              outputs: mediaResult.outputs,
            });
          }

          const outputLinks = mediaResult.outputs
            .map((o, i) => {
              const provider = o.storageUrl ? ` (provider URL: ${o.storageUrl})` : '';
              return `${i + 1}. ${o.description ? `${o.description}: ` : ''}${o.workspacePath || o.path || '(no path)'}${provider}`;
            })
            .join('\n') || '(none)';
          const outputMessage = `Workspace outputs:\n${outputLinks}`;
          return {
            type: 'text' as const,
            content: mediaResult.content
              ? `${mediaResult.content}\n\n${outputMessage}\n\nIf these are user-facing MP4 deliverables, immediately publish them with write_file({ fromWorkspaceOutputs: true, mediaType: "video", limit: ${mediaResult.outputs.length || 1} }) before telling the user it is done. Keep them as workspace outputs only for intermediate model-preparation chunks or when the user explicitly says not to publish.`
              : `Node media run complete. Workspace outputs are ready.\n${outputMessage}\n\nIf these are user-facing MP4 deliverables, immediately publish them with write_file({ fromWorkspaceOutputs: true, mediaType: "video", limit: ${mediaResult.outputs.length || 1} }) before telling the user it is done. Keep them as workspace outputs only for intermediate model-preparation chunks or when the user explicitly says not to publish.`,
          };
        }

        // Debug: log snapshot image URLs available to run_code
        console.log(`📸 [run_code] ctx.snapshotImages (${ctx.snapshotImages.length}):`);
        ctx.snapshotImages.forEach((img, i) => {
          console.log(`  [${i}] ${img ? (img.startsWith('http') ? img : `base64:${img.length}chars`) : 'EMPTY'}`);
        });
        try {
          let result: any;
          if (resolvedComposition) {
            result = { type: 'render', ...resolvedComposition };
          } else {
          // Pre-fetch requested still images as Buffers. Timeline video refs are
          // resolved through <<<media_N>>> in the returned composition; sending
          // their MP4 bytes through Sharp fails before the composition can run.
          let preloadedImages: Buffer[] = [];
          if (media_refs?.length) {
            for (const ref of media_refs) {
              const v = validateImageIndex(ctx.snapshotImages, ref);
              if (v.error) return { type: 'text' as const, content: v.error };
            }
            const stillMediaRefs = media_refs.filter(ref => !isVideoUrl(ctx.snapshotImages[ref - 1]));
            const skippedVideoRefs = media_refs.filter(ref => isVideoUrl(ctx.snapshotImages[ref - 1]));
            preloadedImages = await Promise.all(
              stillMediaRefs.map(ref => fetchImageBuffer(ctx.snapshotImages[ref - 1]))
            );
            console.log(`📦 [run_code] pre-fetched ${preloadedImages.length} images (${preloadedImages.map(b => `${(b.length / 1024).toFixed(0)}KB`).join(', ')})`);
            if (skippedVideoRefs.length) {
              console.log(`🎬 [run_code] kept video refs marker-backed: ${skippedVideoRefs.map(ref => `<<<media_${ref}>>>`).join(', ')}`);
            }
          }

          // Build sandbox context
          // Helper: save file to workspace directly from run_code (avoids passing large base64 back to Agent)
          const saveToWorkspace = async (path: string, content: string | Buffer, contentType?: string) => {
            if (!ctx.supabase || !ctx.userId) return { success: false, error: 'No Supabase connection' };
            const result = await workspace.writeFile(path, content, ctx.supabase, ctx.userId, contentType);
            return { ...result, storageUrl: result.storageUrl ? toPublicStorageUrl(result.storageUrl) : undefined };
          };

          const JSZip = (await import('jszip')).default;

          const sandbox = {
            sharp,
            saveToWorkspace,
            JSZip,
            images: preloadedImages,
            fetch: globalThis.fetch,
            Buffer,
            JSON,
            Math,
            Date,
            console: { log: (...args: unknown[]) => console.log('[run_code]', ...args) },
            ctx: {
              snapshotImages: ctx.snapshotImages,
              snapshotCount: ctx.snapshotImages.length,
              projectId: ctx.projectId,
              userId: ctx.userId || '',
              supabase: ctx.supabase,
            },
          };

          // Execute in vm sandbox — isolates from process.env, require, fs, etc.
          const vm = require('vm') as typeof import('vm');
          const context = vm.createContext({
            ...sandbox,
            setTimeout, clearTimeout, Promise, // needed for async code
          });

          const wrappedCode = `(async () => { 'use strict';\n${executableCode}\n})()`;
          const script = new vm.Script(wrappedCode);
          result = await script.runInContext(context, { timeout: 30_000 });
          }

          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const resultKind = typeof result?.type === 'string'
            ? result.type.trim().toLowerCase()
            : result?.type;
          console.log(`✅ [run_code] done in ${elapsed}s, result type: ${typeof result}, kind: ${String(resultKind ?? 'N/A')}, isBuffer: ${Buffer.isBuffer(result)}, keys: ${result && typeof result === 'object' ? Object.keys(result).join(',') : 'N/A'}, dataType: ${result?.data ? `${typeof result.data} / ${result.data.constructor?.name} / len=${result.data.length || 'N/A'}` : 'no data'}`);

          // Handle result types — be flexible about what Agent returns
          if (!result) {
            return { type: 'text' as const, content: 'Code executed but returned nothing. Make sure to return a value.' };
          }

          // Helper: convert anything buffer-like to base64 string
          const toBase64 = (data: unknown): string | null => {
            if (Buffer.isBuffer(data)) return data.toString('base64');
            if (data instanceof Uint8Array) return Buffer.from(data).toString('base64');
            if (typeof data === 'string' && data.length > 100) return data; // already base64
            return null;
          };

          // Helper: store image — sharp images auto-send; durable design drafts use publish_draft.
          const pushImage = (b64: string, mime: string, isDraft = false) => {
            const dataUrl = `data:${mime};base64,${b64}`;
            ctx.currentImage = dataUrl;
            if (isDraft) {
              if (!(ctx as any).__runCodeDrafts) (ctx as any).__runCodeDrafts = [];
              (ctx as any).__runCodeDrafts.push({ type: 'image', imageBase64: dataUrl, previewBase64: dataUrl });
            } else {
              ctx.snapshotImages.push(dataUrl);
              ctx.generatedImages.push(dataUrl);
            }
          };

          // Incremental update on the last composition or code_path.
          if (resultKind === 'patch' && (
            Array.isArray(result.edits)
            || result.props !== undefined
            || result.editables !== undefined
            || result.fontSubstitutions !== undefined
          )) {
            let baseDesign = (ctx as any).__lastDesignPayload;

            // code_path: load a different design from workspace as patch base
            if (result.code_path && typeof result.code_path === 'string') {
              try {
                const file = await workspace.readFile(result.code_path, ctx.supabase, ctx.userId);
                if (!file) {
                  return { type: 'text' as const, content: `Patch failed: code_path "${result.code_path}" not found. Use read_file to verify the path.` };
                }
                baseDesign = JSON.parse(file.content);
              } catch (e) {
                return { type: 'text' as const, content: `Patch failed: could not read "${result.code_path}": ${e instanceof Error ? e.message : String(e)}` };
              }
            }

            if (!baseDesign) {
              return { type: 'text' as const, content: 'Patch failed: no base composition. Provide code_path in the patch result, e.g. return { type: "patch", code_path: "code/...", edits: [...] }. Do not fall back to render unless the user asked for a new composition.' };
            }
            let code = baseDesign.code;
            if (Array.isArray(result.edits)) {
              for (const edit of result.edits) {
                if (typeof edit.old !== 'string' || typeof edit.new !== 'string') {
                  return { type: 'text' as const, content: 'Patch failed: each edit must have "old" and "new" strings.' };
                }
                const count = code.split(edit.old).length - 1;
                if (count === 0) return { type: 'text' as const, content: `Patch failed: old_string not found in current code.\n"${edit.old.slice(0, 100)}"` };
                if (count > 1) return { type: 'text' as const, content: `Patch failed: old_string matches ${count} times. Add more surrounding context to make it unique.\n"${edit.old.slice(0, 100)}"` };
                code = code.replace(edit.old, edit.new);
              }
            }
            const mergedProps = mergePatchProps(baseDesign.props, result.props);
            const patched = {
              ...baseDesign,
              code: resolveMediaMarkersInString(code, ctx.snapshotImages),
              props: resolveMediaMarkersInValue(mergedProps, ctx.snapshotImages) as Record<string, unknown> | undefined,
            };
            if ((baseDesign as Record<string, unknown>).__makaronScaffold === true) {
              delete (patched as Record<string, unknown>).__makaronScaffold;
              (patched as Record<string, unknown>).description = desc || 'Director-refined Studio composition';
            }
            patched.animation = normalizeCompositionAnimation(patched.code, patched.animation);
            if (result.editables) patched.editables = result.editables;
            if (result.fontSubstitutions && typeof result.fontSubstitutions === 'object') {
              patched.fontSubstitutions = result.fontSubstitutions;
            }

            const promiseError = studioCompositionPromiseError(await getStudioRunCheckpoint(ctx), patched);
            if (promiseError) return { type: 'text' as const, content: promiseError };

            const harnessError = validateDesign(patched);
            if (harnessError) return { type: 'text' as const, content: harnessError };

            if (!ctx.supabase || !ctx.userId) {
              return { type: 'text' as const, content: 'Patch passed validation but cannot be safely autosaved because workspace access is unavailable.' };
            }
            const autosave = await persistCompositionDraft({
              projectId: ctx.projectId,
              userId: ctx.userId,
              supabase: ctx.supabase,
              design: patched,
              sourceDesignPath: typeof result.code_path === 'string' ? result.code_path : ctx.currentDesignPath,
            });
            if (!autosave.success) {
              return { type: 'text' as const, content: `Patch passed validation but autosave failed after 3 attempts: ${autosave.error}. Retry run_code before ending the turn.` };
            }

            (ctx as any).__pendingDesign = patched;
            (ctx as any).__pendingDesignPublished = false; // draft — canvas preview only, no snapshot
            (ctx as any).__lastDesignPayload = patched;
            (ctx as any).__lastRunCode = JSON.stringify(patched, null, 2);
            (ctx as any).__lastSavedDraftPath = autosave.path;

            // Track draft for local preview; durable promotion uses its autosaved design path.
            if (!(ctx as any).__runCodeDrafts) (ctx as any).__runCodeDrafts = [];

            // Update last draft (patch updates existing draft, doesn't create new one)
            const drafts = (ctx as any).__runCodeDrafts;
            if (drafts.length > 0) {
              drafts[drafts.length - 1] = { type: 'design', payload: patched, codePath: autosave.path };
            } else {
              drafts.push({ type: 'design', payload: patched, codePath: autosave.path });
            }

            const draftIdx = drafts.length;
            const patchSource = result.code_path ? ` from ${result.code_path}` : '';
            return { type: 'text' as const, code_path: autosave.path, content: `Patched${patchSource} — draft ${draftIdx} autosaved to ${autosave.path}. If this changed trim timing, confirm animation.durationInSeconds matches the final frame count. If this changed transitions, subtitles, overlays, trim timing, cropping, or will be published, call preview_frame before telling the user it is complete. After QA, use publish_draft({ design_path: "${autosave.path}" }) when the editable composition should appear in the timeline.` };
          }

          // { type: 'render' (or aliases 'composition' / legacy 'design'), code: '...' } — Store for event loop to emit as SSE
          if ((resultKind === 'render' || resultKind === 'composition' || resultKind === 'design') && typeof result.code === 'string') {
            // Normalize animation struct — agent may return { fps, duration } or { animation: { fps, durationInSeconds } }
            let animation = result.animation;
            if (!animation && (result.fps || result.duration || result.durationInSeconds)) {
              animation = {
                fps: result.fps || 30,
                durationInSeconds: result.durationInSeconds || result.duration || 5,
              };
            }
            const promiseError = studioCompositionPromiseError(await getStudioRunCheckpoint(ctx), {
              width: result.width,
              height: result.height,
            });
            if (promiseError) return { type: 'text' as const, content: promiseError };
            // ── Composition harness: compile + image reference checks ──
            const resolvedCode = resolveMediaMarkersInString(result.code, ctx.snapshotImages);
            const resolvedProps = resolveMediaMarkersInValue(result.props, ctx.snapshotImages) as Record<string, unknown> | undefined;
            const normalizedComposition = {
              code: resolvedCode,
              props: resolvedProps,
              editables: result.editables,
              animation,
            };
            const harnessError = validateDesign(normalizedComposition);
            if (harnessError) {
              return { type: 'text' as const, content: harnessError };
            }
            const aspectError = await validateCompositionMediaAspect(ctx, {
              code: normalizedComposition.code,
              props: resolvedProps,
              width: result.width,
              height: result.height,
            });
            if (aspectError) {
              return { type: 'text' as const, content: aspectError };
            }
            const normalizedEditables = normalizedComposition.editables ?? [];

            // ── Harness passed — store composition ──
            // Auto-generate description if Agent didn't provide one
            const autoDesc = desc || (() => {
              const type = animation ? `${animation.durationInSeconds}s video` : 'still composition';
              // Extract text content from code (string literals in JSX)
              const textMatches = result.code.match(/>([^<>{}\n]{3,60})</g)?.slice(0, 5).map((m: string) => m.slice(1).trim()).filter(Boolean);
              const textHint = textMatches?.length ? `: "${textMatches.slice(0, 3).join('", "')}"` : '';
              return `${type} (${result.width || 1080}x${result.height || 1350})${textHint}`;
            })();
            animation = normalizeCompositionAnimation(normalizedComposition.code, animation);
            const designPayload = {
              code: normalizedComposition.code,
              width: result.width || 1080,
              height: result.height || 1350,
              props: resolvedProps,
              animation,
              description: autoDesc,
              ...(normalizedEditables.length > 0
                ? { editables: normalizedEditables }
                : {}),
              ...(result.fontSubstitutions ? { fontSubstitutions: result.fontSubstitutions } : {}),
            };
            if (!ctx.supabase || !ctx.userId) {
              return { type: 'text' as const, content: 'Composition passed validation but cannot be safely autosaved because workspace access is unavailable.' };
            }
            const autosave = await persistCompositionDraft({
              projectId: ctx.projectId,
              userId: ctx.userId,
              supabase: ctx.supabase,
              design: designPayload,
              sourceDesignPath: ctx.currentDesignPath,
            });
            if (!autosave.success) {
              return { type: 'text' as const, content: `Composition passed validation but autosave failed after 3 attempts: ${autosave.error}. Retry run_code before ending the turn.` };
            }
            (ctx as any).__pendingDesign = designPayload;
            (ctx as any).__pendingDesignPublished = false; // draft — canvas preview only, no snapshot
            (ctx as any).__lastDesignPayload = designPayload;
            // Store for write_file({ fromLastRunCode: true })
            (ctx as any).__lastRunCode = JSON.stringify(designPayload, null, 2);
            (ctx as any).__lastSavedDraftPath = autosave.path;

            // Track draft for local preview; durable promotion uses its autosaved design path.
            if (!(ctx as any).__runCodeDrafts) (ctx as any).__runCodeDrafts = [];

            // Push new draft (no auto-screenshot — Agent uses preview_frame tool to check)
            (ctx as any).__runCodeDrafts.push({ type: 'design', payload: designPayload, codePath: autosave.path });
            const draftIdx = (ctx as any).__runCodeDrafts.length;

            return { type: 'text' as const, code_path: autosave.path, content: `Composition ready — draft ${draftIdx} autosaved to ${autosave.path}. If this changed trim timing, confirm animation.durationInSeconds matches the final frame count. If this includes transitions, subtitles, overlays, trim timing, cropping, or will be published, call preview_frame with design_path if the run resumes later. After QA, use publish_draft({ design_path: "${autosave.path}" }) when the editable composition should appear in the timeline.` };
          }

          // Helper: handle sharp image result — auto-sends to frontend (no draft/publish needed)
          const handleImageResult = async (b64: string, mime: string): Promise<{ type: 'image'; base64Data: string; mimeType: string; description?: string }> => {
            pushImage(b64, mime);
            return { type: 'image' as const, base64Data: b64, mimeType: mime, description: `Image generated. Now <<<media_${ctx.snapshotImages.length}>>>.` };
          };

          // Buffer or Uint8Array → treat as image
          const directB64 = toBase64(result);
          if (directB64) {
            return handleImageResult(directB64, 'image/jpeg');
          }

          // { type: 'image', data: ... } — standard format
          if (resultKind === 'image' && result.data) {
            const b64 = toBase64(result.data) || String(result.data);
            return handleImageResult(b64, result.mimeType || 'image/jpeg');
          }

          // { buffer: ... } — sharp output shorthand
          if (result.buffer) {
            const b64 = toBase64(result.buffer);
            if (b64) {
              return handleImageResult(b64, result.mimeType || 'image/jpeg');
            }
          }

          // Error result
          if (resultKind === 'error') {
            return { type: 'text' as const, content: `Error: ${result.message}` };
          }

          // Text result
          if (resultKind === 'text') {
            return { type: 'text' as const, content: String(result.content) };
          }

          // Fallback: stringify
          return { type: 'text' as const, content: JSON.stringify(result, null, 2) };
        } catch (e) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`❌ [run_code] failed in ${elapsed}s:`, msg);
          return { type: 'text' as const, content: `Code execution error: ${msg}` };
        }
      },

      toModelOutput({ output }: { output: any }) {
        if (output.type === 'image' && output.base64Data) {
          return {
            type: 'content' as const,
            value: [
              modelFileContent(output.base64Data, output.mimeType || 'image/jpeg'),
              { type: 'text' as const, text: output.description ? `Code output: ${output.description}` : 'Code produced an image.' },
            ],
          };
        }
        return {
          type: 'content' as const,
          value: [{ type: 'text' as const, text: output.content || 'Code executed successfully.' }],
        };
      },
    });
}

function createGenerateAudioTool(
  { ctx }: AgentToolFactoryScope,
) {
  return tool({
      description: `Generate audio from a natural-language prompt.

This is the single Agent-facing audio-generation tool. Use it for every standalone voiceover, narration, dialogue, speech translation, multilingual character performance, music bed, ambience, sound effect, and mixed sound scene. All voiceover content is generated by Seed Audio; there is no separate Agent voiceover or voice-catalog tool.

Before its first use in a conversation, read \`prompts/audio.md\` and write one compact production brief with an audible timeline. If the final soundtrack contains voice plus music, ambience, or SFX, make exactly one model generation with kind="mixed"; never generate voiceover and supporting audio separately. Use kind="voiceover" only for an intentionally isolated voice master. Use kind="translation" to translate source speech while retaining the source speaker; it requires exactly one source_voice and a target_language. Include translated_script when claims or wording need deterministic control, otherwise Seed Audio translates the referenced speech directly. Then call transcribe_audio on every translated result before composition work.

Exception: if the chosen final-video workflow is generate_animation, do not generate a separate audio asset. Put the requested sound design in story_prompt so the video model generates it with the picture.

Available audio model notes:
${formatAudioCapabilitiesForAgent()}`,
      inputSchema: z.object({
        kind: z.enum(['voiceover', 'dialogue', 'music', 'sound_design', 'mixed', 'translation']).describe('Required audio intent. Use translation for same-speaker cross-language speech. Use mixed whenever one deliverable contains voice plus music/ambience/SFX. Use voiceover only for an intentionally isolated voice-only master.'),
        prompt: z.string().max(SEED_AUDIO_AGENT_PROMPT_MAX_CHARS).optional().describe(`Natural-language production direction, maximum ${SEED_AUDIO_AGENT_PROMPT_MAX_CHARS} characters before the internal mode wrapper. Required for every kind except translation. For translation, use this only for extra performance direction; target language, source voice, identity preservation, and exact translated text have typed fields.`),
        duration_seconds: z.number().optional().describe('Requested duration in seconds. Seed Audio supports up to 120 seconds. Also include the duration in the prompt for best results.'),
        reference_voices: z.array(z.string()).max(3).optional().describe('Up to 3 Audio Index labels such as audio_1, or provider preset voice IDs. The prompt must bind them in order as @audio1, @audio2, and @audio3. Cannot be combined with image conditioning.'),
        target_language: z.string().optional().describe('Required for kind=translation, for example English, Japanese, or Spanish (Mexico).'),
        translated_script: z.string().optional().describe('Optional exact target-language script for kind=translation. Omit for direct translation of all source speech; provide it when protected terms, claims, numbers, or deliberate localization wording must be exact.'),
        source_voice: z.discriminatedUnion('type', [
          z.object({
            type: z.literal('audio_index'),
            ref: z.string().describe('One Audio Index label such as audio_1. MP3 and WAV inputs are supported.'),
          }),
          z.object({
            type: z.literal('timeline_media'),
            media_index: z.number().int().positive().describe('1-based Timeline Media index containing the source speaker.'),
            ranges: z.array(z.object({
              start_sec: z.number().nonnegative(),
              end_sec: z.number().positive(),
            })).min(1).max(20).describe('ASR-aligned source speech ranges in playback order. The tool extracts audio only and concatenates the ranges into one 2-30 second MP3 reference.'),
          }),
        ]).optional().describe('Required for kind=translation. Use Audio Index MP3/WAV directly, or extract ASR-aligned speech ranges from a timeline video without sending the video to Seed Audio.'),
        conditioning: z.discriminatedUnion('type', [
          z.object({ type: z.literal('none') }),
          z.object({
            type: z.literal('image'),
            media_index: z.number().int().positive().describe('1-based Timeline Media image index explicitly introduced or referenced by the current user turn.'),
          }),
        ]).optional().describe('Optional structured conditioning. Omit or use {type:"none"} for ordinary audio. Use {type:"image",media_index:N} only for a still image in the current upload batch or explicitly named by the user as @N / <<<media_N>>>. The runtime validates media provenance and never inherits selected Timeline state.'),
        speech_rate: z.number().min(0.5).max(2).optional().describe('Global speech speed multiplier from 0.5 to 2.0. Default 1.0.'),
        loudness_rate: z.number().min(0.5).max(2).optional().describe('Global loudness multiplier from 0.5 to 2.0. Default 1.0; still direct mix priority in the prompt.'),
        pitch_rate: z.number().int().min(-12).max(12).optional().describe('Global pitch shift in integer semitones from -12 to 12. Default 0; avoid extremes.'),
        format: z.enum(['wav', 'mp3', 'ogg_opus', 'pcm']).optional().describe('Output format. Default wav for a production master.'),
        sample_rate: z.union([z.literal(8000), z.literal(16000), z.literal(24000), z.literal(48000)]).optional().describe('Output sample rate. Default 48000 for production masters.'),
        title: z.string().optional().describe('Short title for the generated audio asset.'),
        model: z.enum(['auto', 'evolink-seed-audio']).optional().describe('Audio model. Omit or use auto for the default Seed Audio model.'),
      }),
      execute: async ({
        kind,
        prompt,
        duration_seconds,
        reference_voices,
        target_language,
        translated_script,
        source_voice,
        conditioning,
        speech_rate,
        loudness_rate,
        pitch_rate,
        format,
        sample_rate,
        title,
        model,
      }) => {
        const imageMediaIndex = conditioning?.type === 'image'
          ? conditioning.media_index
          : undefined;
        if (kind !== 'translation' && !prompt?.trim()) {
          return { success: false as const, message: 'prompt is required unless kind=translation.' };
        }
        if (kind === 'translation' && !target_language?.trim()) {
          return { success: false as const, message: 'target_language is required for kind=translation.' };
        }
        if (kind === 'translation' && !source_voice) {
          return { success: false as const, message: 'source_voice is required for kind=translation.' };
        }
        if (kind === 'translation' && reference_voices?.length) {
          return { success: false as const, message: 'Use source_voice, not reference_voices, for kind=translation.' };
        }
        if (reference_voices?.length && imageMediaIndex != null) {
          return { success: false as const, message: 'Seed Audio reference_voices and image conditioning are mutually exclusive.' };
        }
        if (kind === 'translation' && imageMediaIndex != null) {
          return { success: false as const, message: 'Speech translation cannot use image conditioning.' };
        }
        let translationReference: string[] = [];
        if (kind === 'translation' && source_voice?.type === 'audio_index') {
          const resolved = resolveSeedAudioReferences(ctx.audioAttachments, [source_voice.ref]);
          if (resolved.error) return { success: false as const, message: resolved.error };
          translationReference = resolved.references;
        }
        if (kind === 'translation' && source_voice?.type === 'timeline_media') {
          if (!ctx.explicitMediaIndices.includes(source_voice.media_index)) {
            return {
              success: false as const,
              message: `Source voice extraction only accepts media introduced or explicitly referenced in the current user turn. Ask the user to attach the video or name it as @${source_voice.media_index} / <<<media_${source_voice.media_index}>>>.`,
            };
          }
          const validated = validateImageIndex(ctx.snapshotImages, source_voice.media_index);
          if (validated.error) return { success: false as const, message: validated.error };
          const mediaUrl = toPublicStorageUrl(ctx.snapshotImages[validated.idx]);
          if (!/^https:\/\//i.test(mediaUrl) || !isVideoUrl(mediaUrl)) {
            return { success: false as const, message: `<<<media_${source_voice.media_index}>>> must be a public timeline video.` };
          }
          if (!ctx.supabase || !ctx.userId) {
            return { success: false as const, message: 'Source voice extraction requires an authenticated project workspace.' };
          }
          try {
            const materialized = await materializeSeedAudioReference({
              mediaUrl,
              ranges: source_voice.ranges.map(range => ({ startSec: range.start_sec, endSec: range.end_sec })),
              supabase: ctx.supabase,
              userId: ctx.userId,
              projectId: ctx.projectId,
            });
            translationReference = [materialized.audioUrl];
          } catch (error) {
            return {
              success: false as const,
              message: `Failed to extract source voice: ${error instanceof Error ? error.message : String(error)}`,
            };
          }
        }
        const resolvedReferences = kind === 'translation'
          ? { references: translationReference }
          : resolveSeedAudioReferences(ctx.audioAttachments, reference_voices);
        if (resolvedReferences.error) {
          return { success: false as const, message: resolvedReferences.error };
        }
        let imageUrls: string[] | undefined;
        if (imageMediaIndex != null) {
          if (!ctx.explicitMediaIndices.includes(imageMediaIndex)) {
            return {
              success: false as const,
              message: `Image conditioning only accepts media introduced or explicitly referenced in the current user turn. Ask the user to attach the still image or name it as @${imageMediaIndex} / <<<media_${imageMediaIndex}>>>; selected Timeline state is never inherited.`,
            };
          }
          const validated = validateImageIndex(ctx.snapshotImages, imageMediaIndex);
          if (validated.error) return { success: false as const, message: validated.error };
          const imageUrl = toPublicStorageUrl(ctx.snapshotImages[validated.idx]);
          if (!/^https:\/\//i.test(imageUrl) || isVideoUrl(imageUrl)) {
            return {
              success: false as const,
              message: `<<<media_${imageMediaIndex}>>> must be a still image with a public HTTPS URL before it can be used by Seed Audio.`,
            };
          }
          imageUrls = [imageUrl];
        }
        const result = await createAudio({
          kind,
          prompt,
          targetLanguage: target_language,
          translatedScript: translated_script,
          durationSeconds: duration_seconds,
          audioReferences: resolvedReferences.references,
          imageUrls,
          speechRate: speech_rate,
          loudnessRate: loudness_rate,
          pitchRate: pitch_rate,
          format,
          sampleRate: sample_rate,
          title,
          model,
          supabase: ctx.supabase,
          userId: ctx.userId,
          projectId: ctx.projectId,
        });
        if (result.success) {
          if (result.audioUrl) {
            const audioIndex = addAudioAttachment(ctx, {
              audioUrl: result.audioUrl,
              title: result.title || title || (
                kind === 'voiceover'
                  ? 'Generated voiceover'
                  : kind === 'translation'
                    ? `Translated ${target_language || ''} voice`.trim()
                  : kind === 'mixed'
                    ? 'Generated unified soundtrack'
                    : 'Generated audio'
              ),
              duration: result.duration,
              trackIndex: result.trackIndex,
            });
            result.message = `${result.message}\nAdded to Audio Index as <<<audio_${audioIndex}>>>.\nResolved ${kind === 'voiceover' ? 'voiceover master' : kind === 'translation' ? 'translated voice master' : kind === 'mixed' ? 'unified soundtrack' : 'audio'} URL: ${result.audioUrl}\nUse this URL directly in Remotion <Audio src>; do not rely on the marker inside composition code or props.${kind === 'voiceover' || kind === 'translation' || kind === 'mixed' ? '\nIf this asset contains speech, call transcribe_audio with expected_sections and the Composition fps before Storyboard or run_code.' : ''}`;
          }
          deductSeedAudioCredits(ctx.userId ?? '', {
            durationSeconds: result.duration,
            providerCreditsUsed: result.creditsUsed,
            model: result.model,
            generationSeconds: result.generationSeconds,
          }).catch(e => console.error('[billing] generate_audio deduct error:', e));
        }
        return result;
      },
      toModelOutput({ output }: { output: any }) {
        return {
          type: 'content' as const,
          value: [{ type: 'text' as const, text: formatGeneratedAudioForModel('generate_audio', output) }],
        };
      },
    });
}

export function createTools(ctx: AgentContext, runtime: AgentModelRuntime, locale?: string, durableVisionBridge = false) {
  let videoSubmissionTail: Promise<void> = Promise.resolve();
  const serializeVideoSubmission = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previousSubmission = videoSubmissionTail;
    let releaseSubmission: () => void = () => undefined;
    videoSubmissionTail = new Promise<void>((resolve) => {
      releaseSubmission = resolve;
    });
    await previousSubmission;
    try {
      return await operation();
    } finally {
      releaseSubmission();
    }
  };

    const scope: AgentToolFactoryScope = {
    ctx,
    runtime,
    locale,
    durableVisionBridge,
    serializeVideoSubmission,
  };

return {
    generate_image: createGenerateImageTool(scope),

    generate_animation: createGenerateAnimationTool(scope),

    analyze_image: createAnalyzeImageTool(scope),

    analyze_video: createAnalyzeVideoTool(scope),

    transcribe_audio: createTranscribeAudioTool(scope),

    prepare_visual_asset: createPrepareVisualAssetTool(scope),

    execution_checkpoint: createExecutionCheckpointTool(scope),

    studio_run: createStudioRunTool(scope),

    publish_draft: createPublishDraftTool(scope),

    materialize_media: createMaterializeMediaTool(scope),

    preview_frame: createPreviewFrameTool(scope),

    rotate_camera: createRotateCameraTool(scope),

    // ── Workspace tools ─────────────────────────────────────────────────────

    list_files: createListFilesTool(scope),

    read_file: createReadFileTool(scope),

    write_code_file: createWriteCodeFileTool(scope),

    write_file: createWriteFileTool(scope),

    delete_file: createDeleteFileTool(scope),

    run_code: createRunCodeTool(scope),

    generate_audio: createGenerateAudioTool(scope),

  };
}

/** Keep tool prompt telemetry independent from the Agent runner module. */
function estTokens(chars: number): number {
  return Math.round(chars / 3.5);
}

/** Log tool description sizes — call after createTools. */

export function logToolSizes(tools: Record<string, any>): number {
  const entries = Object.entries(tools)
    .map(([name, t]) => ({ name, chars: (t?.description || '').length }))
    .sort((a, b) => b.chars - a.chars);
  const total = entries.reduce((s, e) => s + e.chars, 0);
  const top = entries.slice(0, 5)
    .map(e => `${e.name}=${e.chars}`)
    .join(' ');
  console.log(
    `[agent-prompt] tools count=${entries.length} totalDescChars=${total} (~${estTokens(total)} tokens)  top: ${top}`
  );
  return total;
}
