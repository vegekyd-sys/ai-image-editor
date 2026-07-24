import type { AgentStreamEvent } from './agent';
import type { AgentModelPreference } from './agent-models';
import type { SkillLaunchContext } from './skill-launch-context';

export type { AgentStreamEvent };

export interface AgentStreamCallbacks {
  onStatus?: (text: string) => void;
  onContent?: (text: string) => void;
  onNewTurn?: (messageId?: string) => void;
  onImage?: (image: string, usedModel?: string, snapshotId?: string, imageUrl?: string) => void;
  onToolCall?: (tool: string, input: Record<string, unknown>, images?: string[]) => void;
  onAnimationTask?: (taskId: string, prompt: string, imageUrls?: string[], model?: string) => void;
  onVideoSnapshot?: (snapshotId: string, taskId: string, videoMeta: import('@/types').VideoMeta) => void;
  onMusicTask?: (taskId: string) => void;
  onImageAnalyzed?: (imageIndex: number) => void;
  onCaptureFrame?: (frame: number, uploadPath: string, captureId: string) => void;
  onPreviewFrame?: (workspaceUrl: string) => void;
  onNsfwDetected?: () => void;
  onRunId?: (runId: string) => void;
  onMessageId?: (messageId: string) => void;
  onClearRunMessages?: (messageIds: string[]) => void;
  onReasoningStart?: () => void;
  onReasoning?: (text: string) => void;
  onCoding?: () => void;
  onCodeStream?: (text: string, done: boolean) => void;
  onRender?: (design: { code: string; width: number; height: number; props?: Record<string, unknown>; animation?: { fps: number; durationInSeconds: number; format?: string }; editables?: import('@/types').EditableField[]; fontSubstitutions?: Record<string, string>; snapshotId?: string; published?: boolean; previewUrl?: string }) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
  /** SSE/network ended while the server-side run may still be alive. */
  onDisconnect?: (runId: string) => void;
  onInsufficientCredits?: (balance: number) => void;
}

type AgentRequestBody = Parameters<typeof streamAgent>[0];

export async function streamAgent(
  body: {
    prompt: string; image: string; projectId: string;
    animationImageUrls?: string[];  // Supabase Storage URLs for animation mode
    animationImages?: string[];  // Actual image data (base64 or URL) for Agent vision in animation mode
    analysisOnly?: boolean; analysisContext?: 'initial' | 'post-edit'; isVideoAnalysis?: boolean;
    tipReaction?: boolean; committedTip?: object; currentTips?: object[];
    tipsTeaser?: boolean; tipsPayload?: object[];
    nameProject?: boolean; description?: string;
    previewsReady?: boolean; readyTips?: object[];
    musicReady?: boolean; musicAudioUrl?: string;
    preferredModel?: string;
    agentModel?: AgentModelPreference;
    videoModel?: string;
    videoResolution?: string;
    videoAuto?: boolean;
    skillLaunchContext?: SkillLaunchContext;
    snapshotImages?: string[];
    currentSnapshotIndex?: number;
    isNsfw?: boolean;
    hasAnnotation?: boolean;
    isDraft?: boolean;
    referenceImageCount?: number;
    uploadedVideoCount?: number;
    turnMediaCount?: number;
    audioAttachments?: Array<{ audioUrl: string; title?: string; duration?: number; trackIndex?: number }>;
    durable?: boolean;
  },
  callbacks: AgentStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const durableNormalRequest = body.durable === true
    && !body.analysisOnly
    && !body.tipReaction
    && !body.tipsTeaser
    && !body.nameProject
    && !body.previewsReady
    && !body.musicReady;
  if (durableNormalRequest) return streamDurableAgent(body, callbacks, signal);
  return streamAgentAttempt(body, callbacks, signal);
}

interface PersistedAgentEvent {
  type: string;
  data?: Record<string, any>;
  seq: number;
}

