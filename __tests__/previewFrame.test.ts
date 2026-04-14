import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeAgentCallbacks, type AgentCallbackContext } from '@/lib/agentCallbacks';
import type { Message } from '@/types';

// ── Helper: mock context ──────────────────────────────────────────────────

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

// ── Tests ──────────────────────────────────────────────────────────────────

describe('preview_frame — frame number resolution', () => {
  // These test the frame calculation logic that lives in the tool's execute function.
  // We test it by directly computing what the tool would compute.

  function resolveFrame(
    opts: { frame?: number; timestamp?: number },
    animation?: { fps: number; durationInSeconds: number },
  ): number {
    const fps = animation?.fps || 30;
    const dur = animation?.durationInSeconds || 0;
    const totalFrames = dur > 0 ? Math.max(1, Math.round(fps * dur)) : 1;

    let targetFrame = 0;
    if (opts.frame !== undefined) {
      targetFrame = Math.max(0, Math.min(opts.frame, totalFrames - 1));
    } else if (opts.timestamp !== undefined) {
      targetFrame = Math.max(0, Math.min(Math.round(opts.timestamp * fps), totalFrames - 1));
    }
    return targetFrame;
  }

  it('defaults to frame 0 for still designs', () => {
    expect(resolveFrame({})).toBe(0);
  });

  it('defaults to frame 0 for videos when no param given', () => {
    expect(resolveFrame({}, { fps: 30, durationInSeconds: 10 })).toBe(0);
  });

  it('respects explicit frame number', () => {
    expect(resolveFrame({ frame: 100 }, { fps: 30, durationInSeconds: 10 })).toBe(100);
  });

  it('clamps frame to max (totalFrames - 1)', () => {
    // 10s * 30fps = 300 frames → max is 299
    expect(resolveFrame({ frame: 500 }, { fps: 30, durationInSeconds: 10 })).toBe(299);
  });

  it('clamps negative frame to 0', () => {
    expect(resolveFrame({ frame: -5 }, { fps: 30, durationInSeconds: 10 })).toBe(0);
  });

  it('converts timestamp to frame', () => {
    // 2.5s * 30fps = 75
    expect(resolveFrame({ timestamp: 2.5 }, { fps: 30, durationInSeconds: 10 })).toBe(75);
  });

  it('clamps timestamp beyond duration', () => {
    // 15s * 30fps = 450, but only 300 frames → clamp to 299
    expect(resolveFrame({ timestamp: 15 }, { fps: 30, durationInSeconds: 10 })).toBe(299);
  });

  it('frame takes priority over timestamp', () => {
    // Both provided: frame wins (checked first in the if/else)
    expect(resolveFrame({ frame: 50, timestamp: 5 }, { fps: 30, durationInSeconds: 10 })).toBe(50);
  });

  it('handles non-standard fps', () => {
    // 24fps, 5s = 120 frames
    expect(resolveFrame({ timestamp: 3 }, { fps: 24, durationInSeconds: 5 })).toBe(72);
  });

  it('still design ignores frame > 0', () => {
    // No animation → totalFrames = 1 → clamp to 0
    expect(resolveFrame({ frame: 10 })).toBe(0);
  });
});

describe('onPreviewFrame callback', () => {
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

  it('appends to message.images array', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');
    callbacks.onPreviewFrame?.('https://storage.example.com/drafts/design-snap3-frame0.jpg');

    expect(messages).toHaveLength(1);
    expect(messages[0].images).toEqual(['https://storage.example.com/drafts/design-snap3-frame0.jpg']);
  });

  it('does nothing if no current message', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onPreviewFrame?.('https://storage.example.com/some-url.jpg');
    expect(messages).toHaveLength(0);
  });

  it('updates the correct message when multiple turns exist', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');
    callbacks.onContent?.('First message');
    callbacks.onNewTurn?.('msg-2');
    callbacks.onContent?.('Second message');

    callbacks.onPreviewFrame?.('https://storage.example.com/frame-42.jpg');

    const msg1 = messages.find(m => m.id === 'msg-1');
    const msg2 = messages.find(m => m.id === 'msg-2');
    expect(msg1?.images).toBeUndefined();
    expect(msg2?.images).toEqual(['https://storage.example.com/frame-42.jpg']);
  });

  it('accumulates multiple preview frames on same message', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');
    callbacks.onPreviewFrame?.('https://storage.example.com/frame-0.jpg');
    callbacks.onPreviewFrame?.('https://storage.example.com/frame-100.jpg');
    callbacks.onPreviewFrame?.('https://storage.example.com/frame-200.jpg');

    expect(messages[0].images).toEqual([
      'https://storage.example.com/frame-0.jpg',
      'https://storage.example.com/frame-100.jpg',
      'https://storage.example.com/frame-200.jpg',
    ]);
  });
});

describe('onCaptureFrame callback', () => {
  it('calls captureDesignFrame when capture_frame event received', () => {
    const captureDesignFrame = vi.fn().mockResolvedValue(undefined);
    const ctx = createMockContext({ captureDesignFrame });
    const { callbacks } = makeAgentCallbacks(ctx);

    callbacks.onCaptureFrame?.(30, 'proj/drafts/design-snap3-frame30.jpg', 'capture-123');

    expect(captureDesignFrame).toHaveBeenCalledWith(30, 'proj/drafts/design-snap3-frame30.jpg');
  });

  it('does not crash if captureDesignFrame is not provided', () => {
    const ctx = createMockContext();
    const { callbacks } = makeAgentCallbacks(ctx);

    // Should not throw
    callbacks.onCaptureFrame?.(0, 'path.jpg', 'id');
  });

  it('handles captureDesignFrame rejection gracefully', () => {
    const captureDesignFrame = vi.fn().mockRejectedValue(new Error('render failed'));
    const ctx = createMockContext({ captureDesignFrame });
    const { callbacks } = makeAgentCallbacks(ctx);

    // Should not throw (error caught internally)
    callbacks.onCaptureFrame?.(0, 'path.jpg', 'id');
  });
});

describe('onRender — draft without previewUrl', () => {
  let ctx: AgentCallbackContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('sets draftDesign even without previewUrl', () => {
    const { callbacks } = makeAgentCallbacks(ctx);
    const design = { code: 'function D() {}', width: 1080, height: 1350 };
    callbacks.onRender?.(design as never);

    expect(ctx.setDraftDesign).toHaveBeenCalledWith(design);
  });

  it('does not set message.image when no previewUrl', () => {
    let messages: Message[] = [];
    ctx = createMockContext({
      setMessages: vi.fn((updater: (prev: Message[]) => Message[]) => {
        messages = updater(messages);
      }),
    });

    const { callbacks } = makeAgentCallbacks(ctx);
    callbacks.onNewTurn?.('msg-1');
    const design = { code: 'function D() {}', width: 1080, height: 1350 };
    callbacks.onRender?.(design as never);

    // No previewUrl → message.image should not be set
    expect(messages[0].image).toBeUndefined();
  });
});
