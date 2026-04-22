import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeAgentCallbacks, type AgentCallbackContext } from '@/lib/agentCallbacks';
import type { Message } from '@/types';

function createMockContext(overrides?: Partial<AgentCallbackContext>): AgentCallbackContext {
  return {
    projectId: 'test-project',
    setMessages: vi.fn((updater) => updater([])),
    setSnapshots: vi.fn((updater) => updater([])),
    setAgentStatus: vi.fn(),
    setAnimations: vi.fn((updater) => updater([])),
    setPendingDesign: vi.fn(),
    setDraftDesign: vi.fn(),
    setDesignDraftParent: vi.fn(),
    setPendingNotification: vi.fn(),
    setSelectedVideoId: vi.fn(),
    setAnimationState: vi.fn(),
    snapshotsRef: { current: [] },
    isNsfwRef: { current: false },
    lastEditPromptRef: { current: null },
    lastEditInputImagesRef: { current: null },
    pendingDesignMsgIdRef: { current: '' },
    pendingDesignSnapIdRef: { current: '' },
    codeStreamRef: { current: null },
    agentRunIdRef: { current: null },
    agentTimerRef: { current: null },
    autoFetchTriggered: { current: false },
    pendingAnalysisRef: { current: [] },
    pendingTeaserRef: { current: null },
    hasTriggeredNamingRef: { current: false },
    draftParentIndexRef: { current: null },
    viewIndexRef: { current: 0 },
    pendingNavigateToVideoRef: { current: false },
    cacheImage: vi.fn(),
    fetchTipsForSnapshot: vi.fn(),
    onSaveSnapshot: vi.fn(),
    onUpdateDescription: vi.fn(),
    triggerProjectNaming: vi.fn(),
    triggerTipsTeaser: vi.fn(),
    compressBase64Image: vi.fn(async (img) => img),
    t: (key: string) => key,
    ...overrides,
  };
}

