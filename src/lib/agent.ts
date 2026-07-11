import { streamText, tool, stepCountIs } from 'ai';
import type { ModelMessage } from 'ai';
import { after } from 'next/server';
import { createBedrockAnthropic } from '@ai-sdk/amazon-bedrock/anthropic';
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
import agentPrompt from './prompts/agent.md';
import enhancePrompt from './prompts/enhance.md';
import creativePrompt from './prompts/creative.md';
import wildPrompt from './prompts/wild.md';
import captionsPrompt from './prompts/captions.md';
import generateImageToolPrompt from './prompts/generate_image_tool.md';
import type { DesignPayload, Tip, VideoMeta, VideoModel } from '@/types';
import { isPermanentUrl, toPublicStorageUrl, uploadAudio, uploadVideo } from '@/lib/supabase/storage';
import type { AgentPerf } from './agent-perf';
import { createTextDeltaState, normalizeTextDelta } from './agent-text-delta';
import { formatAspectRatio } from './media-aspect';
import { filterWorkspaceFilesForAgentScope } from './agent-workspace-scope';
import { normalizeCompositionAnimation } from './composition-duration';
import {
  createRemotionExportJob,
  runRemotionExportJob,
  type RemotionRenderProfile,
} from '@/lib/remotion-export';
import { VIDEO_PLACEHOLDER_IMAGE } from '@/lib/editor/timeline-derivations';
import { getAgentModelId, isClaudeSonnet5Model } from './bedrock-models';
import { normalizeAgentErrorMessage } from './agent-error';
import { describeBedrockToolUseInputIssue, normalizeBedrockToolUseInputs } from './bedrock-tool-inputs';
import { mergePatchProps } from './patch-props';
import { persistCompositionDraft } from './composition-draft';
import { resolveMediaMarkersInString, resolveMediaMarkersInValue } from './media-markers';

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

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

function getAgentModel() {
  const bedrockAnthropic = createBedrockAnthropic({
    region: process.env.AWS_REGION?.trim(),
    accessKeyId: process.env.AWS_ACCESS_KEY_ID?.trim(),
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY?.trim(),
  });
  return bedrockAnthropic(getAgentModelId());
}
const ANTHROPIC_CACHE_CONTROL = { anthropic: { cacheControl: { type: 'ephemeral' } } } as const;
const ANTHROPIC_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const ANTHROPIC_THINKING_MODES = new Set(['adaptive', 'disabled']);

function modelFileContent(base64Data: string, mediaType: string) {
  return {
    type: 'file' as const,
    data: { type: 'data' as const, data: base64Data },
    mediaType,
  };
}

function getAnthropicReasoningEffort() {
  const effort = process.env.AGENT_REASONING_EFFORT?.trim().toLowerCase();
  return effort && ANTHROPIC_REASONING_EFFORTS.has(effort) ? effort : undefined;
}

function getAnthropicThinkingMode() {
  const mode = process.env.AGENT_THINKING_MODE?.trim().toLowerCase();
  return mode && ANTHROPIC_THINKING_MODES.has(mode) ? mode : undefined;
}

