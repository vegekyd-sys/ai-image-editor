'use client';

import { useState, useRef, useCallback, useMemo, useEffect, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { Message, Tip, Snapshot, PhotoMetadata, AnnotationEntry, ProjectAnimation } from '@/types';
import ImageCanvas from '@/components/ImageCanvas';
import TipsBar from '@/components/TipsBar';
import AgentStatusBar from '@/components/AgentStatusBar';
import AgentChatView, { type PreferredModel } from '@/components/AgentChatView';
import AnnotationToolbar from '@/components/AnnotationToolbar';
import { streamAgent } from '@/lib/agentStream';

// Semaphore to limit concurrent /api/tips requests across all snapshots.
// Single image: 4 categories run in parallel (fine). Multi-image: 10 images × 4 = 40 concurrent → rate limit risk.
// With maxConcurrent=4, multi-image tips are effectively serialized per snapshot.
const _tipsQueue: Array<() => void> = [];
let _tipsRunning = 0;
const TIPS_MAX_CONCURRENT = 20;
function acquireTipsSlot(): Promise<void> {
  if (_tipsRunning < TIPS_MAX_CONCURRENT) { _tipsRunning++; return Promise.resolve(); }
  return new Promise(resolve => _tipsQueue.push(resolve));
}
function releaseTipsSlot() {
  _tipsRunning--;
  const next = _tipsQueue.shift();
  if (next) { _tipsRunning++; next(); }
}
import { cacheImage } from '@/lib/imageCache';
import { mergeAnnotation } from '@/lib/annotationUtils';
import { newAnnotationId } from '@/features/annotation/annotationIds';
import AnimateSheet from '@/components/AnimateSheet';
import VideoResultCard from '@/components/VideoResultCard';
import CameraPanel from '@/components/CameraPanel';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { compressBase64Image, compressImageFile, isHeicFile } from '@/lib/imageUtils';
import { containRect, coverRect } from '@/lib/image/geometry';
import { extractPhotoMetadata } from '@/lib/image/metadata';
import { useLocale } from '@/lib/i18n';
import { getThumbnailUrl, getOptimizedUrl } from '@/lib/supabase/storage';
import { AZIMUTH_MAP, ELEVATION_MAP, DISTANCE_MAP, AZIMUTH_STEPS, ELEVATION_STEPS, DISTANCE_STEPS, snapToNearest, type CameraState } from '@/lib/camera-utils';

export interface AnimationState {
  imageUrls: string[]
  prompt: string
  userHint: string
  taskId: string | null
  videoUrl: string | null
  status: 'idle' | 'generating_prompt' | 'ready' | 'submitting' | 'polling' | 'done' | 'error'
  error: string | null
  duration: number | null  // null = smart mode (API decides 3-15s)
  pollSeconds: number
}

function generateId() {
  return Date.now().toString() + Math.random().toString(36).slice(2);
}

/** Map a timeline index to the corresponding snapshot index.
 *  Returns null when the timeline index points at the virtual draft entry. */
function snapFromTimeline(timelineIdx: number, draftParentIdx: number | null): number | null {
  if (draftParentIdx === null) return timelineIdx;
  if (timelineIdx === draftParentIdx + 1) return null; // draft slot
  if (timelineIdx <= draftParentIdx) return timelineIdx;
  return timelineIdx - 1; // shift back past the draft slot
}

/** Map a snapshot index to its timeline index (accounting for draft slot). */
function timelineFromSnap(snapIdx: number, draftParentIdx: number | null): number {
  if (draftParentIdx === null || snapIdx <= draftParentIdx) return snapIdx;
  return snapIdx + 1;
}

// t('editor.greeting') is now locale-aware via t('editor.greeting') in the component

/** Get best image representation for API calls: URL if available (tiny payload), else raw image (base64) */
function getImageForApi(snapshot: Snapshot | undefined): string {
  return snapshot?.imageUrl || snapshot?.image || '';
}

/** Fetch reference images for a skill and return them as Snapshot objects. */
async function fetchSkillReferenceSnapshots(skillName: string): Promise<Snapshot[]> {
  try {
    const res = await fetch('/api/skills');
    const { skills } = await res.json();
    const skill = skills?.find((s: { name: string }) => s.name === skillName);
    const refImages: string[] = skill?.referenceImages || [];
    return refImages.map((url, i) => ({
      id: generateId(),
      image: url,
      tips: [],
      messageId: '',
      imageUrl: url,
      type: 'reference' as const,
      description: `Reference image ${i + 1} from skill "${skillName}"`,
    }));
  } catch (err) {
    console.warn('[Editor] Failed to fetch skill reference images:', err);
    return [];
  }
}

interface EditorProps {
  projectId?: string;
  initialSnapshots?: Snapshot[];
  initialMessages?: Message[];
  pendingImage?: string;  // legacy single-image (unused, kept for compat)
  pendingImages?: string[];
  pendingMetadata?: PhotoMetadata;
  pendingPrompt?: string;
  pendingSkill?: string;
  onSaveSnapshot?: (snapshot: Snapshot, sortOrder: number, onUploaded?: (imageUrl: string) => void) => void;
  onSaveMessage?: (message: Message) => void;
  onUpdateTips?: (snapshotId: string, tips: Tip[]) => void;
  onUpdateDescription?: (snapshotId: string, description: string) => void;
  initialTitle?: string;
  onRenameProject?: (title: string) => void;
  onBack?: () => void;
  onNewProject?: (file: File) => void;
  initialAnimations?: ProjectAnimation[];
}

export default function Editor({
  projectId,
  initialSnapshots,
  initialMessages,
  pendingImage,
  pendingImages: pendingImagesProp,
  pendingMetadata,
  pendingPrompt,
  pendingSkill,
  onSaveSnapshot,
  onSaveMessage,
  onUpdateTips,
  onUpdateDescription,
  initialTitle,
  onRenameProject,
  onBack,
  onNewProject,
  initialAnimations,
}: EditorProps = {}) {
  // Merge legacy single + new multi into one array
  const pendingImages = pendingImagesProp ?? (pendingImage ? [pendingImage] : undefined);
  const isDesktop = useIsDesktop();
  const { t, locale } = useLocale();
  const [cuiPanelWidth, setCuiPanelWidth] = useState(500);
  const cuiPanelRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Message[]>(initialMessages ?? []);
  const [snapshots, setSnapshots] = useState<Snapshot[]>(initialSnapshots ?? []);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveToast, setSaveToast] = useState(false);
  const [isTipsFetching, setIsTipsFetching] = useState(false);
  const [failedCategories, setFailedCategories] = useState<Set<Tip['category']>>(new Set());
  const [viewIndex, setViewIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'gui' | 'cui'>('gui');
  // Annotation (paintbrush) mode
  const [annotationMode, setAnnotationMode] = useState(false);
  const [annotationTool, setAnnotationTool] = useState<'brush' | 'rect' | 'text'>('brush');
  const [annotationEntries, setAnnotationEntries] = useState<AnnotationEntry[]>([]);
  const [annotationUndoStack, setAnnotationUndoStack] = useState<AnnotationEntry[]>([]);
  const annotationColor = '#dc2626'; // fixed red for all annotations
  const [annotationBrushSize, setAnnotationBrushSize] = useState(30); // 0-100 slider
  // Text editing sub-mode
  const [textEditPos, setTextEditPos] = useState<{ x: number; y: number } | null>(null);
  const [textEditValue, setTextEditValue] = useState('');
  const [textColor, setTextColor] = useState('#ec4899');
  const [textBgEnabled, setTextBgEnabled] = useState(true);
  const [showAnimateSheet, setShowAnimateSheet] = useState(false);
  // Camera rotation panel
  const [showCameraPanel, setShowCameraPanel] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  // Animation state: lifted from AnimateSheet so it persists across GUI↔CUI switches
  const [animationState, setAnimationState] = useState<AnimationState | null>(null);
  // All animations for this project (loaded from DB + newly created)
  const [animations, setAnimations] = useState<ProjectAnimation[]>(() => initialAnimations ?? []);
  // Which video is currently selected for canvas playback
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [videoPlayTrigger, setVideoPlayTrigger] = useState(0);
  // Detail mode: which animation to view in AnimateSheet
  const [detailAnimation, setDetailAnimation] = useState<ProjectAnimation | null>(null);
  const [previewingTipIndex, setPreviewingTipIndex] = useState<number | null>(null);
  const [draftParentIndex, setDraftParentIndex] = useState<number | null>(null);
  const [draftFullLoaded, setDraftFullLoaded] = useState(false);
  const [isAgentActive, setIsAgentActive] = useState(false);
  const [agentStatus, setAgentStatus] = useState(t('editor.greeting'));
  const [preferredModel, setPreferredModel] = useState<PreferredModel>('auto');
  const [loadingMoreCategories, setLoadingMoreCategories] = useState<Set<Tip['category']>>(new Set());
  const [committedCategory, setCommittedCategory] = useState<Tip['category'] | null>(null);
  const agentAbortRef = useRef<AbortController>(new AbortController());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newProjectFileInputRef = useRef<HTMLInputElement>(null);
  const previewAbortRef = useRef<AbortController>(new AbortController());
  // Snapshots pending auto-analysis after current agent run finishes
  const pendingAnalysisRef = useRef<{ id: string; image: string }[]>([]);
  const lastEditPromptRef = useRef<string | null>(null); // captures editPrompt from generate_image tool calls
  const lastEditInputImagesRef = useRef<string[] | null>(null); // captures input images from generate_image tool calls
  const isNsfwRef = useRef(false); // NSFW flag — set when Gemini blocks content, session-level

  // ── Hero animation (GUI ↔ CUI transition) ───────────────────────
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const lastCanvasRect = useRef<{ l: number; t: number; w: number; h: number } | null>(null);
  const lastImageAR = useRef(1); // cached image aspect ratio for CUI→GUI direction
  const cuiInputBarH = useRef(96); // cached CUI input bar height for PiP target position
  const HERO_DURATION = 380;
  interface HeroAnim {
    src: string;
    // Container rect (overflow:hidden clip)
    fromRect: { l: number; t: number; w: number; h: number };
    toRect:   { l: number; t: number; w: number; h: number };
    // Img absolute rect within container (simulates contain/cover).
    // Unused when objectCover=true (img fills container with object-cover instead).
    fromImg:  { l: number; t: number; w: number; h: number };
    toImg:    { l: number; t: number; w: number; h: number };
    fromRadius: string;
    toRadius: string;
    active: boolean;
    objectCover?: boolean; // when true, img uses w-full h-full object-cover (no img animation)
  }
  const [heroAnim, setHeroAnim] = useState<HeroAnim | null>(null);
  // ────────────────────────────────────────────────────────────────

  // ── Pull-down gesture (GUI → CUI) ─────────────────────────────
  const [pullProgress, setPullProgress] = useState<number | null>(null); // null=inactive, 0-1=gesture
  const [pullDelta, setPullDelta] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 }); // finger offset
  const pullStartRect = useRef<{ l: number; t: number; w: number; h: number } | null>(null);
  const pullTransitioning = useRef(false); // true during CSS-driven animation (release / Chat button)
  const pullCommitted = useRef(false);     // commit decision (ref to avoid flash between render cycles)
  // ────────────────────────────────────────────────────────────────

  const snapshotsRef = useRef(snapshots);
  snapshotsRef.current = snapshots;
  const animationStateRef = useRef(animationState);
  animationStateRef.current = animationState;
  const viewIndexRef = useRef(viewIndex);
  viewIndexRef.current = viewIndex;
  const draftParentIndexRef = useRef(draftParentIndex);
  draftParentIndexRef.current = draftParentIndex;
  const previewingTipIndexRef = useRef(previewingTipIndex);
  previewingTipIndexRef.current = previewingTipIndex;
  const isAgentActiveRef = useRef(isAgentActive);
  useEffect(() => { isAgentActiveRef.current = isAgentActive; }, [isAgentActive]);
  const isTipsFetchingRef = useRef(isTipsFetching);
  isTipsFetchingRef.current = isTipsFetching;
  const previewDoneBaselineRef = useRef(0);
  const lastTipsRequestRef = useRef<{ snapshotId: string; image: string; previewMode: 'full' | 'none'; autoPreviewCategory?: string } | null>(null);
  const pendingTeaserRef = useRef<{ snapshotId: string; tips: Tip[] } | null>(null);
  const isReactionInFlightRef = useRef(false);
  // Pending notification: shown when image/video is generated while user is on a different snapshot or draft.
  // Displays notification text + "See" button in StatusBar to navigate to the new snapshot.
  const [pendingNotification, setPendingNotification] = useState<{ text: string; targetIndex: number } | null>(null);
  // Track which snapshot's teaser has already been displayed (prevents progress bar from overwriting)
  const teaserSnapshotRef = useRef<string | null>(null);
  // Track if we've already triggered auto-naming this session (only once per new project)
  const hasTriggeredNamingRef = useRef(false);
  // Track which snapshots have already received "previews ready" CUI notification
  // Pre-seed with initialSnapshots so restored projects don't re-trigger
  const previewsNotifiedRef = useRef<Set<string>>(
    new Set(initialSnapshots?.map(s => s.id) ?? [])
  );
  // Flag: navigate to video entry on next render after submitting animation
  const pendingNavigateToVideoRef = useRef(false);

  // Draft mode: draftParentIndex !== null means a virtual draft entry exists in timeline
  const isDraft = draftParentIndex !== null;

  // Draft image: show thumbnail immediately (already cached from TipsBar), upgrade to full when loaded
  const draftFullUrl = useMemo(() => {
    if (draftParentIndex === null || previewingTipIndex === null) return null;
    const parentTips = snapshots[draftParentIndex]?.tips ?? [];
    const tip = parentTips[previewingTipIndex];
    return tip?.previewImage || snapshots[draftParentIndex]?.image || null;
  }, [draftParentIndex, previewingTipIndex, snapshots]);

  const draftImage = useMemo(() => {
    if (!draftFullUrl) return null;
    // base64 or non-URL: use directly (no loading needed)
    if (!draftFullUrl.startsWith('http')) return draftFullUrl;
    // Full image loaded: high-quality WebP (no visible downscale)
    if (draftFullLoaded) return getOptimizedUrl(draftFullUrl);
    // Not loaded yet: small proportional thumbnail (contain = keeps original aspect ratio)
    return getThumbnailUrl(draftFullUrl, 144, 60, 144, 'contain');
  }, [draftFullUrl, draftFullLoaded]);

  // Preload full draft image and flip flag when done
  useEffect(() => {
    if (!draftFullUrl || !draftFullUrl.startsWith('http')) return;
    setDraftFullLoaded(false);
    const img = new Image();
    img.src = getOptimizedUrl(draftFullUrl);
    img.onload = () => setDraftFullLoaded(true);
  }, [draftFullUrl]);

  // Timeline: committed snapshots with the virtual draft inserted right after its parent
  // + optional video sentinel at the end (when ANY animation exists)
  const hasAnyAnimation = animations.length > 0;
  const timeline = useMemo(() => {
    const base = snapshots.map((s, i) => {
      // base64 from IndexedDB cache — use directly, no network cost
      if (s.image && !s.image.startsWith('http')) return s.image;
      // URL (first load from DB, or imageUrl fallback)
      const url = s.image || s.imageUrl || '';
      if (!url) return '';
      // Current snapshot and neighbors: high-quality WebP (PNG→WebP, no visible downscale).
      // Distant snapshots: lightweight thumbnail (user not viewing).
      if (Math.abs(i - viewIndex) <= 1) return getOptimizedUrl(url);
      return getThumbnailUrl(url, 800, 75);
    });
    if (draftImage !== null && draftParentIndex !== null) {
      base.splice(draftParentIndex + 1, 0, draftImage);
    }
    if (hasAnyAnimation) {
      base.push('__VIDEO__');
    }
    return base;
  }, [snapshots, draftImage, draftParentIndex, hasAnyAnimation, viewIndex]);

  const referenceCount = useMemo(() =>
    snapshots.filter(s => s.type === 'reference').length,
  [snapshots]);

  // Preload optimized images for nearby snapshots (±2) so swipe feels instant
  useEffect(() => {
    [viewIndex - 2, viewIndex - 1, viewIndex + 1, viewIndex + 2]
      .filter(i => i >= 0 && i < snapshots.length)
      .forEach(i => {
        const s = snapshots[i];
        if (!s) return;
        // Already base64 cached — no preload needed
        if (s.image && !s.image.startsWith('http')) return;
        const url = s.imageUrl || s.image;
        if (url) {
          const img = new Image();
          img.src = getOptimizedUrl(url);
        }
      });
  }, [viewIndex, snapshots]);

  // Video entry: last item in timeline when any animation exists
  const hasVideo = hasAnyAnimation;
  const videoTimelineIndex = hasAnyAnimation ? timeline.length - 1 : -1;
  const isViewingVideo = hasAnyAnimation && viewIndex === videoTimelineIndex;
  // Currently selected video for canvas playback
  const currentVideo = (selectedVideoId && animations.find(a => a.id === selectedVideoId))
    || animations.find(a => a.status === 'completed' && !!a.videoUrl);

  // Draft occupies the slot immediately after its parent snapshot
  const isViewingDraft = isDraft && draftParentIndex !== null && viewIndex === draftParentIndex + 1;

  // Tips come from the parent snapshot when viewing draft; otherwise map timeline→snapshot index
  const tipsSourceIndex = isViewingDraft
    ? draftParentIndex!
    : (snapFromTimeline(viewIndex, draftParentIndex) ?? draftParentIndex ?? 0);
  const currentTips = snapshots[tipsSourceIndex]?.tips ?? [];

  // Auto-jump when timeline grows (commit adds snapshot) or shrinks (draft dismissed)
  const prevTimelineLen = useRef(0);
  if (timeline.length !== prevTimelineLen.current) {
    const isInitialLoad = prevTimelineLen.current === 0;
    if (isInitialLoad && hasAnyAnimation) {
      // First load with videos → jump to video entry
      setViewIndex(timeline.length - 1);
    } else if (timeline.length > prevTimelineLen.current && !isDraft) {
      // A new snapshot was committed → jump to the new last snapshot (not video entry)
      const lastSnapshotIdx = hasAnyAnimation ? timeline.length - 2 : timeline.length - 1;
      setViewIndex(Math.max(0, lastSnapshotIdx));
    } else if (viewIndex >= timeline.length) {
      setViewIndex(Math.max(0, timeline.length - 1));
    }
    prevTimelineLen.current = timeline.length;
  }

  // Auto-clear pending notification when user navigates to the target snapshot
  useEffect(() => {
    if (!pendingNotification) return;
    const snapIdx = snapFromTimeline(viewIndex, draftParentIndex);
    if (snapIdx === pendingNotification.targetIndex) {
      setPendingNotification(null);
    }
  }, [viewIndex, pendingNotification, draftParentIndex]);

  // "See" button handler — exit draft if needed, jump to target snapshot
  const handleSeeNotification = useCallback(() => {
    if (!pendingNotification) return;
    // Exit draft mode
    if (draftParentIndex !== null) {
      setPreviewingTipIndex(null);
      setDraftParentIndex(null);
    }
    setViewIndex(pendingNotification.targetIndex);
    setPendingNotification(null);
  }, [pendingNotification, draftParentIndex]);

  // Trigger a one-sentence teaser about the tips shown in StatusBar
  const triggerTipsTeaser = useCallback(async (snapshotId: string, tips: Tip[]) => {
    if (!projectId) return;
    // Check user is still viewing this snapshot (map timeline index to snapshot index)
    const snapIdx = snapFromTimeline(viewIndexRef.current, draftParentIndexRef.current);
    if (snapIdx === null || snapshotsRef.current[snapIdx]?.id !== snapshotId) return;

    const tipsPayload = tips.map(({ emoji, label, desc, category }) => ({ emoji, label, desc, category }));
    try {
      let teaser = '';
      await streamAgent(
        { prompt: '', image: '', projectId, tipsTeaser: true, tipsPayload },
        {
          onContent: (delta) => { teaser += delta; },
          onDone: () => {
            // Only update if user still viewing same snapshot
            if (snapshotsRef.current[viewIndexRef.current]?.id === snapshotId && teaser.trim()) {
              teaserSnapshotRef.current = snapshotId; // mark only when teaser actually shown
              setAgentStatus(teaser.trim());
            }
          },
          onError: () => {},
        },
      );
    } catch (err) {
      console.error('Tips teaser failed:', err);
    }
  }, [projectId]);

  // AI-generated CUI notification when all preview images are done
  const triggerPreviewsReadyNotification = useCallback(async (snapshotId: string, tips: Tip[]) => {
    if (!projectId) return;
    if (previewsNotifiedRef.current.has(snapshotId)) return;
    previewsNotifiedRef.current.add(snapshotId);

    const doneTips = tips.filter(t => t.previewStatus === 'done');
    if (doneTips.length === 0) return;

    const readyTips = doneTips.map(({ emoji, label, desc, category }) => ({ emoji, label, desc, category }));

    const msgId = generateId();
    setMessages((prev) => [...prev, {
      id: msgId,
      role: 'assistant' as const,
      content: '',
      timestamp: Date.now(),
    }]);

    try {
      await streamAgent(
        { prompt: '', image: '', projectId, previewsReady: true, readyTips },
        {
          onContent: (delta) => {
            setMessages((prev) => prev.map((m) =>
              m.id === msgId ? { ...m, content: m.content + delta } : m
            ));
          },
          onDone: () => {
            setMessages((prev) => {
              const msg = prev.find(m => m.id === msgId);
              if (msg?.content) onSaveMessage?.(msg);
              else return prev.filter(m => m.id !== msgId); // remove if empty
              return prev;
            });
          },
          onError: () => {
            setMessages((prev) => prev.filter(m => m.id !== msgId || m.content));
          },
        },
      );
    } catch {
      setMessages((prev) => prev.filter(m => m.id !== msgId || m.content));
    }
  }, [projectId, onSaveMessage]);

  // Auto-name the project based on the image analysis description (fires once, only if title is default)
  const triggerProjectNaming = useCallback(async (description: string) => {
    if (!projectId || !onRenameProject || !description.trim()) return;
    let name = '';
    try {
      await streamAgent(
        { prompt: '', image: '', projectId, nameProject: true, description },
        {
          onContent: (delta) => { name += delta; },
          onDone: () => { if (name.trim()) onRenameProject(name.trim()); },
          onError: () => {},
        },
      );
    } catch (err) {
      console.error('Project naming failed:', err);
    }
  }, [projectId, onRenameProject]);

  // Open CUI with hero animation (canvas → PiP)
  // Shared hero animation: fly fromRect → PiP corner, then mount CUI.
  // Used by both Chat button (openCUI) and pull-down gesture commit.
  const startHeroToCUI = useCallback((fromRect: { l: number; t: number; w: number; h: number }, fromRadius: string) => {
    const src = timeline[viewIndex];
    if (!src) { setViewMode('cui'); return; }

    // pushState if not already done (pull-down pushes at gesture start)
    if (!hasCuiHistoryState.current) {
      window.history.pushState({ makaronCui: true }, '');
      hasCuiHistoryState.current = true;
    }

    const PIP_SIZE = 116, PIP_M = 14;
    const ar = lastImageAR.current;
    // toRect placeholder — corrected in rAF x2 after CUI mounts
    setHeroAnim({
      src,
      fromRect,
      toRect: { l: window.innerWidth - PIP_M - PIP_SIZE, t: window.innerHeight - (cuiInputBarH.current + 8) - PIP_SIZE, w: PIP_SIZE, h: PIP_SIZE },
      fromImg: coverRect(fromRect.w, fromRect.h, ar),
      toImg:   coverRect(PIP_SIZE, PIP_SIZE, ar),
      fromRadius, toRadius: '16px',
      objectCover: true,
      active: false,
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const PIP_BOTTOM = cuiInputBarH.current - 32 + 4;
      const toRect = { l: window.innerWidth - PIP_M - PIP_SIZE, t: window.innerHeight - PIP_BOTTOM - PIP_SIZE, w: PIP_SIZE, h: PIP_SIZE };
      setHeroAnim(p => p ? { ...p, toRect, active: true } : null);
    }));
    setTimeout(() => setHeroAnim(null), HERO_DURATION + 120);
    setViewMode('cui');
  }, [timeline, viewIndex]);

  // Chat button → open CUI with hero animation
  const openCUI = useCallback(() => {
    if (isDesktop) return;
    const el = canvasAreaRef.current;
    if (el) {
      const cr = el.getBoundingClientRect();
      lastCanvasRect.current = { l: cr.left, t: cr.top, w: cr.width, h: cr.height };
      const imgEl = el.querySelector('img');
      const ar = (imgEl && imgEl.naturalWidth && imgEl.naturalHeight)
        ? imgEl.naturalWidth / imgEl.naturalHeight : 1;
      lastImageAR.current = ar;
      const imgBounds = containRect(cr.width, cr.height, ar);
      const side = Math.min(imgBounds.w, imgBounds.h);
      const sqX = (imgBounds.w - side) / 2;
      const sqY = (imgBounds.h - side) / 2;
      startHeroToCUI({
        l: cr.left + imgBounds.l + sqX,
        t: cr.top  + imgBounds.t + sqY,
        w: side, h: side,
      }, '0px');
    } else {
      startHeroToCUI({ l: 0, t: 0, w: 116, h: 116 }, '0px');
    }
  }, [isDesktop, startHeroToCUI]);

  // Handle PiP tap: hero animation (PiP → canvas), then trigger GUI return
  const handlePipTap = useCallback((pipRect: DOMRect) => {
    const cr = lastCanvasRect.current;
    const src = timeline[viewIndex];
    if (cr && src) {
      const ar = lastImageAR.current;
      const fromRect = { l: pipRect.left, t: pipRect.top, w: pipRect.width, h: pipRect.height };
      setHeroAnim({
        src,
        fromRect, toRect: cr,
        fromImg: coverRect(pipRect.width, pipRect.height, ar),
        toImg:   containRect(cr.w, cr.h, ar),
        fromRadius: '16px', toRadius: '0px',
        active: false,
      });
      requestAnimationFrame(() => requestAnimationFrame(() =>
        setHeroAnim(p => p ? { ...p, active: true } : null)
      ));
      setTimeout(() => setHeroAnim(null), HERO_DURATION + 120);
    }
  }, [timeline, viewIndex]);

  // ── Pull-down gesture callbacks ──────────────────────────────────
  const handlePullDown = useCallback((dx: number, dy: number, progress: number) => {
    if (pullTransitioning.current) return;
    // First call: capture canvas rect + pushState BEFORE overlay renders.
    // Safari snapshots this frame (clean GUI canvas) for iOS back-swipe.
    if (pullProgress === null) {
      const el = canvasAreaRef.current;
      if (el) {
        const cr = el.getBoundingClientRect();
        lastCanvasRect.current = { l: cr.left, t: cr.top, w: cr.width, h: cr.height };
        const imgEl = el.querySelector('img');
        const ar = (imgEl?.naturalWidth && imgEl?.naturalHeight)
          ? imgEl.naturalWidth / imgEl.naturalHeight : 1;
        lastImageAR.current = ar;
        const imgBounds = containRect(cr.width, cr.height, ar);
        pullStartRect.current = {
          l: cr.left + imgBounds.l,
          t: cr.top + imgBounds.t,
          w: imgBounds.w, h: imgBounds.h,
        };
      }
      // pushState while DOM is clean canvas (no overlay yet)
      window.history.pushState({ makaronCui: true }, '');
      hasCuiHistoryState.current = true;
    }
    setPullDelta({ dx, dy });
    setPullProgress(progress);
  }, [pullProgress]);

  const handlePullDownEnd = useCallback((committed: boolean) => {
    if (pullTransitioning.current) return;
    pullTransitioning.current = true;
    pullCommitted.current = committed;

    if (committed) {
      // Compute current drag position (same math as pull overlay render)
      const from = pullStartRect.current;
      const p = pullProgress ?? 0;
      let fromL: number, fromT: number, fromW: number, fromH: number;
      if (from) {
        const scale = 1 - p * 0.5;
        fromW = from.w * scale;
        fromH = from.h * scale;
        const cx = from.l + from.w / 2 + pullDelta.dx;
        const cy = from.t + from.h / 2 + pullDelta.dy;
        fromL = cx - fromW / 2;
        fromT = cy - fromH / 2;
      } else {
        fromL = 0; fromT = 0; fromW = 116; fromH = 116;
      }

      // Clear pull overlay, then fly from release position to PiP (shared with Chat)
      pullStartRect.current = null;
      pullTransitioning.current = false;
      pullCommitted.current = false;
      setPullProgress(null);
      setPullDelta({ dx: 0, dy: 0 });

      startHeroToCUI(
        { l: fromL, t: fromT, w: fromW, h: fromH },
        `${p * 16}px`,
      );
    } else {
      // Snap back to original position, then pop history state
      setPullProgress(0);
      setTimeout(() => {
        setPullProgress(null);
        setPullDelta({ dx: 0, dy: 0 });
        pullStartRect.current = null;
        pullTransitioning.current = false;
        pullCommitted.current = false;
        // Pop the history state pushed at pull start
        if (hasCuiHistoryState.current) {
          hasCuiHistoryState.current = false;
          window.history.back();
        }
      }, 320);
    }
  }, [startHeroToCUI, pullProgress, pullDelta]);
  // ────────────────────────────────────────────────────────────────

  // Trigger a 1-2 sentence CUI reaction after user commits a tip in the GUI
  const triggerTipCommitReaction = useCallback(async (
    committedTip: { emoji: string; label: string; desc: string; category: string },
    tipImage: string | undefined,
    siblingTips: { emoji: string; label: string; desc: string; category: string }[],
  ) => {
    if (!projectId || isReactionInFlightRef.current) return;
    isReactionInFlightRef.current = true;

    const reactionMsgId = generateId();
    setMessages((prev) => [...prev, {
      id: reactionMsgId,
      role: 'assistant' as const,
      content: '',
      timestamp: Date.now(),
    }]);

    // Prefer URL for API calls — server handles both URL and base64
    const snapForReaction = snapshotsRef.current[viewIndexRef.current];
    const imageBase64 = tipImage || getImageForApi(snapForReaction) || '';

    try {
      await streamAgent(
        { prompt: '', image: imageBase64, projectId, tipReaction: true, committedTip, currentTips: siblingTips },
        {
          onContent: (delta) => {
            setMessages((prev) => prev.map((m) =>
              m.id === reactionMsgId ? { ...m, content: m.content + delta } : m
            ));
          },
          onDone: () => {
            setMessages((prev) => {
              const msg = prev.find(m => m.id === reactionMsgId);
              if (msg?.content) onSaveMessage?.(msg);
              return prev;
            });
            isReactionInFlightRef.current = false;
          },
          onError: () => {
            // Remove empty message on error
            setMessages((prev) => prev.filter(m => m.id !== reactionMsgId || m.content));
            isReactionInFlightRef.current = false;
          },
        },
      );
    } catch (err) {
      console.error('Tip commit reaction failed:', err);
      setMessages((prev) => prev.filter(m => m.id !== reactionMsgId || m.content));
      isReactionInFlightRef.current = false;
    }
  }, [projectId, onSaveMessage]);

  const addMessage = useCallback((role: 'user' | 'assistant', content: string, image?: string, attachedImages?: string[]) => {
    const msg: Message = {
      id: generateId(),
      role,
      content,
      image,
      ...(attachedImages?.length ? { editInputImages: attachedImages } : {}),
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, msg]);
    onSaveMessage?.(msg);
    return msg;
  }, [onSaveMessage]);

  // Generate preview image for a single tip (fire-and-forget)
  // Uses editPrompt as key to find the tip (safe with concurrent streams)
  const generatePreviewForTip = useCallback(async (
    snapshotId: string,
    editPrompt: string,
    imageInput: string,
    aspectRatio?: string,
    category?: string,
  ) => {
    // imageInput can be URL (preferred, tiny payload) or base64 — server handles both
    const imageForApi = imageInput;

    // Mark as generating
    setSnapshots((prev) => prev.map((s) => {
      if (s.id !== snapshotId) return s;
      const tips = s.tips.map(t =>
        t.editPrompt === editPrompt ? { ...t, previewStatus: 'generating' as const } : t
      );
      return { ...s, tips };
    }));

    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageForApi, editPrompt, aspectRatio, category, isNsfw: isNsfwRef.current || undefined }),
        signal: previewAbortRef.current.signal,
      });

      if (!res.ok) throw new Error('Preview failed');
      const { image, contentBlocked } = await res.json();
      if (contentBlocked) isNsfwRef.current = true;

      cacheImage(`tip:${snapshotId}:${editPrompt}`, image);
      setSnapshots((prev) => {
        const updated = prev.map((s) => {
          if (s.id !== snapshotId) return s;
          const tips = s.tips.map(t =>
            t.editPrompt === editPrompt ? { ...t, previewImage: image, previewStatus: 'done' as const } : t
          );
          return { ...s, tips };
        });
        // Persist tips with new preview image to Storage+DB (fire-and-forget)
        const snap = updated.find(s => s.id === snapshotId);
        if (snap) onUpdateTips?.(snapshotId, snap.tips);
        return updated;
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setSnapshots((prev) => prev.map((s) => {
        if (s.id !== snapshotId) return s;
        const tips = s.tips.map(t =>
          t.editPrompt === editPrompt ? { ...t, previewStatus: 'error' as const } : t
        );
        return { ...s, tips };
      }));
    }
  }, [onUpdateTips]);

  // Shared helper: handle a tip SSE event (partial or complete) for a given snapshot
  const handleTipEvent = useCallback((
    tip: Tip,
    snapshotId: string,
    shouldPreview: (tip: Tip) => boolean,
  ) => {
    if (!tip.label || !tip.category) return;
    if (!tip.editPrompt) {
      // Partial tip: label+desc ready, editPrompt still streaming — show immediately
      setSnapshots((prev) => prev.map((s) => {
        if (s.id !== snapshotId) return s;
        if (s.tips.some(t => t.label === tip.label)) return s;
        return { ...s, tips: [...s.tips, { ...tip, previewStatus: 'none' }] };
      }));
    } else {
      // Complete tip: upsert by label (updates partial if exists, adds new otherwise)
      const doPreview = shouldPreview(tip);
      setSnapshots((prev) => prev.map((s) => {
        if (s.id !== snapshotId) return s;
        const idx = s.tips.findIndex(t => t.label === tip.label);
        if (idx >= 0) {
          const newTips = [...s.tips];
          newTips[idx] = { ...newTips[idx], editPrompt: tip.editPrompt, previewStatus: doPreview ? 'pending' : 'none', aspectRatio: tip.aspectRatio };
          return { ...s, tips: newTips };
        }
        return { ...s, tips: [...s.tips, { ...tip, previewStatus: doPreview ? 'pending' : 'none' }] };
      }));
      if (doPreview) {
        // Always use original-quality image for preview generation (URL preferred, full base64 fallback).
        // Never use the compressed 600KB tips image — it causes cumulative quality loss on faces.
        const snap = snapshotsRef.current.find(s => s.id === snapshotId);
        const imageForPreview = getImageForApi(snap);
        if (imageForPreview) {
          generatePreviewForTip(snapshotId, tip.editPrompt, imageForPreview, tip.aspectRatio, tip.category);
        }
      }
    }
  }, [generatePreviewForTip]);

  // Fetch tips via 3 parallel calls to Claude (fast, ~2-3s vs Gemini ~15s)
  // previewMode: 'full' = all tips get preview; 'none' = no auto-previews
  // autoPreviewCategory: if set, auto-preview tips in this category (used after commit)
  const fetchTipsForSnapshot = useCallback((
    snapshotId: string,
    imageInput: string,
    previewMode: 'full' | 'none' = 'full',
    autoPreviewCategory?: string,
  ) => {
    setIsTipsFetching(true);
    setFailedCategories(new Set());
    previewDoneBaselineRef.current = 0;
    previewAbortRef.current = new AbortController();
    lastTipsRequestRef.current = { snapshotId, image: imageInput, previewMode, autoPreviewCategory };
    if (!isAgentActiveRef.current) {
      setAgentStatus(t('status.thinking'));
    }

    const categories: ('enhance' | 'creative' | 'wild' | 'captions')[] = ['enhance', 'creative', 'wild', 'captions'];
    let completedCount = 0;
    const fetchCategory = async (category: string) => {
      await acquireTipsSlot();
      try { await _fetchCategoryInner(category); } finally { releaseTipsSlot(); }
    };
    const _fetchCategoryInner = async (category: string) => {
      // imageInput can be URL or base64 — server handles both
      const imageForApi = imageInput;
      const MAX_RETRIES = 2;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const res = await fetch('/api/tips', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image: imageForApi,
              category,
              metadata: snapshotsRef.current.find(s => s.id === snapshotId)?.metadata,
            }),
          });
          if (!res.ok) throw new Error(`Tips ${category} failed: ${res.status}`);

          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let tipsReceived = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let boundary;
            while ((boundary = buffer.indexOf('\n\n')) !== -1) {
              const line = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              if (line.startsWith('data: ')) {
                const payload = line.slice(6);
                if (payload === '[DONE]') break;
                if (payload === '[BLOCKED]') {
                  console.warn(`[tips] ${category} content blocked — skipping`);
                  tipsReceived = -1; // sentinel: don't retry
                  break;
                }
                try {
                  const tip = JSON.parse(payload) as Tip;
                  handleTipEvent(tip, snapshotId, (t) => {
                    if (previewMode === 'full') return true;
                    if (autoPreviewCategory && t.category === autoPreviewCategory) return true;
                    return false;
                  });
                  tipsReceived++;
                } catch { /* skip malformed */ }
              }
            }
          }
          // Content blocked — don't retry
          if (tipsReceived === -1) break;
          // Stream succeeded but returned 0 tips — treat as failure and retry
          if (tipsReceived === 0) throw new Error(`Tips ${category}: 0 tips returned`);
          break;
        } catch (err) {
          if (attempt < MAX_RETRIES) {
            console.warn(`[tips] ${category} attempt ${attempt + 1} failed, retrying...`, err);
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          } else {
            console.error(`[tips] ${category} all retries exhausted`, err);
            setFailedCategories(prev => new Set([...prev, category as Tip['category']]));
          }
        }
      }

      completedCount++;
      if (completedCount === categories.length) {
        setIsTipsFetching(false);
        setCommittedCategory(null);
        if (onUpdateTips) {
          setSnapshots((prev) => {
            const snap = prev.find(s => s.id === snapshotId);
            if (snap?.tips.length) {
              // Only persist complete tips (with editPrompt) — don't save partial streaming stubs
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const tipsForDb = snap.tips.filter(t => !!t.editPrompt).map(({ previewImage, previewStatus, ...rest }) => rest) as Tip[];
              onUpdateTips(snapshotId, tipsForDb);
            }
            return prev;
          });
        }
        setTimeout(() => {
          const snap = snapshotsRef.current.find(s => s.id === snapshotId);
          if (snap?.tips.length) {
            if (isAgentActiveRef.current) {
              pendingTeaserRef.current = { snapshotId, tips: snap.tips };
            } else {
              triggerTipsTeaser(snapshotId, snap.tips);
            }
          } else if (!isAgentActiveRef.current) {
            setAgentStatus(t('editor.greeting'));
          }
        }, 100);
      }
    };

    categories.forEach(cat => fetchCategory(cat));
  }, [onUpdateTips, triggerTipsTeaser, handleTipEvent]);

  // Retry a single failed category
  const retryFailedCategory = useCallback((category: Tip['category']) => {
    const req = lastTipsRequestRef.current;
    if (!req) return;
    setFailedCategories(prev => {
      const next = new Set(prev);
      next.delete(category);
      return next;
    });
    // Re-run fetchCategory logic for this single category
    setIsTipsFetching(true);
    const doRetry = async () => {
      const MAX_RETRIES = 2;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const res = await fetch('/api/tips', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image: req.image,
              category,
              metadata: snapshotsRef.current.find(s => s.id === req.snapshotId)?.metadata,
            }),
          });
          if (!res.ok) throw new Error(`Tips ${category} failed: ${res.status}`);

          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let tipsReceived = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let boundary;
            while ((boundary = buffer.indexOf('\n\n')) !== -1) {
              const line = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              if (line.startsWith('data: ')) {
                const payload = line.slice(6);
                if (payload === '[DONE]') break;
                try {
                  const tip = JSON.parse(payload) as Tip;
                  handleTipEvent(tip, req.snapshotId, (t) => {
                    if (req.previewMode === 'full') return true;
                    if (req.autoPreviewCategory && t.category === req.autoPreviewCategory) return true;
                    return false;
                  });
                  tipsReceived++;
                } catch { /* skip malformed */ }
              }
            }
          }
          if (tipsReceived === 0) throw new Error(`Tips ${category}: 0 tips returned`);
          break;
        } catch (err) {
          if (attempt < MAX_RETRIES) {
            console.warn(`[tips] ${category} retry attempt ${attempt + 1} failed, retrying...`, err);
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          } else {
            console.error(`[tips] ${category} retry all attempts exhausted`, err);
            setFailedCategories(prev => new Set([...prev, category]));
          }
        }
      }
      // Check if all categories are done loading
      setIsTipsFetching(false);
    };
    doRetry();
  }, [handleTipEvent]);

  // Retry all failed categories at once
  const retryAllTips = useCallback(() => {
    const req = lastTipsRequestRef.current;
    if (!req) return;
    fetchTipsForSnapshot(req.snapshotId, req.image, req.previewMode, req.autoPreviewCategory);
  }, [fetchTipsForSnapshot]);

  // Load more tips of a specific category and append to the given snapshot
  const fetchMoreTipsForCategory = useCallback((
    category: Tip['category'],
    snapshotId: string,
    imageInput: string,
  ) => {
    setLoadingMoreCategories(prev => new Set([...prev, category]));

    const doFetch = async () => {
      try {
        // imageInput can be URL or base64 — server handles both
        const imageForApi = imageInput;
        const snap = snapshotsRef.current.find(s => s.id === snapshotId);
        const existingLabels = snap?.tips
          .filter(t => t.category === category)
          .map(t => t.label) ?? [];
        const res = await fetch('/api/tips', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: imageForApi,
            category,
            count: 2,
            metadata: snap?.metadata,
            existingLabels,
          }),
        });
        if (!res.ok) return;

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) !== -1) {
            const line = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (line.startsWith('data: ')) {
              const payload = line.slice(6);
              if (payload === '[DONE]') break;
              try {
                const tip = JSON.parse(payload) as Tip;
                handleTipEvent(tip, snapshotId, () => true);
              } catch { /* skip malformed */ }
            }
          }
        }
      } finally {
        setLoadingMoreCategories(prev => {
          const next = new Set(prev);
          next.delete(category);
          return next;
        });
      }
    };
    doFetch();
  }, [handleTipEvent]);

  // Auto-analyze a snapshot: runs silently in background, stores result in snapshot.description only
  const runAutoAnalysis = useCallback(async (
    snapshotId: string,
    imageBase64: string,
    context: 'initial' | 'post-edit' = 'initial',
    options?: { silent?: boolean },
  ) => {
    if (!projectId) return;

    const silent = options?.silent ?? false;

    if (!silent) {
      setIsAgentActive(true);
      setAgentStatus(t('status.analyzingImage'));
      agentAbortRef.current = new AbortController();
    }

    let description = '';
    // For initial upload (non-silent): show analysis as a CUI message
    const isInitial = context === 'initial';
    const showInCui = isInitial && !silent;
    const msgId = showInCui ? generateId() : null;
    if (showInCui && msgId) {
      setMessages((prev) => [...prev, {
        id: msgId,
        role: 'assistant' as const,
        content: '',
        timestamp: Date.now(),
      }]);
    }

    try {
      await streamAgent(
        { prompt: '', image: imageBase64, projectId, analysisOnly: true, analysisContext: context },
        {
          onStatus: (s) => { if (!silent) setAgentStatus(s); },
          onContent: (delta) => {
            description += delta;
            if (showInCui && msgId) {
              setMessages((prev) => prev.map((m) =>
                m.id === msgId ? { ...m, content: m.content + delta } : m
              ));
            }
          },
          onNewTurn: () => {},
          onImage: () => {},
          onToolCall: () => {},
          onDone: () => {
            if (description) {
              setSnapshots((prev) => prev.map((s) =>
                s.id === snapshotId ? { ...s, description } : s
              ));
              onUpdateDescription?.(snapshotId, description);
              if (showInCui && msgId) {
                const suffix = t('editor.tipsSuffix');
                setMessages((prev) => {
                  const msg = prev.find(m => m.id === msgId);
                  if (msg) {
                    const finalMsg = { ...msg, content: msg.content + suffix };
                    onSaveMessage?.(finalMsg);
                    return prev.map(m => m.id === msgId ? finalMsg : m);
                  }
                  return prev;
                });
              }
              // Auto-name the project once
              if (!hasTriggeredNamingRef.current && (!initialTitle || initialTitle === 'Untitled' || initialTitle === '未命名' || initialTitle === '未命名项目')) {
                hasTriggeredNamingRef.current = true;
                triggerProjectNaming(description);
              }
            }
            if (!silent && !isTipsFetchingRef.current) {
              const snap = snapshotsRef.current.find(s => s.id === snapshotId);
              if (!snap || snap.tips.length === 0) {
                setAgentStatus(t('editor.greeting'));
              }
            }
          },
          onError: () => {},
        },
        silent ? undefined : agentAbortRef.current.signal,
      );
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      console.error('[runAutoAnalysis] error:', err);
    } finally {
      if (!silent) {
        setIsAgentActive(false);
        const pending = pendingTeaserRef.current;
        if (pending) {
          pendingTeaserRef.current = null;
          setTimeout(() => triggerTipsTeaser(pending.snapshotId, pending.tips), 400);
        }
      }
    }
  }, [projectId, onUpdateDescription, onSaveMessage, triggerTipsTeaser, initialTitle, triggerProjectNaming]);

  // Agent request: route user message through Makaron Agent
  const handleAgentRequest = useCallback(async (text: string, attachedImages?: string[], overrideImage?: string, options?: { silent?: boolean }) => {
    // CUI reference images → append as new snapshots (so agent sees them in Image Index)
    if (attachedImages?.length && !overrideImage) {
      const newSnaps: Snapshot[] = [];
      for (const img of attachedImages) {
        const snapId = generateId();
        const snap: Snapshot = { id: snapId, image: img, tips: [], messageId: '', description: 'User-uploaded reference image' };
        newSnaps.push(snap);
      }
      if (newSnaps.length > 0) {
        const baseOrder = snapshotsRef.current.length;
        setSnapshots(prev => {
          const updated = [...prev, ...newSnaps];
          snapshotsRef.current = updated;
          return updated;
        });
        // Persist + cache, tips text-only after agent finishes, NO analysis (agent already sees the images)
        newSnaps.forEach((snap, i) => {
          const sortOrder = baseOrder + i;
          onSaveSnapshot?.(snap, sortOrder, (url) => {
            setSnapshots(prev => prev.map(s => s.id === snap.id ? { ...s, imageUrl: url } : s));
          });
          cacheImage(`snap:${snap.id}`, snap.image);
          onUpdateDescription?.(snap.id, snap.description!);
        });
        // Queue tips-only (no analysis) after agent finishes
        for (const snap of newSnaps) {
          pendingAnalysisRef.current.push({ id: snap.id, image: snap.image });
        }
      }
    }

    // Map timeline index → snapshot index; null means we're at the draft slot
    const snapIdx = snapFromTimeline(viewIndexRef.current, draftParentIndexRef.current);
    let currentImage = snapIdx !== null ? snapshotsRef.current[snapIdx]?.image : undefined;
    let contextSnapshotIndex = snapIdx ?? draftParentIndexRef.current ?? 0;
    if (!currentImage && draftParentIndexRef.current !== null && previewingTipIndexRef.current !== null) {
      const parentTips = snapshotsRef.current[draftParentIndexRef.current]?.tips ?? [];
      currentImage = parentTips[previewingTipIndexRef.current]?.previewImage
        || snapshotsRef.current[draftParentIndexRef.current]?.image;
      contextSnapshotIndex = draftParentIndexRef.current;
    }
    // Fallback to last snapshot when viewing video entry
    if (!currentImage) {
      currentImage = snapshotsRef.current[snapshotsRef.current.length - 1]?.image;
      contextSnapshotIndex = snapshotsRef.current.length - 1;
    }
    if (!projectId) return;
    // Path 2 (text-only): no image is OK — Agent will generate one
    if (!currentImage && snapshotsRef.current.length > 0) return;

    // Prefer URL (tiny payload) over base64 for API calls — server handles both
    // When URL isn't available yet (upload still in progress), compress base64 to fit Vercel 4.5MB limit
    // Use 3MB limit (not 1.8MB) — agent generates images, aggressive compression destroys quality
    const snapForApi = snapIdx !== null ? snapshotsRef.current[snapIdx] : undefined;
    const rawImage = snapForApi ? getImageForApi(snapForApi) : (currentImage || '');
    const imageForApi = overrideImage
      || (rawImage.startsWith('data:') ? await compressBase64Image(rawImage, 3_000_000) : rawImage);
    // Show attached/annotated images in the user message bubble (skip for silent/system-initiated requests)
    if (!options?.silent) {
      addMessage('user', text, undefined, overrideImage ? [overrideImage] : (attachedImages?.length ? attachedImages : undefined));
    }
    const assistantMsgId = generateId();
    setMessages((prev) => [...prev, {
      id: assistantMsgId,
      role: 'assistant' as const,
      content: '',
      timestamp: Date.now(),
    }]);

    // Auto-switch to CUI (mobile only — desktop CUI panel is always visible)
    if (!isDesktop) setViewMode('cui');
    setIsAgentActive(true);
    setAgentStatus(t('editor.agentThinking'));
    agentAbortRef.current = new AbortController();

    // Mutable local var so onNewTurn can point content to a fresh message
    let currentMsgId = assistantMsgId;
    // Track all assistant message IDs created in this run for persistence on done
    const agentMsgIds: string[] = [assistantMsgId];

    // Include pre-computed image description only when viewing a real snapshot (not a draft/preview)
    // Draft's image may differ significantly from the parent snapshot's description — skip to avoid mismatch
    const isViewingDraft = contextSnapshotIndex !== viewIndexRef.current;
    const currentDescription = isViewingDraft ? undefined : snapshotsRef.current[contextSnapshotIndex]?.description;
    const descriptionContext = currentDescription
      ? `[图片分析结果]\n${currentDescription}\n\n`
      : '';

    // Build multi-turn context: include both user and assistant messages for full conversation history
    // Large context model (1M tokens) — no need to truncate aggressively
    const recentMessages = messages
      .filter(m => m.content && (m.role === 'user' || m.role === 'assistant'))
      .slice(-200)
      .map(m => `[${m.role === 'user' ? '用户' : 'Makaron'}] ${m.content.slice(0, 500)}`)
      .join('\n');
    const historyContext = recentMessages
      ? `[对话历史]\n${recentMessages}\n\n`
      : '';

    // Inject current tips into the prompt so agent can reference them
    const currentTipsForPrompt = snapshotsRef.current[contextSnapshotIndex]?.tips ?? [];
    const tipsContext = currentTipsForPrompt.length > 0
      ? `[当前TipsBar中的编辑建议]\n${currentTipsForPrompt.map(t => `- [${t.category}] ${t.emoji} ${t.label}：${t.desc}`).join('\n')}\n\n`
      : '';

    // Warn Claude if user is editing an intermediate snapshot (not the latest)
    const isIntermediateSnapshot = contextSnapshotIndex < snapshotsRef.current.length - 1;
    const snapshotWarning = isIntermediateSnapshot
      ? `[重要提示] 用户当前正在编辑的是第 ${contextSnapshotIndex + 1} 个版本（共 ${snapshotsRef.current.length} 个），不是最新版本。对话历史描述的是其他版本的状态，与当前图片无关。请完全以传入的当前图片为准，忽略对话历史中对图片内容的描述。\n\n`
      : '';

    // Inject photo metadata (location + time) for original snapshot
    const originalMeta = snapshotsRef.current[0]?.metadata;
    const metaLines: string[] = [];
    if (originalMeta?.takenAt) metaLines.push(`拍摄时间：${originalMeta.takenAt}`);
    if (originalMeta?.location) metaLines.push(`拍摄地点：${originalMeta.location}`);
    const metaContext = metaLines.length > 0
      ? `[照片元数据]\n${metaLines.join('\n')}\n\n`
      : '';

    const refContext = attachedImages?.length
      ? `[用户上传了 ${attachedImages.length} 张参考图，已自动传给 generate_image 工具使用]\n\n`
      : '';

    // Build image index for multi-snapshot navigation — only when >1 snapshot
    const snapshotIndexContext = snapshotsRef.current.length > 1
      ? `[图片索引 / Image Index — ${snapshotsRef.current.length} snapshots]\n${snapshotsRef.current.map((s, i) => {
          const isRef = s.type === 'reference';
          const desc = isRef
            ? (s.description || 'Skill reference image')
            : i === 0 || (snapshotsRef.current.slice(0, i).every(ss => ss.type === 'reference'))
              ? (s.description || '原图 / Original upload')
              : (s.description || '(use analyze_image to see this snapshot)');
          const tag = isRef ? ' (reference)' : '';
          const marker = i === contextSnapshotIndex ? '  ← YOU ARE HERE' : '';
          return `<<<image_${i + 1}>>>${tag}${marker} — ${desc}`;
        }).join('\n')}\n\n`
      : '';

    const annotationWarning = overrideImage
      ? `[ANNOTATION MODE] The current image has red annotations drawn by the user. You MUST edit THIS image based on the annotations — do NOT use image_index to switch to another snapshot. Call analyze_image first (without image_index) to see the annotations, then generate_image (without image_index) to edit.\n\n`
      : '';

    // When viewing a draft/preview (tip not yet committed), warn agent to edit the current image directly
    const isDraftMode = snapIdx === null && draftParentIndexRef.current !== null;
    const draftWarning = isDraftMode
      ? `[DRAFT PREVIEW MODE] The user is viewing a tip preview (not yet committed). The image passed to you is this draft preview — edit it directly. Do NOT use image_index to switch to another snapshot.\n\n`
      : '';

    const fullPrompt = `${annotationWarning}${draftWarning}${snapshotWarning}${metaContext}${descriptionContext}${snapshotIndexContext}${tipsContext}${historyContext}${refContext}[User request — detect language and reply in the same language]\n${text}`;

    // Always pass the original snapshot (index 0) as reference for face/person preservation
    const originalSnapshot = snapshotsRef.current[0];
    const rawOriginal = originalSnapshot ? getImageForApi(originalSnapshot) : undefined;
    const originalImageBase64 = rawOriginal?.startsWith('data:') ? await compressBase64Image(rawOriginal, 3_000_000) : rawOriginal;

    // Compress snapshot images for API payload — URLs pass through (~100B), base64 compressed to 600KB
    // This prevents multi-image uploads from exceeding Vercel body size limits
    const snapshotImagesForApi = (await Promise.all(
      snapshotsRef.current.map(async (s) => {
        const img = getImageForApi(s);
        if (!img) return '';
        return img.startsWith('data:') ? compressBase64Image(img, 600_000) : img;
      })
    )).filter(img => img.length > 0);

    const _agentT0 = performance.now();
    let _genStartTime = 0;
    // Track analyze_image results for auto-saving to snapshot.description
    let _lastAnalyzedIdx: number | null = null;
    let _analyzedTextBuf = '';
    const _flushAnalyzedDesc = () => {
      if (_lastAnalyzedIdx !== null && _analyzedTextBuf.trim()) {
        const desc = _analyzedTextBuf.split('\n\n')[0].trim().slice(0, 300);
        const snapIdx = _lastAnalyzedIdx - 1;
        const snap = snapshotsRef.current[snapIdx];
        if (snap && !snap.description) {
          setSnapshots(prev => prev.map(s => s.id === snap.id ? { ...s, description: desc } : s));
          onUpdateDescription?.(snap.id, desc);
        }
      }
      _lastAnalyzedIdx = null;
      _analyzedTextBuf = '';
    };
    try {
      await streamAgent(
        { prompt: fullPrompt, image: imageForApi, originalImage: originalImageBase64, projectId, ...(attachedImages?.length ? { referenceImages: attachedImages } : {}), ...(preferredModel !== 'auto' ? { preferredModel } : {}), snapshotImages: snapshotImagesForApi, currentSnapshotIndex: contextSnapshotIndex, isNsfw: isNsfwRef.current || undefined },
        {
          onStatus: (status) => {
            const elapsed = ((performance.now() - _agentT0) / 1000).toFixed(1);
            console.log(`⏱️ [agent] status="${status}" at +${elapsed}s`);
            if (status.includes('生成图片') || status.includes('Generating image')) {
              _genStartTime = performance.now();
            }
            setAgentStatus(status);
          },
          onImageAnalyzed: (imageIndex) => {
            _flushAnalyzedDesc(); // flush previous if any
            _lastAnalyzedIdx = imageIndex;
            _analyzedTextBuf = '';
          },
          onNewTurn: () => {
            _flushAnalyzedDesc();
            const newId = generateId();
            currentMsgId = newId;
            agentMsgIds.push(newId);
            setMessages((prev) => [...prev, {
              id: newId,
              role: 'assistant' as const,
              content: '',
              timestamp: Date.now(),
            }]);
          },
          onContent: (delta) => {
            const id = currentMsgId;
            setMessages((prev) => prev.map((m) =>
              m.id === id ? { ...m, content: m.content + delta } : m
            ));
            // Accumulate text after analyze_image for auto-saving description
            if (_lastAnalyzedIdx !== null) {
              _analyzedTextBuf += delta;
            }
          },
          onImage: (imageData, usedModel) => {
            const elapsed = ((performance.now() - _agentT0) / 1000).toFixed(1);
            const genDuration = _genStartTime ? ((performance.now() - _genStartTime) / 1000).toFixed(1) : '?';
            console.log(`⏱️ [agent] IMAGE received at +${elapsed}s (${usedModel || 'gemini'} took ${genDuration}s, image ${(imageData.length / 1024).toFixed(0)}KB)`);
            const snapId = generateId();
            const editDesc = lastEditPromptRef.current
              ? `[agent] ${lastEditPromptRef.current.slice(0, 100)}`
              : undefined;
            const newSnapshot: Snapshot = {
              id: snapId,
              image: imageData,
              tips: [],
              messageId: currentMsgId,
              description: editDesc,
            };
            setSnapshots((prev) => [...prev, newSnapshot]);
            onSaveSnapshot?.(newSnapshot, snapshotsRef.current.length, (url) => {
              setSnapshots(prev => prev.map(s => s.id === snapId ? { ...s, imageUrl: url } : s));
            });
            if (editDesc) onUpdateDescription?.(snapId, editDesc);
            cacheImage(`snap:${snapId}`, imageData);
            const isFirstSnapshot = snapshotsRef.current.length <= 1;
            fetchTipsForSnapshot(snapId, imageData, isFirstSnapshot ? 'full' : 'none');
            autoFetchTriggered.current = true; // Prevent auto-fetch effect from double-fetching
            setAgentStatus(t('status.imageGenerated'));
            // If user is not on the new snapshot (e.g. viewing draft or earlier snapshot), show "See" button
            const newSnapIdx = snapshotsRef.current.length; // index after setSnapshots adds it
            if (draftParentIndexRef.current !== null || viewIndexRef.current !== newSnapIdx) {
              setPendingNotification({ text: t('status.imageGenerated'), targetIndex: newSnapIdx });
            }
            const id = currentMsgId;
            // Attach the last captured editPrompt and input images to the image message
            const capturedPrompt = lastEditPromptRef.current;
            const capturedInputImages = lastEditInputImagesRef.current;
            lastEditPromptRef.current = null;
            lastEditInputImagesRef.current = null;
            setMessages((prev) => prev.map((m) =>
              m.id === id ? {
                ...m,
                image: imageData,
                editPrompt: capturedPrompt ?? undefined,
                editModel: usedModel ?? undefined,
                editInputImages: capturedInputImages ?? undefined,
              } : m
            ));
            // Auto-name project after first image generation (text-to-image projects have no description)
            if (!hasTriggeredNamingRef.current && (!initialTitle || initialTitle === 'Untitled' || initialTitle === '未命名' || initialTitle === '未命名项目')) {
              hasTriggeredNamingRef.current = true;
              triggerProjectNaming(text);
            }
          },
          onToolCall: (tool, input, images) => {
            const elapsed = ((performance.now() - _agentT0) / 1000).toFixed(1);
            console.log(`⏱️ [agent] tool_call="${tool}" at +${elapsed}s`, tool === 'generate_image' ? `editPrompt="${(input.editPrompt as string)?.slice(0, 80)}..."` : '');
            // Capture editPrompt and input images from generate_image calls
            if (tool === 'generate_image' && typeof input.editPrompt === 'string') {
              lastEditPromptRef.current = input.editPrompt;
              lastEditInputImagesRef.current = images ?? null;
            }
          },
          onAnimationTask: (taskId, prompt) => {
            // CUI-initiated video: add to animations array and start polling
            const urls = snapshotsRef.current.filter(s => s.imageUrl).map(s => s.imageUrl!).slice(0, 7);
            const newAnim: ProjectAnimation = {
              id: taskId,
              projectId: projectId ?? '',
              taskId,
              videoUrl: null,
              prompt,
              snapshotUrls: urls,
              status: 'processing',
              createdAt: new Date().toISOString(),
            };
            setAnimations(prev => [newAnim, ...prev]);
            setSelectedVideoId(taskId);
            pendingNavigateToVideoRef.current = true;
            // Trigger polling status so StatusBar shows "Video rendering M:SS"
            setAnimationState({
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
          onNsfwDetected: () => {
            console.log('[agent] NSFW content detected — session flagged, future calls skip Gemini');
            isNsfwRef.current = true;
          },
          onDone: () => {
            _flushAnalyzedDesc(); // save any pending analyze_image description
            const elapsed = ((performance.now() - _agentT0) / 1000).toFixed(1);
            console.log(`⏱️ [agent] DONE total ${elapsed}s`);
            setAgentStatus(t('editor.done'));
            // Persist all assistant messages created in this agent run
            setMessages((prev) => {
              const toSave = prev.filter(m => agentMsgIds.includes(m.id) && m.content);
              toSave.forEach(m => onSaveMessage?.(m));
              return prev;
            });
            // Drain pending CUI-attached images: tips text only, no preview, no analysis
            const pendingAnalysisList = [...pendingAnalysisRef.current];
            pendingAnalysisRef.current = [];
            if (pendingAnalysisList.length > 0) {
              (async () => {
                for (const { id, image } of pendingAnalysisList) {
                  const tipsImg = await compressBase64Image(image, 600_000);
                  fetchTipsForSnapshot(id, tipsImg, 'none');
                }
              })();
            }
            {
              // Drain pending teaser or reset to greeting
              const pendingTeaser = pendingTeaserRef.current;
              if (pendingTeaser) {
                pendingTeaserRef.current = null;
                setTimeout(() => triggerTipsTeaser(pendingTeaser.snapshotId, pendingTeaser.tips), 400);
              } else {
                setTimeout(() => setAgentStatus(t('editor.greeting')), 2000);
              }
            }
          },
          onError: (msg) => {
            console.error('Agent error:', msg);
            const id = currentMsgId;
            setMessages((prev) => {
              const updated = prev.map((m) =>
                m.id === id ? { ...m, content: m.content || t('editor.errorRetry') } : m
              );
              // Persist whatever content we have
              const toSave = updated.filter(m => agentMsgIds.includes(m.id) && m.content);
              toSave.forEach(m => onSaveMessage?.(m));
              return updated;
            });
          },
        },
        agentAbortRef.current.signal,
      );
    } catch (err) {
      if ((err as Error).name === 'AbortError') return; // User cancelled — handled by handleAgentAbort
      console.error('Agent request failed:', err);
    } finally {
      setIsAgentActive(false);
    }
  }, [addMessage, projectId, fetchTipsForSnapshot, onSaveSnapshot, messages, runAutoAnalysis, triggerTipsTeaser, isDesktop, onSaveMessage, initialTitle, triggerProjectNaming]);

  // Abort the current agent request and discard its partial response
  const handleAgentAbort = useCallback(() => {
    agentAbortRef.current.abort();
    setIsAgentActive(false);
    setAgentStatus(t('editor.greeting'));
    // Remove the last empty/partial assistant message (the one being streamed)
    setMessages(prev => {
      // Find the last assistant message — if it has no meaningful content, remove it
      const lastIdx = prev.length - 1;
      if (lastIdx >= 0 && prev[lastIdx].role === 'assistant') {
        return prev.slice(0, lastIdx);
      }
      return prev;
    });
  }, []);

  // Shared: merge annotations → send to agent, then exit annotation mode
  // NOTE: no compressBase64 here — annotated image is used as generation base,
  // aggressive compression (1.8MB cap → quality 0.6) destroys image quality.
  // mergeAnnotation already outputs JPEG 0.92 at the base image's dimensions (~2048px).
  const sendWithAnnotations = async (text: string, referenceImages?: string[]) => {
    const baseImage = timeline[viewIndex];
    if (!baseImage) return;
    const merged = annotationEntries.length > 0
      ? await mergeAnnotation(baseImage, annotationEntries)
      : baseImage;
    setAnnotationMode(false);
    setAnnotationEntries([]);
    setAnnotationUndoStack([]);
    handleAgentRequest(text || t('annotation.defaultPrompt'), referenceImages, merged);
  };

  // CUI send: if annotations exist, merge them; otherwise normal chat
  const handleCuiSend = async (text: string, imgs?: string[]) => {
    if (annotationMode && annotationEntries.length > 0) {
      await sendWithAnnotations(text);
    } else {
      handleAgentRequest(text, imgs);
    }
  };

  // ── Generate animation prompt via Agent (runs in background, no CUI switch) ──
  const animPromptInFlightRef = useRef(false);
  const generateAnimationPrompt = useCallback(async (overrideImageUrls?: string[]) => {
    const imageUrls = overrideImageUrls || animationStateRef.current?.imageUrls;
    if (!projectId || !imageUrls?.length) return;
    if (isAgentActiveRef.current || animPromptInFlightRef.current) return;
    animPromptInFlightRef.current = true;

    const n = imageUrls.length;
    const userHint = animationStateRef.current?.userHint?.trim() || '';
    const langInstr = locale === 'en' ? 'Write the script in English.' : '用中文写脚本。';
    const hintLine = userHint ? `\nUser requirements: ${userHint}` : '';

    // Build Image Index with descriptions so Agent can pick images intelligently
    const imageIndex = snapshotsRef.current.map((s, i) => {
      const desc = i === 0
        ? (s.description || 'Original upload')
        : (s.description || '(no description)');
      return `<<<image_${i + 1}>>> — ${desc}`;
    }).join('\n');

    const prompt = `[视频动画模式] Create a video story script from the following ${n} snapshots. ${langInstr}${hintLine}

[Image Index — ${n} snapshots]
${imageIndex}

Select the best 3-7 images for a compelling video. You do NOT need to use all images or follow their order — pick the ones that create the strongest narrative arc. Output only the script, no confirmation needed.`;

    const userMsg = { id: generateId(), role: 'user' as const, content: t('editor.makeVideo'), timestamp: Date.now() };
    const assistantMsgId = generateId();
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantMsgId, role: 'assistant' as const, content: '', timestamp: Date.now() },
    ]);
    onSaveMessage?.(userMsg);

    // Stay in GUI — Agent runs in background
    setAnimationState(prev => prev ? { ...prev, status: 'generating_prompt', prompt: '' } : prev);
    setIsAgentActive(true);
    setAgentStatus(t('status.creatingStory'));
    agentAbortRef.current = new AbortController();

    let scriptText = '';
    let currentMsgId = assistantMsgId;
    const agentMsgIds: string[] = [assistantMsgId];

    // Use URL for context image (avoid base64 upload overhead)
    const contextImageUrl = snapshotsRef.current[0]?.imageUrl || snapshotsRef.current[0]?.image || '';

    try {
      await streamAgent(
        {
          prompt,
          image: contextImageUrl,
          projectId,
          animationImageUrls: imageUrls,
          // Pass URLs directly — Bedrock fetches them server-side (much faster than uploading base64)
          animationImages: imageUrls,
        },
        {
          onStatus: (s) => setAgentStatus(s),
          onNewTurn: () => {
            const newId = generateId();
            currentMsgId = newId;
            agentMsgIds.push(newId);
            setMessages((prev) => [...prev, { id: newId, role: 'assistant' as const, content: '', timestamp: Date.now() }]);
          },
          onContent: (delta) => {
            scriptText += delta;
            // Stream to CUI message
            const id = currentMsgId;
            setMessages((prev) => prev.map((m) => m.id === id ? { ...m, content: m.content + delta } : m));
            // Stream to animationState.prompt (shown in AnimateSheet textarea)
            setAnimationState(prev => prev ? { ...prev, prompt: scriptText } : prev);
          },
          onAnimationTask: () => {}, // Agent should not call generate_animation anymore
          onDone: () => {
            setAgentStatus(t('status.scriptDone'));
            setAnimationState(prev => prev ? { ...prev, status: 'ready' } : prev);
            // Persist all assistant messages from this run
            setMessages((prev) => {
              const toSave = prev.filter(m => agentMsgIds.includes(m.id) && m.content);
              toSave.forEach(m => onSaveMessage?.(m));
              return prev;
            });
          },
          onError: (msg) => {
            console.error('Animation prompt generation failed:', msg);
            setAnimationState(prev => prev ? { ...prev, status: 'error', error: t('status.scriptFailedRetry') } : prev);
          },
        },
        agentAbortRef.current.signal,
      );
    } catch (err) {
      console.error('Animation prompt failed:', err);
      setAnimationState(prev => prev ? { ...prev, status: 'error', error: t('status.scriptFailed') } : prev);
    } finally {
      setIsAgentActive(false);
      animPromptInFlightRef.current = false;
    }
  }, [projectId, onSaveMessage, locale, t]);

  // Commit draft: finalize the virtual draft as a real snapshot
  const commitDraft = useCallback(() => {
    if (draftParentIndex === null || previewingTipIndex === null) return;

    const parentTips = snapshots[draftParentIndex]?.tips ?? [];
    const tip = parentTips[previewingTipIndex];
    if (!tip?.previewImage) return;

    // Cancel remaining preview generations
    previewAbortRef.current.abort();

    // Add chat messages for context
    addMessage('user', tip.label);
    const assistantMsg = addMessage('assistant', '', tip.previewImage);

    // Create new committed snapshot from the draft image
    const snapId = generateId();
    const tipDesc = `[${tip.category}] ${tip.emoji} ${tip.label}: ${tip.desc}`;
    const newSnapshot: Snapshot = {
      id: snapId,
      image: tip.previewImage,
      tips: [],
      messageId: assistantMsg.id,
      description: tipDesc,
    };
    setSnapshots((prev) => [...prev, newSnapshot]);
    cacheImage(`snap:${snapId}`, newSnapshot.image);
    onUpdateDescription?.(snapId, tipDesc);

    // Clear draft and jump to the newly committed snapshot
    setViewIndex(snapshots.length);
    setDraftParentIndex(null);
    setPreviewingTipIndex(null);
    setCommittedCategory(tip.category as Tip['category']);

    // Wait for Supabase upload → use URL for tips (tiny payload vs 2MB+ base64 x4)
    onSaveSnapshot?.(newSnapshot, snapshots.length, (url) => {
      setSnapshots(prev => prev.map(s => s.id === snapId ? { ...s, imageUrl: url } : s));
    });

    // Fetch new tips — auto-preview only the committed tip's category
    // Use URL if available (fast, ~100 bytes), otherwise compress base64 to avoid ~3MB per request × 4
    const committedImage = tip.previewImage;
    if (committedImage.startsWith('http')) {
      fetchTipsForSnapshot(snapId, committedImage, 'none', tip.category);
    } else {
      compressBase64Image(committedImage, 600_000).then(compressed => {
        fetchTipsForSnapshot(snapId, compressed, 'none', tip.category);
      });
    }

    // Trigger agent CUI reaction to the committed tip
    const tipSnapshot = { emoji: tip.emoji, label: tip.label, desc: tip.desc, category: tip.category };
    const tipImg = tip.previewImage;
    // Pass other tips so agent can recommend a real one as next step
    const siblings = parentTips
      .filter((_, i) => i !== previewingTipIndex)
      .map(t => ({ emoji: t.emoji, label: t.label, desc: t.desc, category: t.category }));
    setTimeout(() => triggerTipCommitReaction(tipSnapshot, tipImg, siblings), 200);
  }, [draftParentIndex, previewingTipIndex, snapshots, addMessage, fetchTipsForSnapshot, onSaveSnapshot, triggerTipCommitReaction]);

  // Camera rotation: route through Agent so CUI shows tool_call + result
  const handleCameraGenerate = useCallback((_camera: CameraState, _prompt: string) => {
    const azName = AZIMUTH_MAP[snapToNearest(_camera.azimuth, AZIMUTH_STEPS)];
    const elName = ELEVATION_MAP[snapToNearest(_camera.elevation, ELEVATION_STEPS)];
    const dsName = DISTANCE_MAP[snapToNearest(_camera.distance, DISTANCE_STEPS)];

    // Close panel and send to Agent
    setShowCameraPanel(false);
    handleAgentRequest(`Rotate the camera to: ${azName}, ${elName}, ${dsName}`);
  }, [handleAgentRequest]);

  // Click tip:
  //   - First click (no draft) → create draft
  //   - Different tip (while viewing draft) → switch draft image
  //   - Tip click while navigated away from draft → dismiss old draft, create new from current
  //   - Same tip while selected → handled by onTipDeselect (dismissDraft) in TipsBar
  //   - Commit → handled by onTipCommit (commitDraft) in TipsBar
  const handleTipInteraction = useCallback((tip: Tip, tipIndex: number) => {
    const viewingDraft = draftParentIndex !== null && viewIndex === draftParentIndex + 1;

    // Safety net: same tip re-clicked while draft is visible (shouldn't happen with new UI)
    if (viewingDraft && previewingTipIndex === tipIndex) return;

    // Map current timeline index to snapshot index
    const currentSnapIdx = viewingDraft
      ? (draftParentIndex ?? 0)
      : (snapFromTimeline(viewIndex, draftParentIndex) ?? draftParentIndex ?? 0);

    // If tip has no preview yet ('none' or 'error'), trigger generation — don't select as draft yet
    if (!tip.previewImage && (tip.previewStatus === 'none' || tip.previewStatus === 'error' || !tip.previewStatus)) {
      const snap = snapshots[currentSnapIdx];
      if (snap && tip.editPrompt) {
        previewDoneBaselineRef.current = snap.tips.filter(t => t.previewStatus === 'done').length;
        setSnapshots(prev => prev.map(s =>
          s.id === snap.id ? {
            ...s,
            tips: s.tips.map(t => t.label === tip.label ? { ...t, previewStatus: 'pending' } : t),
          } : s
        ));
        generatePreviewForTip(snap.id, tip.editPrompt, getImageForApi(snap), tip.aspectRatio, tip.category);
      }
      return; // don't create draft until image is ready
    }

    // If tip is still generating, ignore click
    if (tip.previewStatus === 'pending' || tip.previewStatus === 'generating') return;

    // Update tip selection (switches draft image via draftImage memo)
    setPreviewingTipIndex(tipIndex);

    if (draftParentIndex === null) {
      // No draft → create one; explicitly jump to the draft slot
      setDraftParentIndex(currentSnapIdx);
      setViewIndex(currentSnapIdx + 1);
    } else if (!viewingDraft) {
      // Viewing a committed snapshot with an existing draft elsewhere
      // → update draft parent to current snapshot, jump to new draft slot
      setDraftParentIndex(currentSnapIdx);
      setViewIndex(currentSnapIdx + 1);
    }
  }, [draftParentIndex, viewIndex, snapshots, previewingTipIndex, generatePreviewForTip]);

  // Retry a failed preview generation
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleRetryPreview = useCallback((tip: Tip, tipIndex: number) => {
    // Find which snapshot owns this tip (tipsSourceIndex already maps correctly)
    const snap = snapshots[tipsSourceIndex] ?? null;
    if (!snap) return;
    // Baseline = done count right now, so x/y resets to 0/1 (or 0/N for multi-retry)
    previewDoneBaselineRef.current = snap.tips.filter(t => t.previewStatus === 'done').length;
    generatePreviewForTip(snap.id, tip.editPrompt, getImageForApi(snap), tip.aspectRatio, tip.category);
  }, [snapshots, generatePreviewForTip, tipsSourceIndex]);

  // Generate previews for all tips in a category (triggered by category tab click)
  const generatePreviewsForCategory = useCallback((category: string) => {
    const snap = snapshots[tipsSourceIndex];
    if (!snap) return;
    const imageForApi = getImageForApi(snap);
    const pending = snap.tips.filter(t => t.category === category && t.editPrompt && t.previewStatus === 'none');
    if (pending.length === 0) return;
    previewDoneBaselineRef.current = snap.tips.filter(t => t.previewStatus === 'done').length;
    pending.forEach(t => generatePreviewForTip(snap.id, t.editPrompt, imageForApi, t.aspectRatio, t.category));
  }, [snapshots, tipsSourceIndex, generatePreviewForTip]);

  // Previous image for long-press compare
  const previousImage = useMemo(() => {
    let img: string | undefined;
    if (isViewingDraft && draftParentIndex !== null) {
      img = snapshots[draftParentIndex]?.image;
    } else {
      const snapIdx = snapFromTimeline(viewIndex, draftParentIndex) ?? 0;
      img = snapIdx > 0 ? snapshots[snapIdx - 1]?.image : undefined;
    }
    // URL images: route through optimized path (same quality as canvas)
    if (img && img.startsWith('http')) return getOptimizedUrl(img);
    return img;
  }, [isViewingDraft, draftParentIndex, snapshots, viewIndex]);

  // Dismiss draft: remove virtual draft entry, return to parent
  const dismissDraft = useCallback(() => {
    // Restore viewIndex to the parent's timeline index before clearing draft,
    // so the auto-clamp doesn't fall back to the last snapshot instead.
    // While draft exists, draftParentIndex === its timeline index (no earlier draft slot).
    if (draftParentIndex !== null) setViewIndex(draftParentIndex);
    setDraftParentIndex(null);
    setPreviewingTipIndex(null);
  }, [draftParentIndex]);

  // Navigate timeline: keep draft alive so user can swipe back
  const handleIndexChange = useCallback((index: number) => {
    setViewIndex(index);
  }, []);

  const compressAndUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/') && !isHeicFile(file)) return;

    previewAbortRef.current.abort();
    setPreviewingTipIndex(null);
    setDraftParentIndex(null);
    setMessages([]);

    const heic = isHeicFile(file);
    const snapId = generateId();

    // HEIC: show loading spinner (Chrome can't render HEIC blob URLs)
    // Non-HEIC: show instant blob URL preview
    const previewUrl = heic ? '' : URL.createObjectURL(file);
    const previewSnapshot: Snapshot = { id: snapId, image: previewUrl, tips: [], messageId: '' };
    setSnapshots([previewSnapshot]);
    snapshotsRef.current = [previewSnapshot];
    setViewIndex(0);
    prevTimelineLen.current = 1;

    // Extract EXIF metadata in parallel (non-blocking)
    const metadataPromise = extractPhotoMetadata(file);

    try {
      // Convert HEIC to JPEG in browser if needed (Chrome/Firefox can't decode HEIC)
      const base64 = await compressImageFile(file, 2048, 0.92);
      if (previewUrl) URL.revokeObjectURL(previewUrl);

      // Start tips generation immediately with compressed image
      const newSnapshot: Snapshot = { id: snapId, image: base64, tips: [], messageId: '' };
      setSnapshots([newSnapshot]);
      snapshotsRef.current = [newSnapshot];
      const tipsImage = await compressBase64Image(base64, 600_000);
      fetchTipsForSnapshot(snapId, tipsImage, 'full');

      // Attach metadata when available
      const metadata = await metadataPromise;

      // Update snapshot image with final base64 + metadata
      const finalSnapshot: Snapshot = { id: snapId, image: base64, tips: [], messageId: '', metadata };
      setSnapshots([finalSnapshot]);
      snapshotsRef.current = [finalSnapshot];
      onSaveSnapshot?.(finalSnapshot, 0, (url) => {
        setSnapshots(prev => prev.map(s => s.id === snapId ? { ...s, imageUrl: url } : s));
      });
      cacheImage(`snap:${snapId}`, base64);
      // Auto-analyze the uploaded photo
      runAutoAnalysis(snapId, base64);
    } catch (err) {
      console.error('Image upload error:', err);
      URL.revokeObjectURL(previewUrl);
    }
  }, [fetchTipsForSnapshot, onSaveSnapshot, runAutoAnalysis]);

  // Auto-trigger upload when a pending image is passed (new project from projects page)
  // Lock body scroll while editor is mounted to prevent iOS back-navigation jump
  useEffect(() => {
    const prev = { overflow: document.body.style.overflow, position: document.body.style.position, width: document.body.style.width, top: document.body.style.top };
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.top = '0';
    return () => {
      document.body.style.overflow = prev.overflow;
      document.body.style.position = prev.position;
      document.body.style.width = prev.width;
      document.body.style.top = prev.top;
    };
  }, []);

  const initHandled = useRef(false);

  // Unified init: handles all entry scenarios (images, text, images+text, with/without skill)
  useEffect(() => {
    const hasImages = pendingImages && pendingImages.length > 0;
    const hasPrompt = !!pendingPrompt;
    if (!hasImages && !hasPrompt) return;
    if (initHandled.current) return;
    initHandled.current = true;

    const init = async () => {
      const isMulti = hasImages && pendingImages!.length > 1;

      // ── Step 1: Skill reference images ──
      const refSnapshots = pendingSkill ? await fetchSkillReferenceSnapshots(pendingSkill) : [];

      // ── Step 2: Work snapshots ──
      const workSnapshots: Snapshot[] = hasImages
        ? pendingImages!.map((img, i) => ({
            id: generateId(),
            image: img,
            tips: [],
            messageId: '',
            ...(img.startsWith('http') ? { imageUrl: img } : {}),
            ...(i === 0 && pendingMetadata ? { metadata: pendingMetadata } : {}),
          }))
        : [];

      // ── Step 3: Commit to state ──
      const allSnapshots = [...refSnapshots, ...workSnapshots];
      if (allSnapshots.length > 0) {
        setSnapshots(allSnapshots);
        snapshotsRef.current = allSnapshots;
        prevTimelineLen.current = allSnapshots.length;
        if (workSnapshots.length > 0) setViewIndex(refSnapshots.length);
      }

      // ── Step 4: Persist + cache ──
      allSnapshots.forEach((snap, i) => {
        onSaveSnapshot?.(snap, i, (url) => {
          setSnapshots(prev => prev.map(s => s.id === snap.id ? { ...s, imageUrl: url } : s));
        });
        if (snap.type !== 'reference') {
          cacheImage(`snap:${snap.id}`, snap.image);
        }
      });

      // ── Step 5: Tips (if images exist) ──
      if (hasImages) {
        const tipsImage = (img: string) =>
          img.startsWith('http') ? Promise.resolve(img) : compressBase64Image(img, 600_000);
        if (hasPrompt) {
          // Images + prompt: tips for first image only (full preview)
          tipsImage(workSnapshots[0].image).then(img => fetchTipsForSnapshot(workSnapshots[0].id, img));
        } else if (isMulti) {
          // Multi-image: tips for all, no preview
          for (const snap of workSnapshots) {
            tipsImage(snap.image).then(img => fetchTipsForSnapshot(snap.id, img, 'none'));
          }
        } else {
          // Single image: tips with full preview
          tipsImage(workSnapshots[0].image).then(img => fetchTipsForSnapshot(workSnapshots[0].id, img));
        }
      }

      // ── Step 6: Analysis (if images, no prompt) ──
      if (hasImages && !hasPrompt) {
        if (isMulti) {
          // Multi-image: silent analysis → greeting
          const analyzingMsgId = generateId();
          const analyzingText = t('editor.multiImageAnalyzing').replace('{count}', String(workSnapshots.length));
          setMessages(prev => [...prev, { id: analyzingMsgId, role: 'assistant' as const, content: analyzingText, timestamp: Date.now() }]);
          setIsAgentActive(true);
          Promise.all(
            workSnapshots.map(snap => runAutoAnalysis(snap.id, snap.image, 'initial', { silent: true }))
          ).then(() => {
            setIsAgentActive(false);
            handleAgentRequest(
              `[System] User uploaded ${workSnapshots.length} images. All images have been analyzed (see Image Index descriptions). Briefly greet the user and mention what you see in each image in 1 sentence each.`,
              undefined, undefined, { silent: true }
            );
          });
        } else {
          // Single image: non-silent analysis (shows in CUI)
          runAutoAnalysis(workSnapshots[0].id, workSnapshots[0].image, 'initial');
        }
      }

      // ── Step 7: Agent request (if prompt) ──
      if (hasPrompt) {
        setTimeout(() => {
          const skillPrefix = pendingSkill ? `[Active skill: ${pendingSkill}]\n` : '';
          handleAgentRequest(skillPrefix + pendingPrompt!);
        }, 200);
      }

      // ── Step 8: CUI mode ──
      if ((hasPrompt || isMulti) && !isDesktop) {
        setViewMode('cui');
      }
    };

    init();
  }, [pendingImages, pendingMetadata, pendingPrompt, pendingSkill, fetchTipsForSnapshot, onSaveSnapshot, runAutoAnalysis, handleAgentRequest, isDesktop]);

  // Existing project with no tips on latest snapshot — auto-fetch
  const autoFetchTriggered = useRef(false);
  useEffect(() => {
    if (autoFetchTriggered.current || pendingImages?.length) return;
    const lastSnap = snapshots[snapshots.length - 1];
    if (!lastSnap || lastSnap.tips.length > 0) return;
    autoFetchTriggered.current = true;
    const image = getImageForApi(lastSnap);
    if (!image) return;
    if (image.startsWith('data:')) {
      compressBase64Image(image, 600_000).then(img => fetchTipsForSnapshot(lastSnap.id, img));
    } else {
      fetchTipsForSnapshot(lastSnap.id, image);
    }
  }, [snapshots, pendingImages, fetchTipsForSnapshot]);

  // Pick up late-arriving initialAnimations (from Supabase fetch after cache-init)
  const animationInitRef = useRef((initialAnimations ?? []).length > 0);
  useEffect(() => {
    if (animationInitRef.current || !initialAnimations?.length) return;
    animationInitRef.current = true;
    // Sync prevCompletedIdsRef so existing completed animations aren't treated as "newly completed"
    prevCompletedIdsRef.current = new Set(initialAnimations.filter(a => a.status === 'completed').map(a => a.id));
    setAnimations(initialAnimations);
  }, [initialAnimations]);

  // Auto-select latest completed video when entering video entry
  useEffect(() => {
    if (isViewingVideo && !selectedVideoId) {
      const latest = animations.find(a => a.status === 'completed' && !!a.videoUrl);
      if (latest) setSelectedVideoId(latest.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isViewingVideo]);

  // Poll all processing animations (runs in Editor, independent of any card)
  useEffect(() => {
    const processing = animations.filter(a => a.status === 'processing' && a.taskId);
    if (processing.length === 0) return;
    const interval = setInterval(async () => {
      for (const anim of processing) {
        try {
          const res = await fetch(`/api/animate/${anim.taskId}`);
          const data = await res.json();
          if (data.status === 'completed' && data.videoUrl) {
            setAnimations(prev => prev.map(a =>
              a.id === anim.id ? { ...a, status: 'completed' as const, videoUrl: data.videoUrl } : a
            ));
          } else if (data.status === 'failed') {
            setAnimations(prev => prev.map(a =>
              a.id === anim.id ? { ...a, status: 'failed' as const } : a
            ));
          }
        } catch { /* ignore poll errors */ }
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [animations]);

  // Auto-name existing projects that still have a default title (runs once on mount)
  useEffect(() => {
    if (hasTriggeredNamingRef.current) return;
    if (!initialTitle || initialTitle === 'Untitled' || initialTitle === '未命名' || initialTitle === '未命名项目') {
      // Find the first snapshot with a description (from previous analysis)
      const desc = initialSnapshots?.find(s => s.description)?.description;
      if (desc) {
        hasTriggeredNamingRef.current = true;
        triggerProjectNaming(desc);
      }
    }
  }, [initialTitle, initialSnapshots, triggerProjectNaming]);

  // Preload adjacent snapshots (not yet in DOM) so swipe transitions are instant
  useEffect(() => {
    for (const offset of [-1, 1]) {
      const src = timeline[viewIndex + offset];
      if (src && src.startsWith('http')) {
        const img = new Image();
        img.src = src;
      }
    }
  }, [viewIndex, timeline]);

  // Drive StatusBar text based on tips/preview generation progress
  useEffect(() => {
    if (isAgentActive) return;
    const snap = snapshots[tipsSourceIndex];
    if (!snap) return;

    if (isTipsFetching) {
      if (teaserSnapshotRef.current !== snap.id) {
        setAgentStatus(t('status.generatingTips'));
      }
      return;
    }

    const total = snap.tips.length;
    if (total === 0) return;
    const generating = snap.tips.filter(t => t.previewStatus === 'generating').length;
    const done = snap.tips.filter(t => t.previewStatus === 'done').length;
    const settled = snap.tips.filter(t => t.previewStatus === 'done' || t.previewStatus === 'error').length;
    if (generating > 0) {
      const x = Math.max(0, done - previewDoneBaselineRef.current);
      const y = x + generating;
      setAgentStatus(t('status.generatingPreviews', x, y));
    } else if (settled === total && !isAgentActive) {
      setAgentStatus(prev => prev === t('status.generatingPreviews', 0, 0) || prev.includes('previews') || prev.includes('预览') ? t('editor.greeting') : prev);
    }
  }, [snapshots, tipsSourceIndex, isAgentActive, isTipsFetching]);

  // CUI notification when all preview images are settled (independent of StatusBar / agent state)
  useEffect(() => {
    const snap = snapshots[tipsSourceIndex];
    if (!snap || snap.tips.length === 0 || isTipsFetching) return;
    if (previewsNotifiedRef.current.has(snap.id)) return;
    const total = snap.tips.length;
    const settled = snap.tips.filter(t => t.previewStatus === 'done' || t.previewStatus === 'error').length;
    if (settled === total) {
      triggerPreviewsReadyNotification(snap.id, snap.tips);
    }
  }, [snapshots, tipsSourceIndex, isTipsFetching, triggerPreviewsReadyNotification]);



  // When animationState transitions — handle creation flow lifecycle
  const prevAnimStatusRef = useRef(animationState?.status);
  useEffect(() => {
    const prev = prevAnimStatusRef.current;
    const curr = animationState?.status;
    prevAnimStatusRef.current = curr;
    // Submitting → polling: add a processing entry to animations array
    if (prev === 'submitting' && curr === 'polling' && animationState?.taskId) {
      const newAnim: ProjectAnimation = {
        id: animationState.taskId,
        projectId: projectId ?? '',
        taskId: animationState.taskId,
        videoUrl: null,
        prompt: animationState.prompt,
        snapshotUrls: animationState.imageUrls,
        status: 'processing',
        createdAt: new Date().toISOString(),
        duration: animationState.duration ?? null,
      };
      setAnimations(prev => [newAnim, ...prev]);
      // Close the creation card
      setShowAnimateSheet(false);
      setAnimationState(null);
      setSelectedVideoId(animationState.taskId);
      // Navigate to video entry on next render (timeline hasn't updated yet)
      pendingNavigateToVideoRef.current = true;
    }
  }, [animationState?.status, animationState?.taskId, animationState?.prompt, animationState?.imageUrls, projectId]);

  // Navigate to video entry after submitting animation (deferred to next render when timeline is updated)
  // Only fires ONCE per flag set — resets immediately to prevent re-triggering on subsequent timeline changes
  useEffect(() => {
    if (pendingNavigateToVideoRef.current && videoTimelineIndex >= 0) {
      pendingNavigateToVideoRef.current = false;
      // Use requestAnimationFrame to ensure state has settled before navigating
      requestAnimationFrame(() => setViewIndex(videoTimelineIndex));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animations.length]); // Only react to animations array changes, not every timeline resize

  // Watch for animations completing — send CUI notification + StatusBar update
  const prevCompletedIdsRef = useRef<Set<string>>(
    new Set(animations.filter(a => a.status === 'completed').map(a => a.id))
  );
  useEffect(() => {
    const completedIds = new Set(animations.filter(a => a.status === 'completed').map(a => a.id));
    const newlyCompleted = [...completedIds].filter(id => !prevCompletedIdsRef.current.has(id));
    prevCompletedIdsRef.current = completedIds;
    for (const id of newlyCompleted) {
      const anim = animations.find(a => a.id === id);
      if (anim?.videoUrl) {
        setAgentStatus(t('status.videoDone'));
        // Show "See" button to navigate to video entry (last item in timeline)
        setPendingNotification({ text: t('status.videoDone'), targetIndex: videoTimelineIndex });
        const alreadyHasVideo = messages.some(m => m.content?.includes(anim.videoUrl!));
        if (!alreadyHasVideo) {
          const videoMsg: Message = {
            id: generateId(),
            role: 'assistant',
            content: `🎬 ${t('status.videoDone')}！\n${anim.videoUrl}\nanim:${anim.id}`,
            timestamp: Date.now(),
          };
          setMessages(prev => [...prev, videoMsg]);
          onSaveMessage?.(videoMsg);
        }
      }
    }
  }, [animations, messages, onSaveMessage]);

  // Update StatusBar with video rendering progress
  // (yields to sticky status for the else branch — active user actions like generating_prompt/submitting override)
  useEffect(() => {
    if (animationState?.status === 'generating_prompt') {
      setAgentStatus(t('status.writingScript'));
    } else if (animationState?.status === 'submitting') {
      setAgentStatus(t('status.submittingVideo'));
    } else {
      const processingCount = animations.filter(a => a.status === 'processing').length;
      if (processingCount > 0 && !isAgentActive) {
        setAgentStatus(t('status.videoRenderingEllipsis'));
      }
    }
  }, [animationState?.status, animations, isAgentActive]);

  const showSaveToast = useCallback(() => {
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 2000);
  }, []);

  const handleDownload = useCallback(async () => {
    // Video download — proxy through our API to avoid CORS
    if (isViewingVideo && currentVideo?.videoUrl) {
      const videoSrc = currentVideo.videoUrl;
      const filename = `makaron-video-${Date.now()}.mp4`;
      setIsSaving(true);
      try {
        const proxyUrl = `/api/proxy-video?url=${encodeURIComponent(videoSrc)}&download=1`;
        const res = await fetch(proxyUrl);
        const blob = await res.blob();
        const file = new File([blob], filename, { type: 'video/mp4' });
        // Try native share (iOS/Android) — check canShare first since large videos may be unsupported
        if (navigator.share && navigator.canShare?.({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
          await navigator.share({ files: [file] });
          setIsSaving(false);
          showSaveToast();
          return;
        }
        // Fallback: trigger download via blob URL (works on desktop + iOS when share fails)
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
        setIsSaving(false);
        showSaveToast();
      } catch {
        setIsSaving(false);
        // Last resort: open video URL directly (iOS will show video player, user can long-press to save)
        window.open(videoSrc, '_blank');
      }
      return;
    }

    // Image download
    const img = timeline[viewIndex];
    if (!img) return;
    const filename = `ai-edited-${Date.now()}.jpg`;
    setIsSaving(true);

    try {
      const res = await fetch(img);
      const blob = await res.blob();

      if (navigator.share && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
        const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
        await navigator.share({ files: [file] });
        setIsSaving(false);
        showSaveToast();
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      setIsSaving(false);
      showSaveToast();
    } catch {
      setIsSaving(false);
      const link = document.createElement('a');
      link.href = img;
      link.download = filename;
      link.click();
    }
  }, [timeline, viewIndex, isViewingVideo, currentVideo?.videoUrl, showSaveToast]);

  // CUI: tap inline image → find snapshot → switch to GUI at that index
  const handleImageTap = useCallback((messageId: string, imgRect?: DOMRect, imgSrc?: string) => {
    const snapIdx = snapshots.findIndex(s => s.messageId === messageId);
    if (snapIdx < 0) return;
    const snap = snapshots[snapIdx];
    const src = imgSrc || snap?.image || snap?.imageUrl || '';
    setViewIndex(timelineFromSnap(snapIdx, draftParentIndex));

    if (isDesktop) {
      // When GUI is smaller than CUI, snap to 50/50 so user can see the image
      const containerW = document.querySelector('.flex.flex-row')?.clientWidth ?? 0;
      if (containerW && cuiPanelWidth > containerW / 2) {
        const midW = Math.round(containerW / 2);
        setCuiPanelWidth(midW);
        if (cuiPanelRef.current) cuiPanelRef.current.style.width = `${midW}px`;
      }
    } else {
      const cr = lastCanvasRect.current;
      if (imgRect && cr && src) {
        // Compute actual image position within canvas (object-contain)
        const imgEl = canvasAreaRef.current?.querySelector('img');
        const ar = (imgEl?.naturalWidth && imgEl?.naturalHeight)
          ? imgEl.naturalWidth / imgEl.naturalHeight : lastImageAR.current;
        const imgInCanvas = containRect(cr.w, cr.h, ar);
        const toRect = { l: cr.l + imgInCanvas.l, t: cr.t + imgInCanvas.t, w: imgInCanvas.w, h: imgInCanvas.h };
        const fromRect = { l: imgRect.left, t: imgRect.top, w: imgRect.width, h: imgRect.height };
        const dummy = { l: 0, t: 0, w: 0, h: 0 };
        setHeroAnim({
          src,
          fromRect, toRect,
          fromImg: dummy, toImg: dummy,
          fromRadius: '16px', toRadius: '0px',
          active: false,
          objectCover: true,
        });
        requestAnimationFrame(() => requestAnimationFrame(() =>
          setHeroAnim(p => p ? { ...p, active: true } : null)
        ));
        setTimeout(() => setHeroAnim(null), HERO_DURATION + 120);
      }
      setViewMode('gui');
    }
  }, [snapshots, draftParentIndex, isDesktop, cuiPanelWidth]);

  // CUI: tap inline video → first click shows in GUI, second click plays
  const handleVideoTap = useCallback((videoRect?: DOMRect, posterSrc?: string, animId?: string) => {
    if (videoTimelineIndex < 0) return;

    // Desktop: if already viewing this exact video, trigger play instead of re-navigating
    const alreadyViewing = isDesktop
      && viewIndex === videoTimelineIndex
      && animId != null
      && selectedVideoId === animId;
    if (alreadyViewing) {
      setVideoPlayTrigger(n => n + 1);
      return;
    }

    setViewIndex(videoTimelineIndex);

    // Select the matching animation by ID (null resets to default fallback)
    setSelectedVideoId(animId ?? null);

    if (isDesktop) {
      const containerW = document.querySelector('.flex.flex-row')?.clientWidth ?? 0;
      if (containerW && cuiPanelWidth > containerW / 2) {
        const midW = Math.round(containerW / 2);
        setCuiPanelWidth(midW);
        if (cuiPanelRef.current) cuiPanelRef.current.style.width = `${midW}px`;
      }
    } else {
      const cr = lastCanvasRect.current;
      if (videoRect && cr && posterSrc) {
        // Compute actual video position within canvas (object-contain), same as image hero
        const ar = lastImageAR.current;
        const vidInCanvas = containRect(cr.w, cr.h, ar);
        const toRect = { l: cr.l + vidInCanvas.l, t: cr.t + vidInCanvas.t, w: vidInCanvas.w, h: vidInCanvas.h };
        const fromRect = { l: videoRect.left, t: videoRect.top, w: videoRect.width, h: videoRect.height };
        const dummy = { l: 0, t: 0, w: 0, h: 0 };
        setHeroAnim({
          src: posterSrc,
          fromRect, toRect,
          fromImg: dummy, toImg: dummy,
          fromRadius: '12px', toRadius: '0px',
          active: false,
          objectCover: true,
        });
        requestAnimationFrame(() => requestAnimationFrame(() =>
          setHeroAnim(p => p ? { ...p, active: true } : null)
        ));
        setTimeout(() => setHeroAnim(null), HERO_DURATION + 120);
      }
      setViewMode('gui');
    }
  }, [videoTimelineIndex, isDesktop, cuiPanelWidth, viewIndex, selectedVideoId]);

  // Navigate GUI canvas to a snapshot when clicking @N chip in CUI (desktop only)
  const handleNavigateToSnapshot = useCallback((snapIndex: number) => {
    if (!isDesktop) return; // mobile keeps default hover/tap preview
    if (snapIndex < 0 || snapIndex >= snapshots.length) return;
    setViewIndex(timelineFromSnap(snapIndex, draftParentIndex));
    // If GUI is smaller than CUI, snap to 50/50
    const containerW = document.querySelector('.flex.flex-row')?.clientWidth ?? 0;
    if (containerW && cuiPanelWidth > containerW / 2) {
      const midW = Math.round(containerW / 2);
      setCuiPanelWidth(midW);
      if (cuiPanelRef.current) cuiPanelRef.current.style.width = `${midW}px`;
    }
  }, [snapshots.length, draftParentIndex, isDesktop, cuiPanelWidth]);

  // Track whether we've pushed a CUI history state that hasn't been consumed yet.
  // We need this because setViewMode('gui') can be called via two paths:
  //   1. popstate (history.back) → state already consumed, don't back() again
  //   2. direct call (e.g. handleImageTap) → orphaned state, must clean up
  const hasCuiHistoryState = useRef(false);

  // Intercept browser/iOS back gesture when CUI is open:
  // push a history state on enter, listen for popstate to go back to GUI.
  // Desktop: no history management needed (CUI is always visible as side panel)
  useEffect(() => {
    if (isDesktop) return;
    if (viewMode === 'cui') {
      // pushState may already have been called by openCUI (for Safari snapshot timing)
      if (!hasCuiHistoryState.current) {
        window.history.pushState({ makaronCui: true }, '');
        hasCuiHistoryState.current = true;
      }
      const handlePop = () => {
        hasCuiHistoryState.current = false;
        // flushSync forces React to render synchronously — DOM updates
        // before the next line, giving Safari no chance to show stale frames.
        flushSync(() => setViewMode('gui'));
        // Force layout reflow + repaint so Safari's compositor picks up the new DOM
        document.body.offsetHeight;           // force reflow
        document.body.style.opacity = '0.999';
        requestAnimationFrame(() => {
          document.body.style.opacity = '';
        });
      };
      window.addEventListener('popstate', handlePop);
      return () => window.removeEventListener('popstate', handlePop);
    }
    // viewMode is 'gui': if a CUI state was pushed but not consumed (e.g. handleImageTap
    // called setViewMode('gui') directly), pop it now so iOS back swipe goes to /projects.
    if (hasCuiHistoryState.current) {
      hasCuiHistoryState.current = false;
      window.history.back(); // listener already removed by cleanup above — silently pops
    }
  }, [viewMode, isDesktop]);

  return (
    <div
      data-testid="editor"
      data-tips-status={isTipsFetching ? 'loading' : (snapshots[0]?.tips?.length ? 'ready' : 'empty')}
      data-tips-count={snapshots.reduce((n, s) => n + (s.tips?.length || 0), 0)}
      data-agent-status={isAgentActive ? 'active' : 'idle'}
      data-snapshot-count={snapshots.length}
      data-current-snapshot={viewIndex}
      data-view-mode={viewMode}
      data-preferred-model={preferredModel}
      className={`h-dvh bg-black relative overflow-hidden flex ${isDesktop ? 'flex-row' : 'flex-col'}`}
    >
      <input
        ref={fileInputRef}
        data-testid="editor-file-upload"
        aria-label="Upload photo to editor"
        type="file"
        accept="image/*,.heic,.heif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) compressAndUpload(file);
          e.target.value = '';
        }}
      />
      {/* New project file input */}
      <input
        ref={newProjectFileInputRef}
        type="file"
        accept="image/*,.heic,.heif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onNewProject?.(file);
          e.target.value = '';
        }}
      />

      {/* GUI mode — always visible on desktop, toggled on mobile (also during pull-down for gesture tracking) */}
      {(isDesktop || viewMode === 'gui' || pullProgress !== null) && (
        <div className={isDesktop ? 'flex-1 min-w-0 flex flex-col relative' : 'contents'}>
          {/* Canvas area (fills remaining space) */}
          <div
            ref={(el) => {
              canvasAreaRef.current = el;
              if (el) {
                const r = el.getBoundingClientRect();
                lastCanvasRect.current = { l: r.left, t: r.top, w: r.width, h: r.height };
              }
            }}
            className="flex-1 relative min-h-0 overflow-hidden"
            style={heroAnim ? { opacity: 0 } : undefined}
          >
            {timeline.length === 0 || (timeline.length === 1 && !timeline[0]) ? (
              (isAgentActive || (timeline.length === 1 && !timeline[0])) ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-fuchsia-400 border-t-transparent rounded-full animate-spin" />
                    <span className="text-white/50 text-sm">{timeline.length === 1 ? 'Converting...' : t('editor.generatingImage')}</span>
                  </div>
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center gap-4 text-white/60 hover:text-white/80 transition-colors"
                  >
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="9" cy="9" r="2" />
                      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                    </svg>
                    <span className="text-lg font-medium">Tap to upload a photo</span>
                  </button>
                </div>
              )
            ) : (
              <ImageCanvas
                data-testid="canvas"
                key={`${viewIndex}:${timeline[viewIndex] ?? ''}:${currentVideo?.videoUrl ?? ''}:${annotationMode ? 'annotate' : 'browse'}`}
                timeline={timeline}
                currentIndex={viewIndex}
                onIndexChange={handleIndexChange}
                referenceCount={referenceCount}
                isEditing={isEditing}
                isDraft={isViewingDraft}
                isDraftLoading={isViewingDraft && !draftFullLoaded && !!draftFullUrl?.startsWith('http')}
                draftTimelineIndex={draftParentIndex !== null ? draftParentIndex + 1 : undefined}
                onDismissDraft={dismissDraft}
                previousImage={previousImage}
                isDesktop={isDesktop}
                annotationMode={annotationMode}
                annotationTool={annotationTool}
                annotationEntries={annotationEntries}
                onAddAnnotationEntry={(entry) => { setAnnotationEntries(prev => [...prev, entry]); setAnnotationUndoStack([]); }}
                onUpdateAnnotationEntry={(id, data) => setAnnotationEntries(prev => prev.map(e => e.id === id ? { ...e, data: { ...e.data, ...data } } : e))}
                onDeleteAnnotationEntry={(id) => setAnnotationEntries(prev => prev.filter(e => e.id !== id))}
                annotationColor={annotationColor}
                annotationLineWidth={(() => {
                  const base = 1408;
                  const t = annotationBrushSize / 100; // 0..1
                  // Brush & Rect use same scale (0.006–0.07)
                  const scale = 0.006 + t * 0.064;
                  return Math.max(4, Math.round(base * scale));
                })()}
                onStartTextEdit={(cx, cy) => { setTextEditPos({ x: cx, y: cy }); setTextEditValue(''); }}
                textEditing={textEditPos ? { x: textEditPos.x, y: textEditPos.y, text: textEditValue, textColor, bgColor: textBgEnabled ? '#000' : '' } : null}
                onAnimate={snapshots.length >= 1 ? () => {
                  if (hasAnyAnimation) {
                    // Animations exist — navigate to video entry (shows result card)
                    setViewIndex(videoTimelineIndex);
                    return;
                  }
                  // No animations yet — open creation card (exclude reference snapshots)
                  const allUrls = snapshots.filter(s => s.type !== 'reference').map(s => s.imageUrl).filter((u): u is string => !!u && u.startsWith('http'));
                  const imageUrls = allUrls.length <= 7
                    ? allUrls
                    : [0, 1, 2, Math.floor(allUrls.length / 2), allUrls.length - 3, allUrls.length - 2, allUrls.length - 1].map(i => allUrls[Math.min(i, allUrls.length - 1)]);
                  setAnimationState({
                    imageUrls,
                    prompt: '',
                    userHint: '',
                    taskId: null,
                    videoUrl: null,
                    status: 'idle',
                    error: null,
                    duration: null,
                    pollSeconds: 0,
                  });
                  setShowAnimateSheet(true);
                } : undefined}
                hasVideo={hasVideo}
                isVideoEntry={isViewingVideo}
                videoUrl={currentVideo?.videoUrl ?? null}
                videoProcessing={isViewingVideo && !currentVideo?.videoUrl && animations.some(a => a.status === 'processing')}
                videoPosterImage={snapshots[snapshots.length - 1]?.image}
                videoPlayTrigger={videoPlayTrigger}
                pullDownActive={pullProgress !== null}
                onPullDown={handlePullDown}
                onPullDownEnd={handlePullDownEnd}
              />
            )}

            {/* TODO: Floating text input for annotation text tool — uncomment when text editing flow is ready */}

            {/* Top toolbar */}
            {snapshots.length > 0 && (
              <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent z-10">
                <div className="flex items-center gap-1">
                  {onBack && (
                    <button
                      onClick={onBack}
                      className="text-white/80 hover:text-white p-2 cursor-pointer"
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => newProjectFileInputRef.current?.click()}
                    className="text-white/80 hover:text-white p-2 cursor-pointer"
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                  {/* Annotation (paintbrush) toggle */}
                  {!isViewingVideo && timeline.length > 0 && (
                    <button
                      onClick={() => {
                        if (annotationMode) {
                          setAnnotationMode(false);
                          setAnnotationEntries([]);
                          setAnnotationUndoStack([]);
                        } else {
                          setShowCameraPanel(false);
                          setAnnotationMode(true);
                          setAnnotationTool('brush');
                        }
                      }}
                      className={`p-2 cursor-pointer transition-colors ${annotationMode ? 'text-fuchsia-400' : 'text-white/80 hover:text-white'}`}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
                        <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
                      </svg>
                    </button>
                  )}
                  {/* Camera rotation toggle */}
                  {!isViewingVideo && timeline.length > 0 && (
                    <button
                      onClick={() => {
                        if (showCameraPanel) {
                          setShowCameraPanel(false);
                        } else {
                          setAnnotationMode(false);
                          setAnnotationEntries([]);
                          setAnnotationUndoStack([]);
                          setShowCameraPanel(true);
                        }
                      }}
                      className={`p-2 cursor-pointer transition-colors ${showCameraPanel ? 'text-fuchsia-400' : 'text-white/80 hover:text-white'}`}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        {/* Camera body */}
                        <path d="M15 16H9a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2z" />
                        <circle cx="12" cy="11.5" r="1.5" />
                        {/* Rotate arrow */}
                        <path d="M20 8a8.5 8.5 0 0 0-3-3.5" />
                        <path d="M20 8l-2.5-.5L18 10" />
                        <path d="M4 16a8.5 8.5 0 0 0 3 3.5" />
                        <path d="M4 16l2.5.5L6 14" />
                      </svg>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {snapshots.length > 0 && (
                    <button
                      onClick={handleDownload}
                      disabled={isSaving}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium backdrop-blur-sm border transition-all cursor-pointer ${
                        isSaving
                          ? 'text-white/50 bg-fuchsia-500/10 border-fuchsia-500/20'
                          : 'text-white bg-fuchsia-500/20 border-fuchsia-500/30'
                      }`}
                    >
                      {isSaving ? (
                        <span className="flex items-center gap-1.5">
                          <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Saving
                        </span>
                      ) : 'Save'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Annotation toolbar — overlays TipsBar like AnimateSheet */}
          {snapshots.length > 0 && annotationMode && (
            <div style={isDesktop ? {
              position: 'absolute',
              top: 56, left: 12,
              zIndex: 201,
              maxWidth: 480,
            } : {
              position: 'fixed',
              bottom: 0, left: 0, right: 0,
              zIndex: 201,
              maxWidth: 480,
              margin: '0 auto',
            }}>
              <AnnotationToolbar
                activeTool={annotationTool}
                onToolChange={(tool) => {
                  setAnnotationTool(tool);
                  if (tool === 'text' && !textEditPos) {
                    setTextEditPos({ x: 704, y: 704 });
                    setTextEditValue('');
                  } else if (tool !== 'text') {
                    setTextEditPos(null);
                    setTextEditValue('');
                  }
                }}
                onUndo={() => {
                  setAnnotationEntries(prev => {
                    if (prev.length === 0) return prev;
                    setAnnotationUndoStack(s => [...s, prev[prev.length - 1]]);
                    return prev.slice(0, -1);
                  });
                }}
                onRedo={() => {
                  setAnnotationUndoStack(prev => {
                    if (prev.length === 0) return prev;
                    setAnnotationEntries(e => [...e, prev[prev.length - 1]]);
                    return prev.slice(0, -1);
                  });
                }}
                onClear={() => { setAnnotationEntries([]); setAnnotationUndoStack([]); }}
                onCancel={() => { setAnnotationMode(false); setAnnotationEntries([]); setAnnotationUndoStack([]); setTextEditPos(null); }}
                canUndo={annotationEntries.length > 0}
                canRedo={annotationUndoStack.length > 0}
                hasEntries={annotationEntries.length > 0}
                isDesktop={isDesktop}
                isSending={isAgentActive}
                onSend={(text, refImg) => sendWithAnnotations(text, refImg ? [refImg] : undefined)}
                brushSize={annotationBrushSize}
                onBrushSizeChange={setAnnotationBrushSize}
                textEditing={!!textEditPos}
                textColor={textColor}
                onTextColorChange={setTextColor}
                textBgEnabled={textBgEnabled}
                onTextBgToggle={() => setTextBgEnabled(prev => !prev)}
                onTextDone={() => {
                  if (textEditPos && textEditValue.trim()) {
                    const fontSize = Math.round(1408 * 0.05);
                    setAnnotationUndoStack([]);
                    setAnnotationEntries(prev => [...prev, {
                      id: newAnnotationId(),
                      type: 'text' as const,
                      color: textColor,
                      lineWidth: 0,
                      data: { x: textEditPos.x, y: textEditPos.y, text: textEditValue.trim(), fontSize, textColor, bgColor: textBgEnabled ? '#000' : '' },
                    }]);
                  }
                  setTextEditPos(null);
                  setTextEditValue('');
                }}
                onTextCancel={() => {
                  setTextEditPos(null);
                  setTextEditValue('');
                }}
              />
            </div>
          )}

          {/* Camera rotation panel — centered in GUI area */}
          {snapshots.length > 0 && showCameraPanel && (
            <div style={isDesktop ? {
              position: 'absolute',
              top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 201,
              maxWidth: 720,
              width: '90%',
            } : {
              position: 'fixed',
              bottom: 0, left: 0, right: 0,
              zIndex: 201,
              maxWidth: 400,
              margin: '0 auto',
            }}>
              <CameraPanel
                imageUrl={timeline[viewIndex] || ''}
                isDesktop={isDesktop}
                isGenerating={isAgentActive}
                onGenerate={handleCameraGenerate}
                onCancel={() => setShowCameraPanel(false)}
              />
            </div>
          )}

          {/* Bottom bar: tips or video results */}
          {snapshots.length > 0 && (
              <div className="flex-shrink-0 bg-gradient-to-t from-black from-70% via-black/95 to-transparent">
                <AgentStatusBar
                  statusText={agentStatus}
                  isActive={isAgentActive}
                  onOpenChat={openCUI}
                  isViewingDraft={isViewingDraft}
                  hideChat={isDesktop}
                  snapshotCount={snapshots.length}
                  notification={pendingNotification}
                  onSeeNotification={handleSeeNotification}
                  onAnimate={snapshots.length >= 1 ? () => {
                    if (hasAnyAnimation) {
                      setViewIndex(videoTimelineIndex);
                      return;
                    }
                    const allUrls = snapshots.map(s => s.imageUrl).filter((u): u is string => !!u && u.startsWith('http'));
                    const imageUrls = allUrls.length <= 7
                      ? allUrls
                      : [0, 1, 2, Math.floor(allUrls.length / 2), allUrls.length - 3, allUrls.length - 2, allUrls.length - 1].map(i => allUrls[Math.min(i, allUrls.length - 1)]);
                    setAnimationState({ imageUrls, prompt: '', userHint: '', taskId: null, videoUrl: null, status: 'idle', error: null, duration: null, pollSeconds: 0 });
                    setShowAnimateSheet(true);
                  } : undefined}
                  hasVideo={hasVideo}
                />
                {isViewingVideo ? (
                  <VideoResultCard
                    animations={animations}
                    selectedVideoId={selectedVideoId}
                    onSelectVideo={setSelectedVideoId}
                    onCreateNew={() => {
                      const allUrls = snapshots.map(s => s.imageUrl).filter((u): u is string => !!u && u.startsWith('http'));
                      const imageUrls = allUrls.length <= 7
                        ? allUrls
                        : [0, 1, 2, Math.floor(allUrls.length / 2), allUrls.length - 3, allUrls.length - 2, allUrls.length - 1].map(i => allUrls[Math.min(i, allUrls.length - 1)]);
                      setAnimationState({
                        imageUrls,
                        prompt: '',
                        userHint: '',
                        taskId: null,
                        videoUrl: null,
                        status: 'idle',
                        error: null,
                        duration: null,
                        pollSeconds: 0,
                      });
                      setShowAnimateSheet(true);
                    }}
                    onAbandon={(taskId) => {
                      setAnimations(prev => prev.filter(a => a.taskId !== taskId));
                      fetch(`/api/animate/${taskId}`, { method: 'DELETE' }).catch(() => {});
                    }}
                    onViewDetail={(anim) => {
                      setDetailAnimation(anim);
                      setAnimationState({
                        imageUrls: anim.snapshotUrls,
                        prompt: anim.prompt,
                        userHint: '',
                        taskId: anim.taskId,
                        videoUrl: anim.videoUrl,
                        status: 'idle',
                        error: null,
                        duration: anim.duration ?? null,
                        pollSeconds: 0,
                      });
                      setShowAnimateSheet(true);
                    }}
                    isDesktop={isDesktop}
                  />
                ) : (
                  <TipsBar
                    tips={currentTips}
                    isLoading={isTipsFetching}
                    isEditing={isEditing}
                    onTipClick={handleTipInteraction}
                    onTipCommit={() => commitDraft()}
                    onTipDeselect={dismissDraft}
                    onRetryPreview={handleRetryPreview}
                    previewingIndex={isViewingDraft ? previewingTipIndex : null}
                    onLoadMore={(category) => {
                      const snap = snapshots[tipsSourceIndex];
                      if (snap) fetchMoreTipsForCategory(category, snap.id, getImageForApi(snap));
                    }}
                    onCategorySelect={generatePreviewsForCategory}
                    loadingMoreCategories={loadingMoreCategories}
                    isDesktop={isDesktop}
                    initialCategory={committedCategory ?? undefined}
                    failedCategories={failedCategories}
                    onRetryCategory={retryFailedCategory}
                    onRetryAll={retryAllTips}
                  />
                )}
              </div>
          )}

          {/* Animate Sheet (Creation Card or Detail Mode) */}
          {showAnimateSheet && projectId && animationState && (
            <AnimateSheet
              snapshots={snapshots.filter(s => s.imageUrl || s.image)}
              projectId={projectId}
              isDesktop={isDesktop}
              mode={detailAnimation ? 'detail' : 'create'}
              detailAnimation={detailAnimation ?? undefined}
              onClose={() => {
                setShowAnimateSheet(false);
                setAnimationState(null);
                setDetailAnimation(null);
              }}
              onOpenCUI={() => { if (!isDesktop) setViewMode('cui'); }}
              onGeneratePrompt={generateAnimationPrompt}
              onPreviewImage={(snapshotId) => {
                const idx = snapshots.findIndex(s => s.id === snapshotId);
                if (idx >= 0) {
                  const tIdx = timelineFromSnap(idx, draftParentIndex);
                  setViewIndex(tIdx);
                }
              }}
              animationState={animationState}
              onStateChange={(update) => setAnimationState(prev => {
                const next = prev ? { ...prev, ...update } : prev;
                if (next) animationStateRef.current = next;
                return next;
              })}
            />
          )}

        </div>
      )}

      {/* CUI mode — desktop: side panel (always visible), mobile: fullscreen overlay */}
      {isDesktop ? (<>
        {/* Resizable divider handle */}
        <div
          className="flex-shrink-0 cursor-col-resize relative group"
          style={{ width: 1 }}
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = cuiPanelWidth;
            const containerW = (e.currentTarget.parentElement?.clientWidth ?? 1200);
            const minW = 340;
            const maxW = containerW - 340;
            const midW = Math.round(containerW / 2);
            const snaps = [minW, midW, maxW];
            let currentW = startW;
            const onMove = (ev: MouseEvent) => {
              const delta = startX - ev.clientX;
              const raw = Math.max(minW, Math.min(maxW, startW + delta));
              const nearest = snaps.reduce((a, b) => Math.abs(b - raw) < Math.abs(a - raw) ? b : a);
              currentW = Math.abs(nearest - raw) < 30 ? nearest : raw;
              // DOM-only update during drag — no React re-render
              if (cuiPanelRef.current) cuiPanelRef.current.style.width = `${currentW}px`;
            };
            const onUp = () => {
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
              document.body.style.cursor = '';
              document.body.style.userSelect = '';
              setCuiPanelWidth(currentW); // sync to React state once
            };
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          }}
        >
          {/* Hit area + hover thicken effect */}
          <div className="absolute inset-y-0 -left-[5px] -right-[5px] z-10" />
          {/* Visible line — thickens on hover */}
          <div className="absolute inset-y-0 -left-[0.5px] w-[1px] bg-white/[0.08] group-hover:w-[3px] group-hover:-left-[1.5px] group-hover:bg-white/20 transition-all duration-150 z-20 pointer-events-none" />
          {/* Handle pill — always visible */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none">
            <div className="w-[6px] py-3 rounded-full bg-white/15 group-hover:bg-white/30 group-hover:w-[8px] transition-all duration-150 flex flex-col items-center justify-center gap-[3px]">
              <div className="w-[2px] h-[2px] rounded-full bg-white/40" />
              <div className="w-[2px] h-[2px] rounded-full bg-white/40" />
              <div className="w-[2px] h-[2px] rounded-full bg-white/40" />
            </div>
          </div>
        </div>
        <div ref={cuiPanelRef} className="flex-shrink-0 border-l border-white/[0.08]" style={{ width: cuiPanelWidth }}>
          <AgentChatView
            mode="panel"
            messages={messages}
            isAgentActive={isAgentActive}
            agentStatus={agentStatus}
            currentImage={isViewingVideo ? snapshots[snapshots.length - 1]?.image : timeline[viewIndex]}
            onSendMessage={handleCuiSend}
            onAbort={handleAgentAbort}
            onBack={() => {}}
            onPipTap={() => {}}
            onInputBarHeight={(h) => { cuiInputBarH.current = h; }}
            onImageTap={handleImageTap}
            onVideoTap={handleVideoTap}
            snapshots={snapshots}
            currentSnapshotIndex={isViewingVideo ? snapshots.length : (snapFromTimeline(viewIndex, draftParentIndex) ?? draftParentIndex ?? 0) + 1}
            preferredModel={preferredModel}
            onModelChange={setPreferredModel}
            onNavigateToSnapshot={handleNavigateToSnapshot}
          />
        </div>
      </>) : viewMode === 'cui' ? (
        <AgentChatView
          messages={messages}
          isAgentActive={isAgentActive}
          agentStatus={agentStatus}
          currentImage={isViewingVideo ? snapshots[snapshots.length - 1]?.image : timeline[viewIndex]}
          onSendMessage={handleCuiSend}
          onAbort={handleAgentAbort}
          onBack={() => {
            if (snapshots.length === 0 && onBack) {
              onBack(); // No snapshots (text-only before image generated) → go to projects
            } else {
              window.history.back(); // Normal: CUI → GUI
            }
          }}
          onPipTap={handlePipTap}
          hidePip={heroAnim !== null || pullProgress !== null}
          onInputBarHeight={(h) => { cuiInputBarH.current = h; }}
          onImageTap={handleImageTap}
          onVideoTap={handleVideoTap}
          focusOnOpen={isViewingDraft}
          snapshots={snapshots}
          currentSnapshotIndex={isViewingVideo ? snapshots.length : (snapFromTimeline(viewIndex, draftParentIndex) ?? draftParentIndex ?? 0) + 1}
          preferredModel={preferredModel}
          onModelChange={setPreferredModel}
          onNavigateToSnapshot={undefined}
        />
      ) : null}

      {/* Pull-down dim overlay + "Entering Chat" hint */}
      {!isDesktop && pullProgress !== null && (<>
        <div
          className="fixed inset-0 z-30 bg-black pointer-events-none"
          style={{
            opacity: pullProgress * 0.8,
            transition: pullTransitioning.current ? 'opacity 300ms ease' : 'none',
          }}
        />
        <div
          className="fixed inset-x-0 z-30 pointer-events-none flex items-center justify-center"
          style={{
            top: lastCanvasRect.current ? lastCanvasRect.current.t : 0,
            height: lastCanvasRect.current ? lastCanvasRect.current.h : '50%',
            opacity: Math.max(0, Math.pow(pullProgress, 2) * 0.7),
            transition: pullTransitioning.current ? 'opacity 300ms ease' : 'none',
          }}
        >
          <p className="text-white text-lg font-medium text-center leading-relaxed tracking-wider whitespace-pre-line">
            {locale === 'zh' ? '进入聊天\n继续编辑' : 'Entering Chat\nContinue Editing'}
          </p>
        </div>
      </>)}

      {/* Pull-down PiP overlay: canvas image follows finger freely, animates to PiP on release */}
      {pullProgress !== null && pullStartRect.current && (() => {
        const from = pullStartRect.current!;
        const PIP_SIZE = 116, PIP_M = 14;
        const PIP_BOTTOM = cuiInputBarH.current - 32 + 4;
        const p = pullProgress;
        const isTransitioning = pullTransitioning.current;

        // PiP target position
        const pipL = (typeof window !== 'undefined' ? window.innerWidth : 390) - PIP_M - PIP_SIZE;
        const pipT = (typeof window !== 'undefined' ? window.innerHeight : 844) - PIP_BOTTOM - PIP_SIZE;

        // Compute current position: free-drag during gesture, target on release
        let l: number, t: number, w: number, h: number, r: number;
        if (isTransitioning) {
          // Animating to target (commit → PiP corner, cancel → original)
          const committed = pullCommitted.current;
          l = committed ? pipL : from.l;
          t = committed ? pipT : from.t;
          w = committed ? PIP_SIZE : from.w;
          h = committed ? PIP_SIZE : from.h;
          r = committed ? 16 : 0;
        } else {
          // Free-drag: follow finger with proportional shrink
          const scale = 1 - p * 0.5; // 1.0 → 0.5
          w = from.w * scale;
          h = from.h * scale;
          const cx = from.l + from.w / 2 + pullDelta.dx;
          const cy = from.t + from.h / 2 + pullDelta.dy;
          l = cx - w / 2;
          t = cy - h / 2;
          r = p * 16;
        }

        return (
          <div
            className="fixed pointer-events-none z-[100] overflow-hidden"
            style={{
              left: l,
              top: t,
              width: w,
              height: h,
              borderRadius: r,
              boxShadow: isTransitioning && p >= 0.5 ? '0 6px 24px rgba(0,0,0,0.55)' : `0 ${6 * p}px ${24 * p}px rgba(0,0,0,${0.55 * p})`,
              border: (p > 0.1 || isTransitioning) ? '1.5px solid rgba(255,255,255,0.14)' : 'none',
              transition: isTransitioning
                ? 'left 300ms cubic-bezier(0.4,0,0.2,1), top 300ms cubic-bezier(0.4,0,0.2,1), width 300ms cubic-bezier(0.4,0,0.2,1), height 300ms cubic-bezier(0.4,0,0.2,1), border-radius 300ms cubic-bezier(0.4,0,0.2,1), box-shadow 300ms ease'
                : 'none',
            } as CSSProperties}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={timeline[viewIndex]}
              draggable={false}
              alt=""
              className="w-full h-full object-cover"
            />
          </div>
        );
      })()}

      {/* Hero Overlay: animates between canvas rect and PiP rect during GUI↔CUI transition */}
      {heroAnim && (
        <div
          className="fixed pointer-events-none z-[100] overflow-hidden"
          style={{
            left:   heroAnim.active ? heroAnim.toRect.l : heroAnim.fromRect.l,
            top:    heroAnim.active ? heroAnim.toRect.t : heroAnim.fromRect.t,
            width:  heroAnim.active ? heroAnim.toRect.w : heroAnim.fromRect.w,
            height: heroAnim.active ? heroAnim.toRect.h : heroAnim.fromRect.h,
            borderRadius: heroAnim.active ? heroAnim.toRadius : heroAnim.fromRadius,
            transition: heroAnim.active
              ? `left ${HERO_DURATION}ms cubic-bezier(0.4,0,0.2,1), top ${HERO_DURATION}ms cubic-bezier(0.4,0,0.2,1), width ${HERO_DURATION}ms cubic-bezier(0.4,0,0.2,1), height ${HERO_DURATION}ms cubic-bezier(0.4,0,0.2,1), border-radius ${HERO_DURATION}ms`
              : 'none',
          } as CSSProperties}
        >
          {heroAnim.objectCover ? (
            // Both containers are squares → object-cover always shows the same center crop, no squish
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={heroAnim.src} draggable={false} alt="" className="w-full h-full object-cover" />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={heroAnim.src}
              draggable={false}
              alt=""
              style={{
                position: 'absolute',
                left:   heroAnim.active ? heroAnim.toImg.l   : heroAnim.fromImg.l,
                top:    heroAnim.active ? heroAnim.toImg.t   : heroAnim.fromImg.t,
                width:  heroAnim.active ? heroAnim.toImg.w   : heroAnim.fromImg.w,
                height: heroAnim.active ? heroAnim.toImg.h   : heroAnim.fromImg.h,
                transition: heroAnim.active
                  ? `left ${HERO_DURATION}ms cubic-bezier(0.4,0,0.2,1), top ${HERO_DURATION}ms cubic-bezier(0.4,0,0.2,1), width ${HERO_DURATION}ms cubic-bezier(0.4,0,0.2,1), height ${HERO_DURATION}ms cubic-bezier(0.4,0,0.2,1)`
                  : 'none',
              } as CSSProperties}
            />
          )}
        </div>
      )}

      {/* Save success toast */}
      {saveToast && (
        <div
          className="fixed top-16 left-1/2 -translate-x-1/2 z-[300] px-5 py-2.5 rounded-full bg-black/80 backdrop-blur-sm text-white text-sm font-medium shadow-lg"
          style={{ animation: 'fadeInOut 2s ease both' }}
        >
          {t('misc.saveSuccess')}
        </div>
      )}
      <style>{`
        @keyframes fadeInOut {
          0% { opacity: 0; transform: translateX(-50%) translateY(-8px); }
          15% { opacity: 1; transform: translateX(-50%) translateY(0); }
          75% { opacity: 1; transform: translateX(-50%) translateY(0); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-8px); }
        }
      `}</style>
    </div>
  );
}