describe('makeAgentCallbacks', () => {
  let ctx: AgentCallbackContext;
  let messages: Message[];

  beforeEach(() => {
    messages = [];
    ctx = createMockContext({
      setMessages: vi.fn((updater: (prev: Message[]) => Message[]) => {
        messages = updater(messages);
      }),
    });
  });

  describe('onNewTurn', () => {
    it('creates a new message with server ID', () => {
      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onNewTurn?.('server-msg-123');
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('server-msg-123');
      expect(messages[0].role).toBe('assistant');
      expect(messages[0].content).toBe('');
    });

    it('generates client ID if no server ID', () => {
      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onNewTurn?.();
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBeTruthy();
      expect(messages[0].id).not.toBe('');
    });

    it('tracks message IDs in agentMsgIds', () => {
      const { callbacks, getAgentMsgIds } = makeAgentCallbacks(ctx);
      callbacks.onNewTurn?.('msg-1');
      callbacks.onNewTurn?.('msg-2');
      expect(getAgentMsgIds()).toEqual(['msg-1', 'msg-2']);
    });
  });

  describe('onContent', () => {
    it('appends text to current message', () => {
      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onNewTurn?.('msg-1');
      callbacks.onContent?.('Hello ');
      callbacks.onContent?.('world');
      expect(messages[0].content).toBe('Hello world');
    });

    it('does nothing if no current message ID', () => {
      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onContent?.('orphan text');
      expect(messages).toHaveLength(0);
    });
  });

  describe('onImage', () => {
    it('creates snapshot with server IDs', () => {
      let snapshots: { id: string; image: string; messageId: string }[] = [];
      ctx = createMockContext({
        setMessages: vi.fn((updater: (prev: typeof messages) => typeof messages) => {
          messages = updater(messages);
        }),
        setSnapshots: vi.fn((updater) => {
          snapshots = updater(snapshots as never) as never;
        }),
      });

      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onNewTurn?.('msg-1');
      callbacks.onImage?.('data:image/jpeg;base64,abc', 'gemini', 'snap-uuid', 'https://storage.url');

      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].id).toBe('snap-uuid');
      expect(snapshots[0].messageId).toBe('msg-1');
    });

    it('deduplicates snapshots with same ID', () => {
      let snapshots: { id: string }[] = [{ id: 'snap-uuid' } as never];
      ctx = createMockContext({
        setMessages: vi.fn((updater: (prev: typeof messages) => typeof messages) => {
          messages = updater(messages);
        }),
        setSnapshots: vi.fn((updater) => {
          snapshots = updater(snapshots as never) as never;
        }),
      });

      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onNewTurn?.('msg-1');
      callbacks.onImage?.('data:image/jpeg;base64,abc', 'gemini', 'snap-uuid', 'https://url');

      expect(snapshots).toHaveLength(1); // not 2
    });

    it('sets inline image on current message', () => {
      ctx = createMockContext({
        setMessages: vi.fn((updater: (prev: typeof messages) => typeof messages) => {
          messages = updater(messages);
        }),
      });

      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onNewTurn?.('msg-1');
      callbacks.onImage?.('data:image/jpeg;base64,abc', 'gemini', 'snap-1', undefined);

      expect(messages[0].image).toBe('data:image/jpeg;base64,abc');
    });

    it('calls fetchTipsForSnapshot', () => {
      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onNewTurn?.('msg-1');
      callbacks.onImage?.('data:img', 'gemini', 'snap-1', undefined);

      expect(ctx.fetchTipsForSnapshot).toHaveBeenCalledWith('snap-1', 'data:img', expect.any(String));
    });
  });

  describe('onToolCall', () => {
    it('captures editPrompt from generate_image', () => {
      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onToolCall?.('generate_image', { editPrompt: 'make it blue' }, undefined);

      expect(ctx.lastEditPromptRef.current).toBe('make it blue');
    });

    it('captures input images', () => {
      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onToolCall?.('generate_image', { editPrompt: 'test' }, ['img1', 'img2']);

      expect(ctx.lastEditInputImagesRef.current).toEqual(['img1', 'img2']);
    });

    it('ignores non-generate_image tools', () => {
      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onToolCall?.('analyze_image', { question: 'what is this?' }, undefined);

      expect(ctx.lastEditPromptRef.current).toBeNull();
    });
  });

  describe('onRender', () => {
    it('published render triggers pendingDesign with snapshotId', () => {
      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onNewTurn?.('msg-1');
      const design = { code: 'function D(){}', width: 1080, height: 1350, snapshotId: 'design-snap', published: true };
      callbacks.onRender?.(design as never);

      expect(ctx.setPendingDesign).toHaveBeenCalled();
      expect(ctx.pendingDesignMsgIdRef.current).toBe('msg-1');
      expect(ctx.pendingDesignSnapIdRef.current).toBe('design-snap');
    });

    it('draft render sets draftDesign, not pendingDesign', () => {
      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onNewTurn?.('msg-1');
      const design = { code: 'function D(){}', width: 1080, height: 1350, published: false };
      callbacks.onRender?.(design as never);

      expect(ctx.setDraftDesign).toHaveBeenCalled();
      expect(ctx.setPendingDesign).not.toHaveBeenCalled();
    });
  });

  describe('onCodeStream', () => {
    it('wraps with code fence on first chunk', () => {
      ctx = createMockContext({
        setMessages: vi.fn((updater: (prev: typeof messages) => typeof messages) => {
          messages = updater(messages);
        }),
      });

      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onNewTurn?.('msg-1');
      callbacks.onCodeStream?.('const x = 1;', false);

      expect(messages[0].content).toContain('```javascript');
      expect(messages[0].content).toContain('const x = 1;');
    });

    it('closes code fence on done', () => {
      ctx = createMockContext({
        setMessages: vi.fn((updater: (prev: typeof messages) => typeof messages) => {
          messages = updater(messages);
        }),
      });

      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onNewTurn?.('msg-1');
      callbacks.onCodeStream?.('const x = 1;', false);
      callbacks.onCodeStream?.('', true);

      expect(messages[0].content).toContain('```\n');
    });
  });

  describe('onImageAnalyzed', () => {
    it('tracks analyzed index and accumulates description', () => {
      ctx = createMockContext({
        setMessages: vi.fn((updater: (prev: typeof messages) => typeof messages) => {
          messages = updater(messages);
        }),
        snapshotsRef: { current: [{ id: 'snap-0', image: '', tips: [], messageId: '' }] as never },
      });

      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onNewTurn?.('msg-1');
      callbacks.onImageAnalyzed?.(1); // 1-based
      callbacks.onContent?.('A photo of a cat');
      callbacks.onContent?.('\n\nMore details');

      // Flush on next analyze or new_turn
      callbacks.onNewTurn?.('msg-2');

      // Description should have been saved (first paragraph, max 300 chars)
      expect(ctx.onUpdateDescription).toHaveBeenCalledWith('snap-0', 'A photo of a cat');
    });
  });

  describe('onDone', () => {
    it('sets status to done then greeting', () => {
      vi.useFakeTimers();
      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onDone?.();

      expect(ctx.setAgentStatus).toHaveBeenCalledWith('editor.done');
      vi.advanceTimersByTime(2000);
      expect(ctx.setAgentStatus).toHaveBeenCalledWith('editor.greeting');
      vi.useRealTimers();
    });

    it('calls onCleanup if provided', () => {
      const cleanup = vi.fn();
      ctx = createMockContext({ onCleanup: cleanup });
      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onDone?.();
      expect(cleanup).toHaveBeenCalled();
    });
  });

  describe('onError', () => {
    it('appends error to current message', () => {
      ctx = createMockContext({
        setMessages: vi.fn((updater: (prev: typeof messages) => typeof messages) => {
          messages = updater(messages);
        }),
      });

      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onNewTurn?.('msg-1');
      callbacks.onError?.('Something went wrong');

      expect(messages[0].content).toBe('editor.errorRetry');
    });

    it('calls onCleanup if provided', () => {
      const cleanup = vi.fn();
      ctx = createMockContext({ onCleanup: cleanup });
      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onError?.('fail');
      expect(cleanup).toHaveBeenCalled();
    });
  });

  describe('onNsfwDetected', () => {
    it('sets isNsfwRef to true', () => {
      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onNsfwDetected?.();
      expect(ctx.isNsfwRef.current).toBe(true);
    });
  });

  describe('onMessageId', () => {
    it('replaces first message ID with server ID', () => {
      ctx = createMockContext({
        setMessages: vi.fn((updater: (prev: typeof messages) => typeof messages) => {
          messages = updater(messages);
        }),
      });

      const { callbacks, getAgentMsgIds } = makeAgentCallbacks(ctx);
      callbacks.onNewTurn?.('client-id');
      callbacks.onMessageId?.('server-id');

      expect(messages[0].id).toBe('server-id');
      expect(getAgentMsgIds()[0]).toBe('server-id');
    });
  });
});
