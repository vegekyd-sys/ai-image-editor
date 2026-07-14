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
import { loadCompositionDraft } from './composition-draft';
import { WorkspaceStudioRunStore } from './studio-run';
import {
  buildTypedCompactionMessage,
  formatDurableExecutionSnapshot,
  getAgentContextPolicy,
  normalizeExecutionSnapshot,
  selectModelHistoryWithinBudget,
  tailModelHistoryAtomically,
  type AgentContextPolicy,
  type ContextSelectionStats,
  type DurableExecutionSnapshot,
} from './agent-execution';

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
  /** Run being created for this request; excluded when locating a prior checkpoint. */
  currentRunId?: string | null;
  /** Durable execution id. agent_runs remains the shared CLI/CUI execution id. */
  executionRunId?: string | null;
  /** Model-aware context policy. Defaults to the conservative 200K policy. */
  contextPolicy?: AgentContextPolicy;
  /** Durable server attempt after attempt 1; use the typed handoff plus a compact atomic tail. */
  durableContinuation?: boolean;
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
  recoverableDesignPath?: string;
  /** Project-scoped audio refs available as audio_1, audio_2, ... (not media_N). */
  audioAttachments: AudioAttachmentContext[];
  executionSnapshot?: DurableExecutionSnapshot;
  contextStats: ContextSelectionStats;
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

export function buildAgentRecoveryContext(
  userMessage: string,
  metadata: Record<string, unknown> | null | undefined,
): string {
  const terminal = metadata?.terminal as Record<string, unknown> | undefined;
  const checkpoint = terminal?.checkpoint as Record<string, unknown> | undefined;
  const resumeIntent = /^(?:请)?\s*(?:(?:继续|接着|恢复|重试|续上)(?:\s|$|[，。！？,.!?]|做|改|完成|刚才|之前|前面|上次|原来|原先|此前)|(?:continue|resume|retry)\b)/i.test(userMessage.trim());
  if (!resumeIntent || terminal?.recoverable !== true || (!checkpoint?.draftPath && !checkpoint?.studioRunId)) return '';
  const draftContext = checkpoint.draftPath
    ? `\ndraft path: ${String(checkpoint.draftPath)}${checkpoint.previewUrl ? `\nlast preview: ${String(checkpoint.previewUrl)}` : ''}`
    : '';
  const studioContext = checkpoint.studioRunId
    ? `\nstudio run id: ${String(checkpoint.studioRunId)}${checkpoint.studioRunStage ? `\ncurrent studio stage: ${String(checkpoint.studioRunStage)}` : ''}${checkpoint.studioRunStatePath ? `\nstudio state path: ${String(checkpoint.studioRunStatePath)}` : ''}`
    : '';
  const streamedCodeContext = checkpoint.streamedCodePath
    ? `\npartial streamed code: ${String(checkpoint.streamedCodePath)} (${Number(checkpoint.streamedCodeChars) || 0} chars)`
    : '';
  const nextAction = checkpoint.studioRunId
    ? 'Call studio_run status first, then read only the persisted script, storyboard, and assets artifacts needed for the current stage. Do not reread skill, prompt, director, component-library, or reference files. In Composition, write numbered source files under <project-id>/drafts/composition-parts, salvage complete definitions from any partial stream, and assemble once with composition_parts.directory. Do not restart a monolithic run_code payload or trim to an aggregate source-size target.'
    : 'Read the draft path and apply the pending modification.';
  return `[Recoverable Agent Checkpoint]\nThe previous run stopped before completion, but durable work was saved. Resume from this exact checkpoint; do not recreate the work from the original media.${draftContext}${studioContext}${streamedCodeContext}${checkpoint.lastTool ? `\nlast completed tool: ${String(checkpoint.lastTool)}` : ''}\n${nextAction} Preview and publish the final artifact when that was the user's original request.\n\n`;
}

export function selectPriorTerminalRun<T extends { id?: string; status?: string }>(
  runs: T[] | null | undefined,
  currentRunId?: string | null,
): T | undefined {
  return runs?.find((row) => (
    row.id !== currentRunId
    && row.status !== 'running'
    && row.status !== 'aborted'
  ));
}