function dispatchPersistedAgentEvent(event: PersistedAgentEvent, callbacks: AgentStreamCallbacks) {
  const data = event.data || {};
  switch (event.type) {
    case 'status': callbacks.onStatus?.(String(data.text || '')); break;
    case 'content': callbacks.onContent?.(String(data.text || '')); break;
    case 'new_turn': callbacks.onNewTurn?.(data.messageId); break;
    case 'tool_call': callbacks.onToolCall?.(String(data.tool || ''), data.input || {}, data.images); break;
    case 'image': callbacks.onImage?.(data.imageUrl || '', data.usedModel, data.snapshotId, data.imageUrl); break;
    case 'render':
    case 'design': callbacks.onRender?.(data as Parameters<NonNullable<AgentStreamCallbacks['onRender']>>[0]); break;
    case 'animation_task': callbacks.onAnimationTask?.(data.taskId, data.prompt || '', data.imageUrls, data.model); break;
    case 'video_snapshot': callbacks.onVideoSnapshot?.(data.snapshotId, data.taskId, data.videoMeta); break;
    case 'music_task': callbacks.onMusicTask?.(data.taskId); break;
    case 'image_analyzed': callbacks.onImageAnalyzed?.(data.imageIndex); break;
    case 'preview_frame_captured': callbacks.onPreviewFrame?.(data.workspaceUrl); break;
    case 'nsfw_detected': callbacks.onNsfwDetected?.(); break;
    case 'coding': callbacks.onCoding?.(); break;
    case 'code_stream': callbacks.onCodeStream?.(data.text || '', Boolean(data.done)); break;
  }
}

async function streamDurableAgent(
  body: AgentRequestBody,
  callbacks: AgentStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/agent/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: body.projectId,
      prompt: body.prompt,
      preferredModel: body.preferredModel,
      agentModel: body.agentModel,
      videoModel: body.videoModel,
      videoResolution: body.videoResolution,
      videoAuto: body.videoAuto,
      skillLaunchContext: body.skillLaunchContext,
      currentSnapshotIndex: body.currentSnapshotIndex,
      hasAnnotation: body.hasAnnotation,
      isDraft: body.isDraft,
      referenceImageCount: body.referenceImageCount,
      uploadedVideoCount: body.uploadedVideoCount,
      turnMediaCount: body.turnMediaCount,
      isNsfw: body.isNsfw,
      audioAttachments: body.audioAttachments,
      clientPersistedUserMessage: true,
    }),
    signal,
  });
  if (!response.ok) {
    if (response.status === 402) {
      const data = await response.json().catch(() => ({}));
      callbacks.onInsufficientCredits?.(data.balance ?? 0);
      return;
    }
    callbacks.onError?.(await response.text().catch(() => 'Failed to start Agent execution'));
    return;
  }
  const started = await response.json() as { runId: string; firstMessageId?: string };
  callbacks.onRunId?.(started.runId);
  if (started.firstMessageId) callbacks.onMessageId?.(started.firstMessageId);

  const abortRun = () => {
    void fetch('/api/agent/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: started.runId }),
    });
  };
  signal?.addEventListener('abort', abortRun, { once: true });

  let lastSeq = -1;
  let firstMessageSeen = false;
  try {
    while (!signal?.aborted) {
      const params = new URLSearchParams({ events: 'true' });
      if (lastSeq >= 0) params.set('after', String(lastSeq));
      let runResponse: Response;
      try {
        runResponse = await fetch(`/api/agent/run/${started.runId}?${params.toString()}`, { signal });
      } catch {
        if (signal?.aborted) return;
        await new Promise(resolve => setTimeout(resolve, 1200));
        continue;
      }
      if (!runResponse.ok) {
        await new Promise(resolve => setTimeout(resolve, 1200));
        continue;
      }
      const run = await runResponse.json() as {
        status: string;
        agent_status?: string;
        first_message_id?: string;
        events?: PersistedAgentEvent[];
        error?: { message?: string };
        next_poll_after_ms?: number;
      };
      if (!firstMessageSeen && run.first_message_id) {
        firstMessageSeen = true;
        callbacks.onMessageId?.(run.first_message_id);
      }
      for (const event of run.events || []) {
        if (event.seq <= lastSeq) continue;
        lastSeq = event.seq;
        dispatchPersistedAgentEvent(event, callbacks);
      }
      const agentStatus = run.agent_status || run.status;
      if (agentStatus === 'completed') {
        callbacks.onDone?.();
        return;
      }
      if (agentStatus === 'failed' || agentStatus === 'aborted') {
        callbacks.onError?.(run.error?.message || (agentStatus === 'aborted' ? 'Agent run aborted' : 'Agent run failed'));
        return;
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(run.next_poll_after_ms || 1200, 3000)));
    }
  } finally {
    signal?.removeEventListener('abort', abortRun);
  }
}

