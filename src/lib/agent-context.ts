/**
 * Server-side prompt context builder for Makaron Agent.
 *
 * Builds the same context blocks that Editor.tsx constructs on the frontend,
 * but from DB queries. This enables headless agent execution (CLI, MCP, API)
 * without any frontend dependency.
 *
 * Frontend-only context (annotation, draft warnings) is passed via options.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModelMessage } from 'ai';
import type { DesignPayload, Tip } from '@/types';
import * as workspace from './workspace';
import { buildModelHistoryFromRows, type DbToolHistoryRow } from './agentToolHistory';
import { formatVideoMediaSpec } from './media-aspect';

export interface AudioAttachmentContext {
  audioUrl: string;
  title?: string;
  duration?: number;
  trackIndex?: number;
}

export interface PromptContextOptions {
  /** 0-based index of the snapshot the user is viewing. Defaults to last. */
  currentSnapshotIndex?: number;
  /** User's text message */
  userMessage: string;
  /** Frontend-only: image has annotations drawn by user */
  hasAnnotation?: boolean;
  /** Frontend-only: viewing a tip draft preview */
  isDraft?: boolean;
  /** Number of attached reference images */
  referenceImageCount?: number;
  /** Number of just-uploaded videos (for context hint with media index) */
  uploadedVideoCount?: number;
  /** Audio references for this turn. Not part of Timeline Media Index. */
  audioAttachments?: AudioAttachmentContext[];
}

export interface PromptContextResult {
  fullPrompt: string;
  /** Prior user/assistant turns (excluding the current user prompt).
   *  Passed to streamText as the messages[] prefix so Bedrock sees a real
   *  multi-turn conversation — required for per-turn cachePoint (B7). */
  history: ModelMessage[];
  snapshotImages: string[];
  currentSnapshotIndex: number;
  currentDesign?: DesignPayload;
  currentDesignPath?: string;
  /** Project-scoped audio refs available as audio_1, audio_2, ... (not media_N). */
  audioAttachments: AudioAttachmentContext[];
}

interface DbSnapshot {
  id: string;
  image_url: string;
  description?: string;
  type?: string;
  design_path?: string;
  tips: Tip[];
  sort_order: number;
  video_meta?: Record<string, unknown>;
  metadata?: { takenAt?: string; location?: string };
}

interface DbMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

interface DbProjectMusic {
  audio_url?: string | null;
  suno_audio_url?: string | null;
  stream_audio_url?: string | null;
  duration?: number | null;
  title?: string | null;
  track_index?: number | null;
  status?: string | null;
  tags?: string | null;
}

function getUsableAudioUrl(row: DbProjectMusic): string {
  return row.audio_url || row.suno_audio_url || row.stream_audio_url || '';
}

