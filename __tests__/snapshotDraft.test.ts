import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeAgentCallbacks, type AgentCallbackContext } from '@/lib/agentCallbacks';
import type { Message, Snapshot, DesignPayload } from '@/types';

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

// ─── Image Snapshot Creation ──────────────────────────────────────────────────

describe('Image Snapshot (generate_image)', () => {
  let ctx: AgentCallbackContext;
  let snapshots: Snapshot[];
  let messages: Message[];

  beforeEach(() => {
    snapshots = [{ id: 'orig', image: 'base64-original', tips: [], messageId: 'msg-0' }];
    messages = [{ id: 'msg-1', role: 'assistant', content: '', timestamp: Date.now() }];
    ctx = createMockContext({
      setSnapshots: vi.fn((updater: (prev: Snapshot[]) => Snapshot[]) => {
        snapshots = updater(snapshots);
      }),
      setMessages: vi.fn((updater: (prev: Message[]) => Message[]) => {
        messages = updater(messages);
      }),
      snapshotsRef: { current: snapshots },
    });
  });

  it('onImage creates a new snapshot with image data', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');
    callbacks.onImage?.('data:image/jpeg;base64,abc123', 'gemini');

    expect(snapshots).toHaveLength(2);
    expect(snapshots[1].image).toBe('data:image/jpeg;base64,abc123');
    expect(snapshots[1].tips).toEqual([]);
  });

  it('onImage triggers saveSnapshot and fetchTips', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');
    callbacks.onImage?.('data:image/jpeg;base64,abc123', 'gemini');

    expect(ctx.onSaveSnapshot).toHaveBeenCalled();
    expect(ctx.fetchTipsForSnapshot).toHaveBeenCalled();
    expect(ctx.cacheImage).toHaveBeenCalled();
  });
});

// ─── Design Draft (render/patch → write_file publish) ─────────────────────────

describe('Design Draft Lifecycle', () => {
  let ctx: AgentCallbackContext;

  beforeEach(() => {
    ctx = createMockContext({
      snapshotsRef: { current: [{ id: 'orig', image: 'base64', tips: [], messageId: 'msg-0' }] },
    });
  });

  it('draft render sets draftDesign and draftParent, NOT pendingDesign', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');

    const design: DesignPayload & { published?: boolean } = {
      code: 'function Design() { return null; }',
      width: 1080, height: 1350,
      published: false,
    };
    callbacks.onRender?.(design as any);

    expect(ctx.setDraftDesign).toHaveBeenCalledWith(expect.objectContaining({ code: design.code }));
    expect(ctx.setDesignDraftParent).toHaveBeenCalledWith(0); // last snap index
    expect(ctx.setPendingDesign).not.toHaveBeenCalled();
  });

  it('published render sets pendingDesign and clears draft', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');

    const design: DesignPayload & { published?: boolean } = {
      code: 'function Design() { return null; }',
      width: 1080, height: 1350,
      published: true,
    };
    callbacks.onRender?.(design as any);

    expect(ctx.setPendingDesign).toHaveBeenCalledWith(expect.objectContaining({ code: design.code }));
    expect(ctx.setDraftDesign).toHaveBeenCalledWith(null);
    expect(ctx.setDesignDraftParent).toHaveBeenCalledWith(null);
  });

  it('draft does not create snapshot (snapshotImages stays clean)', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');

    // Send 3 draft renders
    for (let i = 0; i < 3; i++) {
      callbacks.onRender?.({
        code: `function Design() { return ${i}; }`,
        width: 1080, height: 1350,
        published: false,
      } as any);
    }

    // setSnapshots should NOT have been called (drafts don't create snapshots)
    expect(ctx.setSnapshots).not.toHaveBeenCalled();
  });

  it('previewUrl is passed through to CUI message', () => {
    let messages: Message[] = [{ id: 'msg-1', role: 'assistant', content: '', timestamp: Date.now() }];
    ctx = createMockContext({
      setMessages: vi.fn((updater: (prev: Message[]) => Message[]) => {
        messages = updater(messages);
      }),
      snapshotsRef: { current: [{ id: 'orig', image: 'base64', tips: [], messageId: 'msg-0' }] },
    });

    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');

    callbacks.onRender?.({
      code: 'function Design() { return null; }',
      width: 1080, height: 1350,
      published: false,
      previewUrl: 'https://storage.example.com/drafts/draft-1.jpg',
    } as any);

    // Message should have image set to previewUrl
    expect(messages[0].image).toBe('https://storage.example.com/drafts/draft-1.jpg');
  });
});

// ─── Draft Type Exclusivity ──────────────────────────────────────────────────

describe('Draft Mutual Exclusivity', () => {
  it('design draft clears tips draft state', () => {
    const ctx = createMockContext({
      snapshotsRef: { current: [{ id: 'orig', image: 'base64', tips: [], messageId: 'msg-0' }] },
    });

    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');

    // Start a design draft
    callbacks.onRender?.({
      code: 'function Design() { return null; }',
      width: 1080, height: 1350,
      published: false,
    } as any);

    // setDesignDraftParent should have been called (which clears tips in Editor.tsx)
    expect(ctx.setDesignDraftParent).toHaveBeenCalledWith(0);
  });
});

// ─── Sort Order Consistency ──────────────────────────────────────────────────

describe('Sort Order', () => {
  it('multiple image snapshots get incrementing indices', () => {
    let snapshots: Snapshot[] = [
      { id: 'orig', image: 'base64', tips: [], messageId: 'msg-0' },
    ];
    const ctx = createMockContext({
      setSnapshots: vi.fn((updater: (prev: Snapshot[]) => Snapshot[]) => {
        snapshots = updater(snapshots);
      }),
      snapshotsRef: { current: snapshots },
    });

    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');

    // Generate 3 images
    callbacks.onImage?.('img1', 'gemini');
    // Update ref to reflect new state
    ctx.snapshotsRef.current = snapshots;
    callbacks.onImage?.('img2', 'gemini');
    ctx.snapshotsRef.current = snapshots;
    callbacks.onImage?.('img3', 'gemini');

    expect(snapshots).toHaveLength(4); // orig + 3
    // Each should have unique ID
    const ids = snapshots.map(s => s.id);
    expect(new Set(ids).size).toBe(4);
  });

  it('design draft does not affect snapshot count', () => {
    let snapshots: Snapshot[] = [
      { id: 'orig', image: 'base64', tips: [], messageId: 'msg-0' },
    ];
    const ctx = createMockContext({
      setSnapshots: vi.fn((updater: (prev: Snapshot[]) => Snapshot[]) => {
        snapshots = updater(snapshots);
      }),
      snapshotsRef: { current: snapshots },
    });

    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');

    // 3 draft renders + 1 image
    callbacks.onRender?.({ code: 'v1', width: 1080, height: 1350, published: false } as any);
    callbacks.onRender?.({ code: 'v2', width: 1080, height: 1350, published: false } as any);
    callbacks.onRender?.({ code: 'v3', width: 1080, height: 1350, published: false } as any);
    callbacks.onImage?.('photo1', 'gemini');

    // Only 2 snapshots: orig + photo (drafts don't create snapshots)
    expect(snapshots).toHaveLength(2);
  });
});
