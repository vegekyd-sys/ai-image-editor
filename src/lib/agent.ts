import { streamText, tool, stepCountIs } from 'ai';
import type { ModelMessage } from 'ai';
import { after } from 'next/server';
import { z } from 'zod';
import sharp from 'sharp';
import { validateDesign } from './design-harness';
import type { ModelId } from './models/types';
import { editImage } from './skills/edit-image';
import { rotateCamera } from './skills/rotate-camera';
import { createVideo } from './skills/create-video';
import { estimateVideoCredits, resolveAgentVideoSelection, resolveVideoGenerationRoute, resolveVideoOutputDuration, validateVideoModelRequest } from './video-model-capabilities';
import { deductCredits, deductFixedCredits } from './billing/credits';
import { deductSeedAudioCredits } from './billing/seed-audio';
import { createAudio } from './skills/create-audio';
import { createVoiceover } from './skills/create-voiceover';
import { formatAudioCapabilitiesForAgent } from './audio-model-capabilities';
import { listVolcengineTtsVoices } from './volcengine-tts';
import { transcribeWithVolcengineAsr, type VolcengineAsrTranscript, type TranscriptWord } from './volcengine-asr';
import { prepareVisualAsset, resolvePreparedVisualAssetById } from './visual-assets/bridge';
import agentPrompt from './prompts/agent.md';
import generateImageToolPrompt from './prompts/generate_image_tool.md';
import { normalizeGenerateImageMediaIndex } from './generate-image-input';
import type { DesignPayload, Tip, VideoMeta, VideoModel } from '@/types';
import { isPermanentUrl, toPublicStorageUrl, uploadAudio, uploadVideo } from '@/lib/supabase/storage';
import type { AgentPerf } from './agent-perf';
import { createTextDeltaState, normalizeTextDelta } from './agent-text-delta';
import { formatAspectRatio } from './media-aspect';
import { filterWorkspaceFilesForAgentScope } from './agent-workspace-scope';
import { normalizeCompositionAnimation } from './composition-duration';
import {
  createRemotionExportJob,
  runRemotionExportJobAndWait,
  type RemotionRenderProfile,
} from '@/lib/remotion-export';
import { VIDEO_PLACEHOLDER_IMAGE } from '@/lib/editor/timeline-derivations';
import { normalizeAgentErrorMessage } from './agent-error';
import {
  findSnapshotMediaIndex,
  pinAgentMediaUrl,
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
import type { AgentModelPreference } from './agent-models';
import {
  createAgentModelRuntime,
  getAgentProviderOptions,
  sumOpenRouterProviderCost,
  type AgentModelRuntime,
} from './agent-model-runtime';
import {
  classifyModelTermination,
  describeModelStreamError,
  requestsMaterializedVideo,
  shouldCompleteDurableStudioRun,
  shouldContinueActiveStudioRun,
  shouldHandoffToStudioComposition,
  shouldStopAfterDurablePublishToolStep,
  shouldStopAfterTerminalToolFailure,
  shouldStopAfterStudioToolStep,
  shouldUseTextOnlyRecovery,
} from './agent-terminal';
import {
  AgentExecutionStore,
  normalizeExecutionSnapshot,
  stableOperationKey,
  type DurableExecutionRef,
} from './agent-execution';
import { buildDurableCompositionGuidance } from './studio-composition-guidance';
import {
  buildStudioCreativeArtifacts,
  studioCreativePacketSchema,
} from './studio-run/creative-packet';
import {
  getReplyLanguageInstruction,
  normalizeLocale,
  translate,
} from './locales';
import { getSkillLaunchSystemDirective, shouldContinueSkillVideoSubmission, type SkillLaunchContext } from './skill-launch-context';
import { buildAgentOutputLanguageDirective } from './agent-response-policy';

const MAX_VIDEO_DIMENSION_PROBE_BYTES = 220 * 1024 * 1024;

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
    try {
      const result = await createVideo(options.createVideoInput);
      if (!result.success || !result.videoUrl) {
        await admin.from('snapshots').update({
          video_meta: {
            ...options.videoMeta,
            status: 'failed',
            error: result.message || 'Google Omni video generation failed',
          },
        }).eq('id', options.snapshotId);
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
      await admin.from('snapshots').update({
        video_meta: {
          ...options.videoMeta,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        },
      }).eq('id', options.snapshotId);
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentContext {
  currentImage: string;       // base64 data URL – updated after each generation
  referenceImages?: string[]; // base64 data URLs – user-uploaded references (up to 3)
  projectId: string;

  supabase?: any;             // Supabase client for workspace operations
  userId?: string;            // Current user ID for workspace
  /** Images generated during this run (base64). Streamed to frontend out-of-band. */
  generatedImages: string[];
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
  /** 0-based index of the snapshot the user is currently viewing */
  currentSnapshotIndex: number;
  /** NSFW flag — set when Gemini refuses content. All subsequent calls skip Gemini. */
  isNsfw?: boolean;
  /** User skills loaded from DB (for reference image lookup) */
  userSkills?: ParsedSkill[];
  /** Timeline version: 1 = legacy (project_animations), 2 = video-in-timeline (snapshots) */
  timelineVersion?: number;
  /** Published or autosaved composition used as the source for this turn. */
  currentDesignPath?: string;
  /** Export attempts for an unchanged composition during this agent turn. */
  materializeAttempts?: Map<string, number>;
  /** Seedance image URLs rejected during this turn; unchanged resubmission is blocked. */
  invalidVideoImageUrls?: Set<string>;
  execution?: DurableExecutionRef;
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

interface StreamedCodeCheckpoint {
  streamedCodePath?: string;
  streamedCodeChars?: number;
  streamedCodeTargetPath?: string;
}

async function getStudioRunCheckpoint(ctx: AgentContext): Promise<StudioRunCheckpoint> {
  if (!ctx.supabase || !ctx.userId || !ctx.projectId) return {};
  try {
    const studio = await import('./studio-run');
    const store = new studio.WorkspaceStudioRunStore(ctx.supabase, ctx.userId);
    const run = (await store.listRuns(ctx.projectId))[0];
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

interface AudioAttachment {
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
  | { type: 'image'; image: string; usedModel?: string; snapshotId?: string; imageUrl?: string; description?: string }
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
  | { type: 'render'; code: string; width: number; height: number; props?: Record<string, unknown>; animation?: { fps: number; durationInSeconds: number; format?: string }; editables?: import('@/types').EditableField[]; published?: boolean; previewUrl?: string }  // Agent React design for browser rendering
  | { type: 'design'; code: string; width: number; height: number; props?: Record<string, unknown>; animation?: { fps: number; durationInSeconds: number; format?: string }; editables?: import('@/types').EditableField[]; published?: boolean }  // @deprecated — backward compat alias for 'render'
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
import { type ParsedSkill } from './skill-registry';
// Workspace service — unified access to skills, memory, assets
import * as workspace from './workspace';

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

function resolveAudioRefs(audioAttachments: AudioAttachment[] | undefined, refs: string[] | undefined): { audioUrls: string[]; error?: string } {
  if (!refs?.length) return { audioUrls: [] };
  const attachments = audioAttachments || [];
  const audioUrls: string[] = [];
  const invalid: string[] = [];
  for (const ref of refs) {
    const match = String(ref).trim().match(/^audio_(\d+)$/i);
    const idx = match ? Number(match[1]) - 1 : -1;
    const audio = idx >= 0 ? attachments[idx] : undefined;
    if (!audio?.audioUrl) {
      invalid.push(ref);
      continue;
    }
    audioUrls.push(audio.audioUrl);
  }
  if (invalid.length) {
    const available = attachments.map((audio, i) => `audio_${i + 1}${audio.title ? ` (${audio.title})` : ''}`).join(', ') || 'none';
    return { audioUrls, error: `Invalid audio_refs: ${invalid.join(', ')}. Available audio refs: ${available}. Audio refs are separate from <<<media_N>>>.` };
  }
  return { audioUrls };
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

function formatGeneratedAudioForCui(toolName: string | undefined, output: unknown, locale = normalizeLocale('en')): string | null {
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

function formatMs(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '?';
  return (ms / 1000).toFixed(2).replace(/\.00$/, '');
}

function formatTranscriptWords(words: TranscriptWord[] | undefined, maxChars: number): string {
  if (!words?.length || maxChars <= 0) return '';
  let out = '';
  for (const word of words) {
    const next = `${out ? ' | ' : ''}${formatMs(word.startMs)}-${formatMs(word.endMs)} ${word.text}`;
    if (out.length + next.length > maxChars) return `${out} | ...`;
    out += next;
  }
  return out;
}

function formatTranscriptForModel(transcript: VolcengineAsrTranscript, includeWordTimings = true): string {
  const lines: string[] = [
    `Transcript (${transcript.provider}/${transcript.model}, ${transcript.durationMs ? `${formatMs(transcript.durationMs)}s` : 'duration unknown'}):`,
    transcript.text || '(empty transcript)',
    '',
    'Utterance timecodes:',
  ];

  let charBudget = includeWordTimings ? 24_000 : 8_000;
  for (const [idx, utterance] of transcript.utterances.entries()) {
    const line = `${idx + 1}. [${formatMs(utterance.startMs)}s-${formatMs(utterance.endMs)}s]${utterance.speaker ? ` speaker ${utterance.speaker}` : ''} ${utterance.text}`;
    if (charBudget - line.length < 0) {
      lines.push('[transcript truncated]');
      break;
    }
    lines.push(line);
    charBudget -= line.length;
    const words = includeWordTimings ? formatTranscriptWords(utterance.words, Math.min(1200, charBudget)) : '';
    if (words) {
      const wordLine = `   words: ${words}`;
      if (charBudget - wordLine.length < 0) {
        lines.push('   words: [truncated]');
        break;
      }
      lines.push(wordLine);
      charBudget -= wordLine.length;
    }
  }

  return lines.join('\n');
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
  error?: string;
}> {
  const v = validateImageIndex(ctx.snapshotImages, mediaIndex);
  if (v.error) return { idx: -1, error: v.error };

  const directUrl = ctx.snapshotImages[v.idx];
  if (isVideoUrl(directUrl)) return { idx: v.idx, videoUrl: directUrl };

  if (!ctx.supabase || !ctx.userId) {
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

    if (videoUrl || fallbackVideoUrl) {
      return {
        idx: v.idx,
        videoUrl: videoUrl || fallbackVideoUrl,
        duration: Number.isFinite(duration) ? duration : undefined,
        fps: Number.isFinite(fps) ? fps : undefined,
      };
    }
  } catch (e) {
    console.error('[resolveVideoUrlForMediaIndex] exception:', e);
  }

  return { idx: v.idx, error: `No real video file found at <<<media_${mediaIndex}>>>. Use preview_frame only for Remotion compositions with design_path.` };
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
}): Promise<{ success: boolean; message: string; published: Array<{ snapshotId: string; type: 'image' | 'video'; url: string; path?: string }> }> {
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
  const published: Array<{ snapshotId: string; type: 'image' | 'video'; url: string; path?: string }> = [];
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
        published.push({ snapshotId: duplicateSnapshotId, type: 'video', url: output.storageUrl, path: output.path });
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

      ctx.snapshotImages.push(output.storageUrl);
      ctx.currentSnapshotIndex = ctx.snapshotImages.length - 1;
      if (!ctx.pendingVideoSnapshots) ctx.pendingVideoSnapshots = [];
      ctx.pendingVideoSnapshots.push({ snapshotId, taskId, videoMeta });
      published.push({ snapshotId, type: 'video', url: output.storageUrl, path: output.path });
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

      ctx.snapshotImages.push(output.storageUrl);
      ctx.currentSnapshotIndex = ctx.snapshotImages.length - 1;
      if (!ctx.pendingImageSnapshots) ctx.pendingImageSnapshots = [];
      ctx.pendingImageSnapshots.push({ snapshotId, imageUrl: output.storageUrl, description });
      published.push({ snapshotId, type: 'image', url: output.storageUrl, path: output.path });
    }
  }

  return {
    success: true,
    message: `Published ${published.length} workspace media output${published.length === 1 ? '' : 's'} to timeline:\n${published.map((p, i) => `${i + 1}. ${p.type}: ${p.url}`).join('\n')}`,
    published,
  };
}

// ---------------------------------------------------------------------------
// System prompt (bundled via webpack asset/source)
// ---------------------------------------------------------------------------

function getAgentSystemPrompt(): string {
  return agentPrompt;
}

function* flushPendingImageSnapshots(ctx: AgentContext): Generator<AgentStreamEvent> {
  if (!ctx.pendingImageSnapshots?.length) return;
  for (const pending of ctx.pendingImageSnapshots) {
    yield {
      type: 'image',
      image: pending.imageUrl,
      imageUrl: pending.imageUrl,
      snapshotId: pending.snapshotId,
      description: pending.description,
    };
  }
  ctx.pendingImageSnapshots = undefined;
}

/** Rough token estimate — 1 token ≈ 4 chars for English, ~1.5-2 for CJK. Use 3.5 as middle ground. */
function estTokens(chars: number): number {
  return Math.round(chars / 3.5);
}

/** Build system prompt with lightweight skill manifest (not full templates) */

async function buildSystemPrompt(userSkills?: ParsedSkill[], supabase?: any, userId?: string, projectId?: string): Promise<string> {
  const base = getAgentSystemPrompt();
  const manifest = await workspace.getSkillManifest(supabase, userId);
  // Append user skills to manifest if any
  let userSkillLines = '';
  if (userSkills?.length) {
    userSkillLines = '\n' + userSkills.map(s =>
      `- **${s.name}**: ${s.description.trim().split('\n')[0]}${s.makaron?.referenceImages?.length ? ' [has reference images]' : ''}`
    ).join('\n');
  }

  const projectPath = projectId ? `${projectId}/` : '';
  const workspaceSection = `

## Workspace

You have a persistent workspace for skills and files.

Tools: \`list_files\`, \`read_file\`, \`write_code_file\`, \`write_file\`, \`delete_file\`, \`run_code\`

### File organization
- **User-level** (shared across projects): \`skills/\`, \`memory/\`
- **Project-level** (current project): \`${projectPath}code/\`${projectId ? ` — save composition/code files here` : ''}
- **skills/{name}/SKILL.md** — Create reusable skills here. Read \`skills/SKILL_README.md\` for the format.

### run_code
Execute JavaScript in two modes:
- \`runtime: "composition"\` for Remotion/editable composition drafts, animated templates, overlays, and sharp utilities. \`runtime: "design"\` is a legacy alias.
- \`runtime: "node"\` for real file-level MP4 work with FFmpeg/FFprobe: split, exact trim/export, transcode, extract frames, mux audio, long-video preparation, and final assembly of generated chunks.
For finished single images, posters, infographics, and marketing graphics, use \`generate_image\` instead unless the user asks for editable or animated code.
For substantial normal Agent Run code, write the complete program with \`write_code_file\`, then execute its returned workspace path with \`run_code({ code_path })\`. The user sees the real source as it streams, and the file remains available for recovery and later edits. Inline code is for short patches and utilities; Studio Run may use numbered composition parts for long compositions.
For composition files, either save a natural JS/TS/JSX/TSX Remotion module (imports/exports and a top-level Composition are accepted) or the legacy executable body that returns \`{ type: 'render', code, width, height, ... }\`. When a natural module is new and has no existing composition dimensions to inherit, pass its width/height/animation as \`run_code.composition\` metadata without repeating the source.
Always tell the user what you're about to do BEFORE calling run_code (1 sentence). After run_code completes, briefly describe the result.

### Creating skills
Before writing a new skill, read \`skills/SKILL_README.md\` first — it has the exact format (YAML frontmatter + markdown body). Also read an existing skill (e.g. \`skills/makaron-mascot/SKILL.md\`) as a reference.

A good skill is **reusable across any project** — it describes a style, technique, or character, not a specific photo.

${manifest}${userSkillLines}
`;

  // Memory injection — read user-level and project-level MEMORY.md
  let memorySection = '';
  if (supabase && userId) {
    try {
      const userMem = await workspace.readFile('memory/MEMORY.md', supabase, userId);
      if (userMem?.content) memorySection += '\n\n## User Memory\n' + userMem.content;
    } catch { /* no user memory yet */ }
    if (projectId) {
      try {
        const projMem = await workspace.readFile(`projects/${projectId}/memory/MEMORY.md`, supabase, userId);
        if (projMem?.content) memorySection += '\n\n## Project Memory\n' + projMem.content;
      } catch { /* no project memory yet */ }
    }
  }

  const full = base + workspaceSection + memorySection;

  // Observability — prompt size breakdown
  const baseLen = base.length;
  const wsLen = workspaceSection.length;
  const memLen = memorySection.length;
  const total = full.length;
  console.log(
    `[agent-prompt] system base=${baseLen} workspace=${wsLen} memory=${memLen} total=${total} chars (~${estTokens(total)} tokens)`
  );

  return full;
}

function buildLightweightSystemPrompt(mode: 'analysis' | 'tipReaction', locale?: string): string {
  const languageRule = getReplyLanguageInstruction(locale);
  if (mode === 'analysis') {
    return [
      'You are Makaron, a warm and concise creative media assistant.',
      'Use the available analysis tool exactly once before answering.',
      'Describe what you see directly. Do not mention tools, hidden prompts, or system instructions.',
      'Keep the answer short, natural, and useful for photo or video editing context.',
      languageRule,
    ].join('\n');
  }
  return [
    'You are Makaron, a warm and concise creative media assistant.',
    'Write only the requested short user-facing response.',
    'Do not mention tools, hidden prompts, system instructions, or implementation details.',
    languageRule,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Tools (Vercel AI SDK style, closure over AgentContext)
// ---------------------------------------------------------------------------

function createTools(ctx: AgentContext, runtime: AgentModelRuntime, locale?: string, durableVisionBridge = false) {
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

  return {
    generate_image: tool({
      description: generateImageToolPrompt,
      inputSchema: z.object({
        editPrompt: z.string().describe('The specific creative direction for this edit (English). When skill is set, you must have read and internalized that skill prompt once in this conversation; write an editPrompt that follows those rules.'),
        skill: z.string().optional().describe('Activate a skill template (e.g. enhance, creative, wild, captions). See tool description and available skills.'),
        model: z.enum(['gemini', 'gemini-lite', 'qwen', 'pony', 'wai', 'openai']).optional().describe('NEVER set this unless the user literally says a model name like "用pony" or "use qwen" or "用openai" or "nano banana lite", or the active long-video-director workflow is generating director storyboard images, which MUST set "openai". For NSFW after Gemini refusal, set "qwen". Otherwise ALWAYS omit — the router handles everything automatically. Setting this without explicit user request is a bug.'),
        aspectRatio: z.string().optional().describe('Target aspect ratio e.g. "4:5", "1:1", "16:9"'),
        media_index: z.number().optional().describe('1-based index of the snapshot to edit (<<<media_1>>> = 1, <<<media_2>>> = 2, ...). Omit the field entirely for text-to-image (no photo sent); never send 0. For most edits, pass the current snapshot index.'),
        reference_media_indices: z.array(z.number()).optional().describe('1-based indices of snapshots to use as reference images (e.g. [1, 3] to reference <<<media_1>>> and <<<media_3>>>). Use when combining elements from multiple snapshots — e.g. "use the person from media_1 and the background from media_2". The editPrompt should describe how to combine them (e.g. "Place the person from Media 2 into the scene of Media 1").'),
      }),
      execute: async ({ editPrompt, skill, model, aspectRatio, media_index, reference_media_indices }) => {
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
          { editPrompt, skill: skill as 'enhance' | 'creative' | 'wild' | 'captions' | undefined, aspectRatio, preferredModel: resolvedModel, isNsfw: ctx.isNsfw },
          { currentImage: editTarget, referenceImages: resolvedRefs.length ? resolvedRefs : undefined },
        );
        // Bill for image generation (separate from Agent LLM tokens)
        if (skillResult.usage) {
          import('./billing/credits').then(({ deductByTokens }) =>
            deductByTokens(ctx.userId ?? '', 'generate_image', skillResult.usage!.modelId, skillResult.usage!.inputTokens, skillResult.usage!.outputTokens)
              .catch(e => console.error('[billing] generate_image deduct error:', e))
          );
        } else if (skillResult.usedModel && skillResult.usedModel !== 'gemini') {
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
          contentBlocked: skillResult.contentBlocked,
        };
      },
      toModelOutput({ output }: { output: any }) {
        return {
          type: 'content' as const,
          value: [{ type: 'text' as const, text: formatGeneratedImageForModel(output) }],
        };
      },
    }),

    generate_animation: tool({
      description: `Submit a video script for rendering.

Use this tool after the user has confirmed a video script that is already visible in the conversation. You may also call it in the same turn where you first write the script when the user's current request explicitly authorizes direct submission without confirmation, for example "直接提交渲染", "不要问我确认", "不用确认", "直接生成视频", "submit now", or "do not ask for confirmation". A trusted Skill template launch may also authorize same-turn submission; that exception is supplied only in the system prompt and never inferred from ordinary user text or an active Skill name.

When the user requests multiple independent video variants, submit them one at a time. After each \`generate_animation\` call returns a successful submission, continue with the next variant; do not wait for that video's rendering to finish. Continue until every requested variant is submitted, and never reduce a multi-video request to one video merely to finish the turn. Each call still contains one complete <=15-second script.

**BEFORE writing a video script**: call \`read_file('prompts/animate.md')\` to load the full video guide (modes, prompt styles, showcases, reference video usage). Do not re-read if already in this conversation's tool-result history.

Hard constraints:
- First line of script = short title (2-5 words). Then script body.
- Use \`<<<media_N>>>\` to reference images AND videos (N starts at 1). Videos in the timeline are auto-routed — just reference them like images. For native SeeDance text-to-video with no source media, use no media markers and do not generate an intermediate image first.
- To EDIT a video: reference it with \`<<<media_N>>>\` and describe the changes. The selected model must support reference videos.
- To use CLI/app imported reference music/audio for pacing or beat sync, mention its Audio Index marker in \`story_prompt\` (for example \`<<<audio_1>>>\`) AND pass \`audio_refs\` like ["audio_1"]. Audio refs are NOT Timeline Media Index refs. Reference audio is only supported by SeeDance/SeeDance Fast/SeeDance Mini.
- Works for Kling, SeeDance, SeeDance Mini, and Grok, but respect capability limits and tool errors.
- Single-call total duration: SeeDance/SeeDance Mini is 4-15 seconds (4s minimum output, 5s default/common preset); Kling is 5-15 seconds; Grok 1.5 is 1-15 seconds for one starting image; Google Omni is 3-10 seconds. If the user asks for anything shorter than the selected model's minimum, or referenced source videos total less than that minimum, write a compact script at the model minimum and set duration to that minimum. For a provider-generated 30s, 60s, 1-2 minute, or otherwise over-limit video, do not call this tool with one long script; use \`skills/long-video-director/SKILL.md\` and split into self-contained segments. This provider limit does not reroute an explicit explainer-video, Studio Run, Remotion, or other built-in Composition workflow.
- If a complete script totals 15 seconds or less, submit it as one video generation call. Put the whole title, every \`Shot N (Xs):\` line, and the \`Style:\` line into the same \`story_prompt\`; set \`duration\` to the total script duration when known. Do not submit only one shot, the first shot, or one line from the script.
- If the source video may exceed model limits, call \`read_file('skills/video-ffmpeg-lab/SKILL.md')\` and split it once with \`run_code({ runtime: "node" })\` before submitting generation.
- Total duration must fit the selected model's capability. Do not shrink a long source to 5s just to bypass a limit; split first.
- Long source video rule: if a timeline/reference video is longer than 15 seconds, do not shrink the whole source into one 5s or 15s edit. Use \`skills/long-video-director/SKILL.md\`, analyze/split it into self-contained segments of 15s or less, and submit one script per segment after approval.
- Reference video input limit: for one SeeDance generation, the combined source duration of all timeline/uploaded/reference videos used in the script must be 15 seconds or less. This is a single-generation input limit; do not submit videos whose combined duration is longer than 15s together in one call.
- Reference video size limit: for one SeeDance generation, every reference video must be .mp4/.mov, <=50MB, width and height each 300-6000px, aspect ratio 0.4-2.5, and frame pixels width*height between 409,600 and 2,086,876. Tiny videos below 409,600 frame pixels must be resized/padded before submission. For Kling, use one .mp4/.mov reference video, <=200MB, resolution <=2K; no explicit Kling video resolution lower bound is documented. Grok 1.5 does not support video references or multi-image references in Makaron; use it only for single-image-to-video. Google Omni supports one uploaded/reference video in Makaron and, without a video reference, up to 6 image references for subject/reference-to-video; it is best for fast image/video edits with native generated audio. Uploaded audio_refs are not supported by Google Omni.
- Reference image input limit: EvoLink Seedance requires JPEG/PNG/WebP, width and height each 300-6000px, aspect ratio 0.4-2.5, and <=30MB per image. The runtime probes referenced images before provider submission. If the tool returns retryable=false, stop and tell the user to replace/resize the source; never resubmit the same image or merely rewrite the prompt.
- Reference image input limit: EvoLink Seedance requires JPEG/PNG/WebP, width and height each 300-6000px, aspect ratio 0.4-2.5, and <=30MB per image. The runtime returns a specific errorReason such as too_small or too_large plus actual dimensions and limits. If repairable=true, decide whether to prepare a new compliant image URL or ask the user for a better source. Never resubmit the same rejected URL or merely rewrite the prompt.
- Video edit duration lock: when editing timeline videos up to 15 seconds total, output duration should match the combined source duration from Media Index, clamped to the selected model range. For SeeDance, clamp to 4-15s; if combined source duration is under 4s, set \`duration: 4\`. For long-video pipelines, duration lock applies per FFmpeg chunk.
- Default model follows app selection, usually SeeDance 2.0 Fast (\`seedance-fast\`) at 720p. If the app selector has an explicit non-default model or explicit resolution, the backend keeps that app selection, so align the script with the selected route. Generic "HD"/"高清"/"high quality" requests still use \`seedance-fast\` 720p. Use \`seedance-mini\` only when the user asks for Seedance Mini, lower cost, draft, or multi-size testing; prefer 480p unless they ask for 720p. Use standard \`seedance\` only when the user explicitly asks for 1080p, standard/full SeeDance 2.0, or premium/highest-resolution output. If the user asks for cheaper/faster/draft/480p, set \`video_resolution: "480p"\` when supported. If the user asks for Kling Pro/HD/1080p, use model \`kling\` with \`video_resolution: "1080p"\`; if they ask for Kling 4K, use model \`kling\` with \`video_resolution: "4k"\`. If the user asks for Grok by name ("用 Grok 生成", "use grok", "用 grok 做"), fastest generation, or native audio from one image, use model \`grok\` and write a single-image-to-video script. Use model \`google-omni\` only when the app selector is already Gemini Omni or the user explicitly asks for Omni/Gemini Omni/Google Omni; treat it as a fast short 720p video editing model with native generated audio, and do not pass audio_refs to Google Omni.
- Grok aspect-ratio rule: for Grok single-image-to-video, do not pass \`aspect_ratio\`. xAI stretches the source image when a forced ratio differs from the image. If the user asks for a different final shape, choose Seedance/Kling or first create/pad the source image to that target shape, then generate.
- \`video_ref_url\`: ONLY for external videos not in Media Index (e.g. from workspace/list_files). Never put video URLs in prompt text.
- If the generated video is an intermediate artifact, pass \`completion_actions\` so CUI/CLI can show the next step after rendering finishes. These actions are user-confirmed by default; do not rely on the user remembering what to do next. For local video repair, include exact replaceStart/replaceEnd/replacementDuration and say to trim/fit the patch to that duration before merging so the final video keeps the original duration.
- The script must have been shown to the user and confirmed before this tool is called, unless the user's current request explicitly asks for direct submission without confirmation or the system prompt supplies the trusted Skill template launch exception.`,
      inputSchema: z.object({
        story_prompt: z.string().describe('The video script. First line = short title (2-5 words), then the script body. Use <<<media_N>>> only when referencing available images/videos, and <<<audio_N>>> for Audio Index references. Native SeeDance text-to-video uses no media markers. Total duration must be 15 seconds or less.'),
        duration: z.number().optional().describe('Duration in seconds. SeeDance/SeeDance Mini accepts integer output duration 4-15s (default 5s); Kling accepts 5-15s; Grok 1.5 accepts 1-15s for one image; Google Omni accepts 3-10s. Never pass below the selected model minimum. For timeline video edits, set this to the combined source video duration from Media Index clamped to the selected model range. Do not submit multiple reference videos together if their combined source duration exceeds the selected model limit. Omit for smart mode only when generating from photos.'),
        aspect_ratio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '3:2', '2:3']).optional().describe('Output aspect ratio. Pass it only when the user asks for a specific shape and the selected model can safely honor it. For Grok single-image-to-video, omit this field because xAI stretches the source image when a forced ratio differs from the image. Seedance supports 16:9/9:16/1:1/4:3/3:4/21:9/adaptive; Makaron intentionally does not pass forced ratios to Grok image-to-video.'),
        model: z.string().optional().describe('Video model/provider id. Default follows the app selection (usually seedance-fast) at 720p. Generic HD/高清/high quality requests should still use seedance-fast; use seedance-mini for explicit Mini/lower-cost/draft/multi-size tests; use seedance only for explicit 1080p, standard/full SeeDance, or premium/highest-resolution requests. Use google-omni only for explicit Omni/Gemini Omni/Google Omni or when the app selector is already Gemini Omni; it is a fast short 720p video editing model with native generated audio. Supported ids include seedance-fast, seedance-mini, seedance, kling, grok, and google-omni.'),
        video_resolution: z.enum(['480p', '720p', '1080p', '4k', 'auto']).optional().describe('Output resolution. Omit/auto follows the selected model default. Generic HD/高清/high quality means seedance-fast 720p, not 1080p. seedance-fast/seedance-mini support 480p/720p; seedance supports 480p/720p/1080p; kling supports 720p/1080p/4k; grok supports 480p/720p; google-omni outputs 720p.'),
        media_refs: z.array(z.string()).optional().describe('Additional image URLs NOT already in Media Index (e.g. workspace files from list_files). Images in Media Index are auto-available — just use <<<media_N>>> in script. Passing Media Index URLs here will be rejected.'),
        audio_refs: z.array(z.string()).optional().describe('Reference audio labels from the Audio Index block, e.g. ["audio_1"]. Use for beat sync, pacing, or music reference. These are separate from <<<media_N>>> and only supported by SeeDance models.'),
        video_ref_url: z.string().optional().describe('External reference video URL (from workspace/skill assets via list_files). For timeline videos, just use <<<media_N>>> — they are auto-routed. Only use this for external URLs not in Media Index. SeeDance video references must be <=50MB, width/height 300-6000px, aspect ratio 0.4-2.5, frame pixels 409,600-2,086,876. Kling video references must be <=200MB and <=2K; no explicit lower resolution is documented. Google Omni accepts one reference video in Makaron. Grok does not support video references in Makaron yet.'),
        video_ref_type: z.enum(['base', 'feature']).optional().describe('How to use the reference video. feature (default): reference motion/style. base: direct edit (Kling only, output duration=input). Almost always use feature.'),
        keep_original_sound: z.boolean().optional().describe('Keep audio from reference video. Default: false.'),
        motion_control: z.boolean().optional().describe('Use Kling Motion Control for precise action transfer from reference video. Requires video_ref_url. Duration = reference video length. No detailed prompt needed — just a title. Kling only.'),
        character_orientation: z.enum(['image', 'video']).optional().describe('For motion_control: match photo orientation (image, ≤10s) or video orientation (video, ≤30s). Default: image.'),
        completion_actions: z.array(z.object({
          label: z.string().describe('Short button label shown when the video finishes, e.g. "合入原视频" or "加入剪辑".'),
          prompt: z.string().describe('Natural-language instruction to send back to the agent if the user chooses this action. Include concrete media refs/timing when known. For video segment replacement, include replaceStart, replaceEnd, replacementDuration, and require trimming/fitting the patch before FFmpeg merge so the final duration matches the original.'),
          description: z.string().optional().describe('One short line explaining what this action will do.'),
          policy: z.enum(['confirm', 'auto']).optional().describe('confirm = show an action for the user to click. auto is reserved for explicitly authorized end-to-end workflows. Default confirm.'),
        })).optional().describe('Optional next-step actions to show when this async video finishes. Use this for intermediate artifacts such as a generated segment that should later be merged, or generated clips that can be assembled. Do not use it for ordinary final videos.'),
      }),
      execute: async ({ story_prompt, duration, aspect_ratio, model, video_resolution, media_refs, audio_refs, video_ref_url, video_ref_type, keep_original_sound, motion_control, character_orientation, completion_actions }) => serializeVideoSubmission(async () => {
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
        const videoSelection = resolveAgentVideoSelection({
          appModel: (ctx as any).videoModel,
          appResolution: (ctx as any).videoResolution,
          appAuto: (ctx as any).videoAuto,
          toolModel: model,
          toolResolution: video_resolution,
        });
        const videoModel = videoSelection.model;
        const videoRoute = resolveVideoGenerationRoute({
          model: videoModel,
          resolution: videoSelection.resolution,
        });
        if (!imageUrls?.length && !video_ref_url && videoRoute.provider !== 'seedance') {
          return { success: false as const, message: `${videoRoute.label} requires an image or video reference. Use a SeeDance model for native text-to-video.` };
        }
        try {
          const selectedAspectRatio = aspect_ratio;
          const resolvedAudioRefs = resolveAudioRefs(ctx.audioAttachments, audio_refs);
          if (resolvedAudioRefs.error) {
            return { success: false as const, message: resolvedAudioRefs.error };
          }
          if (resolvedAudioRefs.audioUrls.length > 0 && videoRoute.provider !== 'seedance') {
            return {
              success: false as const,
              message: videoRoute.provider === 'google-omni'
                ? 'Google Omni can generate native audio from the prompt, but uploaded audio_refs are not enabled in the current API. Choose seedance-fast, seedance-mini, or seedance for audio_refs, or remove audio_refs and describe the soundtrack for Omni.'
                : 'Reference audio is only supported by Seedance video models. Choose seedance-fast, seedance-mini, or seedance, or remove audio_refs.',
            };
          }

          // Video harness: validate before calling API
          const { validateVideoScript } = await import('./video-harness');
          const harnessError = validateVideoScript({
            prompt: story_prompt,
            imageCount: imageUrls.length,
            imageUrls,
            imageRefs: media_refs,
            videoRefUrl: video_ref_url,
            videoRefType: video_ref_type,
            model: videoModel,
            aspectRatio: selectedAspectRatio,
            motionControl: motion_control,
            duration,
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
          if (video_ref_url && autoVideoUrls.length > 0) {
            return {
              success: false as const,
              message: 'Do not mix video_ref_url with timeline video markers in one generation. For a local segment edit, pass only the extracted segment as video_ref_url and remove any <<<media_N>>> markers that point to timeline videos.',
            };
          }
          const referenceVideoDuration = totalVideoRefDuration > 0 ? totalVideoRefDuration : undefined;
          const modelError = validateVideoModelRequest({
            model: videoModel,
            resolution: videoRoute.resolution,
            aspectRatio: selectedAspectRatio,
            outputDuration: duration,
            referenceVideoDuration,
            referenceVideoMetas: referenceVideoMetas.length ? referenceVideoMetas : undefined,
            hasVideoReference: allVideoUrls.length > 0,
          });
          if (modelError) {
            return {
              success: false as const,
              message: modelError,
            };
          }
          const effectiveDuration = resolveVideoOutputDuration({
            requestedDuration: duration,
            referenceVideoDuration,
            model: videoModel,
          });
          let providerVideoRefUrl = video_ref_url;
          let providerAutoVideoUrls = autoVideoUrls;
          if (allVideoUrls.length > 0 && ctx.userId && ctx.projectId) {
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
            providerAutoVideoUrls = video_ref_url ? [] : prepared.urls;
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
          };
          const isGoogleOmniAsync = videoRoute.provider === 'google-omni';
          if (isGoogleOmniAsync && !ctx.userId) {
            return { success: false as const, message: 'Google Omni video jobs require an authenticated workspace so the completed video can be saved to Storage.' };
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
          const referencedImageUrls = scriptRefs
            .filter(ref => !videoRefIndices.has(ref))
            .map(ref => originalImageUrlsByIndex[ref - 1])
            .filter((u): u is string => !!u && u.startsWith('http') && !u.endsWith('.mp4'));
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
            duration: effectiveDuration || null,
            model: actualVideoModel as import('@/types').VideoModel,
            resolution: actualVideoRoute.resolution,
            aspectRatio: selectedAspectRatio,
            providerModel: skillResult.providerModel || actualVideoRoute.providerModel,
            providerMode: actualVideoRoute.providerMode,
            providerUrl: skillResult.videoUrl,
            createdAt: new Date().toISOString(),
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

          // Bill for video generation (per-second) — store amount in videoMeta for refund on failure
          const videoSec = effectiveDuration || 10;
          const creditsCharged = estimateVideoCredits({
            model: actualVideoModel,
            resolution: actualVideoRoute.resolution,
            durationSec: videoSec,
            imageCount: referencedImageUrls.length,
          }) ?? Math.ceil(videoSec * 22);
          videoMeta.creditsCharged = creditsCharged;
          const providerCostUsd = actualVideoRoute.estimatedCostPerSecondUsd != null
            ? videoSec * actualVideoRoute.estimatedCostPerSecondUsd + referencedImageUrls.length * (actualVideoRoute.estimatedInputCostUsdPerImage ?? 0)
            : undefined;
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

          try {
            await deductFixedCredits(ctx.userId ?? '', creditsCharged, actualVideoModel === 'grok' ? 'create_video_grok' : 'create_video', actualVideoModel, undefined);
          } catch (e) {
            console.error('[billing] generate_animation deduct error:', e);
          }

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
          return { success: false as const, message: String(e) };
        }
      }),
    }),

    analyze_image: tool({
      description: 'See and analyze one timeline photo. Use for questions, red annotations, uncertain target regions, identity/detail inspection, ambiguous edits, or older media without verified evidence. A current upload batch is pre-analyzed in parallel into the Verified current upload batch block; consume that evidence instead of spending one tool round per image. Call analyze_image only when evidence is missing, failed, or a deeper visual question remains. Do not call this before clear direct generate_image edits; generate_image already receives the selected media. Use media_index to look at any snapshot in the timeline.',
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
        if (!runtime.spec.supportsImageInput) {
          const { analyzeImageContent } = await import('./gemini');
          const analysis = await analyzeImageContent(
            `data:image/jpeg;base64,${buf.toString('base64')}`,
            question,
            ctx.userId,
          );
          return { analysis, question };
        }
        return { base64Data: buf.toString('base64'), mimeType: 'image/jpeg', question };
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
    }),

    analyze_video: tool({
      description: `Analyze video content using Gemini vision.

Default mode describes scenes/actions/pacing/audio cues in a timeline video. Current upload batches are pre-analyzed in parallel into the Verified current upload batch block. If any video evidence is missing or failed, pass all affected video indices together in media_indices so the tool analyzes them concurrently. Otherwise do not call this before clear direct video edits such as adding glasses, changing outfit, or using Omni to edit a referenced video; generate_animation already receives selected video references. Use analyze_video only for inspection, comparison, diagnosis, ambiguous targets, or frame-location workflows.

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
              const analysis = await analyzeVideoContent(resolved.videoUrl, question, ctx.userId);
              return { media_index: index, analysis, videoUrl: resolved.videoUrl };
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
            let location = await locateFrameInVideoContent(videoUrl, image.image, question, ctx.userId);
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
              imageSource: image.source,
            };
          }

          const { analyzeVideoContent } = await import('./gemini');
          const analysis = await analyzeVideoContent(videoUrl, question, ctx.userId);
          return { mode: 'describe', analysis, media_index: mediaIndex, videoUrl };
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
    }),

    transcribe_audio: tool({
      description: `Transcribe audio or a timeline video with Volcengine ASR and return dialogue/subtitle timecodes.

Use this when the user asks for transcript, subtitles, dialogue, spoken words, lyrics-like speech timing, or time-based editing such as "cut the part where they say X", "remove this sentence", "剪掉这句话", "按逐字稿剪", or "find the timestamp for ...".

For timeline videos, pass media_index. For external audio/video URLs, pass media_url. Results are cached into the video snapshot's video_meta.transcript when media_index is used. Use analyze_video instead for visual scene/action understanding.`,
      inputSchema: z.object({
        media_index: z.number().optional().describe('1-based Media Index index of the video to transcribe (<<<media_1>>> = 1). Preferred for timeline videos.'),
        media_url: z.string().optional().describe('External public audio/video URL to transcribe. Use only when the media is not in Media Index.'),
        language: z.string().optional().describe('Optional ASR language code such as zh-CN, en-US, ja-JP, ko-KR, id-ID. Omit for auto/default.'),
        force_refresh: z.boolean().optional().describe('Set true to ignore cached transcript and call ASR again. Default false.'),
      }),
      execute: async ({ media_index, media_url, language, force_refresh }) => {
        let resolvedUrl = media_url;
        let localMediaPath: string | undefined;
        let snapshotId: string | undefined;
        let videoMeta: Record<string, unknown> | undefined;
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
            const cached = videoMeta?.transcript as VolcengineAsrTranscript | undefined;
            if (cached?.text && !force_refresh) {
              return { transcript: cached, cached: true, media_index, videoUrl: cached.sourceUrl || resolvedUrl };
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
            uid: ctx.userId || 'makaron-agent',
            language,
          });

          if (ctx.supabase && snapshotId && videoMeta) {
            const nextMeta = { ...videoMeta, transcript };
            const { error: updateError } = await ctx.supabase
              .from('snapshots')
              .update({ video_meta: nextMeta })
              .eq('id', snapshotId);
            if (updateError) console.error('[transcribe_audio] transcript cache update failed:', updateError.message);
          }

          return { transcript, cached: false, media_index, videoUrl: transcript.sourceUrl || resolvedUrl };
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
        return {
          type: 'content' as const,
          value: [{
            type: 'text' as const,
            text: `${output.cached ? 'Cached ' : ''}ASR result${output.media_index ? ` for <<<media_${output.media_index}>>>` : ''}:\n\n${formatTranscriptForModel(transcript)}`,
          }],
        };
      },
    }),

    prepare_visual_asset: tool({
      description: `Prepare generated or supplied media for visual compositing without choosing the final layout.

Use mode "cutout" for a chroma-background image that should become a transparent PNG. The deterministic bridge removes border-connected chroma plus sizeable enclosed high-confidence chroma pockets, despills semi-transparent edges, preserves only tiny isolated same-color subject details, computes subject/safe boxes, and renders a five-background QA sheet.

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
    }),

    execution_checkpoint: tool({
      description: `Persist a typed handoff for a durable Agent execution. Use it after completing a meaningful work unit, after making a decision that later attempts must preserve, and before a long composition/code generation step. This is not a progress message for the user. Keep it concise and factual. Include durable workspace paths instead of copying file contents.`,
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
        current_work_unit: z.string(),
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
          currentWorkUnit: input.current_work_unit,
          nextAction: input.next_action,
          attemptSummary: input.attempt_summary,
          providerCompaction: previous?.providerCompaction,
        }, {
          objective: previous?.objective || 'Continue the durable execution objective.',
          currentWorkUnit: input.current_work_unit,
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
          workUnit: snapshot.currentWorkUnit,
          nextAction: snapshot.nextAction,
          message: 'Durable execution checkpoint saved.',
        };
      },
    }),

    studio_run: tool({
      description: `Create and advance a durable Makaron Studio Run for multi-stage video production.
Use this for explainer-video and other substantial directed video skills, not quick edits.
The run persists typed artifacts in the existing project workspace and enforces dependencies, approval policy, resume state, and downstream invalidation.
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
Review means previewing and patching the Remotion source before export, not authoring a Review artifact. After Composition is persisted and visually satisfactory, call materialize_media once with the final design path. A successful export automatically completes the Review and Delivery UI states. Never author Review or Delivery JSON.`,
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
        if (!ctx.supabase || !ctx.userId || !ctx.projectId) {
          return { success: false, error: 'Studio Run requires an authenticated project workspace.' };
        }
        try {
          const studio = await import('./studio-run');
          const store = new studio.WorkspaceStudioRunStore(ctx.supabase, ctx.userId);

          if (operation === 'start') {
            if (!delivery_promise) return { success: false, error: 'start requires delivery_promise' };
            const run = await studio.startPersistedStudioRun({
              store,
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

          let run = run_id ? await store.loadRun(ctx.projectId, run_id) : (await store.listRuns(ctx.projectId))[0];
          if (!run) return { success: false, error: 'Studio Run not found. Start one first.' };
          const runAtOperationStart = run;

          const loadStudioArtifact = async (artifactStage: 'script' | 'storyboard' | 'composition'): Promise<unknown> => {
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
            overrides: { script?: unknown; storyboard?: unknown } = {},
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
                  }
                } catch {
                  diagnostics.push(`Composition design at ${designPath} is not valid JSON.`);
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
              ? 'Review the Remotion source by previewing and patching it. When satisfied, call materialize_media once with the final design_path; successful export completes Review and Delivery automatically.'
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
              return { success: false, error: 'Review and Delivery do not accept Agent-authored artifacts. Patch Remotion code, then call materialize_media once.' };
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
              return { success: false, error: 'Review and Delivery are automatic. Patch the Remotion source during review, then call materialize_media once.' };
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
    }),

    materialize_media: tool({
      description: `Export an editable Remotion composition into a real MP4 video.
Use this when the user asks to save/export/materialize/turn a composition into MP4. It accepts a timeline media_index, snapshot_id, design_path, or the current unsaved composition from run_code.
Default profile is fast_720p (short side 720, no upscale) for speed. Default publish=true so the exported MP4 appears as a new <<<media_N>>> video. A completed synchronous export returns the exact mediaIndex for subsequent analyze_video/preview_frame calls; use that returned index instead of guessing. By default the tool queues a durable async export like video generation; polling/cron completes it and reports either success or failure. Set wait=true on the first call when the current response must include the final URL. A repeated call for the same unchanged composition reuses the fingerprint-matched queued/completed job and does not render twice. If the same unchanged composition fails twice in one turn, stop retrying and report export as blocked.
For Studio Run, first preview and patch the Remotion source until it is satisfactory, then call materialize_media once with the exact final design_path. Studio Run automatically waits at source resolution; successful export is terminal and completes the Review and Delivery UI states. Do not author Review/Delivery artifacts or continue reviewing after success.`,
      inputSchema: z.object({
        media_index: z.number().optional().describe('1-based media index, e.g. 3 for <<<media_3>>>. Must point to an editable Remotion composition.'),
        snapshot_id: z.string().optional().describe('Snapshot ID of an editable Remotion composition.'),
        design_path: z.string().optional().describe('Workspace design JSON path, e.g. code/<snapshotId>.json.'),
        name: z.string().optional().describe('Short output slug/name.'),
        profile: z.enum(['fast_720p', 'source']).optional().describe('fast_720p for speed, source for full source resolution.'),
        publish: z.boolean().optional().describe('Default true. Publish exported MP4 into the project timeline.'),
        wait: z.boolean().optional().describe('Default false outside Studio Run. Studio Run always waits for the final MP4 URL so successful materialization can complete the run atomically.'),
      }),
      execute: async ({ media_index, snapshot_id, design_path, name, profile, publish, wait }) => {
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
          const shouldWait = Boolean(studioCheckpoint.studioRunId) || wait === true;
          const renderProfile: RemotionRenderProfile = studioCheckpoint.studioRunId
            ? 'source'
            : (profile || 'fast_720p');
          const publishSnapshotId = shouldPublish && !shouldWait ? crypto.randomUUID() : undefined;
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

          if (!shouldWait) {
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
            return {
              success: true,
              queued: job.status !== 'completed',
              jobId: job.id,
              status: job.status,
              taskId,
              publishSnapshotId,
              message: shouldPublish
                ? `Queued MP4 export. It will appear as a video in the timeline. Job: ${job.id}`
                : `Queued MP4 export. Job: ${job.id}`,
            };
          }

          const result = await runRemotionExportJobAndWait(job.id);
          const completed = result.job;
          const videoUrl = completed.storage_url || '';
          const audioAnalysis = completed.metadata?.audioAnalysis && typeof completed.metadata.audioAnalysis === 'object'
            ? completed.metadata.audioAnalysis
            : undefined;
          let studioRunCompleted = false;
          if (studioCheckpoint.studioRunId && completed.status === 'completed') {
            const outputPath = completed.storage_url || completed.workspace_path || '';
            const compositionDesignPath = completed.design_path || source.designPath || '';
            if (!outputPath || !compositionDesignPath) {
              throw new Error('Studio Run export completed but its MP4 or editable Composition path is missing.');
            }
            const studio = await import('./studio-run');
            const store = new studio.WorkspaceStudioRunStore(ctx.supabase, ctx.userId);
            const activeRun = await store.loadRun(ctx.projectId, studioCheckpoint.studioRunId);
            if (!activeRun) throw new Error(`Studio Run ${studioCheckpoint.studioRunId} disappeared after export.`);
            const completion = await studio.completePersistedStudioRunFromMaterialization({
              store,
              run: activeRun,
              outputPath,
              compositionDesignPath,
            });
            studioRunCompleted = completion.run.status === 'completed';
            if (!studioRunCompleted) {
              throw new Error(`Studio Run ${studioCheckpoint.studioRunId} did not reach completed after export.`);
            }
          }
          const publishedSnapshotId = typeof completed.metadata?.publishedSnapshotId === 'string'
            ? completed.metadata.publishedSnapshotId
            : undefined;
          const videoMeta: VideoMeta | null = videoUrl ? {
            taskId: `remotion-export-${completed.id}`,
            videoUrl,
            providerUrl: videoUrl,
            videoPath: completed.workspace_path || '',
            prompt: name || 'Materialized Remotion composition',
            sourceSnapshotIds: source.snapshotId ? [source.snapshotId] : [],
            sourceUrls: [videoUrl],
            status: 'completed',
            duration: completed.duration_seconds || null,
            model: 'upload',
            createdAt: new Date().toISOString(),
            width: completed.width || undefined,
            height: completed.height || undefined,
          } : null;
          let publishedMediaIndex: number | undefined;
          if (publishedSnapshotId && videoMeta) {
            ctx.pendingVideoSnapshot = {
              snapshotId: publishedSnapshotId,
              taskId: videoMeta.taskId || `remotion-export-${completed.id}`,
              videoMeta,
            };
            const orderedSnapshots = await refreshSnapshotUrls(ctx);
            const actualMediaIndex = findSnapshotMediaIndex(orderedSnapshots, publishedSnapshotId);
            if (actualMediaIndex) {
              const pinnedUrls = pinAgentMediaUrl(ctx.snapshotImages, actualMediaIndex, videoUrl);
              ctx.snapshotImages.splice(0, ctx.snapshotImages.length, ...pinnedUrls);
              ctx.currentSnapshotIndex = actualMediaIndex - 1;
              publishedMediaIndex = actualMediaIndex;
            } else {
              const existingIndex = ctx.snapshotImages.indexOf(videoUrl);
              if (existingIndex >= 0) {
                ctx.currentSnapshotIndex = existingIndex;
                publishedMediaIndex = existingIndex + 1;
              } else {
                ctx.snapshotImages.push(videoUrl);
                ctx.currentSnapshotIndex = ctx.snapshotImages.length - 1;
                publishedMediaIndex = ctx.snapshotImages.length;
              }
            }
          }
          return {
            success: completed.status === 'completed',
            jobId: completed.id,
            status: completed.status,
            videoUrl,
            workspacePath: completed.workspace_path,
            publishedSnapshotId,
            mediaIndex: publishedMediaIndex,
            durationSeconds: completed.duration_seconds,
            renderSeconds: completed.render_seconds,
            realtimeRatio: completed.realtime_ratio,
            audioAnalysis,
            studioRunCompleted,
            message: publishedMediaIndex
              ? `Exported MP4 is available as <<<media_${publishedMediaIndex}>>>.${studioCheckpoint.studioRunId ? ' Studio Run is complete; do not start another Review or Delivery step.' : ''}`
              : studioCheckpoint.studioRunId
                ? 'Exported MP4 successfully. Studio Run is complete; do not start another Review or Delivery step.'
                : undefined,
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    preview_frame: tool({
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
        let rawVideo: { url: string; duration?: number; fps?: number } | null = null;
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
              if (snap?.type === 'video' || videoUrl || fallbackUrl) {
                rawVideo = {
                  url: videoUrl || fallbackUrl,
                  duration: Number.isFinite(duration) ? duration : undefined,
                  fps: Number.isFinite(fps) ? fps : undefined,
                };
              }
            }
          } catch (e) {
            console.warn(`[preview_frame] failed to load design for media_index=${targetMediaIndex}:`, e);
          }
        } else if (targetMediaIndex !== undefined) {
          const resolved = await resolveVideoUrlForMediaIndex(ctx, targetMediaIndex);
          if (resolved.videoUrl) {
            rawVideo = { url: resolved.videoUrl, duration: resolved.duration, fps: resolved.fps };
          }
        }

        if (targetMediaIndex !== undefined && !design && !rawVideo) {
          const resolved = await resolveVideoUrlForMediaIndex(ctx, targetMediaIndex);
          if (resolved.videoUrl) {
            rawVideo = { url: resolved.videoUrl, duration: resolved.duration, fps: resolved.fps };
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
          const targetFrame = Math.max(0, Math.round(clampedTimestamp * videoFps));
          const totalFrames = rawVideo.duration && rawVideo.duration > 0 ? Math.max(1, Math.round(rawVideo.duration * videoFps)) : undefined;

          try {
            const { extractVideoFrame } = await import('./video-frame');
            const jpegBuffer = await extractVideoFrame(rawVideo.url, { timestamp: clampedTimestamp });

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
                  description: `video frame at ${clampedTimestamp.toFixed(2)}s`,
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
    }),

    rotate_camera: tool({
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
          // Bill for camera rotation (per-action)
          import('./billing/credits').then(({ deductCredits }) =>
            deductCredits(ctx.userId ?? '', null, 'rotate_camera')
              .catch(e => console.error('[billing] rotate_camera deduct error:', e))
          );
        }
        return { success: skillResult.success as true, message: skillResult.message };
      },
    }),

    // ── Workspace tools ─────────────────────────────────────────────────────

    list_files: tool({
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
    }),

    read_file: tool({
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
    }),

    write_code_file: tool({
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
    }),

    write_file: tool({
      description: `Write a file to your workspace. Use this to save memory, create skills, or organize your workspace.
For durable Composition work, write numbered source parts under \`<project-id>/drafts/composition-parts/\` one cohesive component per model step and wait for each result. Filenames MUST use a numeric prefix of at least two digits plus a slug, for example \`00-foundation.js\`, \`10-scenes-a.js\`, \`90-root.js\`, or \`120-chapter.js\`. Include compositionMetadata on the first part (and again only when metadata changes) so dimensions, props, editables, and animation remain durable without a final assembly call. Each part has a hard transport limit of 12000 source characters; focused parts around 3000-8000 characters are preferred, but visual detail must decide the size. There is no aggregate source-size or part-count limit. Parts share one scope: do not use import/export. Rewriting the same numbered path is retry-safe. Never shorten approved narration, subtitles, scenes, animation, or visual detail to reduce source size. If one unusually large part exceeds 12000, split that component across new numbered files; renaming unchanged oversized source will still fail. The workspace automatically assembles, validates, and autosaves the complete draft after every successful part write. compositionWorkspace.status="ready" means the current files compile mechanically; it is not permission to omit planned scenes or polish. Finish every planned part, repair any diagnostics, then preview the returned designPath. Do not call run_code merely to assemble files.
Set fromLastRunCode=true to save the last run_code output.
Composition runtime: publish=false saves the draft code only; default publish=true saves and publishes a timeline Snapshot.
Node media runtime: \`type: "files"\` outputs are already saved workspace files. If they are user-facing MP4 deliverables from split/trim/export/transcode, publish them with fromWorkspaceOutputs before final reply. \`type: "video"\` is a single final MP4 and can be published with write_file. Do not use node/FFmpeg as a fallback for ordinary editable timeline splicing of existing videos; patch or publish the Remotion composition instead.
Set fromWorkspaceOutputs=true to publish recent workspace image/video outputs to the timeline. Use this immediately after direct FFmpeg deliverables, or later when the user says "publish the videos/images you just exported"; do not re-run FFmpeg.
Path is auto-generated from the current project and output type. Just provide a short name.`,
      inputSchema: z.object({
        path: z.string().optional().describe('File path. Auto-generated when fromLastRunCode=true (just pass name for the slug).'),
        name: z.string().optional().describe('Short descriptive name for the saved code (e.g. "sunset-poster"). Used with fromLastRunCode.'),
        content: z.string().optional().describe('File content. Not needed if fromLastRunCode=true.'),
        fromLastRunCode: z.boolean().optional().describe('Save the last run_code output. Composition drafts can publish to timeline; node media chunks should usually be save-only until the final MP4.'),
        fromWorkspaceOutputs: z.boolean().optional().describe('Publish recent workspace image/video outputs to the timeline instead of writing text/code. Use immediately for user-facing FFmpeg split/trim/export MP4 outputs, and for previously exported outputs across turns. Prefer exact workspace paths returned by run_code/list_files; never guess a workspace URL from a file name.'),
        workspacePaths: z.array(z.string()).optional().describe('Specific workspace file paths to publish. If omitted with fromWorkspaceOutputs=true, publishes the most recent project media outputs.'),
        mediaType: z.enum(['image', 'video', 'all']).optional().describe('Filter workspace outputs when publishing. Default all.'),
        limit: z.number().int().min(1).max(20).optional().describe('Maximum recent workspace outputs to publish when workspacePaths is omitted. Use 3 for three exported clips, etc.'),
        publish: z.boolean().optional().describe('Whether to publish to timeline. Default true. Set false to save workspace output without creating a Snapshot.'),
        compositionMetadata: z.object({
          width: z.number().int().positive().optional(),
          height: z.number().int().positive().optional(),
          props: z.record(z.string(), z.unknown()).optional(),
          editables: z.array(z.object({
            id: z.string().min(1),
            type: z.literal('text'),
            label: z.string(),
            propKey: z.string().min(1),
          }).passthrough()).optional(),
          animation: z.object({
            fps: z.number().positive(),
            durationInSeconds: z.number().positive(),
            format: z.string().optional(),
          }).optional(),
          description: z.string().optional(),
        }).optional().describe('Durable metadata for numbered composition parts. Include on the first part and only repeat when it changes; source files are auto-assembled without a final run_code call.'),
      }),
      execute: async ({ path: filePath, name, content, fromLastRunCode, fromWorkspaceOutputs, workspacePaths, mediaType, limit, publish: shouldPublish, compositionMetadata }) => {
        if (!ctx.supabase || !ctx.userId) {
          return { success: false, message: 'Workspace not available (no Supabase connection).' };
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
              : `${ctx.projectId}/code/snapshot-${snapshotIdx}-${slug}.json`;
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
    }),

    delete_file: tool({
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
    }),

    run_code: tool({
      description: `Execute JavaScript.

Before first use, read \`prompts/agent-coding.md\`, plus \`prompts/remotion-composition.md\` for Remotion/editable compositions. For new compositions or major visual/timing patches, follow \`skills/_shared/remotion-director-contract.md\` and its required references. Studio Run uses the same original Composition and Director guidance; it does not replace them with a compact creative prompt. For real file-level MP4 splitting, exact trimming/export, transcode, frames, audio muxing, long-video preparation, or final assembly of generated chunks, also read \`skills/video-ffmpeg-lab/SKILL.md\`. Do not re-read a guide already present in tool-result history.

Runtimes:
- \`runtime: "composition"\`: Remotion/editable composition draft, animated template, overlay, sharp utility.
- \`runtime: "design"\` or omitted: legacy alias for \`runtime: "composition"\`.
- \`runtime: "node"\`: open backend Node with FFmpeg/FFprobe for real file-level media operations. Never use node as a fallback for ordinary editable timeline splicing of existing videos.

Return exactly one supported shape:
- \`{ type: 'render', code, width, height, editables?, props?, animation? }\`
- \`{ type: 'patch', edits?, props?, code_path? }\`
- \`{ type: 'image', data, mimeType }\`
- \`{ type: 'video', path, contentType?, description?, duration?, width?, height? }\`
- \`{ type: 'files', outputs: [{ path, contentType, description? }] }\`
- \`{ type: 'text', content }\`
- \`{ type: 'error', message }\`

For substantial normal Agent Run coding, prefer \`write_code_file\` followed by \`run_code({ code_path })\`. This exposes real source progress, persists the program before execution, and keeps it patchable across turns. For a small patch or utility, inline \`code\` remains available. The top-level \`composition\` input remains available for direct first-draft payloads.

When \`write_code_file\` uses \`runtime: "composition"\`, it may contain a natural JS/TS/JSX/TSX Remotion module with imports/exports and a top-level Composition, or the legacy outer JavaScript body. For a new natural module, provide width/height/animation through the optional \`composition\` metadata on run_code; code_path supplies the source, so do not repeat it.

For durable Composition work, use \`write_file\` to author numbered source parts. Every file MUST be under \`<project-id>/drafts/composition-parts/\` and use a numeric prefix of at least two digits plus a lowercase slug. Each file has a hard transport limit of 12000 source characters. There is no aggregate source-size or part-count limit. Files are concatenated by numeric prefix into one scope, so do not use import/export. Preserve approved narration, subtitles, scenes, animation, and visual detail; never trim creative content to satisfy a source-size target. Saving a part automatically assembles, validates, and autosaves the workspace. The legacy composition_parts input remains available for recovery and explicit subsets, but do not call it merely to assemble a directory that write_file has already compiled.

For a 30s+ first composition, author numbered composition parts until write_file reports compositionWorkspace.status="ready". Use scene data arrays and shared components where they help, but do not impose an aggregate source-size target or trim approved creative detail. Preview or patch the returned designPath directly; no assembly-only run_code call is needed.

Composition hard rules: use Remotion \`<Img>\`, not \`<img>\`; declare editable user-facing text; use system CJK fonts; keep mobile image layers light. Reference timeline media in composition code and props with the literal 1-based marker \`<<<media_N>>>\`; the runtime resolves markers to current URLs before validation, autosave, preview, and export. Never translate Media Index N into \`ctx.snapshotImages[N]\` because that JavaScript array is 0-based. Only \`Composition(props)\` may read \`props\` directly; helper components must receive values through their own parameters and must never reference outer \`props\` (prevents \`props is not defined\` in Lambda). For timeline videos, preserve the selected Media Index video aspect ratio when all selected videos share one aspect: 9:16 sources must return a 9:16 canvas such as 1080x1920, never a 16:9 canvas. For mixed-aspect sources, choose the user/platform/current composition target and use contain/background; do not claim the runtime forced one source's aspect.
For legacy first-draft calls without \`composition\`, send one complete executable JavaScript body that returns the render object. Do not send a fragment like \`const code = \\\`\` without the final \`return { type: 'render', code, ... }\`. Keep long videos concise by using arrays, helper components, and interpolations instead of writing frame-by-frame code.

Node media runtime provides \`require\`, \`process\`, \`ffmpegPath\`, \`inputFiles\`, \`outputDir\`, \`workDir\`, \`workspaceDir\`, \`saveOutput(localPath)\`, and \`probeVideo(path)\`. Most Node built-ins are available, plus media packages such as \`sharp\`, \`jszip\`, \`exifr\`, \`heic-convert\`, \`canvas\`, \`remotion\`, and Remotion media utilities. Arbitrary local/package require, env secrets, and escape/debug modules are blocked. Workspace files are local to the runtime: use \`workspace_paths\` and \`inputFiles[n].inputPath\`, never download or reconstruct Storage URLs. For \`runtime: "node"\`, any referenced timeline media like \`<<<media_1>>>\` MUST be passed as \`media_refs: [1]\`; any existing workspace file from \`list_files\` MUST be passed as \`workspace_paths: ["project/media/file.mp4"]\`. The system resolves both to local workspace-backed files before your code runs. \`ffprobePath\` may be empty in deployment; prefer \`probeVideo(path)\`. Use \`type: "files"\` for chunks and \`type: "video"\` for the final MP4. If ordinary timeline splicing was routed to composition, do not switch to node just because preview needs adjustment; patch the composition or report the preview issue.`,
      inputSchema: z.object({
        code: z.string().optional().describe('JavaScript code to execute. Required for node, patch, image, and legacy calls. For a first Remotion draft prefer the direct composition input instead.'),
        code_path: z.string().optional().describe('Workspace code file created by write_code_file. Preferred for substantial normal Agent Run coding; run_code reads and executes the saved source without repeating it in tool history.'),
        composition: z.object({
          code: z.string().min(1).optional().describe('Direct Remotion component source. Natural imports/exports are accepted. Omit when code_path supplies the source and this object only supplies metadata.'),
          width: z.number().int().positive(),
          height: z.number().int().positive(),
          props: z.record(z.string(), z.unknown()).optional(),
          editables: z.array(z.object({
            id: z.string().min(1),
            type: z.string().min(1),
            label: z.string(),
            propKey: z.string().min(1),
          }).passthrough()).optional(),
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
          editables: z.array(z.object({
            id: z.string().min(1),
            type: z.string().min(1),
            label: z.string(),
            propKey: z.string().min(1),
          }).passthrough()).optional(),
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
        if (resolvedComposition && !resolvedComposition.code && code_path) {
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
          // Pre-fetch requested snapshot images as Buffers
          let preloadedImages: Buffer[] = [];
          if (media_refs?.length) {
            for (const ref of media_refs) {
              const v = validateImageIndex(ctx.snapshotImages, ref);
              if (v.error) return { type: 'text' as const, content: v.error };
            }
            preloadedImages = await Promise.all(
              media_refs.map(ref => fetchImageBuffer(ctx.snapshotImages[ref - 1]))
            );
            console.log(`📦 [run_code] pre-fetched ${preloadedImages.length} images (${preloadedImages.map(b => `${(b.length / 1024).toFixed(0)}KB`).join(', ')})`);
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
          console.log(`✅ [run_code] done in ${elapsed}s, result type: ${typeof result}, isBuffer: ${Buffer.isBuffer(result)}, keys: ${result && typeof result === 'object' ? Object.keys(result).join(',') : 'N/A'}, dataType: ${result?.data ? `${typeof result.data} / ${result.data.constructor?.name} / len=${result.data.length || 'N/A'}` : 'no data'}`);

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

          // Helper: store image — sharp images auto-send, design drafts need write_file to publish
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

          // { type: 'patch', edits?: [...], props?: {...} } — Incremental update on last composition or code_path
          if (result?.type === 'patch' && (Array.isArray(result.edits) || result.props !== undefined)) {
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

            const promiseError = studioCompositionPromiseError(await getStudioRunCheckpoint(ctx), patched);
            if (promiseError) return { type: 'text' as const, content: promiseError };

            const harnessError = validateDesign({ code: patched.code, props: patched.props });
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

            // Track draft for potential later publish via write_file
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
            return { type: 'text' as const, code_path: autosave.path, content: `Patched${patchSource} — draft ${draftIdx} autosaved to ${autosave.path}. If this changed trim timing, confirm animation.durationInSeconds matches the final frame count. If this changed transitions, subtitles, overlays, trim timing, cropping, or will be published, call preview_frame before telling the user it is complete. Use write_file({ fromLastRunCode: true, name: "slug" }) only when publishing a timeline snapshot or creating a named checkpoint.` };
          }

          // { type: 'render' (or legacy 'design'), code: '...' } — Store for event loop to emit as SSE
          if ((result?.type === 'render' || result?.type === 'design') && typeof result.code === 'string') {
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
            const harnessError = validateDesign({ code: resolvedCode, props: resolvedProps });
            if (harnessError) {
              return { type: 'text' as const, content: harnessError };
            }
            const aspectError = await validateCompositionMediaAspect(ctx, {
              code: resolvedCode,
              props: resolvedProps,
              width: result.width,
              height: result.height,
            });
            if (aspectError) {
              return { type: 'text' as const, content: aspectError };
            }

            // ── Harness passed — store composition ──
            // Auto-generate description if Agent didn't provide one
            const autoDesc = desc || (() => {
              const type = animation ? `${animation.durationInSeconds}s video` : 'still composition';
              // Extract text content from code (string literals in JSX)
              const textMatches = result.code.match(/>([^<>{}\n]{3,60})</g)?.slice(0, 5).map((m: string) => m.slice(1).trim()).filter(Boolean);
              const textHint = textMatches?.length ? `: "${textMatches.slice(0, 3).join('", "')}"` : '';
              return `${type} (${result.width || 1080}x${result.height || 1350})${textHint}`;
            })();
            animation = normalizeCompositionAnimation(resolvedCode, animation);
            const designPayload = {
              code: resolvedCode,
              width: result.width || 1080,
              height: result.height || 1350,
              props: resolvedProps,
              animation,
              description: autoDesc,
              ...(result.editables ? { editables: result.editables } : {}),
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

            // Track draft for potential later publish via write_file
            if (!(ctx as any).__runCodeDrafts) (ctx as any).__runCodeDrafts = [];

            // Push new draft (no auto-screenshot — Agent uses preview_frame tool to check)
            (ctx as any).__runCodeDrafts.push({ type: 'design', payload: designPayload, codePath: autosave.path });
            const draftIdx = (ctx as any).__runCodeDrafts.length;

            return { type: 'text' as const, code_path: autosave.path, content: `Composition ready — draft ${draftIdx} autosaved to ${autosave.path}. If this changed trim timing, confirm animation.durationInSeconds matches the final frame count. If this includes transitions, subtitles, overlays, trim timing, cropping, or will be published, call preview_frame with design_path if the run resumes later. Use write_file({ fromLastRunCode: true, name: "<descriptive-slug>" }) only to publish a timeline snapshot or create a named checkpoint.` };
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
          if (result.type === 'image' && result.data) {
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
          if (result.type === 'error') {
            return { type: 'text' as const, content: `Error: ${result.message}` };
          }

          // Text result
          if (result.type === 'text') {
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
    }),

    list_voiceover_voices: tool({
      description: `Fetch the current Volcengine Doubao / Seed Speech voice catalog so you can choose the best voice for a voiceover.

Call this before generate_voiceover unless the user explicitly supplied a concrete voice_id or the conversation already contains a fresh voice catalog. Use the returned language, gender, scenario, style tags, and descriptions to pick a fitting voice for the user's content. Prefer voices whose language and scenario match the script; avoid novelty, rock, character, dialect, or highly stylized voices unless the user's task asks for that style.`,
      inputSchema: z.object({
        query: z.string().optional().describe('Optional short description of what you need, e.g. "warm Chinese sales narration", "English energetic product demo", "古风女声". The tool returns the full catalog plus filtered suggestions when possible.'),
        force_refresh: z.boolean().optional().describe('Set true to bypass the short server-side cache and call Volcengine ListSpeakers again. Default false.'),
      }),
      execute: async ({ query, force_refresh }) => {
        const catalog = await listVolcengineTtsVoices({ forceRefresh: force_refresh, allowFallback: true });
        const normalizedQuery = query?.trim().toLowerCase();
        const scored = catalog.voices.map((voice) => {
          const haystack = [
            voice.id,
            voice.name,
            voice.language,
            voice.gender,
            voice.scenario,
            voice.description,
            voice.resourceId,
            voice.model,
            ...voice.styles,
          ].filter(Boolean).join(' ').toLowerCase();
          let score = 0;
          if (normalizedQuery) {
            for (const token of normalizedQuery.split(/[\s,，、;；/|]+/).filter(Boolean)) {
              if (haystack.includes(token)) score += 2;
            }
          }
          if (/中文|chinese|zh|普通话/.test(normalizedQuery || '') && /(^zh|中文|mandarin|普通话)/i.test(haystack)) score += 4;
          if (/英文|english|en\b/.test(normalizedQuery || '') && /(^en|english|英文)/i.test(haystack)) score += 4;
          if (/男|male/.test(normalizedQuery || '') && /male|男/.test(haystack)) score += 3;
          if (/女|female/.test(normalizedQuery || '') && /female|女/.test(haystack)) score += 3;
          if (/销售|sales|口播|旁白|解说|explainer|narration/.test(normalizedQuery || '') && /sales|口播|直播|广告|营销|general|通用|narration|旁白/.test(haystack)) score += 3;
          return { voice, score };
        }).sort((a, b) => b.score - a.score);
        const suggestions = scored.filter(item => item.score > 0).slice(0, 12).map(item => item.voice);
        return {
          ...catalog,
          count: catalog.voices.length,
          suggestions: suggestions.length ? suggestions : catalog.voices.slice(0, 12),
          query,
        };
      },
      toModelOutput({ output }: { output: any }) {
        const voices = Array.isArray(output.suggestions) ? output.suggestions : [];
        const rows = voices.map((voice: any, index: number) => {
          const tags = [
            voice.language,
            voice.gender,
            voice.scenario,
            ...(Array.isArray(voice.styles) ? voice.styles : []),
          ].filter(Boolean).join(', ');
          return `${index + 1}. ${voice.id}${voice.resourceId ? ` [resource_id=${voice.resourceId}]` : ''}${voice.name ? ` — ${voice.name}` : ''}${tags ? ` (${tags})` : ''}${voice.description ? `: ${voice.description}` : ''}`;
        }).join('\n');
        const warning = output.warning ? `\nWarning: ${output.warning}` : '';
        return {
          type: 'content' as const,
          value: [{
            type: 'text' as const,
            text: `Volcengine voice catalog source=${output.source}, total=${output.count || output.voices?.length || 0}.${warning}\nSuggested voices:\n${rows || 'No voices returned.'}\n\nChoose one voice_id and pass both its voice_id and resource_id to generate_voiceover.`,
          }],
        };
      },
    }),

    generate_voiceover: tool({
      description: `Generate a spoken narration / voiceover audio clip with Volcengine Doubao Seed TTS, upload it to the project, and add it to the Audio Index.

Use this when the task needs accurate scripted speech: narration, voiceover, dialogue, spoken explainer audio, product introductions, tutorials, sales-style oral copy, or when a video/composition clearly needs a human spoken line. Do not use it for background music, ambience, sound effects, character-voice experiments, or mixed sound design; use generate_audio or generate_music for prompt-first Seed Audio assets.

The generated audio becomes an Audio Index item (<<<audio_N>>>) in later turns. Use the audio marker only as a conversational/Seedance reference label. In Remotion composition code, always use the returned public audioUrl directly as the <Audio src>; never put <<<audio_N>>> in props or <Audio src>. Before calling this tool, call list_voiceover_voices and choose a concrete voice_id that fits the script, unless the user explicitly supplied one. If list_voiceover_voices returns fallback only, you may still use the best fallback voice but mention that the full voice catalog was unavailable.`,
      inputSchema: z.object({
        text: z.string().describe('The exact spoken text to synthesize. Keep it natural and speakable; rewrite stiff copy into oral narration first when appropriate.'),
        title: z.string().optional().describe('Short title for the audio card/index, e.g. "Hook voiceover" or "Product narration".'),
        voice_id: z.string().optional().describe('Optional Doubao speaker id / voice type. Omit to use the project default.'),
        resource_id: z.enum(['seed-tts-2.0', 'seed-icl-2.0', 'seed-tts-1.0', 'seed-tts-1.0-concurr']).optional().describe('Volcengine resource id returned by list_voiceover_voices. Mars voices use seed-tts-1.0, Uranus voices use seed-tts-2.0, and authorized cloned voices use seed-icl-2.0.'),
        speech_rate: z.number().min(-50).max(100).optional().describe('Speech speed. 0 is natural, 100 is 2x, -50 is 0.5x. Prefer 0 unless the user asks for faster/slower delivery.'),
        context_prompt: z.string().optional().describe('Optional short voice direction for Seed TTS 2.0, e.g. "用轻松、真诚、有现场感的口吻".'),
      }),
      execute: async ({ text, title, voice_id, resource_id, speech_rate, context_prompt }) => {
        if (!ctx.supabase || !ctx.userId) {
          return { success: false as const, message: 'generate_voiceover requires an authenticated project workspace.' };
        }

        const result = await createVoiceover({
          text,
          title,
          voiceId: voice_id,
          resourceId: resource_id,
          speechRate: speech_rate,
          contextPrompt: context_prompt,
        });
        if (!result.success || !result.audio || !result.tts || !result.taskId) {
          return { success: false as const, message: result.message };
        }

        const { data: latestRows } = await ctx.supabase
          .from('project_music')
          .select('track_index')
          .eq('project_id', ctx.projectId)
          .eq('user_id', ctx.userId)
          .order('track_index', { ascending: false })
          .limit(1);
        const trackIndex = Number(latestRows?.[0]?.track_index ?? -1) + 1;
        const audioUrl = await uploadAudio(ctx.supabase, ctx.userId, ctx.projectId, result.taskId, trackIndex, result.audio);
        if (!audioUrl) {
          return { success: false as const, message: 'Voiceover was generated but failed to upload to project storage.' };
        }

        const trackTitle = (result.title || title || 'Generated voiceover').slice(0, 120);
        const { error: insertError } = await ctx.supabase.from('project_music').upsert({
          suno_task_id: result.taskId,
          track_index: trackIndex,
          project_id: ctx.projectId,
          user_id: ctx.userId,
          prompt: text,
          audio_url: audioUrl,
          suno_audio_url: null,
          stream_audio_url: null,
          duration: null,
          title: trackTitle,
          tags: `voiceover,tts,doubao,${result.tts.resourceId}`,
          status: 'completed',
          selected: false,
        }, { onConflict: 'suno_task_id,track_index' });
        if (insertError) {
          return { success: false as const, message: `Voiceover uploaded but DB insert failed: ${insertError.message}`, audioUrl };
        }

        const audioIndex = addAudioAttachment(ctx, { audioUrl, title: trackTitle, trackIndex });
        deductCredits(ctx.userId, null, 'create_voiceover', result.tts.model)
          .catch(e => console.error('[billing] generate_voiceover deduct error:', e));

        return {
          success: true as const,
          message: `Voiceover generated and added to Audio Index as <<<audio_${audioIndex}>>>.\nResolved voiceover URL: ${audioUrl}\nUse this URL directly in Remotion <Audio src>; do not use the <<<audio_${audioIndex}>>> marker inside composition code or props.`,
          audioUrl,
          title: trackTitle,
          trackIndex,
          taskId: result.taskId,
          model: result.tts.model,
          voiceId: result.tts.voiceId,
          resourceId: result.tts.resourceId,
          textLength: result.tts.textLength,
          sentenceCount: result.tts.sentences.length,
        };
      },
      toModelOutput({ output }: { output: any }) {
        return {
          type: 'content' as const,
          value: [{ type: 'text' as const, text: formatGeneratedAudioForModel('generate_voiceover', output) }],
        };
      },
    }),

    generate_audio: tool({
      description: `Generate audio from a natural-language prompt.

This is prompt-first: describe the sound directly. Do not force a rigid category. The prompt may describe background music, sound effects, ambience, character voice, or a mixed sound-design scene.

Use generate_voiceover instead when exact scripted narration is required, especially for explainer videos, tutorials, and product introductions. Use generate_music for background music beds; it also uses Seed Audio.

Available audio model notes:
${formatAudioCapabilitiesForAgent()}`,
      inputSchema: z.object({
        prompt: z.string().describe('Natural-language description of the audio to create. Include duration, mood, instruments, sound effects, voice direction, and constraints directly in the prompt.'),
        duration_seconds: z.number().optional().describe('Requested duration in seconds. Seed Audio supports up to 120 seconds. Also include the duration in the prompt for best results.'),
        title: z.string().optional().describe('Short title for the generated audio asset.'),
        model: z.enum(['auto', 'evolink-seed-audio']).optional().describe('Audio model. Omit or use auto for the default Seed Audio model.'),
      }),
      execute: async ({ prompt, duration_seconds, title, model }) => {
        const result = await createAudio({
          prompt,
          durationSeconds: duration_seconds,
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
              title: result.title || title || 'Generated audio',
              duration: result.duration,
              trackIndex: result.trackIndex,
            });
            result.message = `${result.message}\nAdded to Audio Index as <<<audio_${audioIndex}>>>.\nResolved audio URL: ${result.audioUrl}\nUse this URL directly in Remotion <Audio src>; do not rely on the marker inside composition code or props.`;
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
    }),

    generate_music: tool({
      description: `Generate background music with Seed Audio and return one persisted audio asset. Use this for short-video music beds, soundtrack, score, ambience-driven music, and polished vlog/commercial background tracks. Do not use Suno; all new music generation routes go through Seed Audio.`,
      inputSchema: z.object({
        prompt: z.string().describe('Music description: genre, mood, energy, instruments (no timing, no artist names)'),
        instrumental: z.boolean().optional().describe('No vocals (default: true)'),
        style: z.string().optional().describe('Genre/mood tags for custom mode'),
        duration_seconds: z.number().optional().describe('Requested duration for Seed Audio music beds. Seed Audio supports up to 120 seconds.'),
        provider: z.enum(['auto', 'evolink-seed-audio']).optional().describe('Omit or use auto for Seed Audio. Kept only for compatibility.'),
      }),
      execute: async ({ prompt, instrumental, style, duration_seconds, provider }) => {
        const musicPrompt = [
          prompt,
          style ? `Style tags: ${style}.` : '',
          instrumental === false
            ? 'Use subtle vocal texture only if it supports the requested music bed; avoid dominant sung lyrics unless explicitly required.'
            : 'Instrumental background music only, no vocals or lyrics.',
        ].filter(Boolean).join('\n');
        const result = await createAudio({
          prompt: musicPrompt,
          durationSeconds: duration_seconds,
          title: 'Generated music',
          model: provider === 'evolink-seed-audio' ? provider : 'auto',
          supabase: ctx.supabase,
          userId: ctx.userId,
          projectId: ctx.projectId,
        });
        if (result.success) {
          if (result.audioUrl) {
            const audioIndex = addAudioAttachment(ctx, {
              audioUrl: result.audioUrl,
              title: result.title || 'Generated music',
              duration: result.duration,
              trackIndex: result.trackIndex,
            });
            result.message = `${result.message}\nAdded to Audio Index as <<<audio_${audioIndex}>>>.\nResolved music URL: ${result.audioUrl}\nUse this URL directly in Remotion <Audio src>; do not rely on the marker inside composition code or props.`;
          }
          deductSeedAudioCredits(ctx.userId ?? '', {
            durationSeconds: result.duration,
            providerCreditsUsed: result.creditsUsed,
            model: result.model,
            generationSeconds: result.generationSeconds,
          }).catch(e => console.error('[billing] generate_music deduct error:', e));
        }
        return result;
      },
      toModelOutput({ output }: { output: any }) {
        return {
          type: 'content' as const,
          value: [{ type: 'text' as const, text: formatGeneratedAudioForModel('generate_music', output) }],
        };
      },
    }),

  };
}

/** Log tool description sizes — call after createTools. */

function logToolSizes(tools: Record<string, any>): number {
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

const DURABLE_IDEMPOTENT_TOOLS = new Set([
  'generate_image',
  'generate_animation',
  'materialize_media',
  'rotate_camera',
  'generate_voiceover',
  'generate_audio',
  'generate_music',
  'prepare_visual_asset',
]);

function wrapDurableIdempotentTools(
  tools: Record<string, any>,
  ctx: AgentContext,
): Record<string, any> {
  if (!ctx.execution || !ctx.supabase || !ctx.userId) return tools;
  for (const [toolName, definition] of Object.entries(tools)) {
    if (!DURABLE_IDEMPOTENT_TOOLS.has(toolName) || typeof definition?.execute !== 'function') continue;
    const execute = definition.execute.bind(definition);
    definition.execute = async (input: unknown, executionOptions?: unknown) => {
      const operationKey = stableOperationKey(ctx.execution!.workUnitKey, toolName, input);
      const { data, error } = await ctx.supabase.rpc('claim_agent_operation', {
        p_run_id: ctx.execution!.runId,
        p_attempt_id: ctx.execution!.attemptId,
        p_user_id: ctx.userId,
        p_work_unit_key: ctx.execution!.workUnitKey,
        p_operation_key: operationKey,
        p_tool_name: toolName,
      });
      if (error) {
        console.warn(`[agent-execution] operation ledger unavailable for ${toolName}: ${error.message}`);
        return execute(input, executionOptions);
      }
      const claim = Array.isArray(data) ? data[0] : data;
      if (!claim?.claimed) {
        if (claim?.operation_status === 'completed' && claim?.operation_result != null) {
          return {
            ...(typeof claim.operation_result === 'object' ? claim.operation_result : { result: claim.operation_result }),
            reused: true,
            operationKey,
          };
        }
        return {
          success: true,
          reused: true,
          operationKey,
          status: claim?.operation_status || 'running',
          message: `The identical ${toolName} operation is already ${claim?.operation_status || 'running'}. Do not submit it again; continue from its persisted project result or wait for reconciliation.`,
        };
      }

      const operationId = claim.operation_id as string;
      try {
        const result = await execute(input, executionOptions);
        const record: Record<string, unknown> = result && typeof result === 'object'
          ? result as Record<string, unknown>
          : { value: result };
        const failed = record.success === false || record.status === 'failed' || Boolean(record.error);
        await ctx.supabase.from('agent_operations').update({
          status: failed ? 'failed' : 'completed',
          result: record,
          external_task_id: record.taskId || record.jobId || record.snapshotId || null,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', operationId);
        return { ...record, operationKey };
      } catch (error) {
        await ctx.supabase.from('agent_operations').update({
          status: 'failed',
          result: { error: error instanceof Error ? error.message : String(error) },
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', operationId);
        throw error;
      }
    };
  }
  return tools;
}

// ---------------------------------------------------------------------------
// Agent runner – async generator yielding SSE events
// ---------------------------------------------------------------------------

function readJsonStringValueFromBuffer(buffer: string, key: string): { complete: boolean; value: string } | null {
  const match = buffer.match(new RegExp(`"${key}"\\s*:\\s*"`));
  if (!match || match.index === undefined) return null;

  let index = match.index + match[0].length;
  let value = '';
  while (index < buffer.length) {
    const char = buffer[index];
    if (char === '"') {
      return { complete: true, value };
    }
    if (char !== '\\') {
      value += char;
      index++;
      continue;
    }

    if (index + 1 >= buffer.length) return { complete: false, value };
    const escape = buffer[index + 1];
    if (escape === 'u') {
      if (index + 6 > buffer.length) return { complete: false, value };
      const hex = buffer.slice(index + 2, index + 6);
      value += /^[0-9a-fA-F]{4}$/.test(hex)
        ? String.fromCharCode(Number.parseInt(hex, 16))
        : `\\u${hex}`;
      index += 6;
      continue;
    }
    if (escape === 'n') value += '\n';
    else if (escape === 'r') value += '\r';
    else if (escape === 't') value += '\t';
    else if (escape === 'b') value += '\b';
    else if (escape === 'f') value += '\f';
    else if (escape === '"') value += '"';
    else if (escape === '\\') value += '\\';
    else if (escape === '/') value += '/';
    else value += escape;
    index += 2;
  }

  return { complete: false, value };
}

// Used for initial upload analysis
const ANALYSIS_PROMPT_INITIAL = `Describe this photo in 1-2 sentences, in the tone of a friend sharing what they noticed. Start directly with the subject. Do not use any preamble such as "Let me take a look".`;

// Used for post-edit analysis — acknowledges the edit context
const ANALYSIS_PROMPT_POSTEDIT = `The edit is complete. In one sentence, directly describe the edited image's overall effect and mood. Acknowledge that this is the result after editing, without any preamble.`;

// Used for video upload auto-analysis
const ANALYSIS_PROMPT_VIDEO_TEMPLATE = (mediaIndex: number) =>
  `[System: User just uploaded a video at <<<media_${mediaIndex}>>>. Analyze it and describe the content.]\nDescribe this video in 2-3 sentences — duration, key subjects/actions, mood. Be conversational. No preamble.`;

export interface RunMakaronAgentOptions {
  analysisOnly?: boolean;
  analysisContext?: 'initial' | 'post-edit';
  isVideoAnalysis?: boolean;
  tipReactionOnly?: boolean;
  disableToolCalls?: boolean;
  referenceImages?: string[];
  animationImageUrls?: string[];
  animationImages?: string[];
  locale?: string;
  preferredModel?: ModelId;
  agentModel?: AgentModelPreference;
  videoModel?: string;
  videoResolution?: import('@/types').VideoResolution;
  videoAuto?: boolean;
  skillLaunchContext?: SkillLaunchContext;
  audioAttachments?: AudioAttachment[];
  snapshotImages?: string[];
  currentSnapshotIndex?: number;
  isNsfw?: boolean;
  userSkills?: ParsedSkill[];
  supabase?: any;
  userId?: string;
  currentDesign?: { code: string; width: number; height: number; props?: Record<string, unknown>; animation?: { fps: number; durationInSeconds: number; format?: string } };
  currentDesignPath?: string;
  history?: ModelMessage[];
  timelineVersion?: number;
  perf?: AgentPerf;
  abortSignal?: AbortSignal;
  execution?: DurableExecutionRef;
  attemptBudgetMs?: number;
  maxSteps?: number;
  contextCompactAtTokens?: number;
  historyBoundary?: string;
}

export async function* runMakaronAgent(
  prompt: string,
  currentImage: string,
  projectId: string,

  options?: RunMakaronAgentOptions,
): AsyncGenerator<AgentStreamEvent> {
  const perf = options?.perf;
  const runtime = createAgentModelRuntime(options?.agentModel, projectId);
  const ctx: AgentContext = {
    currentImage,
    referenceImages: options?.referenceImages,
    projectId,
    generatedImages: [],
    animationImageUrls: options?.animationImageUrls,
    videoModel: options?.videoModel as VideoModel | undefined,
    videoResolution: options?.videoResolution,
    videoAuto: options?.videoAuto,
    audioAttachments: options?.audioAttachments,
    preferredModel: options?.preferredModel,
    snapshotImages: (options?.snapshotImages ?? [currentImage]).filter(img => img.length > 0),
    currentSnapshotIndex: options?.currentSnapshotIndex ?? 0,
    isNsfw: options?.isNsfw,
    userSkills: options?.userSkills,
    supabase: options?.supabase,
    userId: options?.userId,
    timelineVersion: options?.timelineVersion,
    currentDesignPath: options?.currentDesignPath,
    execution: options?.execution,
  };
  if (options?.currentDesign) {
    (ctx as any).__lastDesignPayload = { ...options.currentDesign };
  }

  const allTools = wrapDurableIdempotentTools(createTools(ctx, runtime, options?.locale, Boolean(options?.execution)), ctx);
  if (!options?.execution) delete (allTools as Record<string, unknown>).execution_checkpoint;
  perf?.mark('agent_tools_created', { toolCount: Object.keys(allTools).length });
  let imagesSent = 0;
  let stepCount = 0;
  let toolCallStartTime = 0;
  let toolCallName = '';
  let activeToolCallId: string | undefined;
  const agentStartTime = Date.now();

  const analysisOnly = options?.analysisOnly ?? false;
  const isVideoAnalysis = options?.isVideoAnalysis ?? false;
  const tipReactionOnly = options?.tipReactionOnly ?? false;
  const configuredMaxSteps = Number.parseInt(process.env.AGENT_MAX_STEPS || '', 10);
  const normalMaxSteps = typeof options?.maxSteps === 'number' && Number.isFinite(options.maxSteps)
    ? Math.min(120, Math.max(1, Math.floor(options.maxSteps)))
    : Number.isFinite(configuredMaxSteps)
      ? Math.min(120, Math.max(30, configuredMaxSteps))
      : 60;
  const maxSteps = analysisOnly ? 2 : tipReactionOnly ? 1 : normalMaxSteps;
  const videoMediaIndex = isVideoAnalysis ? (options?.currentSnapshotIndex ?? 0) + 1 : 0;
  const analysisPrompt = isVideoAnalysis ? ANALYSIS_PROMPT_VIDEO_TEMPLATE(videoMediaIndex)
    : options?.analysisContext === 'post-edit' ? ANALYSIS_PROMPT_POSTEDIT : ANALYSIS_PROMPT_INITIAL;

  // Determine which tools to expose
  // tipReactionOnly: no tools (text-only response)
  // analysisOnly: only analyze_image or analyze_video (agent uses tool to see the content)
  // normal chat / animation: all tools including workspace (agent.md controls behavior)
  const tools = tipReactionOnly ? undefined : analysisOnly
    ? (isVideoAnalysis ? { analyze_video: allTools.analyze_video } : { analyze_image: allTools.analyze_image })
    : allTools;

  // Build user message content — animation mode includes all snapshot images as visual content
  const animImages = options?.animationImages;

  let userContent: any;
  if (animImages?.length && runtime.spec.supportsImageInput && !analysisOnly && !tipReactionOnly) {
    // Multi-image user message: text + all snapshot images
    userContent = [
      { type: 'text' as const, text: prompt },
      ...animImages.map((img: string) =>
        img.startsWith('data:')
          ? { type: 'image' as const, image: img }
          : { type: 'image' as const, image: new URL(img) }
      ),
    ];
  } else {
    // Inject only the pointer/metadata, never full composition code. The agent
    // must pass code_path explicitly in run_code patch mode for persisted compositions.
    const promptHasCompositionPointer = typeof prompt === 'string'
      && (prompt.includes('[Current Composition]') || prompt.includes('[Current composition pointer]'));
    const designInjection = options?.currentDesignPath && !promptHasCompositionPointer
      ? `[Current composition pointer]\npath: ${options.currentDesignPath}${options.currentDesign ? `\nwidth: ${options.currentDesign.width}\nheight: ${options.currentDesign.height}${options.currentDesign.animation ? `\nanimation: ${options.currentDesign.animation.durationInSeconds}s @ ${options.currentDesign.animation.fps}fps` : ''}` : ''}\nTo modify this existing composition, call run_code with a JS return value like { type: 'patch', code_path: '${options.currentDesignPath}', edits: [...] } or { type: 'patch', code_path: '${options.currentDesignPath}', props: {...} } and runtime: "composition". Use props-only patches for text/data changes. Do not render from scratch unless the user asks for a new composition.\n\n`
      : '';
    const textOnlyVisionNote = animImages?.length && !runtime.spec.supportsImageInput
      ? '\n\n[Selected Agent model is text-only. Use analyze_image on the relevant Media Index entries before making image-dependent decisions.]'
      : '';
    userContent = analysisOnly ? analysisPrompt : (designInjection + prompt + textOnlyVisionNote);
  }

  // Build system prompt. Lightweight modes must stay small: they power
  // auto-analysis/reactions where first visible text matters more than the
  // full workspace skill surface.
  const endSystemPrompt = perf?.span('build_system_prompt', {
    projectId,
    userSkills: options?.userSkills?.length ?? 0,
    mode: tipReactionOnly ? 'tipReaction' : analysisOnly ? 'analysis' : 'normal',
  });
  const baseSystemPrompt = (analysisOnly || tipReactionOnly)
    ? buildLightweightSystemPrompt(analysisOnly ? 'analysis' : 'tipReaction', options?.locale)
    : await buildSystemPrompt(options?.userSkills, options?.supabase, options?.userId, projectId);
  const durableExecutionDirective = options?.execution
    ? `\n\n## Durable execution contract\nThis is attempt ${options.execution.attemptNo} of execution ${options.execution.runId}, work unit ${options.execution.workUnitKey}. The execution may continue in a fresh model context. Preserve decisions and durable artifact pointers by calling execution_checkpoint after each meaningful work unit and before a long, risky generation step. Produce the first durable mutation within 90 seconds when the work unit is composition/code. If this attempt advances a Studio Run into Composition, immediately switch to numbered composition parts even when this work unit started in an earlier stage; never begin a monolithic run_code payload. Do not repeat expensive side effects whose tool result is already present. A handoff is progress, not failure.`
    : '';
  const durableCompositionDirective = options?.execution?.workUnitKey === 'studio:composition'
    ? `\n\n## Durable Composition workspace\nKeep the full original Composition and Director creative standard, but do not emit a monolithic run_code composition payload in this work unit. Long tool-input streams can reset before the call closes. Author the final Remotion source as numbered files under ${projectId}/drafts/composition-parts, one cohesive part per model step with write_file. Include compositionMetadata with the first part so dimensions, props, editables, and animation are durable; only repeat it when metadata changes. Keep each part under the 12000-character transport limit, wait for its tool result, and create as many parts as the approved content needs. Parts around 3000-8000 characters are preferred, but never compress creative detail merely to hit that range. Rewriting the same numbered path is safe after recovery. Do not use import/export; the files are concatenated into one scope with no aggregate source-size or part-count limit. Never shorten approved narration, subtitles, scenes, animation, or visual detail to reduce source size. Every successful write automatically assembles, validates, and autosaves the workspace. Continue until write_file reports compositionWorkspace.status="ready", then preview or patch its designPath directly. Do not spend another model turn calling run_code merely to assemble the directory. This changes only persistence and transport; it must not simplify the approved story, audio, visual direction, or ending.`
    : '';
  const durableCompositionGuidance = options?.execution?.workUnitKey === 'studio:composition'
    ? buildDurableCompositionGuidance()
    : '';
  const executionSystemPrompt = `${baseSystemPrompt}${durableExecutionDirective}${durableCompositionDirective}${durableCompositionGuidance}`;
  const languageDirective = buildAgentOutputLanguageDirective(options?.locale);
  const skillLaunchDirective = getSkillLaunchSystemDirective(options?.skillLaunchContext);
  const systemPrompt = `${executionSystemPrompt}${languageDirective}${skillLaunchDirective}`;
  const responseLocale = normalizeLocale(options?.locale, 'en');
  endSystemPrompt?.({ systemChars: systemPrompt.length });

  // Observability — per-request summary
  const toolsChars = tools ? logToolSizes(tools as Record<string, unknown>) : 0;
  const userContentChars = typeof userContent === 'string'
    ? userContent.length
    : Array.isArray(userContent)
      ? userContent.reduce((s: number, p: { type?: string; text?: string }) => s + (p?.type === 'text' ? (p.text?.length ?? 0) : 0), 0)
      : 0;
  const userImagesCount = Array.isArray(userContent)
    ? userContent.filter((p: { type?: string }) => p?.type === 'image').length
    : 0;
  // analysis / tipReaction modes intentionally skip history to keep
  // the request single-turn (matches prior behavior). Normal chat and video
  // requests send it so read_file/tool results can be reused cross-turn.
  const sendHistory = !analysisOnly && !tipReactionOnly;
  const history = sendHistory ? (options?.history ?? []) : [];
  console.log(
    `[agent-req] systemChars=${systemPrompt.length} toolsChars=${toolsChars} userChars=${userContentChars} images=${userImagesCount} historyTurns=${history.length} mode=${tipReactionOnly ? 'tipReaction' : analysisOnly ? 'analysis' : 'normal'}`
  );
  perf?.mark('agent_request_ready', {
    systemChars: systemPrompt.length,
    toolsChars,
    userChars: userContentChars,
    userImages: userImagesCount,
    historyTurns: history.length,
    mode: tipReactionOnly ? 'tipReaction' : analysisOnly ? 'analysis' : 'normal',
    agentModel: runtime.spec.id,
    provider: runtime.spec.provider,
  });

  // Optional full-request dump for offline diffing
  if (process.env.AGENT_DEBUG_DUMP === '1') {
    try {
      const fs = await import('fs/promises');
      const os = await import('os');
      const path = await import('path');
      const ts = Date.now();
      const dumpPath = path.join(os.tmpdir(), `agent-req-${ts}.json`);
      const toolsDump = tools
        ? Object.fromEntries(Object.entries(tools).map(([k, v]: [string, unknown]) => [k, { description: (v as { description?: string })?.description || '' }]))
        : {};
      const userContentDump = typeof userContent === 'string'
        ? userContent
        : Array.isArray(userContent)
          ? userContent.map((p: { type?: string; text?: string }) => p?.type === 'image' ? { type: 'image', omitted: true } : p)
          : userContent;
      await fs.writeFile(dumpPath, JSON.stringify({
        ts, mode: tipReactionOnly ? 'tipReaction' : analysisOnly ? 'analysis' : 'normal',
        systemPrompt, tools: toolsDump, history, userContent: userContentDump,
      }, null, 2));
      console.log(`[agent-req] dumped → ${dumpPath}`);
    } catch (e) { console.log(`[agent-req] dump failed: ${e instanceof Error ? e.message : String(e)}`); }
  }

  let firstContentAt = 0;

  const msgs: ModelMessage[] = [
    ...history,
    { role: 'user', content: userContent } as ModelMessage,
  ];

  try {
    const configuredIdleTimeout = Number(process.env.AGENT_MODEL_IDLE_TIMEOUT_MS || 300_000);
    const streamIdleTimeoutMs = Number.isFinite(configuredIdleTimeout)
      ? Math.max(30_000, Math.min(configuredIdleTimeout, 600_000))
      : 300_000;
    const attemptResults: any[] = [];
    let billedNoCacheTokens = 0;
    let billedCacheReadTokens = 0;
    let billedCacheWriteTokens = 0;
    let billedOutputTokens = 0;
    let cacheWriteTelemetryComplete = true;
    const billedStepMetadata: Array<{ providerMetadata?: Record<string, unknown> }> = [];
    let usageEmitted = false;
    const compactionBlocks = new Map<string, string>();
    const pendingCompactionSummaries: string[] = [];
    let attemptMessages: ModelMessage[] = msgs;
    let result: any = null;
    let recoveryAttempt = 0;
    let recoveryTextOnly = false;
    let skillVideoVisibleText = '';
    let skillVideoSubmissionStarted = false;
    let studioRunTouchedThisTurn = false;
    let runCodeStartedThisTurn = false;
    const executionAttemptWorkUnit = options?.execution?.workUnitKey;
    const studioRunRecoveryPrompt = prompt.includes('[System automatic recovery]')
      || prompt.includes('[Recoverable Agent Checkpoint]');
    const requiresMaterializedVideo = requestsMaterializedVideo(prompt);
    const recoveryBlockedTools = new Set<string>();
    const nonRepeatableTools = new Set([
      'generate_image',
      'generate_animation',
      'transcribe_audio',
      'rotate_camera',
      'delete_file',
      'generate_voiceover',
      'generate_audio',
      'generate_music',
      'prepare_visual_asset',
    ]);

    const recordStepUsage = (event: any) => {
      const usage = event?.usage as {
        inputTokens?: number;
        outputTokens?: number;
        cachedInputTokens?: number;
        inputTokenDetails?: {
          noCacheTokens?: number;
          cacheReadTokens?: number;
          cacheWriteTokens?: number;
        };
      } | undefined;
      if (!usage) return;
      const details = usage.inputTokenDetails;
      const cacheRead = details?.cacheReadTokens ?? usage.cachedInputTokens ?? 0;
      const cacheWrite = details?.cacheWriteTokens ?? 0;
      if (details?.cacheWriteTokens == null) cacheWriteTelemetryComplete = false;
      const noCache = details?.noCacheTokens
        ?? Math.max(0, (usage.inputTokens ?? 0) - cacheRead - cacheWrite);
      billedNoCacheTokens += noCache;
      billedCacheReadTokens += cacheRead;
      billedCacheWriteTokens += cacheWrite;
      billedOutputTokens += usage.outputTokens ?? 0;
      billedStepMetadata.push({ providerMetadata: event.providerMetadata });
    };

    const buildUsageEvent = (): Extract<AgentStreamEvent, { type: 'usage' }> | null => {
      if (usageEmitted || billedStepMetadata.length === 0) return null;
      usageEmitted = true;
      const modelId = runtime.spec.billingModelId;
      const totalInput = billedNoCacheTokens + billedCacheReadTokens + billedCacheWriteTokens;
      const hitRate = totalInput > 0
        ? ((billedCacheReadTokens / totalInput) * 100).toFixed(1)
        : '0';
      const providerCostUsd = sumOpenRouterProviderCost(runtime, billedStepMetadata);
      const cacheWriteLog = cacheWriteTelemetryComplete
        ? String(billedCacheWriteTokens)
        : 'unreported';
      console.log(
        `[agent-usage] totalInput=${totalInput} (noCache=${billedNoCacheTokens} cacheRead=${billedCacheReadTokens} cacheWrite=${cacheWriteLog}) output=${billedOutputTokens} hitRate=${hitRate}% model=${modelId} provider=${runtime.spec.provider}${providerCostUsd != null ? ` providerCostUsd=${providerCostUsd.toFixed(6)}` : ''}`
      );
      return {
        type: 'usage',
        inputTokens: billedNoCacheTokens,
        outputTokens: billedOutputTokens,
        cacheReadTokens: billedCacheReadTokens,
        cacheWriteTokens: billedCacheWriteTokens,
        cacheWriteTelemetryComplete,
        providerCostUsd,
        model: modelId,
      };
    };

    while (true) {
      let sawFinish = false;
      let finishReason: string | undefined;
      let rawFinishReason: string | undefined;
      let finalStepTextChars = 0;
      let finalStepToolCalls = 0;
      let finalStepDeliveredArtifact = false;
      let attemptDeliveredArtifact = false;
      const attemptCommittedTools = new Set<string>();
      let durableStageHandoff: { code: 'studio_stage_handoff'; detail: string } | undefined;
      let durableStudioCompletion: { detail: string } | undefined;
      let nonRetryableToolFailure: { message: string; code?: string } | undefined;
      let streamError: unknown;
      let lastTool = '';

      const endStreamInit = perf?.span('model_stream_init', { projectId, recoveryAttempt });
      const invocationBudgetMs = typeof options?.attemptBudgetMs === 'number' && Number.isFinite(options.attemptBudgetMs)
        ? Math.max(60_000, Math.min(options.attemptBudgetMs, 1_500_000))
        : 1_500_000;
      const invocationDeadline = agentStartTime + invocationBudgetMs;
      let attemptBudgetReached = false;
      const recoveryActiveTools = tools && recoveryBlockedTools.size > 0
        ? Object.keys(tools).filter((toolName) => !recoveryBlockedTools.has(toolName))
        : undefined;
      result = (streamText as any)({
      model: runtime.model,
      system: [{
        role: 'system',
        content: systemPrompt,
      }],
      messages: attemptMessages,
      ...(tools ? { tools } : {}),
      ...((recoveryTextOnly || options?.disableToolCalls) && tools
        ? { toolChoice: 'none' as const }
        : {}),
      ...(analysisOnly && tools
        ? { activeTools: [isVideoAnalysis ? 'analyze_video' : 'analyze_image'] }
        : recoveryActiveTools
          ? { activeTools: recoveryActiveTools }
          : {}),
      stopWhen: [
        stepCountIs(maxSteps),
        ({ steps }: { steps: Array<{ toolResults?: Array<{ toolName?: string; output?: unknown }> }> }) => {
          return shouldStopAfterStudioToolStep({
            durableExecution: Boolean(ctx.execution),
            attemptWorkUnit: executionAttemptWorkUnit,
            toolResults: steps.at(-1)?.toolResults,
          }) || shouldStopAfterDurablePublishToolStep({
            durableExecution: Boolean(ctx.execution),
            requiresMaterializedVideo,
            toolResults: steps.at(-1)?.toolResults,
          }) || shouldStopAfterTerminalToolFailure({
            toolResults: steps.at(-1)?.toolResults,
          });
        },
        // The attempt budget is a handoff boundary, not a kill timer. AI SDK
        // evaluates stop conditions only after a complete model/tool step, so
        // active tool arguments and tool results stay paired and recoverable.
        () => {
          if (!options?.execution || Date.now() < invocationDeadline) return false;
          attemptBudgetReached = true;
          return true;
        },
      ],
      prepareStep: ({ messages }: { messages: ModelMessage[] }) => ({
        messages: runtime.normalizeMessages(messages),
      }),
      onStepFinish: () => { stepCount++; },
      // Durable execution owns retry, failover, and checkpoint semantics. Letting
      // the SDK retry internally turns one timed-out model call into several
      // invisible calls before the runner can switch providers.
      ...(options?.execution ? { maxRetries: 0 } : {}),
      // A long coding step may stream valid source for several minutes. Only
      // an actually idle model stream is timed out. Tool implementations own
      // their domain-specific timeouts; the attempt budget drains at a safe
      // step boundary above instead of aborting active work.
      timeout: {
        chunkMs: streamIdleTimeoutMs,
      },
      ...(options?.abortSignal ? { abortSignal: options.abortSignal } : {}),
      providerOptions: getAgentProviderOptions(runtime, {
        compactAtTokens: options?.contextCompactAtTokens,
      }),
      });
      attemptResults.push(result);
      endStreamInit?.();

    // Stream real source from code-bearing tool inputs and checkpoint it before
    // the tool call closes, so a transport reset cannot erase minutes of work.
    let codeExtractor: {
      toolName: 'run_code' | 'write_code_file' | 'write_file';
      valueKey: 'code' | 'content';
      toolCallId: string;
      targetPath?: string;
      buffer: string;
      state: 'waiting' | 'in_code' | 'done';
      decoded: string;
      lastSavedChars: number;
      lastProgressChars: number;
      descriptionSent: number;
      codeStreamStarted: boolean;
    } | null = null;
    let completedCodeTargetPath: string | undefined;
    const persistStreamedCodeCheckpoint = async (force = false) => {
      if (!codeExtractor || !ctx.supabase || !ctx.userId) return;
      const unsavedChars = codeExtractor.decoded.length - codeExtractor.lastSavedChars;
      if (unsavedChars <= 0 || (!force && unsavedChars < 1_000)) return;
      const targetSlug = `${codeExtractor.targetPath?.split('/').at(-1) || 'inline'}-${codeExtractor.toolCallId}`
        .replace(/[^a-zA-Z0-9.-]+/g, '-')
        .slice(0, 80);
      const partialPath = `${ctx.projectId}/drafts/streamed-${codeExtractor.toolName}-${targetSlug}.partial.js`;
      const saved = await workspace.writeFile(
        partialPath,
        codeExtractor.decoded,
        ctx.supabase,
        ctx.userId,
        'text/javascript',
      );
      if (saved.success) {
        codeExtractor.lastSavedChars = codeExtractor.decoded.length;
        (ctx as any).__streamedCodeCheckpoint = {
          streamedCodePath: partialPath,
          streamedCodeChars: codeExtractor.decoded.length,
          ...(codeExtractor.targetPath ? { streamedCodeTargetPath: codeExtractor.targetPath } : {}),
        } satisfies StreamedCodeCheckpoint;
      }
    };
    const textDeltaState = createTextDeltaState();

      try {
        for await (const event of result.fullStream) {
      if (event.type === 'start-step') {
        finalStepTextChars = 0;
        finalStepToolCalls = 0;
        finalStepDeliveredArtifact = false;
        if (stepCount > 0) yield { type: 'new_turn' };
        continue;
      }
      if (event.type === 'finish-step') {
        recordStepUsage(event);
        finishReason = (event as any).finishReason;
        rawFinishReason = (event as any).rawFinishReason;
        const usage = (event as any).usage as { inputTokens?: number } | undefined;
        const contextManagement = (event as any).providerMetadata?.anthropic?.contextManagement as {
          appliedEdits?: Array<Record<string, unknown>>;
        } | undefined;
        const appliedEdits = contextManagement?.appliedEdits ?? [];
        if (pendingCompactionSummaries.length || appliedEdits.length) {
          const summary = pendingCompactionSummaries.splice(0).join('\n\n');
          if (summary) {
            (ctx as any).__providerCompaction = {
              summary,
              appliedEdits,
              inputTokens: usage?.inputTokens,
            };
            yield {
              type: 'context_compaction',
              provider: 'anthropic',
              modelId: runtime.spec.id,
              compactedThrough: options?.historyBoundary,
              summary,
              appliedEdits,
              inputTokens: usage?.inputTokens,
            };
          }
        }
        if (durableStageHandoff || durableStudioCompletion) break;
        continue;
      }
      if (event.type === 'finish') {
        sawFinish = true;
        finishReason = (event as any).finishReason;
        rawFinishReason = (event as any).rawFinishReason;
        continue;
      }
      if (event.type === 'abort') {
        streamError = new Error((event as any).reason || 'Model stream aborted');
        continue;
      }
      // ── TTFB — log first stream event that indicates model is producing output ──
      if (!firstContentAt && (event.type === 'reasoning-start' || event.type === 'reasoning-delta' || event.type === 'text-delta' || event.type === 'tool-input-start')) {
        firstContentAt = Date.now();
        console.log(`[agent-ttfb] ${firstContentAt - agentStartTime}ms (first ${event.type})`);
        perf?.mark('model_first_output', { eventType: event.type, ttfbMs: firstContentAt - agentStartTime });
      }
      // ── Reasoning events — forward to CUI ──
      if (event.type === 'reasoning-start') {
        yield { type: 'reasoning_start' as const };
        continue;
      }
      if (event.type === 'reasoning-delta') {
        yield { type: 'reasoning' as const, text: (event as any).text || '' };
        continue;
      }
      if (event.type === 'reasoning-end') {
        yield { type: 'status' as const, text: translate(responseLocale, 'agent.status.planning') };
        continue;
      }

      if (event.type === 'custom' && (event as any).kind === 'openai.compaction') {
        const providerKey = runtime.spec.provider === 'azure-openai' ? 'azure' : 'openai';
        const metadata = (event as any).providerMetadata?.[providerKey] as {
          itemId?: string;
          encryptedContent?: string;
        } | undefined;
        if (metadata?.itemId && metadata.encryptedContent) {
          yield {
            type: 'context_compaction',
            provider: 'openai',
            modelId: runtime.spec.id,
            compactedThrough: options?.historyBoundary,
            item: {
              kind: 'openai.compaction',
              providerKey,
              itemId: metadata.itemId,
              encryptedContent: metadata.encryptedContent,
            },
          };
        }
        continue;
      }

      if (event.type === 'text-start') {
        const anthropic = (event as any).providerMetadata?.anthropic as { type?: string } | undefined;
        if (anthropic?.type === 'compaction') {
          compactionBlocks.set(String((event as any).id ?? 'compaction'), '');
        }
        continue;
      }

      if (event.type === 'text-end') {
        const id = String((event as any).id ?? 'compaction');
        const summary = compactionBlocks.get(id);
        if (summary !== undefined) {
          if (summary.trim()) pendingCompactionSummaries.push(summary);
          compactionBlocks.delete(id);
        }
        continue;
      }

      // ── Tool input streaming — expose and checkpoint real source code ──
      if (event.type === 'tool-input-start') {
        const toolName = (event as any).toolName ?? '';
        if (toolName) lastTool = toolName;
        if (toolName === 'run_code' || toolName === 'write_code_file' || toolName === 'write_file') {
          if (toolName !== 'write_file') runCodeStartedThisTurn = true;
          codeExtractor = {
            toolName,
            valueKey: toolName === 'run_code' ? 'code' : 'content',
            toolCallId: String((event as any).toolCallId || crypto.randomUUID()),
            buffer: '',
            state: 'waiting',
            decoded: '',
            lastSavedChars: 0,
            lastProgressChars: 0,
            descriptionSent: 0,
            codeStreamStarted: false,
          };
          if (toolName !== 'write_file') {
            yield { type: 'status' as const, text: translate(responseLocale, 'agent.status.generatingCode') };
          }
        }
        continue;
      }
      if (event.type === 'tool-input-delta') {
        if (!codeExtractor || codeExtractor.state === 'done') continue;
        const delta = (event as any).delta ?? '';
        codeExtractor.buffer += delta;

        if (codeExtractor.toolName === 'write_file' && !codeExtractor.targetPath) {
          const pathValue = readJsonStringValueFromBuffer(codeExtractor.buffer, 'path');
          if (!pathValue?.complete) continue;
          if (!pathValue.value.startsWith(compositionPartsPrefix(ctx.projectId))) {
            codeExtractor = null;
            continue;
          }
          codeExtractor.targetPath = pathValue.value;
          runCodeStartedThisTurn = true;
          const filename = pathValue.value.split('/').at(-1) || pathValue.value;
          yield {
            type: 'status' as const,
            text: responseLocale.startsWith('zh')
              ? `正在写 ${filename}`
              : `Writing ${filename}`,
          };
        }

        if (codeExtractor.toolName === 'write_code_file' && !codeExtractor.codeStreamStarted) {
          const description = readJsonStringValueFromBuffer(codeExtractor.buffer, 'description');
          const nextDescriptionChunk = description?.value.slice(codeExtractor.descriptionSent) ?? '';
          if (nextDescriptionChunk) {
            const prefix = codeExtractor.descriptionSent === 0 ? '\n\n' : '';
            codeExtractor.descriptionSent = description?.value.length ?? codeExtractor.descriptionSent;
            yield { type: 'content' as const, text: `${prefix}${nextDescriptionChunk}` };
          }
        }

        const streamedValue = readJsonStringValueFromBuffer(codeExtractor.buffer, codeExtractor.valueKey);
        if (!streamedValue) continue;
        codeExtractor.state = streamedValue.complete ? 'done' : 'in_code';
        const codeChunk = streamedValue.value.slice(codeExtractor.decoded.length);
        if (codeChunk) {
          codeExtractor.codeStreamStarted = true;
          codeExtractor.decoded = streamedValue.value;
          yield { type: 'code_stream', text: codeChunk };
          if (
            codeExtractor.toolName === 'write_file'
            && codeExtractor.decoded.length - codeExtractor.lastProgressChars >= 2_000
          ) {
            codeExtractor.lastProgressChars = codeExtractor.decoded.length;
            const filename = codeExtractor.targetPath?.split('/').at(-1) || 'composition source';
            yield {
              type: 'status' as const,
              text: responseLocale.startsWith('zh')
                ? `正在写 ${filename} · ${codeExtractor.decoded.length.toLocaleString()} 字符`
                : `Writing ${filename} · ${codeExtractor.decoded.length.toLocaleString()} chars`,
            };
          }
          await persistStreamedCodeCheckpoint();
        }
        if (codeExtractor.state === 'done') {
          yield { type: 'code_stream', text: '', done: true };
        }
        continue;
      }

      // ── Text delta ──────────────────────────────────────────────────────────
      if (event.type === 'text-delta') {
        const text = normalizeTextDelta(event as { delta?: unknown; textDelta?: unknown; text?: unknown }, textDeltaState);
        const textId = String((event as any).id ?? 'compaction');
        if (compactionBlocks.has(textId)) {
          compactionBlocks.set(textId, `${compactionBlocks.get(textId) || ''}${text}`);
          continue;
        }
        if (text) {
          skillVideoVisibleText += text;
          finalStepTextChars += text.trim().length;
          yield { type: 'content', text };
        }
        continue;
      }

      // ── Tool call ───────────────────────────────────────────────────────────
      if (event.type === 'tool-call') {
        toolCallStartTime = Date.now();
        toolCallName = event.toolName;
        lastTool = event.toolName;
        if (event.toolName === 'generate_animation') skillVideoSubmissionStarted = true;
        finalStepToolCalls++;
        activeToolCallId = (event as { toolCallId?: string }).toolCallId || crypto.randomUUID();
        console.log(`⏱️ [agent] tool-call "${event.toolName}" at +${((Date.now() - agentStartTime) / 1000).toFixed(1)}s`);
        perf?.mark('tool_call', {
          tool: event.toolName,
          step: stepCount,
          sinceAgentStartMs: Date.now() - agentStartTime,
        });
        if (event.toolName === 'analyze_image') {
          const q = (event.input as { question?: string }).question;
          yield { type: 'status', text: translate(responseLocale, 'agent.status.analyzingImage', q?.slice(0, 50) ?? '') };
        } else if (event.toolName === 'analyze_video') {
          const q = (event.input as { question?: string }).question;
          yield { type: 'status', text: translate(responseLocale, 'agent.status.analyzingVideo', q?.slice(0, 50) ?? '') };
        } else if (event.toolName === 'transcribe_audio') {
          yield { type: 'status', text: translate(responseLocale, 'agent.status.transcribingAudio') };
        } else if (event.toolName === 'list_voiceover_voices') {
          yield { type: 'status', text: translate(responseLocale, 'agent.status.choosingVoice') };
        } else if (event.toolName === 'generate_voiceover') {
          yield { type: 'status', text: translate(responseLocale, 'agent.status.generatingVoiceover') };
        } else if (event.toolName === 'generate_audio' || event.toolName === 'generate_music') {
          yield { type: 'status', text: translate(responseLocale, 'agent.status.generatingAudio') };
        } else if (event.toolName === 'preview_frame') {
          const input = event.input as { frame?: number; timestamp?: number; frames?: number[]; timestamps?: number[] };
          const batch = input.frames?.length ? input.frames.join(', ') : input.timestamps?.length ? input.timestamps.map(value => `${value}s`).join(', ') : '';
          const hint = batch || (input.frame !== undefined ? `frame ${input.frame}` : input.timestamp !== undefined ? `${input.timestamp}s` : 'frame 0');
          yield { type: 'status', text: translate(responseLocale, 'agent.status.capturingFrame', hint) };
        } else if (event.toolName === 'generate_image') {
          yield { type: 'status', text: translate(responseLocale, 'agent.status.generatingImage') };
        } else if (event.toolName === 'generate_animation') {
          yield { type: 'status', text: translate(responseLocale, 'status.submittingVideo') };
        } else if (event.toolName === 'list_files') {
          yield { type: 'status', text: translate(responseLocale, 'agent.status.browsingWorkspace') };
        } else if (event.toolName === 'read_file') {
          const p = (event.input as { path?: string }).path || '';
          yield { type: 'status', text: translate(responseLocale, 'agent.status.readingFile', p.split('/').pop() ?? '') };
        } else if (event.toolName === 'write_code_file') {
          yield { type: 'status', text: translate(responseLocale, 'agent.status.generatingCode') };
        } else if (event.toolName === 'write_file') {
          yield { type: 'status', text: translate(responseLocale, 'agent.status.saving') };
        } else if (event.toolName === 'delete_file') {
          yield { type: 'status', text: translate(responseLocale, 'agent.status.deleting') };
        } else if (event.toolName === 'run_code') {
          const desc = (event.input as { description?: string }).description;
          yield { type: 'status', text: translate(responseLocale, 'agent.status.runningCode', desc ?? '') };
        } else if (event.toolName === 'rotate_camera') {
          yield { type: 'status', text: translate(responseLocale, 'agent.status.rotatingCamera') };
        }
        let toolCallImages: string[] | undefined;
        if (event.toolName === 'generate_image') {
          const inp = event.input as { media_index?: number; reference_media_indices?: number[]; media_refs?: string[] };
          // Resolve the actual edit target (respects media_index; omit = text-to-image)
          let displayTarget: string | undefined;
          if (inp.media_index !== undefined) {
            const idx = inp.media_index - 1;
            if (idx >= 0 && idx < ctx.snapshotImages.length) {
              displayTarget = ctx.snapshotImages[idx];
            }
          } else if (ctx.currentImage && !ctx.snapshotImages.includes(ctx.currentImage)) {
            displayTarget = ctx.currentImage;
          }
          // Resolve reference images from snapshot indices
          const snapshotRefs: string[] = [];
          if (inp.reference_media_indices?.length) {
            for (const refIdx of inp.reference_media_indices) {
              const idx = refIdx - 1;
              if (idx >= 0 && idx < ctx.snapshotImages.length) {
                snapshotRefs.push(ctx.snapshotImages[idx]);
              }
            }
          }
          const extraRefs: string[] = [];
          if (inp.media_refs?.length) extraRefs.push(...inp.media_refs);
          if (displayTarget || extraRefs.length) {
            toolCallImages = [
              ...(displayTarget ? [displayTarget] : []),
              ...(ctx.referenceImages ?? []),
              ...snapshotRefs,
            ];
          }
        }
        // For run_code: keep the real input for persistence/model history, but send a
        // compact display input to the client. Replaying a UI-truncated code string
        // teaches the next model turn to copy "... (N chars)" as executable code.
        const toolInput = event.input as Record<string, unknown>;
        const directComposition = toolInput.composition && typeof toolInput.composition === 'object'
          ? toolInput.composition as Record<string, unknown>
          : undefined;
        const streamedCode = typeof toolInput.code === 'string'
          ? toolInput.code
          : typeof directComposition?.code === 'string'
            ? directComposition.code
            : undefined;
        const isRunCode = event.toolName === 'run_code' && typeof streamedCode === 'string';
        const isWriteCodeFile = event.toolName === 'write_code_file' && typeof toolInput.content === 'string';
        const isCompositionPartWrite = event.toolName === 'write_file'
          && typeof toolInput.path === 'string'
          && toolInput.path.startsWith(compositionPartsPrefix(ctx.projectId))
          && typeof toolInput.content === 'string';
        if (isCompositionPartWrite) runCodeStartedThisTurn = true;
        if (
          isWriteCodeFile
          && (!codeExtractor || codeExtractor.descriptionSent === 0)
          && typeof toolInput.description === 'string'
          && toolInput.description.trim()
        ) {
          yield { type: 'content' as const, text: `\n\n${toolInput.description.trim()}` };
        }
        const displayInput = isRunCode
          ? directComposition
            ? { ...toolInput, composition: { ...directComposition, code: `[code streamed separately: ${streamedCode.length} chars]` } }
            : { ...toolInput, code: `[code streamed separately: ${streamedCode.length} chars]` }
          : isWriteCodeFile
            ? { ...toolInput, content: `[code streamed separately: ${(toolInput.content as string).length} chars]` }
          : isCompositionPartWrite
            ? { ...toolInput, content: `[code streamed separately: ${(toolInput.content as string).length} chars]` }
          : toolInput;
        yield {
          type: 'tool_call',
          tool: event.toolName,
          toolCallId: activeToolCallId,
          step: stepCount,
          input: toolInput,
          ...(displayInput !== toolInput ? { displayInput } : {}),
          ...(toolCallImages ? { images: toolCallImages } : {}),
        };
        // If code wasn't streamed via delta (edge case), send it now
        if ((isRunCode || isWriteCodeFile || isCompositionPartWrite) && (!codeExtractor || codeExtractor.state === 'waiting')) {
          const code = String(isWriteCodeFile || isCompositionPartWrite ? toolInput.content : streamedCode);
          const CHUNK = 500;
          for (let i = 0; i < code.length; i += CHUNK) {
            yield { type: 'code_stream', text: code.slice(i, i + CHUNK) };
          }
          yield { type: 'code_stream', text: '', done: true };
        }
        completedCodeTargetPath = codeExtractor?.targetPath;
        codeExtractor = null; // reset for next tool call
        continue;
      }

      // ── Tool result — flush generated images + animation task ───────────────
      if (event.type === 'tool-result') {

        const toolName = (event as any).toolName as string | undefined;
        const toolCallId = ((event as any).toolCallId as string | undefined) || activeToolCallId;
        const toolOutput = ((event as any).output ?? (event as any).result) as unknown;
        const toolDuration = toolCallStartTime ? ((Date.now() - toolCallStartTime) / 1000).toFixed(1) : '?';
        console.log(`⏱️ [agent] tool-result "${toolName}" at +${((Date.now() - agentStartTime) / 1000).toFixed(1)}s (tool took ${toolDuration}s)`);
        perf?.mark('tool_result', {
          tool: toolName || toolCallName || null,
          step: stepCount,
          sinceAgentStartMs: Date.now() - agentStartTime,
          toolDurationMs: toolCallStartTime ? Date.now() - toolCallStartTime : null,
        });
        // Reset status after tool completes so stale status doesn't linger during thinking
        yield { type: 'status', text: translate(responseLocale, 'agent.status.thinking') };
        if (toolName) {
          yield { type: 'tool_result', tool: toolName, toolCallId, step: stepCount, output: toolOutput };
          const outputRecord = toolOutput && typeof toolOutput === 'object'
            ? toolOutput as Record<string, unknown>
            : undefined;
          const toolSucceeded = outputRecord?.success !== false
            && outputRecord?.status !== 'failed'
            && !(outputRecord?.error && outputRecord?.success !== true);
          if (!toolSucceeded && outputRecord?.terminal === true) {
            const rawMessage = typeof outputRecord.message === 'string'
              ? outputRecord.message
              : typeof outputRecord.error === 'string'
                ? outputRecord.error
                : 'The tool rejected the current input.';
            const localized = outputRecord.userMessage && typeof outputRecord.userMessage === 'object'
              ? outputRecord.userMessage as Record<string, unknown>
              : undefined;
            const localizedMessage = responseLocale.startsWith('zh')
              ? localized?.zh
              : localized?.en;
            const userFacingMessage = typeof localizedMessage === 'string' && localizedMessage.trim()
              ? localizedMessage
              : rawMessage;
            nonRetryableToolFailure = {
              message: rawMessage,
              code: typeof outputRecord.errorCode === 'string' ? outputRecord.errorCode : undefined,
            };
            finalStepTextChars += userFacingMessage.trim().length;
            yield { type: 'content', text: `\n\n${userFacingMessage}` };
          }
          if (completedCodeTargetPath && toolName === 'write_file') {
            const savedPath = typeof outputRecord?.path === 'string' ? outputRecord.path : undefined;
            if (toolSucceeded && (!savedPath || savedPath === completedCodeTargetPath)) {
              (ctx as any).__streamedCodeCheckpoint = undefined;
            }
            completedCodeTargetPath = undefined;
          }
          const compositionWorkspace = outputRecord?.compositionWorkspace && typeof outputRecord.compositionWorkspace === 'object'
            ? outputRecord.compositionWorkspace as Record<string, unknown>
            : undefined;
          if (toolName === 'write_file' && compositionWorkspace) {
            const status = compositionWorkspace.status;
            const partCount = Number(compositionWorkspace.partCount || 0);
            const totalChars = Number(compositionWorkspace.totalChars || 0);
            const diagnostics = Array.isArray(compositionWorkspace.diagnostics)
              ? compositionWorkspace.diagnostics.length
              : 0;
            yield {
              type: 'status',
              text: status === 'ready'
                ? responseLocale.startsWith('zh')
                  ? `Composition 已自动组装并保存 · ${partCount} 个文件 · ${totalChars.toLocaleString()} 字符`
                  : `Composition compiled and autosaved · ${partCount} files · ${totalChars.toLocaleString()} chars`
                : status === 'invalid'
                  ? responseLocale.startsWith('zh')
                    ? `源码已保存，编译发现 ${diagnostics} 个待修复问题`
                    : `Source saved; compilation found ${diagnostics} issue${diagnostics === 1 ? '' : 's'}`
                  : responseLocale.startsWith('zh')
                    ? `源码已保存 · 当前 ${partCount} 个文件`
                    : `Source saved · ${partCount} file${partCount === 1 ? '' : 's'}`,
            };
          }
          if (toolSucceeded && toolName === 'studio_run') {
            studioRunTouchedThisTurn = true;
            const studioSummary = outputRecord?.studioRun && typeof outputRecord.studioRun === 'object'
              ? outputRecord.studioRun as Record<string, unknown>
              : undefined;
            if (ctx.execution && typeof studioSummary?.currentStage === 'string') {
              ctx.execution.workUnitKey = `studio:${studioSummary.currentStage}`;
            }
            if (
              studioSummary?.currentStage === 'composition'
              && ctx.supabase
              && ctx.userId
            ) {
              try {
                const { ensureStudioCompositionScaffold } = await import('./studio-composition-scaffold');
                const scaffold = await ensureStudioCompositionScaffold({
                  projectId: ctx.projectId,
                  userId: ctx.userId,
                  supabase: ctx.supabase,
                });
                if (scaffold.path) (ctx as any).__lastSavedDraftPath = scaffold.path;
                if (ctx.execution) {
                  await ctx.supabase.from('agent_runs').update({ current_work_unit: 'studio:composition' })
                    .eq('id', ctx.execution.runId)
                    .eq('status', 'running');
                }
                if (scaffold.created) {
                  yield {
                    type: 'status',
                    text: options?.locale === 'en'
                      ? `Composition scaffold saved in ${scaffold.elapsedMs}ms; applying Director craft...`
                      : `Composition 结构骨架已在 ${scaffold.elapsedMs}ms 内保存，正在继续完成导演级画面...`,
                  };
                }
              } catch (scaffoldError) {
                console.error('[agent-execution] composition scaffold failed:', scaffoldError);
              }
            }
            if (shouldHandoffToStudioComposition({
              durableExecution: Boolean(ctx.execution),
              attemptWorkUnit: executionAttemptWorkUnit,
              currentStage: typeof studioSummary?.currentStage === 'string'
                ? studioSummary.currentStage
                : undefined,
            })) {
              durableStageHandoff = {
                code: 'studio_stage_handoff',
                detail: 'Composition is ready to continue in a dedicated durable attempt.',
              };
            }
            if (shouldCompleteDurableStudioRun({
              durableExecution: Boolean(ctx.execution),
              status: typeof studioSummary?.status === 'string' ? studioSummary.status : undefined,
              currentStage: typeof studioSummary?.currentStage === 'string'
                ? studioSummary.currentStage
                : null,
            })) {
              durableStudioCompletion = {
                detail: 'Studio Run completed and all delivery artifacts were persisted.',
              };
              finalStepDeliveredArtifact = true;
              attemptDeliveredArtifact = true;
              yield {
                type: 'content',
                text: options?.locale === 'en'
                  ? 'Studio Run complete. The final video, editable source, and review evidence are archived.'
                  : 'Studio Run 已完成，最终视频、可编辑源和验收记录均已归档。',
              };
            }
          }
          if (toolSucceeded && nonRepeatableTools.has(toolName)) {
            attemptCommittedTools.add(toolName);
          }
          const generatedAudioLine = formatGeneratedAudioForCui(toolName, toolOutput, responseLocale);
          if (generatedAudioLine) {
            yield { type: 'content', text: generatedAudioLine };
          }
        }
        activeToolCallId = undefined;

        // Emit image_analyzed event so frontend can save the description
        if (toolName === 'analyze_image' || toolName === 'analyze_video') {

          const analyzeInput = (event as any).input as { media_index?: number; media_indices?: number[] } | undefined;
          const analyzedIndices = analyzeInput?.media_indices?.length
            ? analyzeInput.media_indices
            : [analyzeInput?.media_index ?? (ctx.currentSnapshotIndex + 1)];
          for (const analyzedIdx of analyzedIndices) {
            yield { type: 'image_analyzed', imageIndex: analyzedIdx };
          }
        }

        // Emit preview_frame_captured so frontend shows the screenshot in CUI
        if (toolName === 'preview_frame') {

          const toolOutput = (event as any).output as { workspaceUrl?: string } | undefined;
          const wsUrl = toolOutput?.workspaceUrl;
          if (wsUrl) {
            yield { type: 'preview_frame_captured' as const, workspaceUrl: wsUrl };
          }
        }

        // run_code / write_file output handling — emit design SSE with published flag
        if (toolName === 'run_code' || toolName === 'write_file') {
          // Design output stored in ctx.__pendingDesign → emit as SSE event
          const pendingDesign = (ctx as any).__pendingDesign;
          if (pendingDesign) {
            const published = (ctx as any).__pendingDesignPublished ?? false;
            // Get preview URL from latest draft (if available)
            const drafts = (ctx as any).__runCodeDrafts as { previewUrl?: string }[] | undefined;
            const previewUrl = drafts?.[drafts.length - 1]?.previewUrl || undefined;
            console.log(`🎨 [agent] emitting render SSE (published=${published}): ${pendingDesign.width}x${pendingDesign.height}, code ${pendingDesign.code?.length} chars${previewUrl ? ', preview: ' + previewUrl.slice(-40) : ''}`);
            yield { type: 'render', code: pendingDesign.code, width: pendingDesign.width, height: pendingDesign.height, props: pendingDesign.props, animation: pendingDesign.animation, editables: pendingDesign.editables, published, previewUrl };
            if (published) {
              finalStepDeliveredArtifact = true;
              attemptDeliveredArtifact = true;
            }
            (ctx as any).__pendingDesign = null;
            (ctx as any).__pendingDesignPublished = undefined;
          } else if (toolName === 'run_code') {
            console.log(`🔍 [agent] run_code result: no __pendingDesign found`);
          }
          // Image output (from toModelOutput won't have base64Data here, but pushImage in execute already handled it)
        }

        // Detect generate_image failure or NSFW content block
        if (toolName === 'generate_image') {

          const toolResult = (event as any).result as { contentBlocked?: boolean } | undefined;
          if (toolResult?.contentBlocked) {
            yield { type: 'nsfw_detected' };
          }
          if (imagesSent === ctx.generatedImages.length) {
            yield { type: 'status', text: translate(responseLocale, 'agent.status.imageGenerationFailed') };
          }
        }

        while (imagesSent < ctx.generatedImages.length) {
          yield { type: 'image', image: ctx.generatedImages[imagesSent], usedModel: ctx.lastUsedModel };
          finalStepDeliveredArtifact = true;
          attemptDeliveredArtifact = true;
          imagesSent++;
        }
        const hadPendingImageSnapshots = Boolean(ctx.pendingImageSnapshots?.length);
        yield* flushPendingImageSnapshots(ctx);
        if (hadPendingImageSnapshots) {
          finalStepDeliveredArtifact = true;
          attemptDeliveredArtifact = true;
        }
        if (ctx.animationTaskId) {
          yield { type: 'animation_task', taskId: ctx.animationTaskId, prompt: ctx.animationPrompt || '', imageUrls: ctx.animationImageUrls_, model: ctx.animationModel };
          finalStepDeliveredArtifact = true;
          attemptDeliveredArtifact = true;
          ctx.animationTaskId = undefined;
          ctx.animationPrompt = undefined;
          ctx.animationImageUrls_ = undefined;
          ctx.animationModel = undefined;
        }
        if (ctx.pendingVideoSnapshots?.length) {
          for (const pending of ctx.pendingVideoSnapshots) {
            yield { type: 'video_snapshot', ...pending };
            finalStepDeliveredArtifact = true;
            attemptDeliveredArtifact = true;
          }
          ctx.pendingVideoSnapshots = undefined;
        }
        if (ctx.pendingVideoSnapshot) {
          yield { type: 'video_snapshot', ...ctx.pendingVideoSnapshot };
          finalStepDeliveredArtifact = true;
          attemptDeliveredArtifact = true;
          ctx.pendingVideoSnapshot = undefined;
        }
        if ((ctx as any).musicTaskId) {
          yield { type: 'music_task', taskId: (ctx as any).musicTaskId };
          finalStepDeliveredArtifact = true;
          attemptDeliveredArtifact = true;
          (ctx as any).musicTaskId = undefined;
        }
        continue;
      }

      // ── Error from stream ──────────────────────────────────────────────────
      if (event.type === 'error') {
        streamError = (event as any).error;
        console.error(`[agent-stream] provider error: ${describeModelStreamError(streamError)}`);
        // AI SDK emits finish-step (with usage) and finish(error) after the
        // error part. Drain the stream so failed reasoning is still billed and
        // the terminal classification sees the real provider finish reason.
        continue;
      }

        }
      } catch (err) {
        streamError = err;
        console.error(`[agent-stream] stream iteration failed: ${describeModelStreamError(streamError)}`);
      }

      if (streamError) await persistStreamedCodeCheckpoint(true);

      let assessment = nonRetryableToolFailure
        ? {
            ok: true,
            retryable: false,
            code: 'non_retryable_tool_failure' as const,
            detail: nonRetryableToolFailure.message,
          }
        : durableStudioCompletion
        ? {
            ok: true,
            retryable: false,
            detail: durableStudioCompletion.detail,
          }
        : durableStageHandoff
          ? {
              ok: false,
              retryable: true,
              code: durableStageHandoff.code,
              detail: durableStageHandoff.detail,
            }
          : classifyModelTermination({
              sawFinish,
              finishReason,
              rawFinishReason,
              finalStepTextChars,
              finalStepToolCalls,
              finalStepDeliveredArtifact,
              streamError,
            });

      if (
        attemptBudgetReached
        && !durableStageHandoff
        && !durableStudioCompletion
        && !finalStepDeliveredArtifact
      ) {
        assessment = {
          ok: false,
          retryable: true,
          code: 'attempt_budget_handoff',
          detail: `Attempt budget reached after a complete step (${invocationBudgetMs}ms); continuing from durable workspace state`,
        };
      }

      if (assessment.ok) {
        const activeStudioCheckpoint = await getStudioRunCheckpoint(ctx);
        if (shouldContinueActiveStudioRun({
          activeStudioRun: Boolean(activeStudioCheckpoint.studioRunId),
          studioRunTouched: studioRunTouchedThisTurn,
          runCodeStarted: runCodeStartedThisTurn,
          recoveryPrompt: studioRunRecoveryPrompt,
          attemptWorkUnit: executionAttemptWorkUnit,
        })) {
          assessment = {
            ok: false,
            retryable: true,
            code: 'studio_run_incomplete',
            detail: `Studio Run ${activeStudioCheckpoint.studioRunId} is still running at ${activeStudioCheckpoint.studioRunStage}`,
          };
        }
      }

      if (assessment.ok && shouldContinueSkillVideoSubmission({
        context: options?.skillLaunchContext,
        visibleText: skillVideoVisibleText,
        submissionStarted: skillVideoSubmissionStarted,
      })) {
        assessment = {
          ok: false,
          retryable: true,
          code: 'skill_video_submission_pending',
          detail: 'The visible Skill video script is ready, but video rendering has not been submitted yet.',
        };
      }

      if (options?.abortSignal?.aborted) {
        const usageEvent = buildUsageEvent();
        if (usageEvent) yield usageEvent;
        return;
      }

      if (assessment.ok) break;

      let attemptSteps: any[] = [];
      try { attemptSteps = await result.steps; } catch { /* stream may have failed before a complete step */ }
      const canRecover = assessment.retryable
        && !durableStageHandoff
        && !options?.execution
        && recoveryAttempt < 1
        && Date.now() - agentStartTime < 600_000;
      if (canRecover) {
        const studioCheckpoint = await getStudioRunCheckpoint(ctx);
        const textOnlyRecovery = shouldUseTextOnlyRecovery({
          deliveredArtifact: attemptDeliveredArtifact,
          activeStudioRun: Boolean(studioCheckpoint.studioRunId),
        });
        recoveryAttempt++;
        recoveryTextOnly = textOnlyRecovery;
        for (const toolName of attemptCommittedTools) recoveryBlockedTools.add(toolName);
        const responseMessages = attemptSteps.flatMap((step: any) => step?.response?.messages ?? []);
        const savedDraftPath = (ctx as any).__lastSavedDraftPath as string | undefined;
        const streamedCheckpoint = (ctx as any).__streamedCodeCheckpoint as StreamedCodeCheckpoint | undefined;
        const studioRecovery = studioCheckpoint.studioRunId
          ? ` Resume Studio Run ${studioCheckpoint.studioRunId} at stage ${studioCheckpoint.studioRunStage}. Call studio_run status first, then continue that stage directly. Do not reread skill, prompt, or reference files already present in the conversation history.`
          : '';
        const compositionRecovery = studioCheckpoint.studioRunStage === 'composition'
          ? ` Switch immediately to numbered source files under ${ctx.projectId}/drafts/composition-parts. Salvage complete reusable definitions from the partial stream into a numbered part, then continue with additional parts; do not stream the monolithic run_code payload again. The workspace assembles automatically after each write, so continue until write_file reports compositionWorkspace.status="ready" and use its designPath directly.`
          : '';
        const skillVideoRecovery = assessment.code === 'skill_video_submission_pending'
          ? 'The complete video script is already visible. Do not rewrite it or ask for confirmation. Call generate_animation now with that exact complete script.'
          : '';
        const recoveryInstruction = textOnlyRecovery
          ? 'A finished artifact was already delivered in the previous step. Do not call any tool, regenerate, republish, or create another task. Only provide the concise final reply for the existing delivered result.'
          : skillVideoRecovery || `Continue from the existing tool results and saved draft; do not restart from the original media.${savedDraftPath ? ` The exact saved draft path is: ${savedDraftPath}.` : ''}${streamedCheckpoint?.streamedCodePath ? ` Partial streamed code was saved at ${streamedCheckpoint.streamedCodePath} (${streamedCheckpoint.streamedCodeChars || 0} chars); read it once and salvage useful components.` : ''}${studioRecovery}${compositionRecovery}${recoveryBlockedTools.size ? ` Do not repeat these already-completed tools: ${[...recoveryBlockedTools].join(', ')}; use their existing results.` : ''} Complete the pending modification you already planned. If the user requested a finished artifact, publish the updated artifact before your concise final reply.`;
        attemptMessages = [
          ...attemptMessages,
          ...responseMessages,
          {
            role: 'user',
            content: `[System recovery] The previous model step ended before it delivered a usable response (${assessment.code || 'incomplete'}). ${recoveryInstruction}`,
          } as ModelMessage,
        ];
        yield { type: 'status', text: translate(responseLocale, 'agent.status.resuming') };
        console.warn(`[agent] recovering incomplete model step code=${assessment.code} finish=${finishReason || 'missing'} raw=${rawFinishReason || ''}`);
        continue;
      }

      const drafts = (ctx as any).__runCodeDrafts as Array<{ previewUrl?: string }> | undefined;
      const studioCheckpoint = await getStudioRunCheckpoint(ctx);
      const streamedCodeCheckpoint = (ctx as any).__streamedCodeCheckpoint as StreamedCodeCheckpoint | undefined;
      const checkpoint = {
        draftPath: (ctx as any).__lastSavedDraftPath as string | undefined,
        previewUrl: drafts?.[drafts.length - 1]?.previewUrl,
        lastTool: lastTool || toolCallName || undefined,
        finishReason,
        rawFinishReason,
        ...studioCheckpoint,
        ...streamedCodeCheckpoint,
        ...((ctx as any).__compositionPartPaths?.length
          ? { compositionPartPaths: (ctx as any).__compositionPartPaths as string[] }
          : {}),
        ...(assessment.detail ? { errorDetail: assessment.detail } : {}),
      };
      const recoverable = assessment.retryable && Boolean(
        checkpoint.draftPath
        || checkpoint.streamedCodePath
        || checkpoint.compositionPartPaths?.length
        || checkpoint.studioRunId
        || options?.execution,
      );
      const usageEvent = buildUsageEvent();
      if (usageEvent) yield usageEvent;
      yield {
        type: 'error',
        code: assessment.code || 'incomplete_agent_step',
        recoverable,
        checkpoint,
        message: recoverable
          ? translate(responseLocale, 'agent.error.recoverable')
          : translate(responseLocale, 'agent.error.fatal'),
      };
      return;
    }

    // Flush remaining images
    while (imagesSent < ctx.generatedImages.length) {
      yield { type: 'image', image: ctx.generatedImages[imagesSent], usedModel: ctx.lastUsedModel };
      imagesSent++;
    }
    yield* flushPendingImageSnapshots(ctx);

    console.log(`⏱️ [agent] DONE total ${((Date.now() - agentStartTime) / 1000).toFixed(1)}s (${imagesSent} images, ${stepCount} steps)`);
    perf?.mark('agent_done', {
      totalAgentMs: Date.now() - agentStartTime,
      imagesSent,
      stepCount,
    });

    // Emit token usage across the initial and automatic recovery attempts.
    // Usage is accumulated from finish-step events so a later timeout cannot
    // erase the tokens already consumed by completed steps.
    const usageEvent = buildUsageEvent();
    if (usageEvent) yield usageEvent;

    yield { type: 'done' };
  } catch (err) {
    const errorMessage = normalizeAgentErrorMessage(err);
    console.log(`⏱️ [agent] ERROR at +${((Date.now() - agentStartTime) / 1000).toFixed(1)}s: ${errorMessage}`);
    yield {
      type: 'error',
      message: responseLocale === 'zh' ? errorMessage : translate(responseLocale, 'agent.error.fatal'),
    };
  }
}