export function isStudioRunContinuationRequest(userMessage: string): boolean {
  const message = userMessage.trim();
  return /(?:继续|接着|恢复|续上|跑完|完成|continue|resume).{0,48}studio\s*run/i.test(message)
    || /studio\s*run.{0,48}(?:继续|接着|恢复|续上|跑完|完成|continue|resume)/i.test(message);
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
  const studioRunStore = new WorkspaceStudioRunStore(supabase, userId);
  const executionSnapshotPromise = options.executionRunId
    ? supabase
        .from('agent_context_snapshots')
        .select('content, run_id')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const executionRunPromise = options.executionRunId
    ? supabase
        .from('agent_runs')
        .select('objective, prompt, acceptance_criteria, current_work_unit')
        .eq('id', options.executionRunId)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const [snapshotsRes, recentMessagesRes, originMessageRes, toolHistoryRes, musicRes, recoverableDraft, recoverableRunRes, studioRuns, executionSnapshotRes, executionRunRes] = await Promise.all([
    supabase
      .from('snapshots')
      .select('id, image_url, description, type, design_path, tips, sort_order, video_meta, metadata')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('messages')
      .select('id, role, content, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(400),
    supabase
      .from('messages')
      .select('id, role, content, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .limit(1),
    supabase
      .from('agent_tool_history')
      .select('created_at, run_id, step, seq, tool_call_id, tool_name, input, output')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(800),
    supabase
      .from('project_music')
      .select('audio_url, suno_audio_url, stream_audio_url, duration, title, track_index, status, tags')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .in('status', ['completed', 'streaming'])
      .order('track_index', { ascending: true })
      .limit(20),
    loadCompositionDraft({ projectId, supabase, userId }),
    supabase
      .from('agent_runs')
      .select('id, status, metadata, started_at')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(10),
    studioRunStore.listRuns(projectId).catch(() => []),
    executionSnapshotPromise,
    executionRunPromise,
  ]);

  const snapshots: DbSnapshot[] = snapshotsRes.data ?? [];
  const recentMessages = ([...(recentMessagesRes.data ?? [])] as DbMessage[]).reverse();
  const originMessage = (originMessageRes.data?.[0] as DbMessage | undefined);
  const messages: DbMessage[] = originMessage && !recentMessages.some(message => (
    message.id && originMessage.id ? message.id === originMessage.id : message.created_at === originMessage.created_at
  ))
    ? [originMessage, ...recentMessages]
    : recentMessages;
  const toolHistory: DbToolHistoryRow[] = ([...(toolHistoryRes.data ?? [])] as DbToolHistoryRow[]).reverse();
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
  const priorRun = selectPriorTerminalRun(recoverableRunRes.data, options.currentRunId);
  // Skip transport-level aborted/running rows, then use only the nearest true
  // terminal run. A newer completed run still blocks stale failed checkpoints.
  const recoverableMetadata = priorRun?.status === 'failed'
    ? priorRun.metadata as Record<string, unknown> | null | undefined
    : undefined;
  const recoveryContext = buildAgentRecoveryContext(userMessage, recoverableMetadata);
  const activeStudioRun = studioRuns.find(run => run.status === 'running' && run.currentStage);
  const activeStudioContinuation = Boolean(
    activeStudioRun && isStudioRunContinuationRequest(userMessage),
  );
  const activeStudioRunContext = activeStudioContinuation && activeStudioRun
    ? `[Active Studio Run]\nstudio run id: ${activeStudioRun.id}\ncurrent studio stage: ${activeStudioRun.currentStage}\nstudio state path: ${activeStudioRun.projectId}/studio-runs/${activeStudioRun.id}/run.json\nCall studio_run status first, then read only the persisted artifacts required by the current stage. Do not reread skill, prompt, director, component-library, or reference files.\n\n`
    : '';
  const executionRow = executionRunRes.data as {
    objective?: string | null;
    prompt?: string | null;
    acceptance_criteria?: unknown;
    current_work_unit?: string | null;
  } | null;
  const executionObjective = executionRow?.objective || executionRow?.prompt || originMessage?.content || userMessage;
  const priorSnapshot = executionSnapshotRes.data?.content
    ? normalizeExecutionSnapshot(executionSnapshotRes.data.content, {
        objective: executionObjective,
        currentWorkUnit: executionRow?.current_work_unit || activeStudioRun?.currentStage || 'agent',
        nextAction: 'Continue the unfinished objective from durable project artifacts.',
      })
    : undefined;
  const persistedSnapshot = priorSnapshot && executionSnapshotRes.data?.run_id !== options.executionRunId
    ? {
        ...priorSnapshot,
        objective: executionObjective,
        acceptanceCriteria: Array.isArray(executionRow?.acceptance_criteria)
          ? executionRow.acceptance_criteria.filter((item): item is string => typeof item === 'string')
          : priorSnapshot.acceptanceCriteria,
        currentWorkUnit: executionRow?.current_work_unit || activeStudioRun?.currentStage || 'agent',
        nextAction: 'Start the current request while preserving relevant prior decisions and durable artifacts.',
      }
    : priorSnapshot;
  const executionSnapshot = options.executionRunId
    ? persistedSnapshot ?? normalizeExecutionSnapshot({
        objective: executionObjective,
        acceptanceCriteria: Array.isArray(executionRow?.acceptance_criteria) ? executionRow?.acceptance_criteria : [],
        currentWorkUnit: executionRow?.current_work_unit || activeStudioRun?.currentStage || 'agent',
        nextAction: 'Start the objective and create the first durable artifact before broad exploration.',
      }, {
        objective: executionObjective,
        currentWorkUnit: 'agent',
        nextAction: 'Start the objective.',
      })
    : undefined;
  const executionContext = formatDurableExecutionSnapshot(executionSnapshot);

  const currentSnapshotIndex = options.currentSnapshotIndex ?? Math.max(0, snapshots.length - 1);
  const currentSnap = snapshots[currentSnapshotIndex];

  // Load design from workspace if current snapshot has one (skip for video snapshots —
  // their design_path is only a Remotion playback wrapper, not user-editable code)
  let currentDesign: DesignPayload | undefined;
  const currentSnapIsVideo = currentSnap?.type === 'video';
  let currentDesignPath = currentSnap?.design_path && !currentSnapIsVideo ? currentSnap.design_path : undefined;
  if (currentDesignPath) {
    try {
      const file = await workspace.readFile(currentDesignPath, supabase, userId);
      if (file) currentDesign = JSON.parse(file.content);
    } catch { /* design load failed, continue without */ }
  }

  // An interrupted patch of the composition currently being viewed is newer
  // than its published timeline source, so resume from the autosave. For other
  // selected media, expose only a recovery pointer and keep the timeline source authoritative.
  if (
    currentDesignPath &&
    recoverableDraft?.draft.__makaronDraft.sourceDesignPath === currentDesignPath
  ) {
    currentDesign = recoverableDraft.draft;
    currentDesignPath = recoverableDraft.path;
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
  const rebuiltHistory = buildModelHistoryFromRows(messages, toolHistory, 400);
  const typedCompaction = buildTypedCompactionMessage(executionSnapshot);
  // A provider compaction block summarizes everything before it. Keep it typed
  // and add only a small local tail, rather than replaying summarized input.
  const durableHistoryTail = tailModelHistoryAtomically(rebuiltHistory, 16);
  const rawHistory = typedCompaction
    ? [typedCompaction, ...durableHistoryTail]
    : options.durableContinuation && executionSnapshot
      ? durableHistoryTail
      : rebuiltHistory;
  const contextPolicy = options.contextPolicy ?? getAgentContextPolicy('default');
  const selectedHistory = selectModelHistoryWithinBudget({
    messages: rawHistory,
    policy: contextPolicy,
    reservedTokens: Math.ceil((executionContext.length + userMessage.length) / 3),
    snapshot: executionSnapshot,
  });
  const history = selectedHistory.messages;

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

  const recoverableDraftContext = recoverableDraft && recoverableDraft.path !== currentDesignPath
    ? `[Recoverable Composition Draft]\npath: ${recoverableDraft.path}\nsavedAt: ${recoverableDraft.draft.__makaronDraft.savedAt}${recoverableDraft.draft.__makaronDraft.sourceDesignPath ? `\nsource: ${recoverableDraft.draft.__makaronDraft.sourceDesignPath}` : ''}\nThis workspace draft was autosaved by run_code but is not necessarily published to the timeline. Use it when the user asks to continue or recover that composition; otherwise keep the selected Timeline Media authoritative. Pass this exact path as code_path to run_code patch mode, design_path to preview_frame/materialize_media, or read it with read_file.\n\n`
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
  const fullPrompt = `${executionContext}${recoveryContext}${activeStudioRunContext}${videoWarning}${designWarning}${annotationWarning}${draftWarning}${snapshotWarning}${metaContext}${descriptionContext}${snapshotIndexContext}${designContext}${recoverableDraftContext}${tipsContext}${refContext}${frameAnchoredVideoEditContext}${videoUploadContext}${audioAttachmentContext}[User request — detect language and reply in the same language]\n${userMessage}`;

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
    recoverableDesignPath: recoverableDraft?.path,
    audioAttachments: resolvedAudioAttachments,
    executionSnapshot,
    contextStats: selectedHistory.stats,
  };
}

function formatSecondsForPrompt(seconds: number): string {
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1).replace(/\.0$/, '');
}
