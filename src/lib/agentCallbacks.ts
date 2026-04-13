import type { AgentStreamCallbacks } from './agentStream';
import type { Snapshot, Tip, ProjectAnimation } from '@/types';
import type { DesignPayload } from '@/types';

/**
 * Context for creating unified agent callbacks.
 * Used by both SSE path (handleAgentRequest) and reconnect path (useAgentRun).
 */
export interface AgentCallbackContext {
  projectId: string;

  // React state setters
  setMessages: (updater: (prev: import('@/types').Message[]) => import('@/types').Message[]) => void;
  setSnapshots: (updater: (prev: Snapshot[]) => Snapshot[]) => void;
  setAgentStatus: (status: string) => void;
  setAnimations: (updater: (prev: ProjectAnimation[]) => ProjectAnimation[]) => void;
  setPendingDesign: (d: DesignPayload | null) => void;
  setPendingNotification?: (n: { text: string; targetIndex: number }) => void;
  setSelectedVideoId?: (id: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setAnimationState?: (state: any) => void;

  // Refs
  snapshotsRef: { current: Snapshot[] };
  isNsfwRef: { current: boolean };
  lastEditPromptRef: { current: string | null };
  lastEditInputImagesRef: { current: string[] | null };
  pendingDesignMsgIdRef: { current: string };
  pendingDesignSnapIdRef: { current: string };
  codeStreamRef: { current: { msgId: string; code: string; shown: number } | null };
  agentRunIdRef: { current: string | null };
  agentTimerRef: { current: { phase: string } | null };
  autoFetchTriggered: { current: boolean };
  pendingAnalysisRef: { current: { id: string; image: string }[] };
  pendingTeaserRef: { current: { snapshotId: string; tips: Tip[] } | null };
  hasTriggeredNamingRef: { current: boolean };
  draftParentIndexRef: { current: number | null };
  viewIndexRef: { current: number };
  pendingNavigateToVideoRef?: { current: boolean };

  // Callback functions (from Editor)
  cacheImage: (key: string, data: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fetchTipsForSnapshot: (...args: any[]) => void;
  onSaveSnapshot?: (snap: Snapshot, sortOrder: number, onUploaded?: (url: string) => void) => void;
  onUpdateDescription?: (snapId: string, desc: string) => void;
  triggerProjectNaming?: (text: string) => void;
  triggerTipsTeaser?: (snapId: string, tips: Tip[]) => void;
  compressBase64Image?: (img: string, maxBytes: number) => Promise<string>;

  // i18n
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: (...args: any[]) => string;

  // Music
  onMusicTaskCreated?: (taskId: string) => void;
  /** When true, onDone won't reset status to greeting (music polling shows its own status) */
  musicPollingRef?: { current: boolean };

  // Credits exhausted — show CreditPopup
  onInsufficientCredits?: (balance: number) => void;

  // Optional cleanup on done (reconnect uses this to disconnect)
  onCleanup?: () => void;

  // Initial title for auto-naming check
  initialTitle?: string;
  // The user prompt text (for auto-naming)
  userPromptText?: string;
}

function generateId() {
  return Date.now().toString() + Math.random().toString(36).slice(2);
}

/**
 * Creates unified agent callbacks used by both SSE and reconnect paths.
 * Returns callbacks + mutable state accessors.
 */
export function makeAgentCallbacks(ctx: AgentCallbackContext) {
  // Mutable state shared across callbacks
  let currentMsgId = '';
  const agentMsgIds: string[] = [];

  // Performance tracking
  const t0 = performance.now();
  let genStartTime = 0;

  // Analysis tracking (for auto-saving snapshot descriptions from analyze_image)
  let lastAnalyzedIdx: number | null = null;
  let analyzedTextBuf = '';

  const flushAnalyzedDesc = () => {
    if (lastAnalyzedIdx !== null && analyzedTextBuf.trim()) {
      const desc = analyzedTextBuf.split('\n\n')[0].trim().slice(0, 300);
      const snapIdx = lastAnalyzedIdx - 1;
      const snap = ctx.snapshotsRef.current[snapIdx];
      if (snap && !snap.description) {
        ctx.setSnapshots(prev => prev.map(s => s.id === snap.id ? { ...s, description: desc } : s));
        ctx.onUpdateDescription?.(snap.id, desc);
      }
    }
    lastAnalyzedIdx = null;
    analyzedTextBuf = '';
  };

  // Tool status minimum display time (2s) — prevents "Thinking" from immediately overriding tool statuses
  const MIN_TOOL_DISPLAY_MS = 2000;
  let toolStatusSetAt = 0;
  let pendingThinking: string | null = null;
  let minDisplayTimer: ReturnType<typeof setTimeout> | null = null;

  const isThinkingStatus = (s: string) =>
    s.includes('Thinking') || s.includes('正在思考');

  const isToolStatus = (s: string) =>
    !isThinkingStatus(s) && !s.includes('Done') && !s.includes('完成') && !s.includes('greeting');

  const callbacks: AgentStreamCallbacks = {
    onStatus: (status) => {
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      console.log(`⏱️ [agent] status="${status}" at +${elapsed}s`);
      if (status.includes('生成图片') || status.includes('Generating image')) {
        genStartTime = performance.now();
      }

      if (isToolStatus(status)) {
        // Tool status: display immediately, record timestamp
        pendingThinking = null;
        if (minDisplayTimer) { clearTimeout(minDisplayTimer); minDisplayTimer = null; }
        toolStatusSetAt = performance.now();
        ctx.setAgentStatus(status);
      } else if (isThinkingStatus(status)) {
        // Thinking: defer if tool status hasn't been shown long enough
        const remaining = MIN_TOOL_DISPLAY_MS - (performance.now() - toolStatusSetAt);
        if (remaining > 0 && toolStatusSetAt > 0) {
          pendingThinking = status;
          if (minDisplayTimer) clearTimeout(minDisplayTimer);
          minDisplayTimer = setTimeout(() => {
            if (pendingThinking) {
              ctx.setAgentStatus(pendingThinking);
              pendingThinking = null;
            }
            minDisplayTimer = null;
          }, remaining);
        } else {
          ctx.setAgentStatus(status);
        }
      } else {
        // Other statuses (done, error, etc): display immediately
        pendingThinking = null;
        if (minDisplayTimer) { clearTimeout(minDisplayTimer); minDisplayTimer = null; }
        ctx.setAgentStatus(status);
      }
    },

    onImageAnalyzed: (imageIndex) => {
      flushAnalyzedDesc();
      lastAnalyzedIdx = imageIndex;
      analyzedTextBuf = '';
    },

    onNewTurn: (serverMessageId) => {
      flushAnalyzedDesc();
      const newId = serverMessageId || generateId();
      currentMsgId = newId;
      agentMsgIds.push(newId);
      ctx.setMessages(prev => [...prev, {
        id: newId,
        role: 'assistant' as const,
        content: '',
        timestamp: Date.now(),
      }]);
    },

    onContent: (delta) => {
      if (!currentMsgId) return;
      const id = currentMsgId;
      ctx.setMessages(prev => prev.map(m =>
        m.id === id ? { ...m, content: m.content + delta } : m,
      ));
      if (lastAnalyzedIdx !== null) {
        analyzedTextBuf += delta;
      }
    },

    onImage: (imageData, usedModel, serverSnapshotId, serverImageUrl) => {
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      const genDuration = genStartTime ? ((performance.now() - genStartTime) / 1000).toFixed(1) : '?';
      console.log(`⏱️ [agent] IMAGE received at +${elapsed}s (${usedModel || 'gemini'} took ${genDuration}s)`);

      const snapId = serverSnapshotId || generateId();
      const editDesc = ctx.lastEditPromptRef.current
        ? `[agent] ${ctx.lastEditPromptRef.current.slice(0, 100)}`
        : undefined;
      const newSnapshot: Snapshot = {
        id: snapId,
        image: imageData,
        tips: [],
        messageId: currentMsgId,
        description: editDesc,
        ...(serverImageUrl ? { imageUrl: serverImageUrl } : {}),
      };

      ctx.setSnapshots(prev => {
        if (prev.some(s => s.id === snapId)) return prev;
        return [...prev, newSnapshot];
      });

      ctx.onSaveSnapshot?.(newSnapshot, ctx.snapshotsRef.current.length, (url) => {
        ctx.setSnapshots(prev => prev.map(s => s.id === snapId ? { ...s, imageUrl: url } : s));
      });
      if (editDesc) ctx.onUpdateDescription?.(snapId, editDesc);
      ctx.cacheImage(`snap:${snapId}`, imageData);

      const isFirstSnapshot = ctx.snapshotsRef.current.length <= 1;
      ctx.fetchTipsForSnapshot(snapId, imageData, isFirstSnapshot ? 'full' : 'none');
      ctx.autoFetchTriggered.current = true;
      ctx.setAgentStatus(ctx.t('status.imageGenerated'));

      // "See" button if user is not on the new snapshot
      const newSnapIdx = ctx.snapshotsRef.current.length;
      if (ctx.draftParentIndexRef.current !== null || ctx.viewIndexRef.current !== newSnapIdx) {
        ctx.setPendingNotification?.({ text: ctx.t('status.imageGenerated'), targetIndex: newSnapIdx });
      }

      // Attach image + editPrompt to current message
      const id = currentMsgId;
      const capturedPrompt = ctx.lastEditPromptRef.current;
      const capturedInputImages = ctx.lastEditInputImagesRef.current;
      ctx.lastEditPromptRef.current = null;
      ctx.lastEditInputImagesRef.current = null;
      ctx.setMessages(prev => prev.map(m =>
        m.id === id ? {
          ...m,
          image: imageData,
          editPrompt: capturedPrompt ?? undefined,
          editModel: usedModel ?? undefined,
          editInputImages: capturedInputImages ?? undefined,
        } : m,
      ));

      // Auto-name project after first image generation
      if (!ctx.hasTriggeredNamingRef.current && (!ctx.initialTitle || ctx.initialTitle === 'Untitled' || ctx.initialTitle === '未命名' || ctx.initialTitle === '未命名项目')) {
        ctx.hasTriggeredNamingRef.current = true;
        ctx.triggerProjectNaming?.(ctx.userPromptText ?? '');
      }
    },

    onToolCall: (tool, input, images) => {
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      console.log(`⏱️ [agent] tool_call="${tool}" at +${elapsed}s`, tool === 'generate_image' ? `editPrompt="${(input.editPrompt as string)?.slice(0, 80)}..."` : '');
      if (tool === 'generate_image' && typeof input.editPrompt === 'string') {
        ctx.lastEditPromptRef.current = input.editPrompt;
        ctx.lastEditInputImagesRef.current = images ?? null;
      }
    },

    onCodeStream: (text, done) => {
      if (!ctx.codeStreamRef.current && !done && text) {
        const id = currentMsgId;
        if (id) {
          ctx.codeStreamRef.current = { msgId: id, code: '', shown: 0 };
          ctx.setMessages(prev => prev.map(m =>
            m.id === id ? { ...m, content: (m.content || '') + '\n\n```javascript\n' } : m,
          ));
        }
      }
      const stream = ctx.codeStreamRef.current;
      if (!stream) return;
      if (done) {
        ctx.setMessages(prev => prev.map(m =>
          m.id === stream.msgId ? { ...m, content: (m.content || '') + '\n```\n' } : m,
        ));
        ctx.codeStreamRef.current = null;
      } else {
        ctx.setMessages(prev => prev.map(m =>
          m.id === stream.msgId ? { ...m, content: (m.content || '') + text } : m,
        ));
      }
    },

    onAnimationTask: (taskId, prompt) => {
      const urls = ctx.snapshotsRef.current.filter(s => s.imageUrl).map(s => s.imageUrl!).slice(0, 7);
      const newAnim: ProjectAnimation = {
        id: taskId,
        projectId: ctx.projectId,
        taskId,
        videoUrl: null,
        prompt,
        snapshotUrls: urls,
        status: 'processing',
        createdAt: new Date().toISOString(),
      };
      ctx.setAnimations(prev => [newAnim, ...prev]);
      ctx.setSelectedVideoId?.(taskId);
      if (ctx.pendingNavigateToVideoRef) ctx.pendingNavigateToVideoRef.current = true;
      ctx.setAnimationState?.({
        imageUrls: urls,
        status: 'polling',
        prompt,
        userHint: '',
        taskId,
        videoUrl: null,
        error: null,
        duration: null,
        pollSeconds: 0,
      });
    },

    onMusicTask: (taskId) => {
      console.log(`🎵 [agent] music task created: ${taskId}`);
      ctx.onMusicTaskCreated?.(taskId);
    },

    onNsfwDetected: () => {
      console.log('[agent] NSFW content detected — session flagged, future calls skip Gemini');
      ctx.isNsfwRef.current = true;
    },

    onRunId: (id) => { ctx.agentRunIdRef.current = id; },

    onMessageId: (serverId) => {
      const oldId = agentMsgIds[0];
      if (oldId) {
        currentMsgId = serverId;
        agentMsgIds[0] = serverId;
        ctx.setMessages(prev => prev.map(m => m.id === oldId ? { ...m, id: serverId } : m));
      }
    },

    onReasoning: () => {
      if (ctx.agentTimerRef.current) ctx.agentTimerRef.current.phase = ctx.t('editor.agentThinking');
    },

    onCoding: () => {
      if (ctx.agentTimerRef.current) ctx.agentTimerRef.current.phase = ctx.t('editor.agentCoding');
    },

    onRender: (design) => {
      console.log(`🎨 [agent] render received: ${design.width}x${design.height}, code ${design.code.length} chars`);
      ctx.setAgentStatus(ctx.t('status.renderingDesign'));
      ctx.pendingDesignMsgIdRef.current = currentMsgId;
      ctx.pendingDesignSnapIdRef.current = (design as Record<string, unknown>).snapshotId as string || '';
      ctx.setPendingDesign(design);
    },

    onDone: () => {
      flushAnalyzedDesc();
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      console.log(`⏱️ [agent] DONE total ${elapsed}s`);
      // Don't overwrite music polling status
      if (!ctx.musicPollingRef?.current) {
        ctx.setAgentStatus(ctx.t('editor.done'));
      }

      // Drain pending CUI-attached images
      const pendingList = [...ctx.pendingAnalysisRef.current];
      ctx.pendingAnalysisRef.current = [];
      if (pendingList.length > 0 && ctx.compressBase64Image) {
        const compress = ctx.compressBase64Image;
        (async () => {
          for (const { id, image } of pendingList) {
            const tipsImg = await compress(image, 600_000);
            ctx.fetchTipsForSnapshot(id, tipsImg, 'none');
          }
        })();
      }

      // Drain pending teaser or reset greeting (skip if music polling)
      const pendingTeaser = ctx.pendingTeaserRef.current;
      if (pendingTeaser) {
        ctx.pendingTeaserRef.current = null;
        setTimeout(() => ctx.triggerTipsTeaser?.(pendingTeaser.snapshotId, pendingTeaser.tips), 400);
      } else if (!ctx.musicPollingRef?.current) {
        setTimeout(() => ctx.setAgentStatus(ctx.t('editor.greeting')), 2000);
      }

      ctx.onCleanup?.();
    },

    onError: (msg) => {
      console.error('Agent error:', msg);
      if (currentMsgId) {
        const id = currentMsgId;
        ctx.setMessages(prev => prev.map(m =>
          m.id === id ? { ...m, content: m.content || ctx.t('editor.errorRetry') } : m,
        ));
      }
      ctx.onCleanup?.();
    },

    onInsufficientCredits: (balance) => {
      // Insert a system message in CUI — popup only opens when user taps "Top Up"
      const sysMsg: import('@/types').Message = {
        id: `credits-${Date.now()}`,
        role: 'assistant',
        content: `[CREDITS_EXHAUSTED:${balance}]`,
        timestamp: Date.now(),
      };
      ctx.setMessages(prev => [...prev, sysMsg]);
      ctx.setAgentStatus('');
      ctx.onInsufficientCredits?.(balance); // triggers StatusBar notification
      ctx.onCleanup?.();
    },
  };

  return {
    callbacks,
    getCurrentMsgId: () => currentMsgId,
    setCurrentMsgId: (id: string) => { currentMsgId = id; },
    getAgentMsgIds: () => agentMsgIds,
  };
}