function getAnthropicContextManagement(modelId: string) {
  if (isClaudeSonnet5Model(modelId)) {
    return {
      edits: [
        {
          type: 'clear_tool_uses_20250919',
          trigger: { type: 'input_tokens', value: 650000 },
          keep: { type: 'tool_uses', value: 24 },
        },
        {
          type: 'compact_20260112',
          trigger: { type: 'input_tokens', value: 900000 },
        },
      ],
    };
  }

  return {
    edits: [
      {
        type: 'clear_tool_uses_20250919',
        trigger: { type: 'input_tokens', value: 80000 },
        keep: { type: 'tool_uses', value: 3 },
      },
      {
        type: 'compact_20260112',
        trigger: { type: 'input_tokens', value: 150000 },
      },
    ],
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
  | { type: 'usage'; inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; model: string }  // token usage for billing (inputTokens = noCache only)
  | { type: 'done' }
  | { type: 'error'; message: string };

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

function formatGeneratedAudioForCui(toolName: string | undefined, output: unknown): string | null {
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
    return `\n\n🎵 音频已生成\n${tracks.join('\n')}\n`;
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

  return `\n\n🎵 音频已生成: ${title}\n${line}\n`;
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

function formatTranscriptForModel(transcript: VolcengineAsrTranscript): string {
  const lines: string[] = [
    `Transcript (${transcript.provider}/${transcript.model}, ${transcript.durationMs ? `${formatMs(transcript.durationMs)}s` : 'duration unknown'}):`,
    transcript.text || '(empty transcript)',
    '',
    'Utterance timecodes:',
  ];

  let charBudget = 24_000;
  for (const [idx, utterance] of transcript.utterances.entries()) {
    const line = `${idx + 1}. [${formatMs(utterance.startMs)}s-${formatMs(utterance.endMs)}s]${utterance.speaker ? ` speaker ${utterance.speaker}` : ''} ${utterance.text}`;
    if (charBudget - line.length < 0) {
      lines.push('[transcript truncated]');
      break;
    }
    lines.push(line);
    charBudget -= line.length;
    const words = formatTranscriptWords(utterance.words, Math.min(1200, charBudget));
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
  // Always convert to JPEG — ensures consistent MIME type for Bedrock vision
  const maxPx = opts?.maxPx ?? 2048;
  const quality = opts?.quality ?? 90;
  buf = Buffer.from(await sharp(buf)
    .resize(maxPx, maxPx, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer());
  return buf;
}

/** Refresh ctx.snapshotImages from DB — replaces base64 entries with Storage URLs, video snapshots with video URLs. */
async function refreshSnapshotUrls(ctx: AgentContext): Promise<void> {
  if (!ctx.supabase || !ctx.projectId) return;
  try {
    const { data: dbSnaps } = await ctx.supabase
      .from('snapshots')
      .select('image_url, sort_order, type, video_meta')
      .eq('project_id', ctx.projectId)
      .order('sort_order');
    if (!dbSnaps?.length) return;
    for (let i = 0; i < Math.min(dbSnaps.length, ctx.snapshotImages.length); i++) {
      const snap = dbSnaps[i];
      if (snap.type === 'video') {
        const videoUrl = typeof snap.video_meta?.videoUrl === 'string' ? snap.video_meta.videoUrl : '';
        if (videoUrl) {
          ctx.snapshotImages[i] = videoUrl;
        } else if (snap.image_url && !ctx.snapshotImages[i]?.startsWith('http')) {
          ctx.snapshotImages[i] = snap.image_url;
        }
        continue;
      }
      if (snap.image_url && !ctx.snapshotImages[i]?.startsWith('http')) {
        ctx.snapshotImages[i] = snap.image_url;
      }
    }
  } catch { /* best effort */ }
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
    return { snapshotId: input.snapshot_id, designPath: input.design_path };
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

Tools: \`list_files\`, \`read_file\`, \`write_file\`, \`delete_file\`, \`run_code\`

### File organization
- **User-level** (shared across projects): \`skills/\`, \`memory/\`
- **Project-level** (current project): \`${projectPath}code/\`${projectId ? ` — save composition/code files here` : ''}
- **skills/{name}/SKILL.md** — Create reusable skills here. Read \`skills/SKILL_README.md\` for the format.

### run_code
Execute JavaScript in two modes:
- \`runtime: "composition"\` for Remotion/editable composition drafts, animated templates, overlays, and sharp utilities. \`runtime: "design"\` is a legacy alias.
- \`runtime: "node"\` for real file-level MP4 work with FFmpeg/FFprobe: split, exact trim/export, transcode, extract frames, mux audio, long-video preparation, and final assembly of generated chunks.
For finished single images, posters, infographics, and marketing graphics, use \`generate_image\` instead unless the user asks for editable or animated code.
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
  const languageRule = locale === 'en' ? 'Reply in English.' : locale === 'zh' ? 'Reply in Chinese.' : 'Reply in the same language the user writes in.';
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

function createTools(ctx: AgentContext) {
  return {
    generate_image: tool({
      description: generateImageToolPrompt,
      inputSchema: z.object({
        editPrompt: z.string().describe('The specific creative direction for this edit (English). When skill is set, you must have read and internalized that skill prompt once in this conversation; write an editPrompt that follows those rules.'),
        skill: z.string().optional().describe('Activate a skill template (e.g. enhance, creative, wild, captions). See tool description and available skills.'),
        model: z.enum(['gemini', 'gemini-lite', 'qwen', 'pony', 'wai', 'openai']).optional().describe('NEVER set this unless the user literally says a model name like "用pony" or "use qwen" or "用openai" or "nano banana lite", or the active long-video-director workflow is generating director storyboard images, which MUST set "openai". For NSFW after Gemini refusal, set "qwen". Otherwise ALWAYS omit — the router handles everything automatically. Setting this without explicit user request is a bug.'),
        aspectRatio: z.string().optional().describe('Target aspect ratio e.g. "4:5", "1:1", "16:9"'),
        media_index: z.number().optional().describe('1-based index of the snapshot to edit (<<<media_1>>> = 1, <<<media_2>>> = 2, ...). Omit for text-to-image (no photo sent). For most edits, pass the current snapshot index.'),
        reference_media_indices: z.array(z.number()).optional().describe('1-based indices of snapshots to use as reference images (e.g. [1, 3] to reference <<<media_1>>> and <<<media_3>>>). Use when combining elements from multiple snapshots — e.g. "use the person from media_1 and the background from media_2". The editPrompt should describe how to combine them (e.g. "Place the person from Media 2 into the scene of Media 1").'),
      }),
      execute: async ({ editPrompt, skill, model, aspectRatio, media_index, reference_media_indices }) => {
        // Resolve which image to edit — agent must pass media_index to include a photo
        let editTarget: string | undefined;
        if (media_index !== undefined) {
          const v = validateImageIndex(ctx.snapshotImages, media_index);
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

Use this tool after the user has confirmed a video script that is already visible in the conversation. You may also call it in the same turn where you first write the script when the user's current request explicitly authorizes direct submission without confirmation, for example "直接提交渲染", "不要问我确认", "不用确认", "直接生成视频", "submit now", or "do not ask for confirmation".

**BEFORE writing a video script**: call \`read_file('prompts/animate.md')\` to load the full video guide (modes, prompt styles, showcases, reference video usage). Do not re-read if already in this conversation's tool-result history.

Hard constraints:
- First line of script = short title (2-5 words). Then script body.
- Use \`<<<media_N>>>\` to reference images AND videos (N starts at 1). Videos in the timeline are auto-routed — just reference them like images. For native SeeDance text-to-video with no source media, use no media markers and do not generate an intermediate image first.
- To EDIT a video: reference it with \`<<<media_N>>>\` and describe the changes. The selected model must support reference videos.
- To use CLI/app imported reference music/audio for pacing or beat sync, mention its Audio Index marker in \`story_prompt\` (for example \`<<<audio_1>>>\`) AND pass \`audio_refs\` like ["audio_1"]. Audio refs are NOT Timeline Media Index refs. Reference audio is only supported by SeeDance/SeeDance Fast/SeeDance Mini.
- Works for Kling, SeeDance, SeeDance Mini, and Grok, but respect capability limits and tool errors.
- Single-call total duration: SeeDance/SeeDance Mini is 4-15 seconds (4s minimum output, 5s default/common preset); Kling is 5-15 seconds; Grok 1.5 is 1-15 seconds for one starting image; Google Omni is 3-10 seconds. If the user asks for anything shorter than the selected model's minimum, or referenced source videos total less than that minimum, write a compact script at the model minimum and set duration to that minimum. If the user wants 30s, 60s, 1-2 minutes, or anything longer than the selected model's max, do not call this tool with one long script. Use \`skills/long-video-director/SKILL.md\` and split into self-contained segments within the selected model limit.
- If a complete script totals 15 seconds or less, submit it as one video generation call. Put the whole title, every \`Shot N (Xs):\` line, and the \`Style:\` line into the same \`story_prompt\`; set \`duration\` to the total script duration when known. Do not submit only one shot, the first shot, or one line from the script.
- If the source video may exceed model limits, call \`read_file('skills/video-ffmpeg-lab/SKILL.md')\` and split it once with \`run_code({ runtime: "node" })\` before submitting generation.
- Total duration must fit the selected model's capability. Do not shrink a long source to 5s just to bypass a limit; split first.
- Long source video rule: if a timeline/reference video is longer than 15 seconds, do not shrink the whole source into one 5s or 15s edit. Use \`skills/long-video-director/SKILL.md\`, analyze/split it into self-contained segments of 15s or less, and submit one script per segment after approval.
- Reference video input limit: for one SeeDance generation, the combined source duration of all timeline/uploaded/reference videos used in the script must be 15 seconds or less. This is a single-generation input limit; do not submit videos whose combined duration is longer than 15s together in one call.
- Reference video size limit: for one SeeDance generation, every reference video must be .mp4/.mov, <=50MB, width and height each 300-6000px, aspect ratio 0.4-2.5, and frame pixels width*height between 409,600 and 2,086,876. Tiny videos below 409,600 frame pixels must be resized/padded before submission. For Kling, use one .mp4/.mov reference video, <=200MB, resolution <=2K; no explicit Kling video resolution lower bound is documented. Grok 1.5 does not support video references or multi-image references in Makaron; use it only for single-image-to-video. Google Omni supports one uploaded/reference video in Makaron and, without a video reference, up to 6 image references for subject/reference-to-video; it is best for fast image/video edits with native generated audio. Uploaded audio_refs are not supported by Google Omni.
- Video edit duration lock: when editing timeline videos up to 15 seconds total, output duration should match the combined source duration from Media Index, clamped to the selected model range. For SeeDance, clamp to 4-15s; if combined source duration is under 4s, set \`duration: 4\`. For long-video pipelines, duration lock applies per FFmpeg chunk.
- Default model follows app selection, usually SeeDance 2.0 Fast (\`seedance-fast\`) at 720p. If the app selector has an explicit non-default model or explicit resolution, the backend keeps that app selection, so align the script with the selected route. Generic "HD"/"高清"/"high quality" requests still use \`seedance-fast\` 720p. Use \`seedance-mini\` only when the user asks for Seedance Mini, lower cost, draft, or multi-size testing; prefer 480p unless they ask for 720p. Use standard \`seedance\` only when the user explicitly asks for 1080p, standard/full SeeDance 2.0, or premium/highest-resolution output. If the user asks for cheaper/faster/draft/480p, set \`video_resolution: "480p"\` when supported. If the user asks for Kling Pro/HD/1080p, use model \`kling\` with \`video_resolution: "1080p"\`; if they ask for Kling 4K, use model \`kling\` with \`video_resolution: "4k"\`. If the user asks for Grok by name ("用 Grok 生成", "use grok", "用 grok 做"), fastest generation, or native audio from one image, use model \`grok\` and write a single-image-to-video script. Use model \`google-omni\` only when the app selector is already Gemini Omni or the user explicitly asks for Omni/Gemini Omni/Google Omni; treat it as a fast short 720p video editing model with native generated audio, and do not pass audio_refs to Google Omni.
- Grok aspect-ratio rule: for Grok single-image-to-video, do not pass \`aspect_ratio\`. xAI stretches the source image when a forced ratio differs from the image. If the user asks for a different final shape, choose Seedance/Kling or first create/pad the source image to that target shape, then generate.
- \`video_ref_url\`: ONLY for external videos not in Media Index (e.g. from workspace/list_files). Never put video URLs in prompt text.
- If the generated video is an intermediate artifact, pass \`completion_actions\` so CUI/CLI can show the next step after rendering finishes. These actions are user-confirmed by default; do not rely on the user remembering what to do next. For local video repair, include exact replaceStart/replaceEnd/replacementDuration and say to trim/fit the patch to that duration before merging so the final video keeps the original duration.
- The script must have been shown to the user and confirmed before this tool is called, unless the user's current request explicitly asks for direct submission without confirmation.`,
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
      execute: async ({ story_prompt, duration, aspect_ratio, model, video_resolution, media_refs, audio_refs, video_ref_url, video_ref_type, keep_original_sound, motion_control, character_orientation, completion_actions }) => {
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
            return { success: false as const, message: skillResult.message };
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
      },
    }),

    analyze_image: tool({
      description: 'See and analyze a photo. Use only for questions, red annotations, uncertain target regions, identity/detail inspection, or ambiguous edits. Do not call this before clear direct generate_image edits; generate_image already receives the selected media. Use media_index to look at any snapshot in the timeline.',
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
        return { base64Data: buf.toString('base64'), mimeType: 'image/jpeg', question };
      },

      toModelOutput({ output }: { output: any }) {
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

Default mode describes scenes/actions/pacing/audio cues in a timeline video. Do not call this before clear direct video edits such as adding glasses, changing outfit, or using Omni to edit a referenced video; generate_animation already receives selected video references. Use analyze_video only for inspection, comparison, diagnosis, ambiguous targets, or frame-location workflows.

Use mode="locate_frame" when the user provides a screenshot/frame and you need to find where that frame appears in a video. This is the primary locator for screenshot-based local video edits. Provide the video as media_index and the screenshot as image_url, image_media_index, or workspace_path. For checking a known timestamp visually, use preview_frame instead.`,
      inputSchema: z.object({
        media_index: z.number().describe('1-based snapshot index of the video to analyze (<<<media_1>>> = 1)'),
        question: z.string().optional().describe('Specific aspect to focus on. In locate_frame mode, use this for the user note about what is wrong in the screenshot.'),
        mode: z.enum(['describe', 'locate_frame']).optional().describe('describe = normal video analysis. locate_frame = locate a screenshot inside this video. Default describe.'),
        image_url: z.string().optional().describe('For locate_frame: screenshot/frame image URL or data:image URL.'),
        image_media_index: z.number().optional().describe('For locate_frame: 1-based Media Index image snapshot to use as the screenshot/frame anchor.'),
        workspace_path: z.string().optional().describe('For locate_frame: workspace image path from preview_frame/read_file/list_files, e.g. project/drafts/frame.jpg.'),
      }),
      execute: async ({ media_index, question, mode, image_url, image_media_index, workspace_path }) => {
        const v = validateImageIndex(ctx.snapshotImages, media_index);
        if (v.error) return { error: v.error };

        // Get video URL: first check snapshotImages (may already contain video URL), then DB fallback
        let videoUrl: string | undefined;
        const mediaUrl = ctx.snapshotImages[v.idx];
        console.log(`[analyze_video] media_index=${media_index} idx=${v.idx} mediaUrl=${mediaUrl?.substring(0, 80)} isVideo=${isVideoUrl(mediaUrl)}`);
        if (isVideoUrl(mediaUrl)) {
          videoUrl = mediaUrl;
        } else if (ctx.supabase && ctx.userId) {
          try {
            const { data: snaps, error: snapErr } = await ctx.supabase
              .from('snapshots')
              .select('video_meta')
              .eq('project_id', ctx.projectId)
              .order('sort_order', { ascending: true });
            if (snapErr) console.error('[analyze_video] DB query error:', snapErr.message);
            const snap = snaps?.[v.idx];
            const vm = snap?.video_meta as Record<string, unknown> | undefined;
            videoUrl = vm?.videoUrl as string | undefined;
            if (!videoUrl) console.log(`[analyze_video] media_index=${media_index} idx=${v.idx} snapsCount=${snaps?.length} hasVM=${!!vm} vmKeys=${vm ? Object.keys(vm).join(',') : 'none'}`);
          } catch (e) { console.error('[analyze_video] exception:', e); }
        } else {
          console.log('[analyze_video] no supabase client available');
        }

        if (!videoUrl) {
          return { error: `No video found at <<<media_${media_index}>>>. This snapshot may not be a video, or video is still processing. Use analyze_image to see the poster, or preview_frame for specific raw-video/composition frames.` };
        }

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
                  candidateFramePath = `${ctx.projectId}/drafts/locate-verify-media${media_index}-t${location.timestamp.toFixed(2).replace('.', '-')}-${Date.now()}.jpg`;
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
              media_index,
              videoUrl,
              imageSource: image.source,
            };
          }

          const { analyzeVideoContent } = await import('./gemini');
          const analysis = await analyzeVideoContent(videoUrl, question, ctx.userId);
          return { mode: 'describe', analysis, media_index, videoUrl };
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
          }
        }

        if (!resolvedUrl || !/^https?:\/\//i.test(resolvedUrl)) {
          return { error: 'transcribe_audio requires a public audio/video URL or a valid video media_index.' };
        }

        try {
          const transcript = await transcribeWithVolcengineAsr({
            mediaUrl: resolvedUrl,
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

          return { transcript, cached: false, media_index, videoUrl: resolvedUrl };
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

    studio_run: tool({
      description: `Create and advance a durable Makaron Studio Run for multi-stage video production.
Use this for explainer-video and other substantial directed video skills, not quick edits.
The run persists typed artifacts in the existing project workspace and enforces dependencies, approval policy, resume state, and downstream invalidation.
Operations:
- start: create the run before producing the brief. It returns all eight stageSchemas in one response; reuse them instead of making separate schema calls.
- put_artifact: validate and persist the completed stage artifact. Use the exact stage order brief, proposal, script, storyboard, assets, composition, review, delivery.
- put_artifacts: for approval_policy=auto only, validate and persist a contiguous batch of adjacent artifacts. Prefer one batch for brief through assets to reduce latency while preserving one CUI event per stage.
- approve: approve a guided/manual stage that is awaiting approval.
- status: load the current run after a new turn or interrupted session. It returns the JSON Schema for the current stage.
- schema: return the JSON Schema for a requested stage before authoring its artifact.
- validate: validate a stage artifact without persisting it.
- invalidate: deliberately reopen a stage and invalidate only its downstream dependents.
For approval_policy=auto, gated artifacts are approved automatically and recorded in the decision log. Never claim a stage is complete until put_artifact succeeds.`,
      inputSchema: z.object({
        operation: z.enum(['start', 'put_artifact', 'put_artifacts', 'approve', 'status', 'invalidate', 'schema', 'validate']),
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
        stage: z.enum(['brief', 'proposal', 'script', 'storyboard', 'assets', 'composition', 'review', 'delivery']).optional(),
        artifact: z.unknown().optional(),
        artifacts: z.array(z.object({
          stage: z.enum(['brief', 'proposal', 'script', 'storyboard', 'assets', 'composition', 'review', 'delivery']),
          artifact: z.unknown(),
        })).min(1).max(8).optional(),
        summary: z.string().optional(),
        reason: z.string().optional(),
      }),
      execute: async ({ operation, run_id, recipe, title, approval_policy, delivery_promise, stage, artifact, artifacts, summary, reason }) => {
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
              stageSchemas: Object.fromEntries(([
                'brief',
                'proposal',
                'script',
                'storyboard',
                'assets',
                'composition',
                'review',
                'delivery',
              ] as const).map(stageId => [stageId, studio.getStudioArtifactJsonSchema(stageId)])),
            };
          }

          let run = run_id ? await store.loadRun(ctx.projectId, run_id) : (await store.listRuns(ctx.projectId))[0];
          if (!run) return { success: false, error: 'Studio Run not found. Start one first.' };

          if (operation === 'status') {
            return {
              success: true,
              studioRun: studio.summarizeStudioRun(run),
              statePath: studio.studioRunStatePath(run.projectId, run.id),
              currentStageSchema: run.currentStage ? studio.getStudioArtifactJsonSchema(run.currentStage) : null,
            };
          }
          if (operation === 'schema') {
            const schemaStage = stage || run.currentStage;
            if (!schemaStage) return { success: false, error: 'schema requires stage when the run is complete' };
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
            const validated = studio.validateStudioArtifact(schemaStage, artifact);
            return { success: true, valid: true, stage: schemaStage, artifact: validated };
          }
          if (operation === 'put_artifacts') {
            if (!artifacts?.length) return { success: false, error: 'put_artifacts requires artifacts' };
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
            };
          }
          if (!stage) return { success: false, error: `${operation} requires stage` };

          if (operation === 'put_artifact') {
            if (artifact === undefined) return { success: false, error: 'put_artifact requires artifact' };
            const result = await studio.putPersistedStudioArtifact({ store, run, stage, artifact });
            return {
              success: true,
              studioRun: studio.summarizeStudioRun(result.run, result.artifactPath),
              artifactPath: result.artifactPath,
              invalidated: result.invalidated,
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
        if (output.schema || output.currentStageSchema || output.stageSchemas) {
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
Default profile is fast_720p (short side 720, no upscale) for speed. Default publish=true so the exported MP4 appears as a new <<<media_N>>> video. By default the tool queues a durable async export like video generation; polling/cron completes it and reports either success or failure. Set wait=true on the first call when the current response must include the final URL. A repeated call for the same unchanged composition reuses the fingerprint-matched queued/completed job and does not render twice. If the same unchanged composition fails twice in one turn, stop retrying and report export as blocked.`,
      inputSchema: z.object({
        media_index: z.number().optional().describe('1-based media index, e.g. 3 for <<<media_3>>>. Must point to an editable Remotion composition.'),
        snapshot_id: z.string().optional().describe('Snapshot ID of an editable Remotion composition.'),
        design_path: z.string().optional().describe('Workspace design JSON path, e.g. code/<snapshotId>.json.'),
        name: z.string().optional().describe('Short output slug/name.'),
        profile: z.enum(['fast_720p', 'source']).optional().describe('fast_720p for speed, source for full source resolution.'),
        publish: z.boolean().optional().describe('Default true. Publish exported MP4 into the project timeline.'),
        wait: z.boolean().optional().describe('Default false. Queue asynchronously and let polling/cron complete. Set true only to wait for final MP4 URL before responding.'),
      }),
      execute: async ({ media_index, snapshot_id, design_path, name, profile, publish, wait }) => {
        if (!ctx.supabase || !ctx.userId) {
          return { success: false, error: 'materialize_media requires an authenticated project workspace.' };
        }
        const source = await resolveCompositionSource(ctx, {
          media_index,
          snapshot_id,
          design_path,
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
          const shouldWait = wait === true;
          const publishSnapshotId = shouldPublish && !shouldWait ? crypto.randomUUID() : undefined;
          const job = await createRemotionExportJob({
            userId: ctx.userId,
            projectId: ctx.projectId,
            snapshotId: source.snapshotId,
            designPath: source.designPath,
            design: source.design,
            outputType: 'video',
            renderProfile: (profile || 'fast_720p') as RemotionRenderProfile,
            publish: shouldPublish,
            publishSnapshotId,
            name: name || 'materialized-composition',
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

          const result = await runRemotionExportJob(job.id);
          const completed = result.job;
          const videoUrl = completed.storage_url || '';
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
          if (publishedSnapshotId && videoMeta) {
            ctx.pendingVideoSnapshot = {
              snapshotId: publishedSnapshotId,
              taskId: videoMeta.taskId || `remotion-export-${completed.id}`,
              videoMeta,
            };
          }
          return {
            success: completed.status === 'completed',
            jobId: completed.id,
            status: completed.status,
            videoUrl,
            workspacePath: completed.workspace_path,
            publishedSnapshotId,
            durationSeconds: completed.duration_seconds,
            renderSeconds: completed.render_seconds,
            realtimeRatio: completed.realtime_ratio,
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    preview_frame: tool({
      description: `Capture one visual frame or a 2-6 frame contact sheet.
Use media_index to target any timeline snapshot. Remotion compositions are rendered with Remotion; raw uploaded/generated videos are extracted with FFmpeg.
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
        const targetMediaIndex = media_index ?? (!design ? ctx.currentSnapshotIndex + 1 : undefined);

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
            return {
              base64Data: contactSheet.toString('base64'),
              mimeType: 'image/jpeg',
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
            return { error: `Failed to capture contact sheet: ${msg}` };
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
            return {
              base64Data: jpegBuffer.toString('base64'),
              mimeType: 'image/jpeg',
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
          return {
            base64Data: jpegBuffer.toString('base64'),
            mimeType: 'image/jpeg',
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
          return { error: `Failed to capture frame ${targetFrame}: ${msg}` };
        }
      },

      toModelOutput({ output }: { output: any }) {
        if (output.error) {
          return { type: 'content' as const, value: [{ type: 'text' as const, text: output.error }] };
        }
        if (Array.isArray(output.frames)) {
          const loc = output.workspacePath ? ` Saved: ${output.workspacePath}` : '';
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

    write_file: tool({
      description: `Write a file to your workspace. Use this to save memory, create skills, or organize your workspace.
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
      }),
      execute: async ({ path: filePath, name, content, fromLastRunCode, fromWorkspaceOutputs, workspacePaths, mediaType, limit, publish: shouldPublish }) => {
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
        const result = await workspace.writeFile(savePath, fileContent, ctx.supabase, ctx.userId);
        if (!result.success) {
          return { success: false, message: `Write failed: ${result.error}` };
        }

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

            console.log(`📌 [agent] design published via write_file: <<<media_${ctx.snapshotImages.length}>>>`);
          } else if (lastDraft?.type === 'image') {
            // Image draft → push to snapshotImages + emit via generatedImages
            const imageData = lastDraft.imageBase64;
            ctx.snapshotImages.push(imageData);
            ctx.currentSnapshotIndex = ctx.snapshotImages.length - 1;
            ctx.generatedImages.push(imageData);

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

            console.log(`📌 [agent] video published via write_file: <<<media_${ctx.snapshotImages.length}>>>`);
          }
        }

        return { success: true, message: `Saved: ${savePath}`, path: savePath, storageUrl: toPublicStorageUrl(result.storageUrl || '') };
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

Before first use, follow one reading path. For Studio Run video skills that already require \`prompts/studio-remotion-fast-path.md\`, that compact guide replaces \`prompts/agent-coding.md\`, \`prompts/remotion-composition.md\`, and \`skills/_shared/remotion-director-contract.md\`; do not read the three longer guides too. Otherwise read \`prompts/agent-coding.md\`, plus \`prompts/remotion-composition.md\` for Remotion/editable compositions. For real file-level MP4 splitting, exact trimming/export, transcode, frames, audio muxing, long-video preparation, or final assembly of generated chunks, also read \`skills/video-ffmpeg-lab/SKILL.md\`. Do not re-read a guide already present in tool-result history.

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

For a first composition draft, prefer the top-level \`composition\` input over wrapping JSX inside executable \`code\`. Pass \`composition: { code, width, height, props, editables, animation }\`; the harness validates and autosaves it directly. This avoids nested-code quoting failures and is the fastest Studio Run path. Keep executable \`code\` for patches, images, Node media work, and legacy calls.

Composition hard rules: use Remotion \`<Img>\`, not \`<img>\`; declare editable user-facing text; use system CJK fonts; keep mobile image layers light. Reference timeline media in composition code and props with the literal 1-based marker \`<<<media_N>>>\`; the runtime resolves markers to current URLs before validation, autosave, preview, and export. Never translate Media Index N into \`ctx.snapshotImages[N]\` because that JavaScript array is 0-based. Only \`Composition(props)\` may read \`props\` directly; helper components must receive values through their own parameters and must never reference outer \`props\` (prevents \`props is not defined\` in Lambda). For timeline videos, preserve the selected Media Index video aspect ratio when all selected videos share one aspect: 9:16 sources must return a 9:16 canvas such as 1080x1920, never a 16:9 canvas. For mixed-aspect sources, choose the user/platform/current composition target and use contain/background; do not claim the runtime forced one source's aspect.
For legacy first-draft calls without \`composition\`, send one complete executable JavaScript body that returns the render object. Do not send a fragment like \`const code = \\\`\` without the final \`return { type: 'render', code, ... }\`. Keep long videos concise by using arrays, helper components, and interpolations instead of writing frame-by-frame code.

Node media runtime provides \`require\`, \`process\`, \`ffmpegPath\`, \`inputFiles\`, \`outputDir\`, \`workDir\`, \`workspaceDir\`, \`saveOutput(localPath)\`, and \`probeVideo(path)\`. Most Node built-ins are available, plus media packages such as \`sharp\`, \`jszip\`, \`exifr\`, \`heic-convert\`, \`canvas\`, \`remotion\`, and Remotion media utilities. Arbitrary local/package require, env secrets, and escape/debug modules are blocked. Workspace files are local to the runtime: use \`workspace_paths\` and \`inputFiles[n].inputPath\`, never download or reconstruct Storage URLs. For \`runtime: "node"\`, any referenced timeline media like \`<<<media_1>>>\` MUST be passed as \`media_refs: [1]\`; any existing workspace file from \`list_files\` MUST be passed as \`workspace_paths: ["project/media/file.mp4"]\`. The system resolves both to local workspace-backed files before your code runs. \`ffprobePath\` may be empty in deployment; prefer \`probeVideo(path)\`. Use \`type: "files"\` for chunks and \`type: "video"\` for the final MP4. If ordinary timeline splicing was routed to composition, do not switch to node just because preview needs adjustment; patch the composition or report the preview issue.`,
      inputSchema: z.object({
        code: z.string().optional().describe('JavaScript code to execute. Required for node, patch, image, and legacy calls. For a first Remotion draft prefer the direct composition input instead.'),
        composition: z.object({
          code: z.string().min(1).describe('Direct Remotion component source. Define function Composition(props) without import/export. This string is validated directly, not executed as nested JavaScript.'),
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
        }).optional().describe('Preferred first-draft Remotion payload. Avoids wrapping composition source inside another executable code string.'),
        description: z.string().optional().describe('Brief description of what this code does. For compositions/videos, describe the content and visual style (e.g. "15s cinematic video: 4 scenes of temple visit with Ken Burns + fade transitions, Japanese text overlays"). This is stored as the snapshot description — be specific.'),
        media_refs: z.array(z.number()).optional().describe('1-based Media Index indices referenced by the user (e.g. [1] for <<<media_1>>>). REQUIRED for runtime:"node" FFmpeg work on timeline media; the system resolves them to local workspace-backed inputFiles[0], inputFiles[1], ... . Do not hardcode Media Index URLs for FFmpeg inputs. For ordinary editable splicing of two timeline videos, use runtime:"composition" instead.'),
        workspace_paths: z.array(z.string()).optional().describe('Workspace file paths from list_files/read_file, e.g. ["project-id/media/clip.mp4"]. For runtime:"node", pass these instead of downloading or copying storage URLs; they are resolved to local inputFiles after media_refs.'),
        runtime: z.enum(['composition', 'design', 'node']).optional().describe('composition = safe Remotion/editable composition runtime. design = legacy alias for composition. node = fully open backend Node runtime with fs/child_process/ffmpeg for real MP4 editing.'),
      }).refine(value => Boolean(value.code || value.composition), {
        message: 'Provide executable code or a direct composition payload.',
      }),
      execute: async ({ code, composition, description: desc, media_refs, workspace_paths, runtime }) => {
        const executableCode = code || '';
        console.log(`🔧 [run_code] ${desc || 'executing code'}...`);
        const startTime = Date.now();
        // Store raw code for write_file({ fromLastRunCode: true })
        (ctx as any).__lastRunCode = composition ? JSON.stringify(composition, null, 2) : executableCode;

        // Refresh snapshotImages URLs from DB — ensures URLs are valid
        if (ctx.supabase && ctx.projectId) {
          try {
            await refreshSnapshotUrls(ctx);
          } catch (e) {
            console.warn('⚠️ [run_code] failed to refresh snapshot URLs:', e);
          }
        }

        if (runtime === 'node') {
          if (!code) {
            return { type: 'text' as const, content: 'Node media runtime requires executable code; composition is only for Remotion first drafts.' };
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
          if (composition) {
            result = { type: 'render', ...composition };
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
            patched.animation = normalizeCompositionAnimation(patched.code, patched.animation);
            if (result.editables) patched.editables = result.editables;

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
          return `${index + 1}. ${voice.id}${voice.name ? ` — ${voice.name}` : ''}${tags ? ` (${tags})` : ''}${voice.description ? `: ${voice.description}` : ''}`;
        }).join('\n');
        const warning = output.warning ? `\nWarning: ${output.warning}` : '';
        return {
          type: 'content' as const,
          value: [{
            type: 'text' as const,
            text: `Volcengine voice catalog source=${output.source}, total=${output.count || output.voices?.length || 0}.${warning}\nSuggested voices:\n${rows || 'No voices returned.'}\n\nChoose one voice_id and pass it to generate_voiceover.`,
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
        resource_id: z.enum(['seed-tts-2.0', 'seed-icl-2.0', 'seed-tts-1.0', 'seed-tts-1.0-concurr']).optional().describe('Volcengine resource id. Use seed-tts-2.0 for standard Doubao TTS voices; use seed-icl-2.0 only for authorized cloned voices.'),
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
      // Cache point marker — cache all tools preceding this one.
      // Must stay on the LAST tool in this map so the whole tools block is cached.
      providerOptions: ANTHROPIC_CACHE_CONTROL,
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

// ---------------------------------------------------------------------------
// Agent runner – async generator yielding SSE events
// ---------------------------------------------------------------------------

/** Append a language reply instruction to any prompt based on locale.
 *  Only appends when locale is explicitly set — undefined means no override. */
export function withLocale(prompt: string, locale?: string): string {
  if (locale === 'en') return `${prompt}\n\nReply in English.`;
  if (locale === 'zh') return `${prompt}\n\nReply in Chinese.`;
  return prompt;
}

// Used for initial upload analysis
const ANALYSIS_PROMPT_INITIAL = `描述这张照片里的内容，1-2句，语气像朋友分享。直接从主体开始说（"一个..."/"画面里..."）。禁止用"我来看看"/"让我看一下"等任何铺垫语。`;

// Used for post-edit analysis — acknowledges the edit context
const ANALYSIS_PROMPT_POSTEDIT = `P完图了，看看效果。以"P完之后，"开头，用1句话描述一下现在这张图的整体效果和氛围。禁止用"我来看看"等铺垫语，直接说结果。`;

// Used for video upload auto-analysis
const ANALYSIS_PROMPT_VIDEO_TEMPLATE = (mediaIndex: number) =>
  `[System: User just uploaded a video at <<<media_${mediaIndex}>>>. Analyze it and describe the content.]\nDescribe this video in 2-3 sentences — duration, key subjects/actions, mood. Be conversational. No preamble.`;

export async function* runMakaronAgent(
  prompt: string,
  currentImage: string,
  projectId: string,

  options?: { analysisOnly?: boolean; analysisContext?: 'initial' | 'post-edit'; isVideoAnalysis?: boolean; tipReactionOnly?: boolean; referenceImages?: string[]; animationImageUrls?: string[]; animationImages?: string[]; locale?: string; preferredModel?: ModelId; videoModel?: string; videoResolution?: import('@/types').VideoResolution; videoAuto?: boolean; audioAttachments?: AudioAttachment[]; snapshotImages?: string[]; currentSnapshotIndex?: number; isNsfw?: boolean; userSkills?: ParsedSkill[]; supabase?: any; userId?: string; currentDesign?: { code: string; width: number; height: number; props?: Record<string, unknown>; animation?: { fps: number; durationInSeconds: number; format?: string } }; currentDesignPath?: string; history?: ModelMessage[]; timelineVersion?: number; perf?: AgentPerf },
): AsyncGenerator<AgentStreamEvent> {
  const perf = options?.perf;
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
  };

  const allTools = createTools(ctx);
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
  const normalMaxSteps = Number.isFinite(configuredMaxSteps)
    ? Math.min(120, Math.max(30, configuredMaxSteps))
    : 60;
  const maxSteps = analysisOnly ? 2 : tipReactionOnly ? 1 : normalMaxSteps;
  const videoMediaIndex = isVideoAnalysis ? (options?.currentSnapshotIndex ?? 0) + 1 : 0;
  const analysisPrompt = withLocale(
    isVideoAnalysis ? ANALYSIS_PROMPT_VIDEO_TEMPLATE(videoMediaIndex)
      : options?.analysisContext === 'post-edit' ? ANALYSIS_PROMPT_POSTEDIT : ANALYSIS_PROMPT_INITIAL,
    options?.locale,
  );

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
  if (animImages?.length && !analysisOnly && !tipReactionOnly) {
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
    userContent = analysisOnly ? analysisPrompt : (designInjection + prompt);
  }

  // Build system prompt. Lightweight modes must stay small: they power
  // auto-analysis/reactions where first visible text matters more than the
  // full workspace skill surface.
  const endSystemPrompt = perf?.span('build_system_prompt', {
    projectId,
    userSkills: options?.userSkills?.length ?? 0,
    mode: tipReactionOnly ? 'tipReaction' : analysisOnly ? 'analysis' : 'normal',
  });
  const systemPrompt = (analysisOnly || tipReactionOnly)
    ? buildLightweightSystemPrompt(analysisOnly ? 'analysis' : 'tipReaction', options?.locale)
    : await buildSystemPrompt(options?.userSkills, options?.supabase, options?.userId, projectId);
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

  // B7: cache the conversation history up through the last non-user turn.
  // Tool-aware history can end with a `tool` message, so include it in the
  // cache point; otherwise expensive tool results sit outside cached prefix.
  // Only worth the cacheWrite cost when the conversation has real history
  // (≥ 2 prior turns including at least one model/tool response). Short sessions skip.
  const msgs: Array<ModelMessage & { providerOptions?: Record<string, unknown> }> =
    [...history, { role: 'user', content: userContent } as ModelMessage];
  if (history.length >= 2) {
    for (let i = msgs.length - 2; i >= 0; i--) {
      if (msgs[i].role === 'assistant' || msgs[i].role === 'tool') {
        msgs[i].providerOptions = ANTHROPIC_CACHE_CONTROL;
        break;
      }
    }
  }

  try {

    const endStreamInit = perf?.span('model_stream_init', { projectId });
    const agentModelId = getAgentModelId();
    const thinkingMode = getAnthropicThinkingMode();
    const reasoningEffort = getAnthropicReasoningEffort();
    const result = (streamText as any)({
      model: getAgentModel(),
      system: [{ role: 'system', content: systemPrompt, providerOptions: ANTHROPIC_CACHE_CONTROL }],
      messages: msgs,
      ...(tools ? { tools } : {}),
      ...(analysisOnly && tools ? { activeTools: [isVideoAnalysis ? 'analyze_video' : 'analyze_image'] } : {}),
      stopWhen: stepCountIs(maxSteps),
      prepareStep: ({ messages }: { messages: ModelMessage[] }) => ({
        messages: normalizeBedrockToolUseInputs(messages),
      }),
      onStepFinish: () => { stepCount++; },
      providerOptions: {
        anthropic: {
          disableParallelToolUse: true,
          toolStreaming: false,
          ...(thinkingMode ? { thinking: { type: thinkingMode } } : {}),
          ...(thinkingMode !== 'disabled' && reasoningEffort ? { effort: reasoningEffort } : {}),
          contextManagement: getAnthropicContextManagement(agentModelId),
        },
      },
    });
    endStreamInit?.();

    // State machine for extracting code from run_code tool-input-delta
    let codeExtractor: { buffer: string; state: 'waiting' | 'in_code' | 'done'; escaped: boolean; sent: number } | null = null;
    const textDeltaState = createTextDeltaState();

    for await (const event of result.fullStream) {
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
        const isEnLocale = options?.locale === 'en';
        yield { type: 'status' as const, text: isEnLocale ? 'Planning...' : '规划中...' };
        continue;
      }

      // ── Tool input streaming — extract code in real-time for run_code ──
      if (event.type === 'tool-input-start') {
        const toolName = (event as any).toolName ?? '';
        if (toolName === 'run_code') {
          codeExtractor = { buffer: '', state: 'waiting', escaped: false, sent: 0 };
          const isEnLocale = options?.locale === 'en';
          yield { type: 'status' as const, text: isEnLocale ? 'Generating code...' : '代码生成中...' };
        }
        continue;
      }
      if (event.type === 'tool-input-delta') {
        if (!codeExtractor || codeExtractor.state === 'done') continue;
        const delta = (event as any).delta ?? '';
        codeExtractor.buffer += delta;

        if (codeExtractor.state === 'waiting') {
          // Look for "code": " or "code":" marker (with or without space)
          const match = codeExtractor.buffer.match(/"code"\s*:\s*"/);
          if (!match || match.index === undefined) continue;
          // Found — switch to in_code, start after the opening quote
          codeExtractor.state = 'in_code';
          codeExtractor.sent = match.index + match[0].length;
        }

        if (codeExtractor.state === 'in_code') {
          // Scan new characters for end of JSON string value
          let codeChunk = '';
          let i = codeExtractor.sent;
          while (i < codeExtractor.buffer.length) {
            const ch = codeExtractor.buffer[i];
            if (codeExtractor.escaped) {
              // Unescape JSON: \n → newline, \t → tab, \" → ", \\ → \
              if (ch === 'n') codeChunk += '\n';
              else if (ch === 't') codeChunk += '\t';
              else if (ch === '"') codeChunk += '"';
              else if (ch === '\\') codeChunk += '\\';
              else if (ch === '/') codeChunk += '/';
              else codeChunk += ch;  // fallback: keep as-is
              codeExtractor.escaped = false;
            } else if (ch === '\\') {
              codeExtractor.escaped = true;
            } else if (ch === '"') {
              // End of code value
              codeExtractor.state = 'done';
              break;
            } else {
              codeChunk += ch;
            }
            i++;
          }
          codeExtractor.sent = i;
          if (codeChunk) {
            yield { type: 'code_stream', text: codeChunk };
          }
          if (codeExtractor.state === 'done') {
            yield { type: 'code_stream', text: '', done: true };
          }
        }
        continue;
      }

      // ── Text delta ──────────────────────────────────────────────────────────
      if (event.type === 'text-delta') {
        const text = normalizeTextDelta(event as { delta?: unknown; textDelta?: unknown; text?: unknown }, textDeltaState);
        if (text) yield { type: 'content', text };
        continue;
      }

      // ── Tool call ───────────────────────────────────────────────────────────
      if (event.type === 'tool-call') {
        toolCallStartTime = Date.now();
        toolCallName = event.toolName;
        activeToolCallId = (event as { toolCallId?: string }).toolCallId || crypto.randomUUID();
        console.log(`⏱️ [agent] tool-call "${event.toolName}" at +${((Date.now() - agentStartTime) / 1000).toFixed(1)}s`);
        perf?.mark('tool_call', {
          tool: event.toolName,
          step: stepCount,
          sinceAgentStartMs: Date.now() - agentStartTime,
        });
        const isEnLocale = options?.locale === 'en';
        if (event.toolName === 'analyze_image') {
          const q = (event.input as { question?: string }).question;
          yield { type: 'status', text: isEnLocale
            ? (q ? `Analyzing image: ${q.slice(0, 50)}` : 'Analyzing image')
            : (q ? `分析图片：${q.slice(0, 40)}` : '分析图片') };
        } else if (event.toolName === 'analyze_video') {
          const q = (event.input as { question?: string }).question;
          yield { type: 'status', text: isEnLocale
            ? (q ? `Analyzing video: ${q.slice(0, 50)}` : 'Analyzing video')
            : (q ? `分析视频：${q.slice(0, 40)}` : '分析视频') };
        } else if (event.toolName === 'transcribe_audio') {
          yield { type: 'status', text: isEnLocale ? 'Transcribing audio...' : '转写音频中...' };
        } else if (event.toolName === 'list_voiceover_voices') {
          yield { type: 'status', text: isEnLocale ? 'Choosing voice...' : '选择配音音色中...' };
        } else if (event.toolName === 'generate_voiceover') {
          yield { type: 'status', text: isEnLocale ? 'Generating voiceover...' : '生成配音中...' };
        } else if (event.toolName === 'generate_audio' || event.toolName === 'generate_music') {
          yield { type: 'status', text: isEnLocale ? 'Generating audio...' : '生成音频中...' };
        } else if (event.toolName === 'preview_frame') {
          const input = event.input as { frame?: number; timestamp?: number; frames?: number[]; timestamps?: number[] };
          const batch = input.frames?.length ? input.frames.join(', ') : input.timestamps?.length ? input.timestamps.map(value => `${value}s`).join(', ') : '';
          const hint = batch || (input.frame !== undefined ? `frame ${input.frame}` : input.timestamp !== undefined ? `${input.timestamp}s` : 'frame 0');
          yield { type: 'status', text: isEnLocale ? `Capturing ${hint}...` : `截帧 ${hint}...` };
        } else if (event.toolName === 'generate_image') {
          yield { type: 'status', text: isEnLocale ? 'Generating image...' : '生成图片中...' };
        } else if (event.toolName === 'list_files') {
          yield { type: 'status', text: isEnLocale ? 'Browsing workspace...' : '浏览工作台...' };
        } else if (event.toolName === 'read_file') {
          const p = (event.input as { path?: string }).path || '';
          yield { type: 'status', text: isEnLocale ? `Reading ${p.split('/').pop()}...` : `读取 ${p.split('/').pop()}...` };
        } else if (event.toolName === 'write_file') {
          yield { type: 'status', text: isEnLocale ? 'Saving...' : '保存中...' };
        } else if (event.toolName === 'delete_file') {
          yield { type: 'status', text: isEnLocale ? 'Deleting...' : '删除中...' };
        } else if (event.toolName === 'run_code') {
          const desc = (event.input as { description?: string }).description;
          yield { type: 'status', text: isEnLocale ? `Running: ${desc || 'code'}...` : `执行: ${desc || '代码'}...` };
        } else if (event.toolName === 'rotate_camera') {
          yield { type: 'status', text: isEnLocale ? 'Rotating camera...' : '旋转相机中...' };
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
        const displayInput = isRunCode
          ? directComposition
            ? { ...toolInput, composition: { ...directComposition, code: `[code streamed separately: ${streamedCode.length} chars]` } }
            : { ...toolInput, code: `[code streamed separately: ${streamedCode.length} chars]` }
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
        if (isRunCode && (!codeExtractor || codeExtractor.state === 'waiting')) {
          const code = streamedCode;
          const CHUNK = 500;
          for (let i = 0; i < code.length; i += CHUNK) {
            yield { type: 'code_stream', text: code.slice(i, i + CHUNK) };
          }
          yield { type: 'code_stream', text: '', done: true };
        }
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
        const isEnLocale = options?.locale === 'en';
        yield { type: 'status', text: isEnLocale ? 'Thinking...' : 'Agent 正在思考...' };
        if (toolName) {
          yield { type: 'tool_result', tool: toolName, toolCallId, step: stepCount, output: toolOutput };
          const generatedAudioLine = formatGeneratedAudioForCui(toolName, toolOutput);
          if (generatedAudioLine) {
            yield { type: 'content', text: generatedAudioLine };
          }
        }
        activeToolCallId = undefined;

        // Emit image_analyzed event so frontend can save the description
        if (toolName === 'analyze_image' || toolName === 'analyze_video') {

          const analyzeInput = (event as any).input as { media_index?: number } | undefined;
          const analyzedIdx = analyzeInput?.media_index ?? (ctx.currentSnapshotIndex + 1);
          yield { type: 'image_analyzed', imageIndex: analyzedIdx };
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
            const isEn = options?.locale === 'en';
            yield { type: 'status', text: isEn ? 'Image generation failed' : '图片生成失败' };
          }
        }

        while (imagesSent < ctx.generatedImages.length) {
          yield { type: 'image', image: ctx.generatedImages[imagesSent], usedModel: ctx.lastUsedModel };
          imagesSent++;
        }
        yield* flushPendingImageSnapshots(ctx);
        if (ctx.animationTaskId) {
          yield { type: 'animation_task', taskId: ctx.animationTaskId, prompt: ctx.animationPrompt || '', imageUrls: ctx.animationImageUrls_, model: ctx.animationModel };
          ctx.animationTaskId = undefined;
          ctx.animationPrompt = undefined;
          ctx.animationImageUrls_ = undefined;
          ctx.animationModel = undefined;
        }
        if (ctx.pendingVideoSnapshots?.length) {
          for (const pending of ctx.pendingVideoSnapshots) {
            yield { type: 'video_snapshot', ...pending };
          }
          ctx.pendingVideoSnapshots = undefined;
        }
        if (ctx.pendingVideoSnapshot) {
          yield { type: 'video_snapshot', ...ctx.pendingVideoSnapshot };
          ctx.pendingVideoSnapshot = undefined;
        }
        if ((ctx as any).musicTaskId) {
          yield { type: 'music_task', taskId: (ctx as any).musicTaskId };
          (ctx as any).musicTaskId = undefined;
        }
        continue;
      }

      // ── Error from stream ──────────────────────────────────────────────────
      if (event.type === 'error') {

        const err = (event as any).error;
        const errMsg = normalizeAgentErrorMessage(err);
        yield { type: 'error', message: errMsg };
        return;
      }

      // ── New step start (after tool result, model begins next turn) ──────────
      if (event.type === 'start-step' && stepCount > 0) {
        yield { type: 'new_turn' };
      }
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

    // Emit token usage for billing — totalUsage aggregates across all steps (multi-turn)
    try {
      const usage = await result.totalUsage;
      if (usage) {
        const modelId = getAgentModelId();
        // Vercel AI SDK v6 semantics (VERIFIED from official source):
        //   - `usage.inputTokens` = TOTAL (noCache + cacheRead + cacheWrite)
        //     See ai/src/types/usage.ts asLanguageModelUsage — `inputTokens: usage.inputTokens.total`
        //     See @ai-sdk/amazon-bedrock/src/convert-bedrock-usage.ts — `total = input + read + write`
        //   - To bill correctly, we MUST use inputTokenDetails.{noCacheTokens,cacheReadTokens,cacheWriteTokens}
        //     and charge each at its own rate. Using `inputTokens` directly billed cache @ base 1× (overcharge).
        const u = usage as { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; inputTokenDetails?: { noCacheTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number } };
        const d = u.inputTokenDetails;
        const cacheRead = d?.cacheReadTokens ?? u.cachedInputTokens ?? 0;
        const cacheWrite = d?.cacheWriteTokens ?? 0;
        // Prefer explicit noCacheTokens; fall back to (total − cache parts) for robustness.
        const noCache = d?.noCacheTokens ?? Math.max(0, (u.inputTokens ?? 0) - cacheRead - cacheWrite);
        const totalInput = u.inputTokens ?? (noCache + cacheRead + cacheWrite);
        const hitRate = totalInput > 0 ? ((cacheRead / totalInput) * 100).toFixed(1) : '0';
        console.log(
          `[agent-usage] totalInput=${totalInput} (noCache=${noCache} cacheRead=${cacheRead} cacheWrite=${cacheWrite}) output=${u.outputTokens ?? 0} hitRate=${hitRate}% model=${modelId}`
        );
        // Emit noCache as `inputTokens` so consumers billing with the legacy 2-arg signature
        // (tokensToCredits) no longer overcharge by billing cache at base rate.
        yield { type: 'usage', inputTokens: noCache, outputTokens: u.outputTokens ?? 0, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, model: modelId };
      }
    } catch { /* best effort — don't fail the stream if usage unavailable */ }

    yield { type: 'done' };
  } catch (err) {
    const bedrockToolInputIssue = describeBedrockToolUseInputIssue(err);
    if (bedrockToolInputIssue) {
      console.error(`[agent] Bedrock toolUse input issue: ${bedrockToolInputIssue}`);
    }
    const errorMessage = normalizeAgentErrorMessage(err);
    console.log(`⏱️ [agent] ERROR at +${((Date.now() - agentStartTime) / 1000).toFixed(1)}s: ${errorMessage}`);
    yield { type: 'error', message: errorMessage };
  }
}

// ---------------------------------------------------------------------------
// Tips Skill: generate tips text using Claude (fast, ~2-3s vs Gemini ~15s)
// ---------------------------------------------------------------------------

const TIPS_JSON_FORMAT_ZH = `\n\n以JSON数组格式输出，只输出JSON：
[{"emoji":"emoji","label":"2-4个中文字","desc":"中文短描述20字以内","editPrompt":"(MUST be in English) Detailed English editing instructions...","category":"enhance|creative|wild|captions"}, ...]`;

const TIPS_JSON_FORMAT_EN = `\n\nOutput as JSON array only, no other text:
[{"emoji":"emoji","label":"2-3 English words","desc":"English description under 20 words","editPrompt":"Detailed English editing prompt","category":"enhance|creative|wild|captions"}, ...]`;

const TIPS_PROMPTS: Record<'enhance' | 'creative' | 'wild' | 'captions', string> = {
  enhance: enhancePrompt,
  creative: creativePrompt,
  wild: wildPrompt,
  captions: captionsPrompt,
};

// Category-specific system prompts (restored from original gemini.ts structure)
const TIPS_CATEGORY_INFO: Record<'enhance' | 'creative' | 'wild' | 'captions', { cn: string; definition: string; selfCheck: string; rules: string }> = {
  enhance: {
    cn: 'enhance（专业增强）',
    definition: 'enhance = 让照片整体变好看（光影/色彩/通透感），变化必须肉眼明显',
    selfCheck: `enhance自检：
- 放在原图旁边，任何人都能一眼看出提升吗？（"看不出变化"=3分）
- 风格与照片情绪匹配吗？（搞笑照片配阴沉暗调=4分）
- 有通透感+景深分离+色调层次吗？
- enhance可以调整构图，但必须基于原图——编辑后还能一眼认出是同一张照片（"画面变化太多了"=3分）
- 编辑后的背景还是原图的背景吗？enhance是提升原图不是生成新图（"背景被换掉了"=3分，"人物都变了"=1分）`,
    rules: `⚠️ enhance的editPrompt必须包含背景锚定：
"Keep the original background scene intact — enhance lighting and colors on the existing scene, do NOT replace or regenerate the background."`,
  },
  creative: {
    cn: 'creative（趣味创意）',
    definition: 'creative = 往画面里加入一个与画面内容有因果关系的有趣新元素',
    selfCheck: `creative自检（三问全过才输出）：
- Q1 为什么是这个元素？能不能一句话说清"因为画面里有X所以加Y"？说不清=换一个
- Q2 情绪对吗？让人笑/惊喜=好，让人害怕/困惑=换
- Q3 这个创意能用在其他照片上吗？能=太通用=换一个`,
    rules: `creative品质标准：
- 加入的动物/角色必须是photorealistic写实风（cartoon/卡通=贴纸感）
- 足够大且显眼，至少占画面5-10%面积
- 必须与人物有互动/眼神交流，不能像贴纸`,
  },
  wild: {
    cn: 'wild（疯狂脑洞）',
    definition: 'wild = 让画面中已有的物品发生疯狂变化（不是加新东西！）',
    selfCheck: `wild自检（四问全过才输出）：
- Q1 变化的主角是画面中已有的什么东西？指不出来=不是wild
- Q2 变化够大吗？一眼就能看到变化=好。改镜片/眼镜反射内容=太小不够大(3分"眼镜idea傻")
- Q3 变化是基于物品本身特点还是随便套的？表面视觉类比（层状=蛋糕/抹茶、圆形=球）=换一个。"变成食物/饮品"除非厨房场景否则=万金油套路
- Q4 这个变化会不会让人不适/恐怖？→ 换一个有趣的方向`,
    rules: `wild额外规则：只选画面中重要/显眼的元素做变化，不要选边缘模糊的小物件`,
  },
  captions: {
    cn: 'captions（创意文案）',
    definition: 'captions = 为照片添加与内容高度相关的创意文字叠加，字体风格必须与照片情绪一致',
    selfCheck: `captions自检（三问全过才输出）：
- Q1 这段文字只适合这张照片吗？换到其他照片上还合适=太通用=重写
- Q2 字体风格与画面情绪匹配吗？（童趣照配严肃字体=4分，搞笑配优雅花体=3分）
- Q3 有metadata时自然融入了吗？有地点/时间必须结合进文案`,
    rules: `captions品质标准：
- 文字必须是photorealistic渲染，不是卡通贴纸
- 明确写出要叠加的文字内容（不能让Gemini自己编）
- 一个tip只加一句/一行文字，简洁有力
- 两个tip风格必须不同（如一中一英，或一童趣一简洁）`,
  },
};

function buildTipsSystemPrompt(category: 'enhance' | 'creative' | 'wild' | 'captions'): string {
  const info = TIPS_CATEGORY_INFO[category];
  const labelNote = category === 'captions'
    ? 'label: 2-3 words, include scene/style context.'
    : 'label: 2-3 words.';
  const base = `Photo editing expert. Analyze image and generate 2 ${category} edit suggestions. ${labelNote} editPrompt in English, highly specific.

${info.definition}

⚠️ 第一步：判断人脸大小！
分析图片时首先判断人脸在画面中的占比：
- 大脸（特写/半身照，脸部占画面>10%）→ 正常处理
- 小脸（全身照/合照/远景/广角，脸部占画面<10%）→ 触发小脸保护模式
小脸保护模式下所有editPrompt必须包含：
"CRITICAL: Faces in this photo are small. Leave ALL face areas completely untouched — do NOT sharpen, enhance, retouch, relight, resize, or process any face region in any way. Treat face areas as if they are masked off and invisible to you."
小脸时人物反应只能用身体语言（身体后仰/转头/手指向变化），绝不能要求面部表情变化。

自检框架（输出每个tip前先过一遍）：

${info.selfCheck}

${info.rules}

⚠️ 人脸保真是最大扣分项！涉及人物的editPrompt必须包含：
"Preserve each person's identity, bone structure, face shape exactly. Do not make faces wider or rounder."

⚠️ 所有editPrompt都必须包含背景净化：
"Clean up the scene like a professional photographer would before shooting: remove any object that draws attention away from the main subject but adds no compositional value. Replace cleaned areas with natural-looking continuation of the scene."

2个tip必须选不同方向。结尾加"Do NOT add any text, watermarks, or borders."`;
  // No withLocale — language of label/desc controlled by TIPS_JSON_FORMAT per locale.
  // editPrompt must ALWAYS be English regardless of locale.
  return base;
}

export async function* streamTipsWithClaude(
  imageBase64: string,
  category: 'enhance' | 'creative' | 'wild' | 'captions',
  metadata?: { takenAt?: string; location?: string },
  locale?: string,
): AsyncGenerator<Tip> {
  const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
  const template = TIPS_PROMPTS[category];
  const systemPrompt = buildTipsSystemPrompt(category);

  // Build metadata context string
  const metaLines: string[] = [];
  if (metadata?.takenAt) metaLines.push(`Date taken: ${metadata.takenAt}`);
  if (metadata?.location) metaLines.push(`Location: ${metadata.location}`);
  const metaContext = metaLines.length > 0
    ? `[Photo Metadata]\n${metaLines.join('\n')}\n(Use for creative inspiration: local landmarks, time-of-day lighting, seasonal elements, etc.)\n\n`
    : '';

  const userPrompt = `${metaContext}在生成建议之前，先分析这张图片：判断人脸大小；识别画面中的具体物品/食物/道具；判断照片情绪基调。

基于分析，给出2条${category}编辑建议。以下是详细规范（必须遵循）：

${template}${locale === 'en' ? TIPS_JSON_FORMAT_EN : TIPS_JSON_FORMAT_ZH}`;

  const { textStream } = streamText({
    model: getAgentModel(),
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', image: dataUrl },
          { type: 'text', text: userPrompt },
        ],
      },
    ],
  });

  // Collect full text then parse JSON
  let fullText = '';
  for await (const delta of textStream) {
    fullText += delta;
  }

  // Extract JSON array from response
  const jsonMatch = fullText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return;

  try {
    const tips = JSON.parse(jsonMatch[0]) as Tip[];
    for (const tip of tips) {
      if (tip.label && tip.editPrompt && tip.category) {
        yield tip;
      }
    }
  } catch { /* parse error, yield nothing */ }
}