function normalizeAudioAttachment(audio: AudioAttachmentContext): AudioAttachmentContext | null {
  if (!audio.audioUrl || !/^https?:\/\//.test(audio.audioUrl)) return null;
  return {
    audioUrl: audio.audioUrl,
    title: audio.title,
    duration: typeof audio.duration === 'number' && Number.isFinite(audio.duration) ? audio.duration : undefined,
    trackIndex: typeof audio.trackIndex === 'number' && Number.isFinite(audio.trackIndex) ? audio.trackIndex : undefined,
  };
}

function mergeAudioAttachments(
  projectAudios: AudioAttachmentContext[],
  turnAudios: AudioAttachmentContext[] | undefined,
): AudioAttachmentContext[] {
  const merged: AudioAttachmentContext[] = [];
  const seen = new Set<string>();
  for (const audio of [...projectAudios, ...(turnAudios || [])]) {
    const normalized = normalizeAudioAttachment(audio);
    if (!normalized) continue;
    const key = normalized.audioUrl.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(normalized);
  }
  return merged;
}

function normalizeLegacyCompositionDescription(description: string | undefined, fallback: string): string {
  if (!description) return fallback;
  const trimmed = description.trim();
  if (trimmed === '[design]' || trimmed === '[design/video]') return fallback;
  if (trimmed === 'still design') return 'still composition';
  return description;
}

function formatTranscriptMediaHint(videoMeta: Record<string, unknown> | undefined): string {
  const transcript = videoMeta?.transcript as Record<string, unknown> | undefined;
  if (!transcript || typeof transcript.text !== 'string' || !transcript.text.trim()) return '';
  const utteranceCount = Array.isArray(transcript.utterances) ? transcript.utterances.length : 0;
  const preview = transcript.text.trim().replace(/\s+/g, ' ').slice(0, 180);
  return ` [ASR transcript cached: ${utteranceCount} utterances, "${preview}${transcript.text.length > 180 ? '...' : ''}"]`;
}

export async function buildPromptContext(
  projectId: string,
  supabase: SupabaseClient,
  userId: string,
  options: PromptContextOptions,
): Promise<PromptContextResult> {
  const { userMessage, hasAnnotation, isDraft, referenceImageCount, uploadedVideoCount, audioAttachments } = options;

  // Query snapshots, visible messages, private tool history, and project audio
  // in parallel. Audio is a separate project-scoped index; it never occupies
  // Timeline Media Index slots like <<<media_N>>>.
  const [snapshotsRes, messagesRes, toolHistoryRes, musicRes] = await Promise.all([
    supabase
      .from('snapshots')
      .select('id, image_url, description, type, design_path, tips, sort_order, video_meta, metadata')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('messages')
      .select('id, role, content, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true }),
    supabase
      .from('agent_tool_history')
      .select('created_at, run_id, step, seq, tool_call_id, tool_name, input, output')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
    supabase
      .from('project_music')
      .select('audio_url, suno_audio_url, stream_audio_url, duration, title, track_index, status, tags')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .in('status', ['completed', 'streaming'])
      .order('track_index', { ascending: true })
      .limit(20),
  ]);

  const snapshots: DbSnapshot[] = snapshotsRes.data ?? [];
  const messages: DbMessage[] = messagesRes.data ?? [];
  const toolHistory: DbToolHistoryRow[] = toolHistoryRes.data ?? [];
  const projectAudios: AudioAttachmentContext[] = ((musicRes.data ?? []) as DbProjectMusic[])
    .map((row) => {
      const audioUrl = getUsableAudioUrl(row);
      return {
        audioUrl,
        title: row.title || undefined,
        duration: typeof row.duration === 'number' ? row.duration : undefined,
        trackIndex: typeof row.track_index === 'number' ? row.track_index : undefined,
      };
    })
    .filter((audio) => !!audio.audioUrl);
  const resolvedAudioAttachments = mergeAudioAttachments(projectAudios, audioAttachments);

  const currentSnapshotIndex = options.currentSnapshotIndex ?? Math.max(0, snapshots.length - 1);
  const currentSnap = snapshots[currentSnapshotIndex];

  // Load design from workspace if current snapshot has one (skip for video snapshots —
  // their design_path is only a Remotion playback wrapper, not user-editable code)
  let currentDesign: DesignPayload | undefined;
  const currentSnapIsVideo = currentSnap?.type === 'video';
  const currentDesignPath = currentSnap?.design_path && !currentSnapIsVideo ? currentSnap.design_path : undefined;
  if (currentDesignPath) {
    try {
      const file = await workspace.readFile(currentDesignPath, supabase, userId);
      if (file) currentDesign = JSON.parse(file.content);
    } catch { /* design load failed, continue without */ }
  }

  // --- Build context blocks (same format as Editor.tsx) ---

  // Photo metadata (location + time) from original snapshot
  const originalMeta = snapshots[0]?.metadata;
  const metaLines: string[] = [];
  if (originalMeta?.takenAt) metaLines.push(`Time: ${originalMeta.takenAt}`);
  if (originalMeta?.location) metaLines.push(`Location: ${originalMeta.location}`);
  const metaContext = metaLines.length > 0
    ? `[Photo Metadata]\n${metaLines.join('\n')}\n\n`
    : '';

  // Description
  const descriptionContext = currentSnap?.description
    ? `[图片分析结果]\n${currentSnap.description}\n\n`
    : '';

  // Conversation history — real AI SDK ModelMessage[] turns, including private
  // sanitized tool call/results. Drop trailing user messages so the current
  // turn's prompt isn't duplicated if the caller already wrote it to DB.
  const history = buildModelHistoryFromRows(messages, toolHistory, 50);

  // Tips
  const currentTips: Tip[] = Array.isArray(currentSnap?.tips) ? currentSnap.tips : [];
  const tipsContext = currentTips.length > 0
    ? `[当前TipsBar中的编辑建议]\n${currentTips.map(t => `- [${t.category}] ${t.emoji} ${t.label}：${t.desc}`).join('\n')}\n\n`
    : '';

  // Snapshot warning (viewing intermediate version)
  const isIntermediateSnapshot = currentSnapshotIndex < snapshots.length - 1;
  const snapshotWarning = isIntermediateSnapshot
    ? `[重要提示] 用户当前正在编辑的是第 ${currentSnapshotIndex + 1} 个版本（共 ${snapshots.length} 个），不是最新版本。对话历史描述的是其他版本的状态，与当前图片无关。请完全以传入的当前图片为准，忽略对话历史中对图片内容的描述。\n\n`
    : '';

  // Snapshot index — emit even for single-snapshot projects so the model always knows
  // at minimum that an image exists (prevents design-from-nothing hallucination).
  const snapshotIndexContext = snapshots.length >= 1
    ? `[Media Index — ${snapshots.length} items]\n${snapshots.map((s, i) => {
        const isRef = s.type === 'reference';
        const isVideo = s.type === 'video';
        const videoMeta = s.video_meta as Record<string, unknown> | undefined;
        const isComposition = !!s.design_path && !isVideo;
        const desc = isVideo
          ? (s.description || (videoMeta?.prompt as string)?.split('\n')[0]?.slice(0, 60) || '[video]')
          : isRef
            ? (s.description || 'Skill reference image')
            : isComposition
              ? normalizeLegacyCompositionDescription(s.description, '[Remotion composition]')
              : i === 0 || snapshots.slice(0, i).every(ss => ss.type === 'reference')
                ? (s.description || '原图 / Original upload')
                : (s.description || '(use analyze_image to see this snapshot)');
        const videoSpec = isVideo ? formatVideoMediaSpec(videoMeta) : '';
        const typeLabel = isVideo
          ? (videoSpec ? `video, ${videoSpec}` : 'video')
          : isRef ? 'reference' : isComposition ? 'composition' : 'image';
        const marker = i === currentSnapshotIndex ? '  ← YOU ARE HERE' : '';
        const videoTag = isVideo && videoMeta?.videoUrl ? ` [video: ${videoMeta.videoUrl}]` : '';
        const transcriptTag = isVideo ? formatTranscriptMediaHint(videoMeta) : '';
        const codePath = s.design_path && !isVideo ? ` [composition code: ${s.design_path}]` : '';
        return `<<<media_${i + 1}>>> [${typeLabel}]${marker} — ${desc}${videoTag}${transcriptTag}${codePath}`;
      }).join('\n')}\n\n`
    : '';

  // Video/composition mode warnings (mutually exclusive)
  const videoWarning = currentSnapIsVideo
    ? `[VIDEO MODE] You are viewing a video. Use analyze_video for visual scenes/actions. Use transcribe_audio for dialogue, subtitles, word/utterance timestamps, or time-based cuts. Do NOT read or patch its composition code — that is only a playback wrapper.\n\n`
    : '';

  const designWarning = !currentSnapIsVideo && currentDesignPath
    ? `[COMPOSITION MODE] You are viewing a Remotion composition (not a photo). Do NOT call analyze_image — it only shows a static poster frame, not the actual content. Modify the existing composition by using its workspace code path with run_code patch mode.\n\n`
    : '';

  // Composition editable state and path contract. Keep the full code out of the
  // prompt; the agent must use code_path explicitly when patching persisted compositions.
  const designContext = currentDesignPath
    ? `[Current Composition]\npath: ${currentDesignPath}${currentDesign ? `\nwidth: ${currentDesign.width}\nheight: ${currentDesign.height}${currentDesign.animation ? `\nanimation: ${currentDesign.animation.durationInSeconds}s @ ${currentDesign.animation.fps}fps` : ''}` : ''}\nTo modify this composition, call run_code with { type: 'patch', code_path: '${currentDesignPath}', edits: [...] } or { type: 'patch', code_path: '${currentDesignPath}', props: {...} } and runtime: "composition". Use props-only patches for text/data changes. Do not recreate it with render unless the user asks for a new composition.\n${currentDesign?.editables?.length ? `\n[Composition Editable State]\n${currentDesign.editables.map(f =>
        `- ${f.label} (${f.propKey}): "${(currentDesign!.props as Record<string, unknown>)?.[f.propKey] ?? ''}"`
      ).join('\n')}\nUser may have edited these values in the GUI. Preserve/merge current props when patching.\n` : ''}\n`
    : '';

  // Frontend-only warnings
  const annotationWarning = hasAnnotation
    ? `[ANNOTATION MODE] The current image has red annotations drawn by the user. You MUST edit THIS image based on the annotations — do NOT use media_index to switch to another snapshot. Call analyze_image first (without media_index) to see the annotations, then generate_image (without media_index) to edit.\n\n`
    : '';

  const draftWarning = isDraft
    ? `[DRAFT PREVIEW MODE] The user is viewing a tip preview (not yet committed). This draft image is NOT in the media index. Omit media_index to edit this draft directly.\n\n`
    : '';

  const isFrameAnchoredVideoEdit = !!(referenceImageCount && /@\d+/.test(userMessage) && /\b\d+:\d{2}\b/.test(userMessage));
  const refContext = referenceImageCount && !isFrameAnchoredVideoEdit
    ? `[用户上传了 ${referenceImageCount} 张参考图，已自动传给 generate_image 工具使用]\n\n`
    : '';

  const frameAnchoredVideoEditContext = isFrameAnchoredVideoEdit
    ? `[Frame-anchored video edit]\nThe user attached a screenshot/frame and referenced a video moment in the text. Treat the attached image as the visual anchor for local video repair: read skills/video-segment-edit/SKILL.md, locate the moment with analyze_video({ mode: "locate_frame" }) using the screenshot + referenced video, and do not call generate_animation until the user explicitly confirms generation.\n\n`
    : '';

  const videoUploadContext = uploadedVideoCount
    ? (() => {
        const total = snapshots.length;
        const startIdx = total - uploadedVideoCount + 1;
        return `[User uploaded ${uploadedVideoCount === 1 ? 'a video' : `${uploadedVideoCount} videos`} — added to Media Index as <<<media_${startIdx}>>>${uploadedVideoCount > 1 ? ` to <<<media_${total}>>>` : ''}]\n\n`;
      })()
    : '';

  const audioAttachmentContext = resolvedAudioAttachments.length
    ? `[Audio Index - not Timeline Media]\n${resolvedAudioAttachments.map((audio, i) => {
        const label = `audio_${i + 1}`;
        const title = audio.title || `Reference audio ${i + 1}`;
        const duration = typeof audio.duration === 'number' ? `, ${formatSecondsForPrompt(audio.duration)}s` : '';
        const track = typeof audio.trackIndex === 'number' ? `, project_music track_index=${audio.trackIndex}` : '';
        return `<<<${label}>>> [audio] — ${title}${duration}${track}, ${audio.audioUrl}`;
      }).join('\n')}\nUse these as music/audio references. To use one in video generation, mention its marker in story_prompt and pass audio_refs, e.g. story_prompt includes <<<audio_1>>> and audio_refs is ["audio_1"]. Audio markers are not Timeline Media Index items and must not be referenced as <<<media_N>>>.\n\n`
    : '';

  // Assemble
  const fullPrompt = `${videoWarning}${designWarning}${annotationWarning}${draftWarning}${snapshotWarning}${metaContext}${descriptionContext}${snapshotIndexContext}${designContext}${tipsContext}${refContext}${frameAnchoredVideoEditContext}${videoUploadContext}${audioAttachmentContext}[User request — detect language and reply in the same language]\n${userMessage}`;

  const snapshotImages = snapshots.map((s) => {
    const videoMeta = s.video_meta as Record<string, unknown> | undefined;
    const videoUrl = typeof videoMeta?.videoUrl === 'string' ? videoMeta.videoUrl : '';
    return s.type === 'video' && videoUrl ? videoUrl : (s.image_url || '');
  });

  return {
    fullPrompt,
    history,
    snapshotImages,
    currentSnapshotIndex,
    currentDesign,
    currentDesignPath,
    audioAttachments: resolvedAudioAttachments,
  };
}

function formatSecondsForPrompt(seconds: number): string {
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1).replace(/\.0$/, '');
}
