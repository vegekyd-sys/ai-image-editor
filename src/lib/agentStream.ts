import type { AgentStreamEvent } from './agent';

export type { AgentStreamEvent };

export interface AgentStreamCallbacks {
  onStatus?: (text: string) => void;
  onContent?: (text: string) => void;
  onNewTurn?: () => void;
  onImage?: (image: string, usedModel?: string) => void;
  onToolCall?: (tool: string, input: Record<string, unknown>, images?: string[]) => void;
  onAnimationTask?: (taskId: string) => void;
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
            callbacks.onNewTurn?.();
            break;
          case 'image':
            callbacks.onImage?.(event.image, event.usedModel);
            break;
          case 'tool_call':
            callbacks.onToolCall?.(event.tool, event.input, event.images);
            break;
          case 'animation_task':
            callbacks.onAnimationTask?.(event.taskId);
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
      } catch {
        // skip malformed JSON
      }
    }
  }

  // Stream ended without done/error event (e.g. Vercel timeout, network cut)
  if (!receivedDone) {
    callbacks.onError?.('连接中断，请重试');
  }
}
