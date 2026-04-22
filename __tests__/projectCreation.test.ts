/**
 * Tests for new project creation paths through agentCallbacks.
 * Covers: single image, multi-image, text-to-image, text-to-design.
 *
 * These test the callback layer (what happens when SSE events arrive),
 * not the full Agent flow. They verify that snapshots, messages, and
 * draft state are correctly managed for each creation path.
 */

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

// ═══════════════════════════════════════════════════════════════════════════════
// Path 1: Single image upload → Agent analyzes → tips generated
// ═══════════════════════════════════════════════════════════════════════════════

describe('Path 1: Single image upload', () => {
  let snapshots: Snapshot[];
  let messages: Message[];
  let ctx: AgentCallbackContext;

  beforeEach(() => {
    // User uploaded 1 image → snapshots[0] already exists
    snapshots = [{ id: 'snap-0', image: 'data:image/jpeg;base64,original', tips: [], messageId: '' }];
    messages = [];
    ctx = createMockContext({
      setSnapshots: vi.fn((updater: (prev: Snapshot[]) => Snapshot[]) => {
        snapshots = updater(snapshots);
      }),
      setMessages: vi.fn((updater: (prev: Message[]) => Message[]) => {
        messages = updater(messages);
      }),
      snapshotsRef: { current: snapshots },
      initialTitle: 'Untitled',
    });
  });

  it('Agent generates an image → new snapshot added', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');
    callbacks.onImage?.('data:image/jpeg;base64,edited', 'gemini', 'snap-1');

    expect(snapshots).toHaveLength(2);
    expect(snapshots[1].id).toBe('snap-1');
    expect(snapshots[1].image).toBe('data:image/jpeg;base64,edited');
  });

  it('triggers tips fetch after image generation', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');
    callbacks.onImage?.('data:image/jpeg;base64,edited', 'gemini', 'snap-1');

    expect(ctx.fetchTipsForSnapshot).toHaveBeenCalled();
  });

  it('triggers project naming on first image', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');
    callbacks.onImage?.('data:image/jpeg;base64,edited', 'gemini', 'snap-1');

    expect(ctx.triggerProjectNaming).toHaveBeenCalled();
  });

  it('does not trigger naming twice', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');
    callbacks.onImage?.('data:image/jpeg;base64,img1', 'gemini', 'snap-1');
    ctx.snapshotsRef.current = snapshots;
    callbacks.onImage?.('data:image/jpeg;base64,img2', 'gemini', 'snap-2');

    expect(ctx.triggerProjectNaming).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Path 2: Multi-image upload → multiple snapshots
// ═══════════════════════════════════════════════════════════════════════════════

describe('Path 2: Multi-image upload', () => {
  let snapshots: Snapshot[];
  let ctx: AgentCallbackContext;

  beforeEach(() => {
    // User uploaded 3 images
    snapshots = [
      { id: 'snap-0', image: 'data:image/jpeg;base64,img0', tips: [], messageId: '' },
      { id: 'snap-1', image: 'data:image/jpeg;base64,img1', tips: [], messageId: '' },
      { id: 'snap-2', image: 'data:image/jpeg;base64,img2', tips: [], messageId: '' },
    ];
    ctx = createMockContext({
      setSnapshots: vi.fn((updater: (prev: Snapshot[]) => Snapshot[]) => {
        snapshots = updater(snapshots);
      }),
      snapshotsRef: { current: snapshots },
    });
  });

  it('Agent generates image → appended after existing snapshots', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');
    callbacks.onImage?.('data:image/jpeg;base64,new', 'gemini', 'snap-3');

    expect(snapshots).toHaveLength(4);
    expect(snapshots[3].id).toBe('snap-3');
  });

  it('design draft uses last snapshot as parent', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');
    callbacks.onRender?.({
      code: 'function D() { return null; }',
      width: 1080, height: 1350,
      published: false,
    } as any);

    // Last snap index = 2
    expect(ctx.setDesignDraftParent).toHaveBeenCalledWith(2);
  });

  it('deduplicates snapshot by ID', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');
    // Same ID as existing
    callbacks.onImage?.('data:image/jpeg;base64,dup', 'gemini', 'snap-1');

    // Should not add duplicate
    expect(snapshots).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Path 3: Text-to-image (no initial image, Agent generates image)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Path 3: Text-to-image (empty project)', () => {
  let snapshots: Snapshot[];
  let messages: Message[];
  let ctx: AgentCallbackContext;

  beforeEach(() => {
    // Text-only prompt → no initial snapshots
    snapshots = [];
    messages = [];
    ctx = createMockContext({
      setSnapshots: vi.fn((updater: (prev: Snapshot[]) => Snapshot[]) => {
        snapshots = updater(snapshots);
      }),
      setMessages: vi.fn((updater: (prev: Message[]) => Message[]) => {
        messages = updater(messages);
      }),
      snapshotsRef: { current: snapshots },
      initialTitle: 'Untitled',
    });
  });

  it('Agent generates image on empty project → first snapshot created', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');
    callbacks.onImage?.('data:image/jpeg;base64,generated', 'gemini', 'snap-0');

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].id).toBe('snap-0');
    expect(snapshots[0].messageId).toBe('msg-1');
  });

  it('triggers naming and tips on first generated image', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');
    callbacks.onImage?.('data:image/jpeg;base64,generated', 'gemini', 'snap-0');

    expect(ctx.triggerProjectNaming).toHaveBeenCalled();
    expect(ctx.fetchTipsForSnapshot).toHaveBeenCalled();
  });

  it('attaches image to assistant message', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');
    callbacks.onContent?.('Here is your image');
    callbacks.onImage?.('data:image/jpeg;base64,generated', 'gemini', 'snap-0');

    expect(messages[0].image).toBe('data:image/jpeg;base64,generated');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Path 4: Text-to-design (no image, Agent creates design via run_code)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Path 4: Text-to-design (empty project, design mode)', () => {
  let ctx: AgentCallbackContext;

  beforeEach(() => {
    // Empty project — no snapshots at all
    ctx = createMockContext({
      snapshotsRef: { current: [] },
      initialTitle: 'Untitled',
    });
  });

  it('draft render on empty project sets draftParent to 0', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');

    callbacks.onRender?.({
      code: 'function Design() { return null; }',
      width: 1080, height: 1920,
      published: false,
    } as any);

    expect(ctx.setDraftDesign).toHaveBeenCalled();
    // snapshots.length - 1 = -1, clamped to 0
    expect(ctx.setDesignDraftParent).toHaveBeenCalledWith(0);
  });

  it('published render on empty project sets pendingDesign', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');

    callbacks.onRender?.({
      code: 'function Design() { return null; }',
      width: 1080, height: 1920,
      published: true,
    } as any);

    expect(ctx.setPendingDesign).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'function Design() { return null; }' })
    );
    expect(ctx.pendingDesignMsgIdRef.current).toBe('msg-1');
  });

  it('multiple drafts on empty project do not create snapshots', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');

    for (let i = 0; i < 5; i++) {
      callbacks.onRender?.({
        code: `function Design() { return ${i}; }`,
        width: 1080, height: 1920,
        published: false,
      } as any);
    }

    expect(ctx.setSnapshots).not.toHaveBeenCalled();
    expect(ctx.setDraftDesign).toHaveBeenCalledTimes(5);
  });

  it('draft → publish sequence works on empty project', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');

    // Draft
    callbacks.onRender?.({
      code: 'function D() { return 1; }',
      width: 1080, height: 1920,
      published: false,
    } as any);

    expect(ctx.setDraftDesign).toHaveBeenCalled();

    // Publish
    callbacks.onRender?.({
      code: 'function D() { return 1; }',
      width: 1080, height: 1920,
      published: true,
    } as any);

    expect(ctx.setPendingDesign).toHaveBeenCalled();
    expect(ctx.setDraftDesign).toHaveBeenLastCalledWith(null);
    expect(ctx.setDesignDraftParent).toHaveBeenLastCalledWith(null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Path 5: Design on existing project (has snapshots, Agent adds design)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Path 5: Design on existing project', () => {
  let ctx: AgentCallbackContext;

  beforeEach(() => {
    ctx = createMockContext({
      snapshotsRef: { current: [
        { id: 's0', image: 'img0', tips: [], messageId: '' },
        { id: 's1', image: 'img1', tips: [], messageId: '' },
        { id: 's2', image: 'img2', tips: [], messageId: '' },
      ] },
    });
  });

  it('draft uses correct parent (last snapshot)', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');

    callbacks.onRender?.({
      code: 'function D() {}', width: 1080, height: 1350,
      published: false,
    } as any);

    expect(ctx.setDesignDraftParent).toHaveBeenCalledWith(2); // index of last snapshot
  });

  it('publish sets correct msgId', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-agent');

    callbacks.onRender?.({
      code: 'function D() {}', width: 1080, height: 1350,
      published: true,
    } as any);

    expect(ctx.pendingDesignMsgIdRef.current).toBe('msg-agent');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// preview_frame integration with different project states
// ═══════════════════════════════════════════════════════════════════════════════

describe('preview_frame with capture callback', () => {
  it('onCaptureFrame fires on empty project', () => {
    const captureDesignFrame = vi.fn().mockResolvedValue(undefined);
    const ctx = createMockContext({
      snapshotsRef: { current: [] },
      captureDesignFrame,
    });

    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');
    callbacks.onCaptureFrame?.(0, 'proj/drafts/design-snap0-frame0.jpg', 'cap-1');

    expect(captureDesignFrame).toHaveBeenCalledWith(0, 'proj/drafts/design-snap0-frame0.jpg');
  });

  it('multiple captures accumulate in images array', () => {
    let messages: Message[] = [];
    const ctx = createMockContext({
      setMessages: vi.fn((updater: (prev: Message[]) => Message[]) => {
        messages = updater(messages);
      }),
    });

    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');
    callbacks.onPreviewFrame?.('https://example.com/frame-0.jpg');
    callbacks.onPreviewFrame?.('https://example.com/frame-50.jpg');
    callbacks.onPreviewFrame?.('https://example.com/frame-100.jpg');

    expect(messages[0].images).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Mixed scenarios: image + design in same session
// ═══════════════════════════════════════════════════════════════════════════════

describe('Mixed: image generation + design in same session', () => {
  let snapshots: Snapshot[];
  let ctx: AgentCallbackContext;

  beforeEach(() => {
    snapshots = [{ id: 'orig', image: 'base64', tips: [], messageId: '' }];
    ctx = createMockContext({
      setSnapshots: vi.fn((updater: (prev: Snapshot[]) => Snapshot[]) => {
        snapshots = updater(snapshots);
      }),
      snapshotsRef: { current: snapshots },
    });
  });

  it('image then design draft: snapshot count only includes image', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');

    // Agent generates an image
    callbacks.onImage?.('img-data', 'gemini', 'snap-new');
    ctx.snapshotsRef.current = snapshots;

    // Then creates a design draft
    callbacks.onRender?.({
      code: 'function D() {}', width: 1080, height: 1350,
      published: false,
    } as any);

    // 2 snapshots (orig + generated image), design draft is NOT a snapshot
    expect(snapshots).toHaveLength(2);
    expect(ctx.setDraftDesign).toHaveBeenCalled();
    expect(ctx.setDesignDraftParent).toHaveBeenCalledWith(1); // parent = last snap
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('Edge cases', () => {
  it('onDone fires correctly after design publish', () => {
    const ctx = createMockContext({
      snapshotsRef: { current: [{ id: 's0', image: 'img', tips: [], messageId: '' }] },
    });

    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');
    callbacks.onRender?.({
      code: 'function D() {}', width: 1080, height: 1350,
      published: true,
    } as any);
    callbacks.onDone?.();

    expect(ctx.setAgentStatus).toHaveBeenCalledWith('editor.done');
  });

  it('onError does not crash on empty project', () => {
    const ctx = createMockContext({ snapshotsRef: { current: [] } });
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');
    callbacks.onError?.('Something went wrong');

    // Should not throw
    expect(ctx.setMessages).toHaveBeenCalled();
  });

  it('server-provided snapshot ID and URL are preserved', () => {
    let snapshots: Snapshot[] = [];
    const ctx = createMockContext({
      setSnapshots: vi.fn((updater: (prev: Snapshot[]) => Snapshot[]) => {
        snapshots = updater(snapshots);
      }),
      snapshotsRef: { current: snapshots },
    });

    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');
    callbacks.onImage?.('data:img', 'gemini', 'server-snap-id', 'https://storage.url/img.jpg');

    expect(snapshots[0].id).toBe('server-snap-id');
    expect(snapshots[0].imageUrl).toBe('https://storage.url/img.jpg');
  });
});