async function streamAgentAttempt(
  body: AgentRequestBody,
  callbacks: AgentStreamCallbacks,
  signal: AbortSignal | undefined,
): Promise<void> {
  const res = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    if (res.status === 402) {
      try {
        const data = await res.json();
        callbacks.onInsufficientCredits?.(data.balance ?? 0);
      } catch {
        callbacks.onInsufficientCredits?.(0);
      }
      return;
    }
    const text = await res.text().catch(() => 'Unknown error');
    callbacks.onError?.(text);
    return;
  }

  // Pass server-generated IDs to caller
  const agentRunId = res.headers.get('X-Agent-Run-Id');
  if (agentRunId) callbacks.onRunId?.(agentRunId);
  // First message ID from DualWriter — frontend should use this instead of generating its own
  const firstMessageId = res.headers.get('X-Agent-Message-Id');
  if (firstMessageId) callbacks.onMessageId?.(firstMessageId);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let receivedDone = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const line = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      if (!line.startsWith('data: ')) continue;
      try {
        const event: AgentStreamEvent = JSON.parse(line.slice(6));
        switch (event.type) {
          case 'status':
            callbacks.onStatus?.(event.text);
            break;
          case 'content':
            callbacks.onContent?.(event.text);
            break;
          case 'new_turn':
            callbacks.onNewTurn?.((event as Record<string, unknown>).messageId as string | undefined);
            break;
          case 'image': {
            const img = event as Record<string, unknown>;
            callbacks.onImage?.(event.image, event.usedModel, img.snapshotId as string | undefined, img.imageUrl as string | undefined);
            break;
          }
          case 'tool_call':
            callbacks.onToolCall?.(event.tool, event.input, event.images);
            break;
          case 'animation_task':
            callbacks.onAnimationTask?.(event.taskId, event.prompt || '', event.imageUrls, event.model);
            break;
          case 'video_snapshot': {
            const vs = event as unknown as { snapshotId: string; taskId: string; videoMeta: import('@/types').VideoMeta };
            callbacks.onVideoSnapshot?.(vs.snapshotId, vs.taskId, vs.videoMeta);
            break;
          }
          case 'music_task':
            callbacks.onMusicTask?.((event as { taskId: string }).taskId);
            break;
          case 'image_analyzed':
            callbacks.onImageAnalyzed?.(event.imageIndex);
            break;
          case 'capture_frame':
            callbacks.onCaptureFrame?.(
              (event as { frame: number }).frame,
              (event as { uploadPath: string }).uploadPath,
              (event as { captureId: string }).captureId,
            );
            break;
          case 'preview_frame_captured':
            callbacks.onPreviewFrame?.((event as { workspaceUrl: string }).workspaceUrl);
            break;
          case 'nsfw_detected':
            callbacks.onNsfwDetected?.();
            break;
          case 'reasoning_start':
            callbacks.onReasoningStart?.();
            break;
          case 'reasoning':
            callbacks.onReasoning?.(event.text);
            break;
          case 'coding':
            callbacks.onCoding?.();
            break;
          case 'code_stream':
            callbacks.onCodeStream?.(event.text, !!event.done);
            break;
          case 'design': // backward compat — fall through to 'render'
          case 'render':
            callbacks.onRender?.(event as { code: string; width: number; height: number; props?: Record<string, unknown>; animation?: { fps: number; durationInSeconds: number; format?: string }; editables?: import('@/types').EditableField[]; fontSubstitutions?: Record<string, string>; snapshotId?: string; published?: boolean });
            break;
          case 'done':
            receivedDone = true;
            callbacks.onDone?.();
            break;
          case 'error':
            receivedDone = true;
            callbacks.onError?.(event.message);
            break;
        }
      } catch (e) {
        console.warn('[agentStream] failed to parse SSE event:', (e as Error)?.message, 'line length:', line.length, 'preview:', line.slice(0, 200));
      }
    }
  }

  // Stream ended without done/error event (e.g. Vercel timeout, network cut)
  if (!receivedDone) {
    if (agentRunId) callbacks.onDisconnect?.(agentRunId);
    else callbacks.onError?.('连接中断，请重试');
  }
}
