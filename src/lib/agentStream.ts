import type { AgentStreamEvent } from './agent';

export type { AgentStreamEvent };

export interface AgentStreamCallbacks {
  onStatus?: (text: string) => void;
  onContent?: (text: string) => void;
  onNewTurn?: (messageId?: string) => void;
  onImage?: (image: string, usedModel?: string, snapshotId?: string, imageUrl?: string) => void;
  onToolCall?: (tool: string, input: Record<string, unknown>, images?: string[]) => void;
  onAnimationTask?: (taskId: string, prompt: string) => void;
  onImageAnalyzed?: (imageIndex: number) => void;
  onNsfwDetected?: () => void;
  onRunId?: (runId: string) => void;
  onMessageId?: (messageId: string) => void;
  onReasoning?: (text: string) => void;
  onCoding?: () => void;
  onCodeStream?: (text: string, done: boolean) => void;
  onDesign?: (design: { code: string; width: number; height: number; props?: Record<string, unknown>; animation?: { fps: number; durationInSeconds: number; format?: string }; snapshotId?: string }) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

export async function streamAgent(
  body: {
    prompt: string; image: string; projectId: string;
    originalImage?: string;
    referenceImages?: string[];  // up to 3 user-uploaded reference images
    animationImageUrls?: string[];  // Supabase Storage URLs for animation mode
    animationImages?: string[];  // Actual image data (base64 or URL) for Agent vision in animation mode
    analysisOnly?: boolean; analysisContext?: 'initial' | 'post-edit';
    tipReaction?: boolean; committedTip?: object; currentTips?: object[];
    tipsTeaser?: boolean; tipsPayload?: object[];
    nameProject?: boolean; description?: string;
    previewsReady?: boolean; readyTips?: object[];
    preferredModel?: string;
    snapshotImages?: string[];
    currentSnapshotIndex?: number;
    isNsfw?: boolean;
  },
  callbacks: AgentStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
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
            callbacks.onAnimationTask?.(event.taskId, event.prompt || '');
            break;
          case 'image_analyzed':
            callbacks.onImageAnalyzed?.(event.imageIndex);
            break;
          case 'nsfw_detected':
            callbacks.onNsfwDetected?.();
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
          case 'design':
            callbacks.onDesign?.(event as { code: string; width: number; height: number; props?: Record<string, unknown>; animation?: { fps: number; durationInSeconds: number; format?: string }; snapshotId?: string });
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
    callbacks.onError?.('连接中断，请重试');
  }
}
