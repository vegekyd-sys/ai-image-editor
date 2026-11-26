import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeAgentCallbacks, type AgentCallbackContext } from '@/lib/agentCallbacks';
import type { Message, Snapshot } from '@/types';
import { timelineFromSnap } from '@/lib/editor/timeline-utils';
const recovery = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/lib/editor/published-snapshot', () => ({ loadPublishedSnapshot: recovery.load }));

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
    autoFetchTriggered: { current: new Set() },
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
    recovery.load.mockReset();
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

    it('replays an existing turn in place without duplicating its text or other video cards', () => {
      messages = [
        { id: 'server-msg-123', role: 'assistant', content: 'old reply', timestamp: 1 },
        { id: 'video-completion-snap-2', role: 'assistant', content: '🎬 done\nsnap:snap-2', timestamp: 2 },
      ];
      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onNewTurn?.('server-msg-123');
      callbacks.onContent?.('replayed reply');
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({ id: 'server-msg-123', content: 'replayed reply', timestamp: 1 });
      expect(messages[1].id).toBe('video-completion-snap-2');
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

  describe('onSource', () => {
    it('deduplicates source IDs while retaining multiple citations for one URL', () => {
      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onNewTurn?.('msg-1');
      callbacks.onSource?.({ id: 'source-1', url: 'https://example.com/news', title: 'Example' });
      callbacks.onSource?.({ id: 'source-1', url: 'https://example.com/news', title: 'Replay' });
      callbacks.onSource?.({ id: 'source-2', url: 'https://example.com/news', title: 'Duplicate' });
      callbacks.onSource?.({ id: 'source-3', url: 'javascript:alert(1)', title: 'Unsafe' });

      expect(messages[0].sources).toEqual([
        { id: 'source-1', url: 'https://example.com/news', title: 'Example' },
        { id: 'source-2', url: 'https://example.com/news', title: 'Duplicate' },
      ]);
    });
  });

  describe('onDisconnect', () => {
    it('releases the active run id so the persistent watcher can reconnect', () => {
      ctx.agentRunIdRef.current = 'run-live';
      const { callbacks } = makeAgentCallbacks(ctx);

      callbacks.onDisconnect?.('run-live');

      expect(ctx.agentRunIdRef.current).toBeNull();
      expect(ctx.setAgentStatus).toHaveBeenCalledWith('editor.reconnecting');
    });
  });

  describe('terminal run cleanup', () => {
    it('clears the active run id when the run completes', () => {
      ctx.agentRunIdRef.current = 'run-complete';
      const { callbacks } = makeAgentCallbacks(ctx);

      callbacks.onDone?.();

      expect(ctx.agentRunIdRef.current).toBeNull();
    });

    it('clears the active run id when the run fails or is aborted', () => {
      ctx.agentRunIdRef.current = 'run-failed';
      const { callbacks } = makeAgentCallbacks(ctx);

      callbacks.onError?.('Agent run aborted');

      expect(ctx.agentRunIdRef.current).toBeNull();
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

    it('restores inline image by snapshot messageId when reconnect current turn is stale', () => {
      messages = [
        { id: 'stale-msg', role: 'assistant', content: '', timestamp: Date.now() },
        { id: 'linked-msg', role: 'assistant', content: 'done', timestamp: Date.now() },
      ];
      const snapshots = [
        { id: 'snap-1', image: '', imageUrl: 'https://old.url', tips: [], messageId: 'linked-msg' },
      ];
      ctx = createMockContext({
        snapshotsRef: { current: snapshots },
        setMessages: vi.fn((updater: (prev: typeof messages) => typeof messages) => {
          messages = updater(messages);
        }),
        setSnapshots: vi.fn((updater) => {
          updater(snapshots as never);
        }),
      });

      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onNewTurn?.('stale-msg');
      callbacks.onImage?.('', 'gemini', 'snap-1', 'https://storage.url/generated.jpg');

      expect(messages.find(m => m.id === 'linked-msg')?.image).toBe('https://storage.url/generated.jpg');
      expect(messages.find(m => m.id === 'stale-msg')?.image).toBeUndefined();
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

  describe('onFocusSnapshot', () => {
    it('focuses the existing design without replacing edited props or publishing it again', () => {
      const focus = vi.fn();
      ctx.snapshotsRef.current = [{ id: 'existing-design', design: { code: 'code', width: 10, height: 10 } } as Snapshot];
      ctx.draftParentIndexRef.current = 0;
      ctx.viewIndexRef.current = 1;
      const { callbacks } = makeAgentCallbacks({ ...ctx, onFocusSnapshot: focus });
      callbacks.onFocusSnapshot?.('existing-design');
      expect(focus).toHaveBeenCalledWith('existing-design');
      expect(ctx.draftParentIndexRef.current).toBeNull();
      expect(ctx.viewIndexRef.current).toBe(0);
      expect(ctx.setPendingDesign).not.toHaveBeenCalled();
      expect(ctx.setSnapshots).not.toHaveBeenCalled();
      expect(ctx.onSaveSnapshot).not.toHaveBeenCalled();
    });

    it('recovers a missing server result before focusing it without republishing', async () => {
      const focus = vi.fn();
      const snapshot = { id: 'saved', image: 'https://example.com/poster.jpg', tips: [], messageId: '' } as Snapshot;
      ctx.draftParentIndexRef.current = 0;
      recovery.load.mockResolvedValue(snapshot);
      const { callbacks } = makeAgentCallbacks({ ...ctx, onFocusSnapshot: focus });
      callbacks.onFocusSnapshot?.('saved');
      await vi.waitFor(() => expect(focus).toHaveBeenCalledWith('saved'));
      expect(ctx.snapshotsRef.current).toContain(snapshot);
      expect(ctx.draftParentIndexRef.current).toBeNull();
      expect(ctx.setPendingDesign).not.toHaveBeenCalled();
      expect(ctx.onSaveSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('onRender', () => {
    it('focuses the published result without the removed virtual draft offset in a batched render', () => {
      ctx.snapshotsRef.current = ['original', 'existing'].map(id => ({ id, image: 'poster', tips: [], messageId: '' }));
      ctx.draftParentIndexRef.current = 1;
      ctx.viewIndexRef.current = 2;
      let focusedIndex = -1;
      const { callbacks } = makeAgentCallbacks({ ...ctx, onFocusSnapshot: snapshotId => {
        const index = ctx.snapshotsRef.current.findIndex(snapshot => snapshot.id === snapshotId);
        focusedIndex = timelineFromSnap(index, ctx.draftParentIndexRef.current);
      } });
      callbacks.onRender?.({ code: 'function D(){}', width: 100, height: 100,
        snapshotId: 'saved', published: true, previewUrl: 'https://example.com/saved.jpg' });
      // Removing the draft and appending the snapshot keeps timeline.length at 3,
      // so the editor's length-change clamp cannot repair an erroneous index 3.
      expect(ctx.snapshotsRef.current).toHaveLength(3);
      expect(focusedIndex).toBe(2);
      expect(ctx.draftParentIndexRef.current).toBeNull();
      expect(ctx.viewIndexRef.current).toBe(2);
      expect(ctx.setDesignDraftParent).toHaveBeenCalledWith(null);
    });

    it('adds the saved poster and design synchronously without browser capture or a second save', () => {
      const focus = vi.fn();
      const { callbacks } = makeAgentCallbacks({ ...ctx, onFocusSnapshot: focus });
      callbacks.onNewTurn?.('msg-saved');
      const design = { code: 'function D(){}', width: 1080, height: 1350,
        snapshotId: 'saved', published: true, prePublished: true, previewUrl: 'https://example.com/poster.jpg' };
      callbacks.onRender?.(design);
      expect(ctx.snapshotsRef.current[0]).toMatchObject({ id: 'saved', imageUrl: design.previewUrl, design });
      expect(focus).toHaveBeenCalledWith('saved');
      expect(ctx.setPendingDesign).not.toHaveBeenCalled();
      expect(ctx.onSaveSnapshot).not.toHaveBeenCalled();
      expect(messages[0]).toMatchObject({ image: design.previewUrl, design });
      // Persisted render replay must preserve GUI layer edits already in memory.
      ctx.snapshotsRef.current[0].design = { ...design, props: { _pos_layer_1: { x: 30, y: 40 } } };
      callbacks.onRender?.(design);
      expect(ctx.snapshotsRef.current).toHaveLength(1);
      expect(ctx.snapshotsRef.current[0].design?.props).toEqual({ _pos_layer_1: { x: 30, y: 40 } });
    });
    it('refreshes the poster and design when a revised draft republishes the same snapshot', () => {
      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onNewTurn?.('msg-saved');
      const original = { code: 'function D(){}', width: 100, height: 100, published: true, snapshotId: 'saved', previewUrl: 'https://example.com/old.jpg' };
      callbacks.onRender?.(original);
      const revision = { ...original, props: { title: 'Updated' }, previewUrl: 'https://example.com/new.jpg' };
      callbacks.onRender?.(revision);
      expect(ctx.snapshotsRef.current).toHaveLength(1);
      expect(ctx.snapshotsRef.current[0]).toMatchObject({ id: 'saved', image: revision.previewUrl, imageUrl: revision.previewUrl, design: revision });
    });

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
    it('wraps with code fence and flushes on done', () => {
      ctx = createMockContext({
        setMessages: vi.fn((updater: (prev: typeof messages) => typeof messages) => {
          messages = updater(messages);
        }),
      });

      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onNewTurn?.('msg-1');
      callbacks.onCodeStream?.('const x = 1;', false);
      // Text is batched via rAF — flush by calling done
      callbacks.onCodeStream?.('', true);

      expect(messages[0].content).toContain('```javascript');
      expect(messages[0].content).toContain('const x = 1;');
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

    it('keeps pending analyzed index when new_turn arrives before analysis text', () => {
      let snapshots: Snapshot[] = [{ id: 'video-0', image: '', tips: [], messageId: '', type: 'video' }];
      ctx = createMockContext({
        setMessages: vi.fn((updater: (prev: typeof messages) => typeof messages) => {
          messages = updater(messages);
        }),
        setSnapshots: vi.fn((updater) => {
          snapshots = updater(snapshots as never) as never;
        }),
        snapshotsRef: { current: snapshots as never },
      });

      const { callbacks } = makeAgentCallbacks(ctx);
      callbacks.onImageAnalyzed?.(1); // analyze_video tool result arrives before final assistant turn
      callbacks.onNewTurn?.('msg-1');
      callbacks.onContent?.('This video shows a product update.');
      callbacks.onDone?.();

      expect(ctx.onUpdateDescription).toHaveBeenCalledWith('video-0', 'This video shows a product update.');
      expect(snapshots[0].description).toBe('This video shows a product update.');
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

      expect(messages[0].content).toBe('Something went wrong');
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
    it('binds an Editor-created placeholder before its first text arrives', () => {
      messages = [{ id: 'local-first', role: 'assistant', content: '', timestamp: 1 }];
      const { callbacks, setCurrentMsgId, getAgentMsgIds } = makeAgentCallbacks(ctx);
      setCurrentMsgId('local-first');
      callbacks.onMessageId?.('server-first');
      callbacks.onMessageId?.('server-first'); // The durable poll repeats the ID.
      callbacks.onContent?.('first visible reply');
      expect(messages).toEqual([{ id: 'server-first', role: 'assistant', content: 'first visible reply', timestamp: 1 }]);
      expect(getAgentMsgIds()).toEqual(['server-first']);
    });

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
it('rebases a published element replacement on GUI edits newer than the server render', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  try {
    const source = { code: 'same source', width: 512, height: 512, __makaronEditableRevision: 20,
      editables: [{ id: 'baby', type: 'image' as const, propKey: 'asset', label: 'Baby' }],
      props: { asset: 'original.png', _pos_baby: { x: 123, y: 45 }, _scale_baby: { w: .5, h: .6 } } };
    let snapshots: Snapshot[] = [{ id: 'source', image: 'poster', tips: [], messageId: '', design: source }];
    const ref = { current: snapshots };
    const ctx = createMockContext({ snapshotsRef: ref, setSnapshots: updater => { snapshots = updater(snapshots); ref.current = snapshots; } });
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onRender!({ ...source, __makaronEditableRevision: 10, props: { ...source.props, asset: 'edited.png', _pos_baby: { x: 0, y: 0 } },
      elementEdit: { version: 1, id: 'edit', sourceSnapshotId: 'source', fieldId: 'baby', operation: { kind: 'replace', source: 'original.png', url: 'edited.png' } },
      snapshotId: 'published', published: true, previewUrl: 'poster-new', sourceDesignPath: 'code/published.json' });
    expect(snapshots.find(s => s.id === 'published')?.design?.props).toMatchObject({ asset: 'edited.png', _pos_baby: { x: 123, y: 45 }, _scale_baby: { w: .5, h: .6 } });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).props._pos_baby).toEqual({ x: 123, y: 45 });
  } finally { vi.unstubAllGlobals(); }
});
