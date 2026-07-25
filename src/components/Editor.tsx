'use client';

import { useState, useRef, useCallback, useMemo, useEffect, type CSSProperties, type TouchEvent as ReactTouchEvent } from 'react';
import { flushSync } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Message, Tip, Snapshot, PhotoMetadata, AnnotationEntry, ProjectAnimation, DesignPayload, type VideoMeta, type VideoModel, type VideoResolution, type ArtifactCompletionAction } from '@/types';
import ImageCanvas from '@/components/ImageCanvas';
import TipsBar from '@/components/TipsBar';
import AgentStatusBar from '@/components/AgentStatusBar';
import AgentChatView, { type ComposerDraftAttachment, type PreferredModel } from '@/components/AgentChatView';
import AnnotationToolbar from '@/components/AnnotationToolbar';
import CreditPopup from '@/components/CreditPopup';
import ShareButton from '@/components/ShareButton';
import { streamAgent } from '@/lib/agentStream';
import { useAgentRun } from '@/hooks/useAgentRun';
import { makeAgentCallbacks } from '@/lib/agentCallbacks';
// projectEventLogger removed — events only needed for ReplayEngine (not active)
import { getBabelStatus, subscribeBabelStatus, type BabelStatus } from '@/lib/evalRemotionJSX';
import { acquireTipsSlot, releaseTipsSlot, generateId, snapFromTimeline, timelineFromSnap, getImageForApi } from '@/lib/editor/timeline-utils';
import { buildDesignsMap, buildImageTimeline, getInitialEditorViewMode, getNearbyOptimizedPreloadUrls, getPreviousImageForCompare, shouldShowCanvasPlaceholder, VIDEO_PLACEHOLDER_IMAGE } from '@/lib/editor/timeline-derivations';
import { type AnimationState, type HeroAnim } from '@/lib/editor/types';
import { resolveContentType, type RendererContext, type ContentType } from '@/lib/editor/renderer-registry';

const IOS_CUI_PAN_EDGE_PX = 36;
const IOS_CUI_PAN_COMMIT_PX = 86;
const IOS_CUI_PAN_MIN_DX = 10;
import { downloadAsset } from '@/lib/editor/download';
import { cacheImage, updateCachedTips } from '@/lib/imageCache';
import { mergeAnnotation } from '@/lib/annotationUtils';
import { newAnnotationId } from '@/features/annotation/annotationIds';
import VideoResultCard from '@/components/VideoResultCard';
import AnimateSheet from '@/components/AnimateSheet';
import DesignEditPanel from '@/components/DesignEditPanel';
import DesignEditorFrame from '@/components/DesignEditorFrame';
import DesignFieldEditor from '@/components/DesignFieldEditor';
import CameraPanel from '@/components/CameraPanel';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useVisualViewportInset } from '@/hooks/useVisualViewportInset';
import { compressBase64Image, compressImageFile, isHeicFile } from '@/lib/imageUtils';
import { containRect, coverRect } from '@/lib/image/geometry';
import { extractPhotoMetadata, enrichMetadataLocation } from '@/lib/image/metadata';
import { getPromptLanguage, getTranslationVariants, useLocale } from '@/lib/i18n';
import { getThumbnailUrl, getOptimizedUrl } from '@/lib/supabase/storage';
import { resolveAudioUrlsInCode } from '@/lib/audio-url-resolver';
import { createClient as createBrowserSupabase } from '@/lib/supabase/client';
import { AZIMUTH_MAP, ELEVATION_MAP, DISTANCE_MAP, AZIMUTH_STEPS, ELEVATION_STEPS, DISTANCE_STEPS, snapToNearest, type CameraState } from '@/lib/camera-utils';
import { readNativeJSONCache, writeNativeJSONCache } from '@/lib/native-app-cache';
import { getDefaultVideoModelId, isFastVideoRenderModel, normalizeVideoResolution } from '@/lib/video-model-capabilities';
import { isRemotionExportTaskId } from '@/lib/remotion-export-flags';
import { formatVideoMediaSpec } from '@/lib/media-aspect';
import { serializeCompletionActions } from '@/lib/artifact-actions';
import { appendSnapshotDedupeVideo, dedupeVideoSnapshots } from '@/lib/video-snapshot-dedupe';
import { isGeneratedVideoSnapshot } from '@/lib/video-snapshot-kind';
import type { AgentModelPreference } from '@/lib/agent-models';
import { loadAgentModelPreference, saveAgentModelPreference } from '@/lib/agent-model-preference';
import type { SkillLaunchContext } from '@/lib/skill-launch-context';
import { stripAgentInternalContextForDisplay } from '@/lib/agent-response-policy';

export type { AnimationState } from '@/lib/editor/types';

type EditorCompletionAction = ArtifactCompletionAction;

const PREVIEW_STATUS_PREFIXES = getTranslationVariants('status.generatingPreviews', 0, 0)
  .map((value) => value.replace(/\s*0\/0$/, ''));

function isPreviewGenerationStatus(status: string): boolean {
  return PREVIEW_STATUS_PREFIXES.some((prefix) => status.startsWith(prefix));
}

function dedupeMessagesById(messages: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const message of messages) {
    const existing = byId.get(message.id);
    if (!existing || (!existing.content && message.content)) {
      byId.set(message.id, message);
    }
  }
  return Array.from(byId.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

function formatFrameEditTime(seconds: number) {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  return `${mins}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

interface EditorProps {
  projectId?: string;
  initialSnapshots?: Snapshot[];
  initialMessages?: Message[];
  pendingImage?: string;  // legacy single-image (unused, kept for compat)
  pendingImages?: string[];
  pendingVideos?: Array<{ videoUrl: string; duration: number; width: number; height: number }>;
  pendingMetadata?: PhotoMetadata;
  pendingPrompt?: string;
  pendingSkill?: string;
  pendingSkillLaunchContext?: SkillLaunchContext;
  onSaveSnapshot?: (snapshot: Snapshot, sortOrder: number, onUploaded?: (imageUrl: string) => void) => void | Promise<void>;
  onSaveMessage?: (message: Message) => void;
  onUpdateTips?: (snapshotId: string, tips: Tip[]) => void;
  onUpdateDescription?: (snapshotId: string, description: string) => void;
  onSaveDesignProps?: (snapshotId: string, design: DesignPayload) => void;
  initialTitle?: string;
  onRenameProject?: (title: string) => void;
  onBack?: () => void;
  onNewProject?: (file: File) => void;
  initialAnimations?: ProjectAnimation[];
  initialMusicTaskId?: string | null;
  timelineVersion?: number;
  readOnly?: boolean;
  disableAgentLiveReload?: boolean;
  disableBodyScrollLock?: boolean;
  inactive?: boolean;
}

interface CreditsPayload {
  balance?: number;
  subscription?: { planId: string; status: string } | null;
}

interface SkillsPayload {
  skills?: { name: string; label: string; icon: string; builtIn?: boolean }[];
}

function shouldMergeFreshVideoMeta(current?: VideoMeta, fresh?: VideoMeta): boolean {
  if (!fresh) return false;
  if (!current) return true;
  if (fresh.status === 'completed') return true;
  if (current.status === 'completed') return false;
  return JSON.stringify(current) !== JSON.stringify(fresh);
}

export default function Editor({
  projectId,
  initialSnapshots,
  initialMessages,
  pendingImage,
  pendingImages: pendingImagesProp,
  pendingVideos,
  pendingMetadata,
  pendingPrompt,
  pendingSkill,
  pendingSkillLaunchContext,
  onSaveSnapshot,
  onSaveMessage,
  onUpdateTips,
  onUpdateDescription,
  onSaveDesignProps,
  initialTitle,
  onRenameProject,
  onBack,
  onNewProject,
  initialAnimations,
  initialMusicTaskId,
  timelineVersion = 1,
  readOnly,
  disableAgentLiveReload = false,
  disableBodyScrollLock = false,
  inactive = false,
}: EditorProps = {}) {
  // Merge legacy single + new multi into one array
  const pendingImages = pendingImagesProp ?? (pendingImage ? [pendingImage] : undefined);
  const isDesktop = useIsDesktop();
  const { t, locale } = useLocale();
  const router = useRouter();

  const gateInteraction = useCallback(() => {
    if (!readOnly) return false;
    sessionStorage.setItem('mkr_return_url', window.location.pathname);
    router.push('/login');
    return true;
  }, [readOnly, router]);
  const [cuiPanelWidth, setCuiPanelWidth] = useState(500);
  const cuiPanelRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Message[]>(() => dedupeMessagesById(initialMessages ?? []));
  const [snapshots, setSnapshots] = useState<Snapshot[]>(dedupeVideoSnapshots(initialSnapshots ?? []));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveToast, setSaveToast] = useState(false);
  const pendingVideoRef = useRef<{ blob: Blob; filename: string } | null>(null);
  // Babel CDN loading status for UI feedback
  const [babelStatus, setBabelStatus] = useState<BabelStatus>(getBabelStatus().status);
  useEffect(() => subscribeBabelStatus(() => setBabelStatus(getBabelStatus().status)), []);
  const [isTipsFetching, setIsTipsFetching] = useState(false);
  const [failedCategories, setFailedCategories] = useState<Set<Tip['category']>>(new Set());
  const [viewIndex, setViewIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'gui' | 'cui'>(() => getInitialEditorViewMode({
    isDesktop,
    hasGuiContent: (initialSnapshots?.length ?? 0) > 0
      || (pendingImages?.length ?? 0) > 0
      || (pendingVideos?.length ?? 0) > 0
      || (initialAnimations?.length ?? 0) > 0,
  }));
  const [cuiPanX, setCuiPanX] = useState(0);
  const [cuiPanActive, setCuiPanActive] = useState(false);
  const [cuiPanSettling, setCuiPanSettling] = useState(false);
  const cuiPanRef = useRef({ tracking: false, startX: 0, startY: 0, lastX: 0, startTime: 0, locked: false });

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

  // Credit popup + status bar notification
  const [creditPopupOpen, setCreditPopupOpen] = useState(false);
  const [cachedCredits] = useState<CreditsPayload | null>(() => readNativeJSONCache<CreditsPayload>('/api/billing/credits'));
  const [creditBalance, setCreditBalance] = useState<number>(() => cachedCredits?.balance ?? 0);
  const [creditSubscription, setCreditSubscription] = useState<{ planId: string; status: string } | null>(() => cachedCredits?.subscription ?? null);
  const [creditExhausted, setCreditExhausted] = useState(false);
  const [creditSuccess, setCreditSuccess] = useState(false);
  const [creditWaiting, setCreditWaiting] = useState(false);

  // Fetch credit balance + subscription info on mount
  useEffect(() => {
    fetch('/api/billing/credits').then(r => {
      if (!r.ok) throw new Error('Failed to load credits');
      return r.json();
    }).then(data => {
      writeNativeJSONCache('/api/billing/credits', data);
      setCreditBalance(data.balance ?? 0);
      setCreditSubscription(data.subscription ?? null);
    }).catch(() => {});
  }, []);

  // Payment success detection is handled by CreditPopup autoDetectPayment
  // Camera rotation panel
  const [showCameraPanel, setShowCameraPanel] = useState(false);
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
  // Draft type: makes the implicit mutual exclusion between tips draft and design draft explicit.
  // 'tips' = tip preview selected, 'design' = Agent render draft, null = no draft active.
  const [activeDraftType, setActiveDraftType] = useState<'tips' | 'design' | null>(null);
  const [isAgentActive, setIsAgentActive] = useState(false);
  const [agentStatus, setAgentStatus] = useState(t('editor.greeting'));
  const [pendingDesign, setPendingDesign] = useState<DesignPayload | null>(null);
  const [draftDesign, setDraftDesign] = useState<DesignPayload | null>(null);
  const [draftDesignPoster, setDraftDesignPoster] = useState<string>('');
  // Refs to track latest design for async capture callbacks
  const draftDesignRef = useRef<DesignPayload | null>(null);
  const pendingDesignRef = useRef<DesignPayload | null>(null);
  useEffect(() => { draftDesignRef.current = draftDesign; }, [draftDesign]);
  useEffect(() => { pendingDesignRef.current = pendingDesign; }, [pendingDesign]);
  const [preferredModel, setPreferredModel] = useState<PreferredModel>('auto');
  const preferredModelRef = useRef<PreferredModel>('auto');
  useEffect(() => { preferredModelRef.current = preferredModel; }, [preferredModel]);
  const [videoModel, setVideoModel] = useState<VideoModel>(() => getDefaultVideoModelId());
  const videoModelRef = useRef<VideoModel>(getDefaultVideoModelId());
  useEffect(() => { videoModelRef.current = videoModel; }, [videoModel]);
  const [videoResolution, setVideoResolution] = useState<VideoResolution>('auto');
  const videoResolutionRef = useRef<VideoResolution>('auto');
  useEffect(() => { videoResolutionRef.current = videoResolution; }, [videoResolution]);
  const [videoAuto, setVideoAuto] = useState(true);
  const videoAutoRef = useRef(true);
  useEffect(() => { videoAutoRef.current = videoAuto; }, [videoAuto]);
  const [agentModel, setAgentModel] = useState<AgentModelPreference>('auto');
  const agentModelRef = useRef<AgentModelPreference>('auto');
  useEffect(() => {
    const next = projectId ? loadAgentModelPreference(projectId) : 'auto';
    agentModelRef.current = next;
    setAgentModel(next);
  }, [projectId]);
  const handleAgentModelChange = useCallback((next: AgentModelPreference) => {
    agentModelRef.current = next;
    setAgentModel(next);
    if (projectId) saveAgentModelPreference(projectId, next);
  }, [projectId]);
  const [availableSkills, setAvailableSkills] = useState<{ name: string; label: string; icon: string; builtIn?: boolean }[]>(() => (
    readNativeJSONCache<SkillsPayload>('/api/skills')?.skills ?? []
  ));
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const skillFileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    fetch('/api/skills').then(r => r.json()).then(d => {
      writeNativeJSONCache('/api/skills', d);
      if (d.skills) setAvailableSkills(d.skills);
    }).catch(() => {});
  }, []);
  const [installingSkill, setInstallingSkill] = useState(false);
  const handleSkillUpload = useCallback(async (file: File) => {
    setInstallingSkill(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/skills', { method: 'POST', body: form });
      const data = await res.json();
      if (data.success) {
        const r = await fetch('/api/skills');
        const d = await r.json();
        writeNativeJSONCache('/api/skills', d);
        if (d.skills) setAvailableSkills(d.skills);
        if (data.skillName) setSelectedSkill(data.skillName);
      }
    } catch {}
    setInstallingSkill(false);
  }, []);
  const [loadingMoreCategories, setLoadingMoreCategories] = useState<Set<Tip['category']>>(new Set());
  const [committedCategory, setCommittedCategory] = useState<Tip['category'] | null>(null);
  // Design editable state
  const [selectedEditableFieldId, _setSelectedEditableFieldId] = useState<string | null>(null);
  const [editingDesignFieldId, setEditingDesignFieldId] = useState<string | null>(null);
  // Mobile keyboard offset for text editor panel
  const editorKbInset = useVisualViewportInset(!isDesktop && Boolean(editingDesignFieldId));
  const [visibleEditableIds, _setVisibleEditableIds] = useState<string[]>([]);
  const handleVisibleEditableFields = useCallback((ids: string[]) => {
    _setVisibleEditableIds(prev => {
      if (prev.length === ids.length && prev.every((id, i) => id === ids[i])) return prev;
      return ids;
    });
  }, []);
  const setSelectedEditableFieldId = useCallback((id: string | null) => {
    _setSelectedEditableFieldId(id);
    if (!id) setEditingDesignFieldId(null); // deselect also closes editor
  }, []);


  // Music generation state
  const [musicTaskId, setMusicTaskId] = useState<string | null>(initialMusicTaskId ?? null);
  const [, setMusicTracks] = useState<{ audioUrl: string; duration: number; title: string; tags: string; trackIndex: number }[]>([]);
  const musicMsgIdRef = useRef<string>(''); // which assistant message to attach tracks to
  const musicPollingRef = useRef(!!initialMusicTaskId); // true during music polling — prevents onDone from resetting status
  const agentAbortRef = useRef<AbortController>(new AbortController());
  const pendingDesignMsgIdRef = useRef<string>('');
  const pendingDesignSnapIdRef = useRef<string>('');
  // Streaming code display: tracks which message is receiving run_code chunks
  const codeStreamRef = useRef<{ msgId: string; code: string; shown: number } | null>(null);
  // Agent elapsed timer: tracks start time and current phase for status bar
  const agentTimerRef = useRef<{ startTime: number; phase: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newProjectFileInputRef = useRef<HTMLInputElement>(null);
  const previewAbortRef = useRef<AbortController>(new AbortController());
  // Snapshots pending auto-analysis after current agent run finishes
  const pendingAnalysisRef = useRef<{ id: string; image: string }[]>([]);
  const lastEditPromptRef = useRef<string | null>(null); // captures editPrompt from generate_image tool calls
  const lastEditInputImagesRef = useRef<string[] | null>(null); // captures input images from generate_image tool calls
  const isNsfwRef = useRef(false); // NSFW flag — set when Gemini blocks content, session-level
  const agentRunIdRef = useRef<string | null>(null); // current run ID from server
  const isAgentActiveRef = useRef(false);
  const [videoGuiTime, setVideoGuiTime] = useState(0);
  const [videoGuiDuration, setVideoGuiDuration] = useState(0);
  const [videoFrameCaptureRequest, setVideoFrameCaptureRequest] = useState(0);
  const [cuiDraftText, setCuiDraftText] = useState('');
  const [cuiDraftAttachments, setCuiDraftAttachments] = useState<ComposerDraftAttachment[]>([]);
  const pendingFrameEditRef = useRef<{ anim: ProjectAnimation; time: number; mediaIndex: number; prompt: string } | null>(null);

  // Sync state when initialSnapshots/Messages props change (Supabase fetch or cache)
  useEffect(() => {
    if (!initialSnapshots?.length) return;
    setSnapshots(prev => {
      const existingIds = new Set(prev.map(s => s.id));
      const incomingSnapshots = dedupeVideoSnapshots(initialSnapshots);
      const newItems = incomingSnapshots.filter(s => !existingIds.has(s.id));

      if (newItems.length > 0) {
        // New snapshots found
        if (isAgentActive) return dedupeVideoSnapshots([...prev, ...newItems]);
        return incomingSnapshots.length > prev.length ? incomingSnapshots : dedupeVideoSnapshots([...prev, ...newItems]);
      }

      // Same IDs — merge updates from Supabase into cached snapshots.
      // This handles: cache shows stale data, then Supabase loads fresh values.
      const incoming = new Map(incomingSnapshots.map(s => [s.id, s]));
      let changed = false;
      const merged = prev.map(s => {
        const fresh = incoming.get(s.id);
        if (!fresh) return s;
        let updated = s;
        // Merge missing image/imageUrl (video snapshots loaded from cache before DB)
        if (!s.image && fresh.image) {
          updated = { ...updated, image: fresh.image, imageUrl: fresh.imageUrl };
          changed = true;
        } else if (!s.imageUrl && fresh.imageUrl) {
          updated = { ...updated, imageUrl: fresh.imageUrl };
          changed = true;
        }
        // Merge design/props updates
        if (fresh.design && (!updated.design || (fresh.design.props && JSON.stringify(fresh.design.props) !== JSON.stringify(updated.design.props)))) {
          updated = { ...updated, design: fresh.design };
          changed = true;
        }
        // Merge video state from Supabase over stale project cache.
        // Example: one retry succeeds after an earlier job marked the same
        // publish snapshot failed; the completed DB state must win on reload.
        if (shouldMergeFreshVideoMeta(updated.videoMeta, fresh.videoMeta)) {
          updated = { ...updated, videoMeta: fresh.videoMeta };
          changed = true;
        }
        return updated;
      });
      return changed ? dedupeVideoSnapshots(merged) : prev;
    });
  }, [initialSnapshots, isAgentActive]);

  useEffect(() => {
    if (!initialMessages?.length) return;
    const dedupedInitialMessages = dedupeMessagesById(initialMessages);
    setMessages(prev => {
      if (prev.length === 0) return dedupedInitialMessages;
      // Strict ID-based dedup: build complete list from initialMessages, then append any live messages not in it
      const initialIds = new Set(dedupedInitialMessages.map(m => m.id));
      const liveOnly = prev.filter(m => !initialIds.has(m.id));
      if (liveOnly.length === 0) return dedupedInitialMessages;
      return dedupeMessagesById([...dedupedInitialMessages, ...liveOnly]);
    });
  }, [initialMessages]);

  // ── Background Agent reconnection ──────────────────────────────
  const { activeRunId, reconnect: agentReconnect, disconnect: agentDisconnect } = useAgentRun({
    projectId: projectId ?? '',
    // Text-only/CLI projects can have an active run before their first snapshot.
    // Reconnect follows the project run, not whether GUI content already exists.
    enabled: !!projectId && !inactive,
    skipRunIdRef: agentRunIdRef,
    isActiveRef: isAgentActiveRef,
  });

  // ── Hero animation (GUI ↔ CUI transition) ───────────────────────
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const lastCanvasRect = useRef<{ l: number; t: number; w: number; h: number } | null>(null);
  const lastImageAR = useRef(1); // cached image aspect ratio for CUI→GUI direction
  const cuiInputBarH = useRef(96); // cached CUI input bar height for PiP target position
  const HERO_DURATION = 380;
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
  const hasBackgroundTaskRef = useRef(false);
  hasBackgroundTaskRef.current = musicPollingRef.current || animationState?.status === 'polling' || animations.some(a => a.status === 'processing') || snapshots.some(s => s.type === 'video' && s.videoMeta?.status === 'processing');
  const viewIndexRef = useRef(viewIndex);
  viewIndexRef.current = viewIndex;
  const draftParentIndexRef = useRef(draftParentIndex);
  draftParentIndexRef.current = draftParentIndex;
  const previewingTipIndexRef = useRef(previewingTipIndex);
  previewingTipIndexRef.current = previewingTipIndex;
  useEffect(() => { isAgentActiveRef.current = isAgentActive; }, [isAgentActive]);
  const activeSkillRef = useRef(pendingSkill);
  useEffect(() => { activeSkillRef.current = pendingSkill; }, [pendingSkill]);
const isTipsFetchingRef = useRef(isTipsFetching);
  isTipsFetchingRef.current = isTipsFetching;
  const tipsFetchCountRef = useRef(0);
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
    const parent = snapshots[draftParentIndex];
    return tip?.previewImage || parent?.imageUrl || parent?.image || null;
  }, [draftParentIndex, previewingTipIndex, snapshots]);

  const draftImage = useMemo(() => {
    if (activeDraftType === 'design') {
      // Design draft: use captured poster (or empty string while capturing)
      return draftDesignPoster || '';
    }
    if (activeDraftType === 'tips') {
      // Tips draft: use tip preview image
      if (!draftFullUrl) return null;
      // base64 or non-URL: use directly (no loading needed)
      if (!draftFullUrl.startsWith('http')) return draftFullUrl;
      // Full image loaded: high-quality WebP (no visible downscale)
      if (draftFullLoaded) return getOptimizedUrl(draftFullUrl);
      // Not loaded yet: small proportional thumbnail (contain = keeps original aspect ratio)
      return getThumbnailUrl(draftFullUrl, 144, 60, 144, 'contain');
    }
    return null;
  }, [activeDraftType, draftDesignPoster, draftFullUrl, draftFullLoaded]);

  // Preload full draft image and flip flag when done
  useEffect(() => {
    if (!draftFullUrl || !draftFullUrl.startsWith('http')) return;
    setDraftFullLoaded(false);
    const img = new Image();
    img.src = getOptimizedUrl(draftFullUrl);
    img.onload = () => setDraftFullLoaded(true);
  }, [draftFullUrl]);

  // Capture poster for design draft (async — shown as timeline thumbnail)
  useEffect(() => {
    if (!draftDesign) { setDraftDesignPoster(''); return; }
    let cancelled = false;
    import('@/components/RemotionRenderer').then(({ captureDesignPoster }) =>
      captureDesignPoster(draftDesign).then(poster => {
        if (!cancelled && poster) setDraftDesignPoster(poster);
      })
    ).catch(() => {});
    return () => { cancelled = true; };
  }, [draftDesign]);

  // Timeline: committed snapshots with the virtual draft inserted right after its parent
  // v1: + optional video sentinel at the end (when ANY animation exists)
  // v2: video snapshots are already in snapshots array, no sentinel needed
  const isV2 = timelineVersion >= 2;
  const hasAnyAnimation = animations.length > 0;
  const timeline = useMemo(() => buildImageTimeline({
    snapshots,
    draftImage,
    draftParentIndex,
    hasAnyAnimation: !isV2 && hasAnyAnimation, // v2: no sentinel, videos are in snapshots array
    viewIndex,
  }), [snapshots, draftImage, draftParentIndex, hasAnyAnimation, viewIndex, isV2]);

  const referenceCount = useMemo(() =>
    snapshots.filter(s => s.type === 'reference').length,
  [snapshots]);

  // Timeline indices that should show play icon (video snapshots + animated designs)
  const videoTimelineIndices = useMemo(() => {
    const set = new Set<number>();
    const hasDraft = draftParentIndex !== null;
    snapshots.forEach((s, i) => {
      const isVideo = s.type === 'video';
      const isAnimatedDesign = !!s.design?.animation;
      if (!isVideo && !isAnimatedDesign) return;
      const timelineIdx = hasDraft && i > draftParentIndex! ? i + 1 : i;
      set.add(timelineIdx);
    });
    return set.size > 0 ? set : undefined;
  }, [snapshots, draftParentIndex]);

  // Map timeline index → DesignPayload for animated designs (rendered via Player)
  // All design snapshots (still + animated) render via Player in ImageCanvas
  // Map timeline index → design payload (accounts for virtual draft insertion)
  const designsMap = useMemo(() => buildDesignsMap(snapshots, draftParentIndex), [snapshots, draftParentIndex]);

  // Preload optimized images for nearby snapshots (±2) so swipe feels instant
  useEffect(() => {
    getNearbyOptimizedPreloadUrls(snapshots, viewIndex).forEach(url => {
      const img = new Image();
      img.src = url;
    });
  }, [viewIndex, snapshots]);

  // Video entry detection
  // v1: last item in timeline (sentinel) when any animation exists
  // v2: any snapshot with type='video' at current viewIndex
  const hasGeneratedVideoSnapshot = snapshots.some(isGeneratedVideoSnapshot);
  const hasVideo = hasAnyAnimation || hasGeneratedVideoSnapshot;
  const videoTimelineIndex = !isV2 && hasAnyAnimation ? timeline.length - 1 : -1;
  const currentSnapIndex = snapFromTimeline(viewIndex, draftParentIndex) ?? 0;
  const currentSnap = snapshots[currentSnapIndex];
  const isAtDraftSlot = isDraft && viewIndex === draftParentIndex! + 1;

  // ── Content type resolution via renderer registry ──
  const rendererContext: RendererContext = useMemo(() => ({
    viewIndex,
    draftParentIndex,
    isAtDraftSlot,
    timelineVersion,
    animations,
    selectedVideoId,
  }), [viewIndex, draftParentIndex, isAtDraftSlot, timelineVersion, animations, selectedVideoId]);

  const isV1VideoSentinel = !isV2 && hasAnyAnimation && viewIndex === videoTimelineIndex;
  const contentType: ContentType = useMemo(
    () => isV1VideoSentinel ? 'video' : resolveContentType(currentSnap, rendererContext),
    [currentSnap, rendererContext, isV1VideoSentinel],
  );

  const isViewingVideo = contentType === 'video';
  const isViewingVideoV2 = isViewingVideo && isV2;
  // Currently selected video for canvas playback (v1 only)
  const currentVideo = (selectedVideoId && animations.find(a => a.id === selectedVideoId))
    || animations.find(a => a.status === 'completed' && !!a.videoUrl);

  // Design editable: current snapshot has a design with editables
  const currentDesignSnap = snapshots[currentSnapIndex];
  const isViewingDesign = contentType === 'design';
  const currentDesignEditables = currentDesignSnap?.design?.editables ?? [];
  const currentDesignProps = (currentDesignSnap?.design?.props || {}) as Record<string, unknown>;
  const editingDesignField = editingDesignFieldId
    ? currentDesignEditables.find(f => f.id === editingDesignFieldId) ?? null
    : null;

  // Unified "current display image" — poster for video, timeline image otherwise
  const currentDisplayImage = isViewingVideo
    ? (currentSnap?.image || currentSnap?.imageUrl || timeline[viewIndex] || '')
    : (timeline[viewIndex] || '');
  const hasRenderableCurrentDesign = !!((isAtDraftSlot ? draftDesign : null) || designsMap.get(viewIndex));
  const showCanvasPlaceholder = shouldShowCanvasPlaceholder({
    timeline,
    viewIndex,
    isViewingVideoV2,
    hasRenderableDesign: hasRenderableCurrentDesign,
  });
  const currentDisplayImageRef = useRef(currentDisplayImage);
  useEffect(() => { currentDisplayImageRef.current = currentDisplayImage; }, [currentDisplayImage]);

  // Clear editing state when view changes (index, mode, or design disappears)
  useEffect(() => {
    setEditingDesignFieldId(null);
  }, [viewIndex, viewMode]);

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
      setActiveDraftType(null);
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
        {
          prompt: '', image: '', projectId, tipsTeaser: true, tipsPayload,
          ...(agentModelRef.current !== 'auto' ? { agentModel: agentModelRef.current } : {}),
        },
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
        {
          prompt: '', image: '', projectId, previewsReady: true, readyTips,
          ...(agentModelRef.current !== 'auto' ? { agentModel: agentModelRef.current } : {}),
        },
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
        {
          prompt: '', image: '', projectId, nameProject: true, description,
          ...(agentModelRef.current !== 'auto' ? { agentModel: agentModelRef.current } : {}),
        },
        {
          onContent: (delta) => { name += delta; },
          onDone: () => { if (name.trim()) { onRenameProject(name.trim()); } },
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
    const src = currentDisplayImageRef.current;
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
      const vidEl = el.querySelector('video');
      const ar = (imgEl && imgEl.naturalWidth && imgEl.naturalHeight)
        ? imgEl.naturalWidth / imgEl.naturalHeight
        : (vidEl && vidEl.videoWidth && vidEl.videoHeight)
          ? vidEl.videoWidth / vidEl.videoHeight : 1;
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
    const src = currentDisplayImageRef.current;
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
        const vidEl = el.querySelector('video');
        const ar = (imgEl?.naturalWidth && imgEl?.naturalHeight)
          ? imgEl.naturalWidth / imgEl.naturalHeight
          : (vidEl?.videoWidth && vidEl?.videoHeight)
            ? vidEl.videoWidth / vidEl.videoHeight : 1;
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
        {
          prompt: '', image: imageBase64, projectId, tipReaction: true, committedTip, currentTips: siblingTips,
          ...(agentModelRef.current !== 'auto' ? { agentModel: agentModelRef.current } : {}),
        },
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

      if (res.status === 402) {
        try { const d = await res.json(); setCreditBalance(d.balance ?? 0); } catch { /* */ }
        setCreditExhausted(true);
        setCreditPopupOpen(true);
        return;
      }
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
        // Persist tips with new preview image to Storage+DB+IDB cache
        const snap = updated.find(s => s.id === snapshotId);
        if (snap) {
          onUpdateTips?.(snapshotId, snap.tips);
          if (projectId) updateCachedTips(projectId, snapshotId, snap.tips);
        }
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
      // Incremental persist: save tips to DB + IDB cache as each complete tip arrives
      setSnapshots((prev) => {
        const snap = prev.find(s => s.id === snapshotId);
        if (snap?.tips.length) {
          const tipsForDb = snap.tips.filter(t => !!t.editPrompt).map(({ previewImage, previewStatus, ...rest }) => rest) as Tip[];
          if (tipsForDb.length) {
            onUpdateTips?.(snapshotId, tipsForDb);
            if (projectId) updateCachedTips(projectId, snapshotId, tipsForDb);
          }
        }
        return prev;
      });
    }
  }, [generatePreviewForTip, onUpdateTips]);

  // Fetch tips through three parallel category calls.
  // previewMode: 'full' = all tips get preview; 'none' = no auto-previews
  // autoPreviewCategory: if set, auto-preview tips in this category (used after commit)
  const fetchTipsForSnapshot = useCallback((
    snapshotId: string,
    imageInput: string,
    previewMode: 'full' | 'none' = 'full',
    autoPreviewCategory?: string,
  ) => {
    tipsFetchCountRef.current++;
    setIsTipsFetching(true);
    setFailedCategories(new Set());
    previewDoneBaselineRef.current = 0;
    previewAbortRef.current = new AbortController();
    lastTipsRequestRef.current = { snapshotId, image: imageInput, previewMode, autoPreviewCategory };
    if (!isAgentActiveRef.current) {
      setAgentStatus(t('status.generatingTips'));
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
              skillName: activeSkillRef.current || undefined,
            }),
          });
          if (res.status === 402) {
            try { const d = await res.json(); setCreditBalance(d.balance ?? 0); } catch { /* */ }
            setCreditPopupOpen(true);
            return;
          }
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
                    if (autoPreviewCategory && t.category === autoPreviewCategory) return true;
                    if (previewMode === 'full') {
                      const autoPreview = typeof window !== 'undefined'
                        ? (localStorage.getItem('mkr_auto_tips') ?? 'auto') : 'auto';
                      return autoPreview !== 'off';
                    }
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
        tipsFetchCountRef.current--;
        if (tipsFetchCountRef.current <= 0) {
          tipsFetchCountRef.current = 0;
          setIsTipsFetching(false);
        }
        setCommittedCategory(null);
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
          if (res.status === 402) {
            try { const d = await res.json(); setCreditBalance(d.balance ?? 0); } catch { /* */ }
            setCreditPopupOpen(true);
            return;
          }
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

  const startTipsFetchForSnapshot = useCallback((
    snap: Snapshot | undefined,
    previewMode: 'full' | 'none' = 'full',
    autoPreviewCategory?: string,
  ) => {
    const image = getImageForApi(snap);
    if (!snap || !image) return false;
    if (image.startsWith('data:')) {
      compressBase64Image(image, 600_000)
        .then(img => fetchTipsForSnapshot(snap.id, img, previewMode, autoPreviewCategory))
        .catch(err => {
          console.warn('[tips] failed to prepare image for tips retry:', err);
          fetchTipsForSnapshot(snap.id, image, previewMode, autoPreviewCategory);
        });
    } else {
      fetchTipsForSnapshot(snap.id, image, previewMode, autoPreviewCategory);
    }
    return true;
  }, [fetchTipsForSnapshot]);

  // Retry all failed categories at once
  const retryAllTips = useCallback(() => {
    setFailedCategories(new Set());
    const visibleSnap = snapshotsRef.current[tipsSourceIndex]
      ?? snapshotsRef.current[snapFromTimeline(viewIndexRef.current, draftParentIndexRef.current) ?? 0];
    if (startTipsFetchForSnapshot(visibleSnap)) return;

    const req = lastTipsRequestRef.current;
    if (!req) return;
    fetchTipsForSnapshot(req.snapshotId, req.image, req.previewMode, req.autoPreviewCategory);
  }, [fetchTipsForSnapshot, startTipsFetchForSnapshot, tipsSourceIndex]);

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
            skillName: activeSkillRef.current || undefined,
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
    options?: { silent?: boolean; isVideo?: boolean },
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
      // For video analysis, pass snapshotImages so agent can find the video URL
      const snapshotImagesForAnalysis = options?.isVideo ? snapshotsRef.current.map((s) => {
        if (s.type === 'video' && s.videoMeta?.videoUrl) return s.videoMeta.videoUrl;
        if (s.imageUrl) return s.imageUrl;
        return getImageForApi(s) || '';
      }) : undefined;
      const snapIndex = options?.isVideo ? snapshotsRef.current.findIndex(s => s.id === snapshotId) : undefined;
      await streamAgent(
        {
          prompt: '', image: imageBase64, projectId, analysisOnly: true, analysisContext: context,
          isVideoAnalysis: options?.isVideo, snapshotImages: snapshotImagesForAnalysis,
          currentSnapshotIndex: snapIndex !== undefined && snapIndex >= 0 ? snapIndex : undefined,
          ...(agentModelRef.current !== 'auto' ? { agentModel: agentModelRef.current } : {}),
        },
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
  const handleAgentRequest = useCallback(async (text: string, attachedImages?: string[], overrideImage?: string, options?: { silent?: boolean; displayText?: string; displayImages?: string[]; uploadedVideoCount?: number; turnMediaCount?: number; skillLaunchContext?: SkillLaunchContext }) => {
    const userVisibleText = options?.displayText ?? stripAgentInternalContextForDisplay(text);
    // Freeze the selected LLM at submit time. Upload waits below must not let a
    // later selector change mutate an already-submitted request.
    const agentModelForRequest = agentModelRef.current;
    // CUI reference images → append as new snapshots (so agent sees them in Media Index)
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
        // Persist the whole attachment batch before the server builds Media Index.
        await Promise.all(newSnaps.map(async (snap, i) => {
          const sortOrder = baseOrder + i;
          await onSaveSnapshot?.(snap, sortOrder, (url) => {
            setSnapshots(prev => {
              const next = prev.map(s => s.id === snap.id ? { ...s, imageUrl: url } : s);
              snapshotsRef.current = next;
              return next;
            });
          });
          cacheImage(`snap:${snap.id}`, snap.image);
          onUpdateDescription?.(snap.id, snap.description!);
        }));
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
    // Fallback to last snapshot with an actual image (design/video snapshots have image='')
    // Only updates currentImage for the early-return guard — contextSnapshotIndex stays
    // faithful to viewIndex so ← YOU ARE HERE always reflects the user's actual position.
    if (!currentImage) {
      for (let i = snapshotsRef.current.length - 1; i >= 0; i--) {
        if (snapshotsRef.current[i]?.image) {
          currentImage = snapshotsRef.current[i].image;
          break;
        }
      }
    }
    if (!projectId) return;
    // Path 2 (text-only): no image is OK — Agent will generate one
    // Design snapshots have no image (rendered via Player), skip this check for them
    const currentSnap = snapIdx !== null ? snapshotsRef.current[snapIdx] : undefined;
    if (!currentImage && !currentSnap?.design && snapshotsRef.current.length > 0 && !options?.silent) return;

    // Prefer URL (tiny payload) over base64 for API calls — server handles both
    // When URL isn't available yet (upload still in progress), compress base64 to fit Vercel 4.5MB limit
    // Use 3MB limit (not 1.8MB) — agent generates images, aggressive compression destroys quality
    const snapForApi = snapIdx !== null ? snapshotsRef.current[snapIdx] : undefined;
    const rawImage = snapForApi ? getImageForApi(snapForApi) : (currentImage || '');
    const imageForApi = overrideImage
      || (rawImage.startsWith('data:') ? await compressBase64Image(rawImage, 3_000_000) : rawImage);
    // Show attached/annotated images in the user message bubble (skip for silent/system-initiated requests)
    if (!options?.silent) {
      const msgImages = options?.displayImages || (overrideImage ? [overrideImage] : (attachedImages?.length ? attachedImages : undefined));
      addMessage('user', userVisibleText, undefined, msgImages);
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

    // currentMsgId and agentMsgIds are now managed by makeAgentCallbacks factory

    // UI state flags — server-side buildPromptContext handles all project context
    const isDraftMode = snapIdx === null && draftParentIndexRef.current !== null;

    // Snapshot images for API: prefer Storage URLs (tiny payload).
    // base64 fallback only for the current image (needed for vision); others skip if no URL yet.
    // Wait briefly for image uploads to complete (up to 5s) if any snapshot lacks a URL
    const hasAllUrls = () => snapshotsRef.current.every(s => s.imageUrl || s.design);
    if (!hasAllUrls()) {
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (hasAllUrls()) break;
      }
    }
    // Build snapshot media: video snapshots use video URL, image snapshots use Storage URL/base64
    const snapshotImagesForApi = snapshotsRef.current.map((s) => {
      if (s.type === 'video' && s.videoMeta?.videoUrl) return s.videoMeta.videoUrl;
      if (s.imageUrl) return s.imageUrl;
      return getImageForApi(s) || '';
    });

    const { callbacks: agentCallbacks, setCurrentMsgId, getCurrentMsgId } = makeAgentCallbacks({
      projectId: projectId!,
      setMessages, setSnapshots, setAgentStatus, setAnimations, setPendingDesign, setDraftDesign,
      setDesignDraftParent: (idx) => {
        if (idx !== null) {
          // Design draft: clear any active tips draft (mutually exclusive)
          setActiveDraftType('design');
          setPreviewingTipIndex(null);
          setDraftParentIndex(idx);
          setViewIndex(idx + 1); // navigate to the virtual draft slot
        } else {
          // Clear design draft slot (published or dismissed)
          setActiveDraftType(null);
          setDraftParentIndex(null);
        }
      },
      setPendingNotification, setSelectedVideoId, setAnimationState,
      snapshotsRef, isNsfwRef, lastEditPromptRef, lastEditInputImagesRef,
      pendingDesignMsgIdRef, pendingDesignSnapIdRef, codeStreamRef,
      agentRunIdRef, agentTimerRef, autoFetchTriggered: autoFetchTriggered,
      pendingAnalysisRef, pendingTeaserRef, hasTriggeredNamingRef,
      draftParentIndexRef, viewIndexRef, pendingNavigateToVideoRef,
      cacheImage, fetchTipsForSnapshot, onSaveSnapshot, onUpdateDescription,
      onSaveMessage,
      triggerProjectNaming, triggerTipsTeaser, compressBase64Image,
      t, initialTitle, userPromptText: userVisibleText,
      onInsufficientCredits: (balance) => {
        setCreditBalance(balance);
        setCreditExhausted(true);
      },
      onMusicTaskCreated: (taskId) => {
        setMusicTaskId(taskId);
        musicPollingRef.current = true;
        setMusicTracks([]);
        musicMsgIdRef.current = getCurrentMsgId();
        setAgentStatus(t('status.generatingMusic'));
      },
      musicPollingRef,
      hasBackgroundTaskRef,
      captureDesignFrame: async (frame, uploadPath) => {
        const design = draftDesignRef.current || pendingDesignRef.current;
        if (!design) { console.warn('⚠️ captureDesignFrame: no active design'); return; }
        try {
          const { captureDesignFrame: capture } = await import('@/components/RemotionRenderer');
          const blob = await capture(design, frame);
          if (!blob) throw new Error('capture returned null');
          const supabase = (await import('@/lib/supabase/client')).createClient();
          const userId = (await supabase.auth.getUser()).data.user?.id;
          if (!userId) throw new Error('no user');
          // Upload to Storage
          const storagePath = `${userId}/workspace/${uploadPath}`;
          const { error } = await supabase.storage.from('images').upload(storagePath, blob, {
            contentType: 'image/jpeg', upsert: true,
          });
          if (error) throw error;
          // Get public URL + upsert workspace_files index (so server readFile can find it)
          const { data: urlData } = supabase.storage.from('images').getPublicUrl(storagePath);
          await supabase.from('workspace_files').upsert({
            user_id: userId,
            path: uploadPath,
            content_type: 'image/jpeg',
            size_bytes: blob.size,
            storage_url: urlData?.publicUrl || '',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id,path' });
          console.log(`📸 [captureDesignFrame] frame ${frame} uploaded → ${storagePath}`);
        } catch (err) {
          console.error('⚠️ captureDesignFrame failed:', err);
        }
      },
    });
    // Sync factory's currentMsgId with the already-created assistant message
    setCurrentMsgId(assistantMsgId);

    try {
      await streamAgent(
        { prompt: text, image: imageForApi, projectId, durable: true, ...(preferredModelRef.current !== 'auto' ? { preferredModel: preferredModelRef.current } : {}), ...(agentModelForRequest !== 'auto' ? { agentModel: agentModelForRequest } : {}), videoModel: videoModelRef.current, videoResolution: videoResolutionRef.current, videoAuto: videoAutoRef.current, skillLaunchContext: options?.skillLaunchContext, snapshotImages: snapshotImagesForApi, currentSnapshotIndex: contextSnapshotIndex, isNsfw: isNsfwRef.current || undefined, ...(snapshotsRef.current[contextSnapshotIndex]?.design && snapshotsRef.current[contextSnapshotIndex]?.type !== 'video' ? { currentDesign: snapshotsRef.current[contextSnapshotIndex].design, currentDesignPath: snapshotsRef.current[contextSnapshotIndex].designPath } : {}), hasAnnotation: !!overrideImage, isDraft: isDraftMode, referenceImageCount: attachedImages?.length || 0, uploadedVideoCount: options?.uploadedVideoCount || 0, turnMediaCount: options?.turnMediaCount || 0 },
        agentCallbacks,
        agentAbortRef.current.signal,
      );
    } catch (err) {
      if ((err as Error).name === 'AbortError') return; // User cancelled — handled by handleAgentAbort
      console.error('Agent request failed:', err);
    } finally {
      setIsAgentActive(false);
    }
  }, [addMessage, projectId, fetchTipsForSnapshot, onSaveSnapshot, runAutoAnalysis, triggerTipsTeaser, isDesktop, onSaveMessage, initialTitle, triggerProjectNaming]);

  // Abort the current agent request and discard its partial response
  const handleAgentAbort = useCallback(() => {
    agentAbortRef.current.abort();
    setIsAgentActive(false);
    setAgentStatus(t('editor.greeting'));
    // Remove the last empty/partial assistant message (the one being streamed)
    setMessages(prev => {
      const lastIdx = prev.length - 1;
      if (lastIdx >= 0 && prev[lastIdx].role === 'assistant') {
        return prev.slice(0, lastIdx);
      }
      return prev;
    });
    // Abort the background agent run so server stops processing
    if (agentRunIdRef.current) {
      fetch('/api/agent/abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: agentRunIdRef.current }),
      }).catch(() => {});
      agentRunIdRef.current = null;
    }
    // If reconnected via Realtime, disconnect
    agentDisconnect();
  }, [agentDisconnect]);

  // ── Reconnect to active background agent run ──
  // Mount-time detection: use standard reconnect flow (replay + realtime).
  // Live detection (CLI triggers run while page already loaded): standalone
  // project pages may reload for a clean reconnect. iOS inline project overlays
  // must never schedule a page reload because the timeout can outlive the
  // overlay and reload /projects after the user taps Back.
  const mountReconnectHandledRef = useRef(false);
  useEffect(() => {
    if (inactive) return;
    if (!activeRunId || isAgentActive) return;

    if (!mountReconnectHandledRef.current || disableAgentLiveReload) {
      // First detection after mount — use standard reconnect
      mountReconnectHandledRef.current = true;
      setIsAgentActive(true);
      setAgentStatus(t('editor.reconnecting'));

      const { callbacks: reconnectCallbacks } = makeAgentCallbacks({
        projectId: projectId ?? '',
        setMessages, setSnapshots, setAgentStatus, setAnimations, setPendingDesign, setDraftDesign,
        setDesignDraftParent: (idx) => {
          if (idx !== null) {
            setActiveDraftType('design');
            setPreviewingTipIndex(null);
            setDraftParentIndex(idx);
            setViewIndex(idx + 1);
          } else {
            setActiveDraftType(null);
            setDraftParentIndex(null);
          }
        },
        setPendingNotification, setSelectedVideoId, setAnimationState,
        snapshotsRef, isNsfwRef, lastEditPromptRef, lastEditInputImagesRef,
        pendingDesignMsgIdRef, pendingDesignSnapIdRef, codeStreamRef,
        agentRunIdRef, agentTimerRef, autoFetchTriggered: autoFetchTriggered,
        pendingAnalysisRef, pendingTeaserRef, hasTriggeredNamingRef,
        draftParentIndexRef, viewIndexRef, pendingNavigateToVideoRef,
        cacheImage, fetchTipsForSnapshot, onSaveSnapshot, onUpdateDescription,
        onSaveMessage,
        triggerProjectNaming, triggerTipsTeaser, compressBase64Image,
        t,
        onInsufficientCredits: (balance) => { setCreditBalance(balance); setCreditExhausted(true); },
        onCleanup: () => { setIsAgentActive(false); agentDisconnect(); },
        hasBackgroundTaskRef,
      });

      agentReconnect(reconnectCallbacks);
      return () => { agentDisconnect(); };
    }

    // Live detection — reload page for clean reconnect
    // Delay slightly to ensure DualWriter has flushed user message to DB
    const reloadTimer = window.setTimeout(() => window.location.reload(), 1500);
    return () => window.clearTimeout(reloadTimer);

  }, [activeRunId, disableAgentLiveReload, inactive]);

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
  const handleCuiSend = async (text: string, imgs?: string[], videos?: { url: string; duration: number; width: number; height: number; poster: string }[]) => {
    if (gateInteraction()) return;
    setCuiDraftText('');
    setCuiDraftAttachments([]);
    if (annotationMode && annotationEntries.length > 0) {
      await sendWithAnnotations(text);
      return;
    }

    // Step 1: Create video snapshots (use snapshotsRef for accurate current length)
    if (videos?.length) {
      const { createVideoDesign } = await import('@/lib/video-design');
      const newVideoSnaps: Snapshot[] = [];
      for (const v of videos) {
        const snapId = generateId();
        const design = createVideoDesign(v.url, v.width, v.height, v.duration);
        newVideoSnaps.push({
          id: snapId,
          image: v.poster,
          tips: [],
          messageId: '',
          imageUrl: v.poster,
          type: 'video',
          design,
          designPath: `code/${snapId}.json`,
          videoMeta: {
            origin: 'source-upload',
            taskId: null, videoUrl: v.url, prompt: '', sourceSnapshotIds: [], sourceUrls: [],
            status: 'completed', duration: v.duration, model: 'upload', createdAt: new Date().toISOString(),
          },
        });
      }
      // Add all video snapshots at once + navigate to last one
      setSnapshots(prev => {
        const next = [...prev, ...newVideoSnaps];
        snapshotsRef.current = next;
        return next;
      });
      // Navigate to the last video snapshot so VideoResultCard shows
      pendingNavigateToVideoRef.current = true;
      // Persist each with correct sort_order + update imageUrl when upload completes
      await Promise.all(newVideoSnaps.map(async (snap, i) => {
        await onSaveSnapshot?.(snap, snapshotsRef.current.length - newVideoSnaps.length + i, (url) => {
          setSnapshots(prev => {
            const next = prev.map(s => s.id === snap.id ? { ...s, imageUrl: url } : s);
            snapshotsRef.current = next;
            return next;
          });
        });
      }));
    }

    // Step 2: Pass images + video posters for user message display
    const displayAttachments = [
      ...(imgs || []),
      ...(videos?.map(v => v.poster) || []),
    ];

    // Step 3: Only create reference snapshots from actual images (not video posters)
    // displayAttachments shown in user message bubble (includes video posters for visual)
    await handleAgentRequest(text, imgs?.length ? imgs : undefined, undefined, {
      displayImages: displayAttachments.length > 0 ? displayAttachments : undefined,
      uploadedVideoCount: videos?.length,
      turnMediaCount: (imgs?.length || 0) + (videos?.length || 0),
    });
  };

  // Legacy story-script path kept as a source-level guardrail for media-index
  // wording. Current video creation flows route through AnimateSheet/Agent tools.
  const animPromptInFlightRef = useRef(false);
  const normalizeLegacyCompositionDescription = useCallback((description: string | undefined, fallback: string) => {
    if (!description) return fallback;
    const trimmed = description.trim();
    if (trimmed === '[design]' || trimmed === '[design/video]') return fallback;
    if (trimmed === 'still design') return 'still composition';
    return description;
  }, []);

  const _generateAnimationPrompt = useCallback(async (overrideImageUrls?: string[]) => {
    const imageUrls = overrideImageUrls || animationStateRef.current?.imageUrls;
    if (!projectId || !imageUrls?.length) return;
    if (isAgentActiveRef.current || animPromptInFlightRef.current) return;
    animPromptInFlightRef.current = true;

    const n = imageUrls.length;
    const userHint = animationStateRef.current?.userHint?.trim() || '';
    const langInstr = `Write the script in ${getPromptLanguage(locale)}.`;
    const hintLine = userHint ? `\nUser requirements: ${userHint}` : '';

    // Build Media Index with descriptions so Agent can pick items intelligently
    const mediaIndex = snapshotsRef.current.map((s, i) => {
      const isVid = s.type === 'video';
      const isComposition = !!s.design && !isVid;
      const videoSpec = isVid ? formatVideoMediaSpec(s.videoMeta) : '';
      const typeLabel = isVid ? (videoSpec ? `video, ${videoSpec}` : 'video') : isComposition ? 'composition' : 'image';
      const desc = isVid
        ? (s.description || s.videoMeta?.prompt?.split('\n')[0]?.slice(0, 60) || '[video]')
        : isComposition
          ? normalizeLegacyCompositionDescription(s.description, '[composition]')
          : i === 0
            ? (s.description || 'Original upload')
            : (s.description || '(no description)');
      return `<<<media_${i + 1}>>> [${typeLabel}] — ${desc}`;
    }).join('\n');

    const prompt = `[视频动画模式] Create a video story script from the following ${n} items. ${langInstr}${hintLine}

[Media Index — ${n} items]
${mediaIndex}

Select the best 3-7 items for a compelling video. You do NOT need to use all or follow their order — pick the ones that create the strongest narrative arc. Output only the script, no confirmation needed.`;

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
          // Pass URLs directly so the Agent provider can fetch them server-side.
          animationImages: imageUrls,
          ...(agentModelRef.current !== 'auto' ? { agentModel: agentModelRef.current } : {}),
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
  }, [projectId, onSaveMessage, locale, t, normalizeLegacyCompositionDescription]);

  // Commit draft: finalize the virtual draft as a real snapshot
  const commitDraft = useCallback(() => {
    if (gateInteraction()) return;
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
    setActiveDraftType(null);
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
    if (gateInteraction()) return;
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

    // Clear any active design draft (tips draft and design draft are mutually exclusive)
    if (activeDraftType === 'design') {
      setDraftDesign(null);
      setDraftDesignPoster('');
    }
    setActiveDraftType('tips');

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
  }, [activeDraftType, draftParentIndex, viewIndex, snapshots, previewingTipIndex, generatePreviewForTip]);

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
  // Must match timeline precedence: prefer base64 from IndexedDB (instant) over URL (network fetch)
  const previousImage = useMemo(() => getPreviousImageForCompare({
    snapshots,
    viewIndex,
    draftParentIndex,
    isViewingDraft,
  }), [isViewingDraft, draftParentIndex, snapshots, viewIndex]);

  // Dismiss draft: remove virtual draft entry, return to parent
  const dismissDraft = useCallback(() => {
    // Restore viewIndex to the parent's timeline index before clearing draft,
    // so the auto-clamp doesn't fall back to the last snapshot instead.
    // While draft exists, draftParentIndex === its timeline index (no earlier draft slot).
    if (draftParentIndex !== null) setViewIndex(draftParentIndex);
    setActiveDraftType(null);
    setDraftParentIndex(null);
    setPreviewingTipIndex(null);
    setDraftDesign(null);
    setDraftDesignPoster('');
  }, [draftParentIndex]);

  // Navigate timeline: keep draft alive so user can swipe back
  const handleIndexChange = useCallback((index: number) => {
    setViewIndex(index);
  }, []);

  const compressAndUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/') && !isHeicFile(file)) return;

    previewAbortRef.current.abort();
    setActiveDraftType(null);
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

      // Await metadata (exifr local parse ~10-50ms, fast enough to not block UX)
      const metadata = await metadataPromise;

      // Start tips generation with metadata available on snapshot
      const newSnapshot: Snapshot = { id: snapId, image: base64, tips: [], messageId: '', metadata };
      setSnapshots([newSnapshot]);
      snapshotsRef.current = [newSnapshot];
      const tipsImage = await compressBase64Image(base64, 600_000);
      fetchTipsForSnapshot(snapId, tipsImage, 'full');

      const finalSnapshot = newSnapshot;
      setSnapshots([finalSnapshot]);
      snapshotsRef.current = [finalSnapshot];
      onSaveSnapshot?.(finalSnapshot, 0, (url) => {
        setSnapshots(prev => prev.map(s => s.id === snapId ? { ...s, imageUrl: url } : s));
      });
      cacheImage(`snap:${snapId}`, base64);
      // Auto-analyze the uploaded photo
      runAutoAnalysis(snapId, base64);

      // Async: enrich metadata with location (non-blocking)
      if (metadata?.raw?.lat !== undefined && metadata?.raw?.lng !== undefined && !metadata.location) {
        enrichMetadataLocation(metadata).then(enriched => {
          if (enriched.location) {
            setSnapshots(prev => prev.map(s => s.id === snapId ? { ...s, metadata: enriched } : s));
            snapshotsRef.current = snapshotsRef.current.map(s => s.id === snapId ? { ...s, metadata: enriched } : s);
          }
        });
      }
    } catch (err) {
      console.error('Image upload error:', err);
      URL.revokeObjectURL(previewUrl);
    }
  }, [fetchTipsForSnapshot, onSaveSnapshot, runAutoAnalysis]);

  // Video upload: transcode → upload → create video snapshot. Returns 1-based image index.
  const handleVideoUpload = useCallback(async (file: File): Promise<number | null> => {
    const { processVideoUpload } = await import('@/lib/video-upload');
    const { createVideoDesign } = await import('@/lib/video-design');
    const snapId = generateId();

    try {
      // Add processing snapshot to timeline immediately (poster captured by ImageCanvas onLoadedData)
      const processingSnap: Snapshot = {
        id: snapId,
        image: '',
        tips: [],
        messageId: '',
        type: 'video',
        videoMeta: {
          origin: 'source-upload',
          taskId: null,
          videoUrl: null,
          prompt: '',
          sourceSnapshotIds: [],
          sourceUrls: [],
          status: 'processing',
          duration: null,
          model: 'upload',
          createdAt: new Date().toISOString(),
        },
      };
      setSnapshots(prev => {
        const next = [...prev, processingSnap];
        snapshotsRef.current = next;
        return next;
      });
      // Navigate to new video snapshot
      viewIndexRef.current = snapshots.length;
      requestAnimationFrame(() => setViewIndex(snapshots.length));

      // Step 3: Transcode + upload
      const result = await processVideoUpload(file, (progress) => {
        setAgentStatus(t('status.videoTranscoding', Math.round(progress * 100)));
      });

      // Step 4: Upload to Supabase
      setAgentStatus(t('status.uploadingVideo'));
      const supabase = (await import('@/lib/supabase/client')).createClient();
      const uid = (await supabase.auth.getUser()).data.user?.id;
      if (!uid) throw new Error('Not authenticated');
      const storagePath = `${uid}/${projectId}/videos/upload-${snapId}.mp4`;
      const { error: uploadError } = await supabase.storage.from('images')
        .upload(storagePath, result.videoBlob, { contentType: 'video/mp4', upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('images').getPublicUrl(storagePath);
      const videoUrl = urlData?.publicUrl || '';

      // Step 5: Generate Remotion wrapper design
      const design = createVideoDesign(videoUrl, result.width, result.height, result.duration);

      // Step 6: Update snapshot with completed state (poster will be captured by ImageCanvas)
      const completedSnap: Snapshot = {
        ...processingSnap,
        image: '',
        design,
        designPath: `code/${snapId}.json`,
        videoMeta: {
          ...processingSnap.videoMeta!,
          status: 'completed',
          videoUrl,
          duration: result.duration,
        },
      };
      setSnapshots(prev => {
        const next = prev.map(s => s.id === snapId ? completedSnap : s);
        snapshotsRef.current = next;
        return next;
      });
      onSaveSnapshot?.(completedSnap, snapshots.length, (uploadedUrl) => {
        setSnapshots(prev => {
          const next = prev.map(s => s.id === snapId ? { ...s, imageUrl: uploadedUrl } : s);
          snapshotsRef.current = next;
          return next;
        });
      });

      // Auto-analyze video content through the normal tool-aware agent flow so
      // analyze_video's result is persisted in agent_tool_history for reuse.
      const mediaIndex = snapshots.length + 1;
      const videoAnalysisPrompt = `[System] User uploaded a video at <<<media_${mediaIndex}>>>. First call analyze_video with media_index ${mediaIndex}. Then summarize the duration, key subjects/actions, and mood in 2-3 conversational sentences.`;
      handleAgentRequest(videoAnalysisPrompt, undefined, undefined, { silent: true, uploadedVideoCount: 1 });

      // Return 1-based index (snapshot was appended at snapshots.length)
      return snapshots.length + 1;

    } catch (err) {
      console.error('Video upload error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      const tooLongMatch = msg.match(/Video too long \((\d+(?:\.\d+)?)s\)/);
      if (tooLongMatch) {
        alert(t('video.tooLong').replace('{duration}', tooLongMatch[1]).replace('{max}', msg.match(/Maximum (\d+)s/)?.[1] || '15'));
        setAgentStatus(t('editor.greeting'));
        setSnapshots(prev => prev.filter(s => s.id !== snapId));
        return null;
      }
      setAgentStatus(t('status.videoUploadFailed', msg));
      setSnapshots(prev => prev.map(s =>
        s.id === snapId ? { ...s, videoMeta: { ...s.videoMeta!, status: 'failed' as const } } : s
      ));
      return null;
    }
  }, [snapshots.length, projectId, onSaveSnapshot, handleAgentRequest, t]);

  // Auto-trigger upload when a pending image is passed (new project from projects page)
  // Lock body scroll while editor is mounted to prevent iOS back-navigation jump
  useEffect(() => {
    if (disableBodyScrollLock) return;
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
  }, [disableBodyScrollLock]);

  const initHandled = useRef(false);

  // Unified init: handles all entry scenarios (images, text, images+text, with/without skill)
  useEffect(() => {
    const hasImages = pendingImages && pendingImages.length > 0;
    const hasVideos = pendingVideos && pendingVideos.length > 0;
    const hasPrompt = !!pendingPrompt;
    if (!hasImages && !hasVideos && !hasPrompt) return;
    if (initHandled.current) return;
    initHandled.current = true;

    const init = async () => {
      const isMulti = hasImages && pendingImages!.length > 1;

      // ── Step 1: Work snapshots (images + videos) ──
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
      if (hasVideos) {
        const { VIDEO_PLACEHOLDER_IMAGE } = await import('@/lib/editor/timeline-derivations');
        for (const v of pendingVideos!) {
          const { createVideoDesign } = await import('@/lib/video-design');
          const design = createVideoDesign(v.videoUrl, v.width, v.height, v.duration);
          const snapId = generateId();
          workSnapshots.push({
            id: snapId,
            image: VIDEO_PLACEHOLDER_IMAGE,
            tips: [],
            messageId: '',
            type: 'video',
            design,
            designPath: `code/${snapId}.json`,
            videoMeta: {
              origin: 'source-upload',
              taskId: null, videoUrl: v.videoUrl, prompt: '', sourceSnapshotIds: [], sourceUrls: [],
              status: 'completed', duration: v.duration, model: 'upload', createdAt: new Date().toISOString(),
            },
          });
        }
      }

      // ── Step 2: Commit to state ──
      if (workSnapshots.length > 0) {
        setSnapshots(workSnapshots);
        snapshotsRef.current = workSnapshots;
        prevTimelineLen.current = workSnapshots.length;
        setViewIndex(0);
      }

      // ── Step 3: Persist + cache + log events ──
      await Promise.all(workSnapshots.map(async (snap, i) => {
        await onSaveSnapshot?.(snap, i, (url) => {
          setSnapshots(prev => {
            const next = prev.map(s => s.id === snap.id ? { ...s, imageUrl: url } : s);
            snapshotsRef.current = next;
            return next;
          });
        });
        cacheImage(`snap:${snap.id}`, snap.image);
      }));

      // ── Step 5: Tips (if images exist) ──
      if (hasImages) {
        const tipsImage = (img: string) =>
          img.startsWith('http') ? Promise.resolve(img) : compressBase64Image(img, 600_000);
        if (hasPrompt) {
          // Images + prompt: tips for first image only (no auto-preview — user is in CUI)
          tipsImage(workSnapshots[0].image).then(img => fetchTipsForSnapshot(workSnapshots[0].id, img, 'none'));
        } else if (isMulti) {
          // Multi-image: tips for all, no preview
          for (const snap of workSnapshots) {
            if (snap.type === 'video') continue;
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
              `[System] User uploaded ${workSnapshots.length} images. All images have been analyzed (see Media Index descriptions). Briefly greet the user and mention what you see in each image in 1 sentence each.`,
              undefined, undefined, { silent: true }
            );
          });
        } else {
          // Single image: non-silent analysis (shows in CUI)
          runAutoAnalysis(workSnapshots[0].id, workSnapshots[0].image, 'initial');
        }
      }

      // ── Step 6b: Video analysis (if videos, no prompt) ──
      if (hasVideos && !hasPrompt) {
        const count = pendingVideos!.length;
        const firstVideoIndex = Math.max(1, workSnapshots.length - count + 1);
        const lastVideoIndex = workSnapshots.length;
        const videoRange = count === 1
          ? `<<<media_${firstVideoIndex}>>>`
          : `<<<media_${firstVideoIndex}>>> to <<<media_${lastVideoIndex}>>>`;
        const videoAnalysisPrompt = `[System] User uploaded ${count === 1 ? 'a video' : `${count} videos`} at ${videoRange}. First call analyze_video for each uploaded video media_index. Then summarize the duration, key subjects/actions, and mood in 2-3 conversational sentences.`;
        handleAgentRequest(videoAnalysisPrompt, undefined, undefined, { silent: true, uploadedVideoCount: count });
      }

      // ── Step 7: Agent request (if prompt) ──
      if (hasPrompt) {
        const skillPrefix = pendingSkill && !pendingSkillLaunchContext ? `[Active skill: ${pendingSkill}]\n` : '';
        if (!isDesktop) setViewMode('cui');
        await handleAgentRequest(skillPrefix + pendingPrompt!, undefined, undefined, {
          displayText: pendingPrompt!,
          uploadedVideoCount: pendingVideos?.length || 0,
          turnMediaCount: workSnapshots.length,
          skillLaunchContext: pendingSkillLaunchContext,
        });
      }

      // ── Step 8: CUI mode ──
      if (isMulti && !isDesktop) {
        setViewMode('cui');
      }
    };

    init();
  }, [pendingImages, pendingMetadata, pendingPrompt, pendingSkill, pendingSkillLaunchContext, fetchTipsForSnapshot, onSaveSnapshot, runAutoAnalysis, handleAgentRequest, isDesktop]);

  // Existing project/current timeline item with no tips — auto-fetch once per snapshot.
  // Do not mark a snapshot attempted until it has a usable image; cached projects can
  // briefly hydrate snapshot metadata before image/imageUrl is available.
  const autoFetchTriggered = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (inactive) return;
    if (pendingImages?.length || isTipsFetching) return;
    const snap = snapshots[tipsSourceIndex];
    if (!snap || snap.tips.length > 0) return;
    if (snap.type === 'video') return;
    // Animated design snapshots don't need tips (still designs do)
    if (snap.design?.animation) return;
    if (autoFetchTriggered.current.has(snap.id)) return;
    const image = getImageForApi(snap);
    if (!image) return;
    autoFetchTriggered.current.add(snap.id);
    startTipsFetchForSnapshot(snap);
  }, [snapshots, tipsSourceIndex, pendingImages, isTipsFetching, inactive, startTipsFetchForSnapshot]);

  // Pick up late-arriving initialAnimations (from Supabase fetch after cache-init)
  // Pick up late-arriving initialMusicTaskId (from Supabase fetch after cache-init)
  const musicInitRef = useRef(!!initialMusicTaskId);
  useEffect(() => {
    if (musicInitRef.current || !initialMusicTaskId) return;
    musicInitRef.current = true;
    setMusicTaskId(initialMusicTaskId);
    musicPollingRef.current = true;
  }, [initialMusicTaskId]);

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

  }, [isViewingVideo]);

  // Poll all processing animations (v1 only — v2 uses snapshot polling above)
  useEffect(() => {
    if (inactive) return;
    if (isV2) return;
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
  }, [animations, inactive]);

  // v2: Poll video snapshots with status=processing
  useEffect(() => {
    if (inactive) return;
    if (!isV2) return;
    const processing = snapshots.filter(s => s.type === 'video' && s.videoMeta?.status === 'processing' && s.videoMeta.taskId);
    if (processing.length === 0) return;
    const interval = setInterval(async () => {
      for (const snap of processing) {
        try {
          const res = await fetch(`/api/video-snapshot/${snap.id}`);
          const data = await res.json();
          if (data.status === 'completed' && data.videoUrl) {
            const { createVideoDesign, probeVideoDimensions } = await import('@/lib/video-design');
            const dims = await probeVideoDimensions(data.videoUrl);
            const design = createVideoDesign(data.videoUrl, dims.width, dims.height, dims.duration);
            setSnapshots(prev => prev.map(s =>
              s.id === snap.id ? {
                ...s,
                image: data.imageUrl || s.image,
                imageUrl: data.imageUrl || s.imageUrl,
                videoMeta: { ...s.videoMeta!, status: 'completed' as const, videoUrl: data.videoUrl },
                design,
                designPath: `code/${snap.id}.json`,
              } : s
            ));
            // Reset animationState if this was the task being polled
            setAnimationState(prev => prev?.taskId === snap.videoMeta?.taskId
              ? { ...prev!, status: 'done' as const, videoUrl: data.videoUrl }
              : prev
            );
            // Add CUI message for completed video (dedup against latest state)
            const actionLines = serializeCompletionActions(snap.videoMeta?.completionActions);
            const videoMsg: Message = {
              id: generateId(),
              role: 'assistant',
              content: `🎬 ${t('status.videoDone')}\n${data.videoUrl}\nsnap:${snap.id}${actionLines ? `\n${actionLines}` : ''}`,
              timestamp: Date.now(),
            };
            setMessages(prev => {
              if (prev.some(m => m.content?.includes(data.videoUrl) || m.content?.includes(`snap:${snap.id}`))) return prev;
              onSaveMessage?.(videoMsg);
              return [...prev, videoMsg];
            });
          } else if (data.status === 'failed') {
            const actionLines = serializeCompletionActions(data.completionActions);
            const reason = data.error ? `\n${data.error}` : '';
            const failMsg: Message = {
              id: generateId(),
              role: 'assistant',
              content: `⚠️ ${t('status.videoFailed')}${reason}\nsnap:${snap.id}${actionLines ? `\n${actionLines}` : ''}`,
              timestamp: Date.now(),
            };
            setSnapshots(prev => prev.map(s =>
              s.id === snap.id ? { ...s, videoMeta: { ...s.videoMeta!, status: 'failed' as const, error: data.error || undefined } } : s
            ));
            setMessages(prev => {
              if (prev.some(m => m.content?.includes(`snap:${snap.id}`) && m.content?.includes(t('status.videoFailed')))) return prev;
              onSaveMessage?.(failMsg);
              return [...prev, failMsg];
            });
          }
        } catch { /* ignore */ }
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [snapshots, isV2, inactive]);


  // Preload adjacent snapshots (not yet in DOM) so swipe transitions are instant
  useEffect(() => {
    if (inactive) return;
    for (const offset of [-1, 1]) {
      const src = timeline[viewIndex + offset];
      if (src && src.startsWith('http')) {
        const img = new Image();
        img.src = src;
      }
    }
  }, [viewIndex, timeline, inactive]);

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
      setAgentStatus(prev => isPreviewGenerationStatus(prev) ? t('editor.greeting') : prev);
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

  // ── Music polling: poll Suno status when musicTaskId is set ──
  useEffect(() => {
    if (inactive) return;
    if (!musicTaskId) return;
    console.log(`🎵 [music] polling started for ${musicTaskId}`);
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/music/${musicTaskId}?projectId=${projectId}`);
        const data = await res.json();
        if (stopped) return;
        if ((data.status === 'streaming' || data.status === 'completed') && data.tracks?.length) {
          setMusicTracks(data.tracks);
          // Format: music:trackIndex|title|duration|tags|playUrl|finalUrl
          const musicLines = data.tracks.map((tk: { title: string; duration: number; tags: string; audioUrl: string; streamAudioUrl?: string; trackIndex: number }) => {
            const playUrl = tk.streamAudioUrl || tk.audioUrl;
            const finalUrl = tk.audioUrl || '';
            return `music:${tk.trackIndex}|${tk.title}|${Math.round(tk.duration)}|${tk.tags}|${playUrl}|${finalUrl}`;
          }).join('\n');
          const msgId = `music-${musicTaskId}`;
          const statusText = data.status === 'streaming' ? t('status.musicStreaming') : t('status.musicReady');
          const fullContent = `🎵 ${statusText}\n${musicLines}`;
          setMessages(prev => {
            if (prev.some(m => m.id === msgId)) {
              const updated = prev.map(m => m.id === msgId ? { ...m, content: fullContent } : m);
              const msg = updated.find(m => m.id === msgId);
              if (msg && data.status === 'completed') onSaveMessage?.(msg);
              return updated;
            }
            const musicMsg: Message = { id: msgId, role: 'assistant', content: fullContent, timestamp: Date.now() };
            if (data.status === 'completed') onSaveMessage?.(musicMsg);
            return [...prev, musicMsg];
          });
          if (data.status === 'streaming') {
            setAgentStatus(t('status.musicStreaming'));
          }
          // Stop polling only when completed with 2 tracks
          if (data.status === 'completed' && data.tracks.length >= 2) {
            // Replace stream/temp URLs with permanent Supabase URLs in all design code
            const supabase = createBrowserSupabase();
            setSnapshots(prev => {
              prev.forEach(snap => {
                if (!snap.design?.code) return;
                resolveAudioUrlsInCode(snap.design.code, projectId!, supabase).then(({ code, changed }) => {
                  if (!changed) return;
                  setSnapshots(p => p.map(s => s.id !== snap.id ? s : { ...s, design: { ...s.design!, code } }));
                  onSaveDesignProps?.(snap.id, { ...snap.design!, code });
                });
              });
              return prev;
            });
            setMusicTaskId(null);
            musicPollingRef.current = false;
            setAgentStatus(t('status.musicReady'));
            setTimeout(() => setAgentStatus(t('editor.greeting')), 3000);
          }
        } else if (data.status === 'failed') {
          console.warn('🎵 [music] failed:', data.error);
          setMusicTaskId(null);
          musicPollingRef.current = false;
          setAgentStatus(t('status.musicFailed'));
          setTimeout(() => setAgentStatus(t('editor.greeting')), 3000);
        }
      } catch (e) {
        console.warn('🎵 [music] poll error:', e);
      }
    };
    poll();
    const interval = setInterval(poll, 2_000);
    return () => { stopped = true; clearInterval(interval); };
  }, [musicTaskId, projectId, t, inactive]);


  // When animationState transitions — handle creation flow lifecycle
  const prevAnimStatusRef = useRef(animationState?.status);
  useEffect(() => {
    const prev = prevAnimStatusRef.current;
    const curr = animationState?.status;
    prevAnimStatusRef.current = curr;
    // Submitting → polling: add a processing entry to animations array
    if (prev === 'submitting' && curr === 'polling' && animationState?.taskId) {
      const newAnim: ProjectAnimation = {
        id: animationState.snapshotId || animationState.taskId,
        projectId: projectId ?? '',
        taskId: animationState.taskId,
        videoUrl: null,
        prompt: animationState.prompt,
        snapshotUrls: animationState.imageUrls,
        status: 'processing',
        createdAt: new Date().toISOString(),
        duration: animationState.duration ?? null,
        videoModel: animationState.videoModel,
        videoResolution: animationState.videoResolution,
      };
      setAnimations(prev => [newAnim, ...prev]);
      // v2: add video snapshot to snapshots array for polling
      if (isV2 && animationState.snapshotId) {
        const newSnap: Snapshot = {
          id: animationState.snapshotId,
          image: VIDEO_PLACEHOLDER_IMAGE,
          tips: [],
          messageId: '',
          type: 'video',
          videoMeta: {
            taskId: animationState.taskId,
            videoUrl: null,
            prompt: animationState.prompt,
            sourceSnapshotIds: [],
            sourceUrls: animationState.imageUrls.filter(u => u?.startsWith('http')),
            status: 'processing',
            duration: animationState.duration,
            model: animationState.videoModel,
            resolution: animationState.videoResolution,
            createdAt: new Date().toISOString(),
          },
        };
        setSnapshots(prev => appendSnapshotDedupeVideo(prev, newSnap));
      }
      // Close the creation card

      setAnimationState(null);
      setSelectedVideoId(animationState.snapshotId || animationState.taskId);
      // Navigate to video entry on next render (timeline hasn't updated yet)
      pendingNavigateToVideoRef.current = true;
    }
  }, [animationState?.status, animationState?.taskId, animationState?.prompt, animationState?.imageUrls, projectId]);

  // Navigate to video entry after submitting animation (deferred to next render when timeline is updated)
  // v1: navigate to sentinel (videoTimelineIndex). v2: navigate to last snapshot (the new video).
  useEffect(() => {
    if (!pendingNavigateToVideoRef.current) return;
    if (isV2) {
      const lastVideoIdx = snapshots.reduce((acc, s, i) => s.type === 'video' ? i : acc, -1);
      if (lastVideoIdx >= 0) {
        pendingNavigateToVideoRef.current = false;
        setViewIndex(lastVideoIdx);
      }
    } else if (videoTimelineIndex >= 0) {
      pendingNavigateToVideoRef.current = false;
      setViewIndex(videoTimelineIndex);
    }

  }, [animations.length, snapshots.length]);

  // Watch for animations completing — send CUI notification + StatusBar update (v1 only)
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
        setPendingNotification({ text: t('status.videoDone'), targetIndex: videoTimelineIndex });
        // v2 handles CUI messages in snapshot poll — skip here to avoid duplicates
        if (!isV2) {
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
    }
  }, [animations, messages, onSaveMessage, isV2]);

  // Update StatusBar with video rendering progress
  const processingVideoSnap = snapshots.find(s => s.type === 'video' && s.videoMeta?.status === 'processing');
  const processingVideoModel = processingVideoSnap?.videoMeta?.model
    ?? animations.find(a => a.status === 'processing')?.videoModel
    ?? animationState?.videoModel
    ?? null;
  const videoProcessing = snapshots.some(s => s.type === 'video' && s.videoMeta?.status === 'processing');
  const videoRenderingStatus = isRemotionExportTaskId(processingVideoSnap?.videoMeta?.taskId)
    ? t('status.remotionExportRendering')
    : (isFastVideoRenderModel(processingVideoModel)
      ? t('status.videoRenderingFast')
      : t('status.videoRenderingEllipsis'));
  useEffect(() => {
    if (animationState?.status === 'generating_prompt') {
      setAgentStatus(t('status.writingScript'));
    } else if (animationState?.status === 'submitting') {
      setAgentStatus(t('status.submittingVideo'));
    } else if (animationState?.status === 'done') {
      setAgentStatus(t('status.videoDone'));
    } else if (animationState?.status === 'polling' || videoProcessing) {
      if (!isAgentActive && !musicTaskId) {
        setAgentStatus(videoRenderingStatus);
      }
    } else if (!isAgentActive && !musicTaskId) {
      setAgentStatus(t('editor.greeting'));
    }
  }, [animationState?.status, videoProcessing, isAgentActive, musicTaskId, t, videoRenderingStatus]);

  // Update StatusBar with music generation progress (same pattern as video)
  useEffect(() => {
    if (musicTaskId && !isAgentActive) {
      setAgentStatus(t('status.generatingMusic'));
    }
  }, [musicTaskId, isAgentActive, t]);

  const showSaveToast = useCallback(() => {
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 2000);
  }, []);

  const handleDownload = useCallback(async () => {
    await downloadAsset({
      timeline,
      viewIndex,
      isViewingVideo,
      currentVideoUrl: currentSnap?.videoMeta?.videoUrl || currentVideo?.videoUrl,
      draftParentIndex: draftParentIndexRef.current,
      snapshotsRef,
      pendingVideoRef,
      setIsSaving,
      setAgentStatus,
      showSaveToast,
      t,
      projectTitle: initialTitle,
    });
  }, [timeline, viewIndex, isViewingVideo, currentSnap?.videoMeta?.videoUrl, currentVideo?.videoUrl, showSaveToast, t, initialTitle]);

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
        const vidEl = canvasAreaRef.current?.querySelector('video');
        const ar = (imgEl?.naturalWidth && imgEl?.naturalHeight)
          ? imgEl.naturalWidth / imgEl.naturalHeight
          : (vidEl?.videoWidth && vidEl?.videoHeight)
            ? vidEl.videoWidth / vidEl.videoHeight : lastImageAR.current;
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

  // Agent elapsed timer — DOM updates every 1s keep iOS Safari from dropping SSE
  useEffect(() => {
    if (inactive) {
      agentTimerRef.current = null;
      return;
    }
    if (!isAgentActive) {
      agentTimerRef.current = null;
      return;
    }
    if (!agentTimerRef.current) {
      agentTimerRef.current = { startTime: Date.now(), phase: t('editor.agentThinking') };
    }
    const timer = setInterval(() => {
      const ref = agentTimerRef.current;
      if (!ref) return;
      const elapsed = Math.round((Date.now() - ref.startTime) / 1000);
      setAgentStatus(`${ref.phase} (${elapsed}s)`);
    }, 1000);
    return () => clearInterval(timer);
  }, [isAgentActive, t, inactive]);

  // CUI: tap inline video → first click shows in GUI, second click plays
  // Design poster captured from CUI's visible Player — update snapshot + message
  // Music select: insert immediately with whatever URL is available (stream or permanent)
  // completed polling will replace stream URLs with permanent URLs in design code later
  const handleMusicSelect = useCallback((track: { audioUrl: string; duration: number; title: string; tags: string }) => {
    if (!projectId) { console.warn('🎵 [music] no projectId'); return; }
    if (isAgentActive) { console.warn('🎵 [music] agent busy, skipping'); return; }
    console.log(`🎵 [music] user selected: ${track.title}`);
    addMessage('user', `🎵 ${track.title}`);
    // Mark selected in DB (fire-and-forget)
    fetch('/api/music/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioUrl: track.audioUrl, projectId }),
    }).catch(() => {});
    const audioUrl = track.audioUrl;
    const agentPrompt = `User selected background music: "${track.title}" (${Math.round(track.duration)}s). Audio URL: ${audioUrl}\nAdd <Audio src="${audioUrl}" volume={0.3} /> to the current Remotion composition via run_code patch with runtime: "composition". If no active composition, read the latest composition code from workspace first.`;
    handleAgentRequest(agentPrompt, undefined, undefined, { silent: true }).catch(e => console.warn('Music inject failed:', e));
  }, [projectId, isAgentActive, addMessage, handleAgentRequest]);

  const handleArtifactAction = useCallback((action: EditorCompletionAction) => {
    if (!projectId) { console.warn('artifact action skipped: no projectId'); return; }
    if (isAgentActive) { console.warn('artifact action skipped: agent busy'); return; }
    if (!action.prompt) return;
    console.log(`▶️ [artifact-action] ${action.label}`);
    addMessage('user', action.label);
    handleAgentRequest(action.prompt, undefined, undefined, { silent: true })
      .catch(e => console.warn('Artifact action failed:', e));
  }, [projectId, isAgentActive, addMessage, handleAgentRequest]);

  const handleVideoFrameEdit = useCallback((anim: ProjectAnimation, time: number) => {
    if (gateInteraction()) return;
    if (!projectId) { console.warn('video frame edit skipped: no projectId'); return; }
    if (isAgentActive) { console.warn('video frame edit skipped: agent busy'); return; }

    const duration = videoGuiDuration || anim.duration || 0;
    const safeTime = Math.max(0, Math.min(Number.isFinite(duration) && duration > 0 ? duration : time, Number.isFinite(time) ? time : 0));
    const snapIndex = snapshotsRef.current.findIndex(s => s.id === anim.id);
    const mediaIndex = snapIndex >= 0 ? snapIndex + 1 : Math.max(1, viewIndexRef.current + 1);
    const timeLabel = formatFrameEditTime(safeTime);
    const prompt = t('video.frameEditDraftPrompt', mediaIndex, timeLabel);

    pendingFrameEditRef.current = { anim, time: safeTime, mediaIndex, prompt };
    setVideoFrameCaptureRequest(v => v + 1);
  }, [gateInteraction, projectId, isAgentActive, videoGuiDuration, t]);

  const handleVideoFrameCaptured = useCallback((dataUrl: string, time: number) => {
    const pending = pendingFrameEditRef.current;
    if (!pending || !projectId) return;
    pendingFrameEditRef.current = null;

    const timeLabel = formatFrameEditTime(time);
    const attachmentId = `frame-edit-${pending.anim.id}-${Math.round(time * 1000)}-${Date.now()}`;
    setCuiDraftText('');
    setCuiDraftAttachments([{ id: attachmentId, type: 'image', data: dataUrl, thumbnail: dataUrl }]);
    requestAnimationFrame(() => setCuiDraftText(pending.prompt || t('video.frameEditDraftPrompt', pending.mediaIndex, timeLabel)));
    setViewMode('cui');
  }, [projectId, t]);

  const handleDesignPoster = useCallback((messageId: string, posterDataUrl: string) => {
    if (!posterDataUrl) return;
    // Update message image
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, image: posterDataUrl } : m));
    // Update snapshot image + trigger persistence + tips
    const snap = snapshotsRef.current.find(s => s.messageId === messageId);
    if (snap && !snap.image) {
      setSnapshots(prev => prev.map(s => s.id === snap.id ? { ...s, image: posterDataUrl } : s));
      onSaveSnapshot?.({ ...snap, image: posterDataUrl }, snapshotsRef.current.indexOf(snap), (url) => {
        setSnapshots(prev => prev.map(s => s.id === snap.id ? { ...s, imageUrl: url } : s));
      });
      cacheImage(`snap:${snap.id}`, posterDataUrl);
      // Tips for still designs
      if (!snap.design?.animation) {
        fetchTipsForSnapshot(snap.id, posterDataUrl, 'none');
      }
    }
  }, [onSaveSnapshot, fetchTipsForSnapshot]);

  // Update a design prop (text edit or drag position) — immediate re-render via Remotion
  const designPropsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleDesignPropUpdate = useCallback((key: string, value: unknown) => {
    setSnapshots(prev => {
      const snapIdx = snapFromTimeline(viewIndex, draftParentIndex);
      const updated = prev.map((s, i) => {
        if (i === snapIdx && s.design) {
          return { ...s, design: { ...s.design, props: { ...s.design.props, [key]: value } } };
        }
        return s;
      });
      // Debounced persist to workspace (500ms)
      if (snapIdx != null) {
        if (designPropsSaveTimer.current) clearTimeout(designPropsSaveTimer.current);
        const capturedIdx = snapIdx;
        designPropsSaveTimer.current = setTimeout(() => {
          const snap = updated[capturedIdx];
          if (snap?.design && onSaveDesignProps) {
            console.log('[design] saving props for', snap.id);
            onSaveDesignProps(snap.id, snap.design);
          }
        }, 500);
      }
      return updated;
    });
  }, [viewIndex, draftParentIndex, onSaveDesignProps]);

  const designSizeSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleDesignContentSize = useCallback((size: { width: number; height: number; source: 'editables' | 'scroll' }) => {
    const measuredHeight = Math.ceil(size.height);
    if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) return;

    const expandHeight = (design: DesignPayload): DesignPayload | null => {
      if (design.animation) return null;
      const nextHeight = Math.min(measuredHeight, 20000);
      if (nextHeight <= design.height + 12) return null;
      return { ...design, height: nextHeight };
    };

    const viewingDraftDesign = draftParentIndex !== null && viewIndex === draftParentIndex + 1;
    if (viewingDraftDesign) {
      setDraftDesign(prev => {
        if (!prev) return prev;
        const expanded = expandHeight(prev);
        return expanded || prev;
      });
      return;
    }

    setSnapshots(prev => {
      const snapIdx = snapFromTimeline(viewIndex, draftParentIndex);
      if (snapIdx == null) return prev;
      const snap = prev[snapIdx];
      if (!snap?.design) return prev;
      const expanded = expandHeight(snap.design);
      if (!expanded) return prev;

      const updated = prev.map((s, i) => i === snapIdx ? { ...s, design: expanded } : s);
      if (onSaveDesignProps) {
        if (designSizeSaveTimer.current) clearTimeout(designSizeSaveTimer.current);
        const snapId = snap.id;
        designSizeSaveTimer.current = setTimeout(() => {
          console.log('[design] auto-expanded height', snap.design?.height, '→', expanded.height, `(${size.source})`);
          onSaveDesignProps(snapId, expanded);
        }, 500);
      }
      return updated;
    });
  }, [viewIndex, draftParentIndex, onSaveDesignProps]);


  // Auto-capture poster for design snapshots loaded from Supabase without a poster image
  const posterCapturedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (inactive) return;
    for (const snap of snapshots) {
      if (snap.design && !snap.image && !posterCapturedRef.current.has(snap.id)) {
        posterCapturedRef.current.add(snap.id);
        import('@/components/RemotionRenderer').then(({ captureDesignPoster }) =>
          captureDesignPoster(snap.design!).then(poster => {
            if (poster) handleDesignPoster(snap.messageId, poster);
          })
        ).catch(() => {});
      }
    }
  }, [snapshots, handleDesignPoster, inactive]);

  const videoStartTimeRef = useRef<number>(0);
  const handleVideoTap = useCallback((videoRect?: DOMRect, posterSrc?: string, animId?: string, startTime?: number) => {
    videoStartTimeRef.current = startTime || 0;
    // v2: navigate directly to snapshot by ID
    if (isV2 && animId) {
      const idx = snapshotsRef.current.findIndex(s => s.id === animId);
      if (idx >= 0) {
        setViewIndex(idx);
        setVideoPlayTrigger(n => n + 1);
        if (!isDesktop) setViewMode('gui');
        return;
      }
    }

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
    if (inactive) {
      hasCuiHistoryState.current = false;
      return;
    }
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
        void document.body.offsetHeight;      // force reflow
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
  }, [viewMode, isDesktop, inactive]);

  const resetCuiPan = useCallback(() => {
    cuiPanRef.current.tracking = false;
    cuiPanRef.current.locked = false;
    setCuiPanX(0);
    setCuiPanActive(false);
    setCuiPanSettling(false);
  }, []);

  const isCuiPanEditableTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
  };

  const handleCuiPanStart = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    if (isDesktop || event.touches.length !== 1 || isCuiPanEditableTarget(event.target)) return;
    const touch = event.touches[0];
    if (touch.clientX > IOS_CUI_PAN_EDGE_PX) return;

    cuiPanRef.current = {
      tracking: true,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      startTime: performance.now(),
      locked: false,
    };
    setCuiPanSettling(false);
  }, [isDesktop]);

  const handleCuiPanMove = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    const pan = cuiPanRef.current;
    if (!pan.tracking || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const dx = touch.clientX - pan.startX;
    const dy = touch.clientY - pan.startY;
    pan.lastX = touch.clientX;

    if (!pan.locked) {
      if (dx <= IOS_CUI_PAN_MIN_DX || dx < Math.abs(dy) * 1.15) {
        if (Math.abs(dy) > IOS_CUI_PAN_MIN_DX && Math.abs(dy) > dx) {
          resetCuiPan();
        }
        return;
      }
      pan.locked = true;
      setCuiPanActive(true);
    }

    event.preventDefault();
    event.stopPropagation();
    setCuiPanX(Math.max(0, Math.min(dx, window.innerWidth)));
  }, [resetCuiPan]);

  const handleCuiPanEnd = useCallback(() => {
    const pan = cuiPanRef.current;
    if (!pan.tracking) return;

    const dx = Math.max(0, pan.lastX - pan.startX);
    const elapsed = Math.max(1, performance.now() - pan.startTime);
    const velocity = dx / elapsed;
    const shouldClose = dx >= IOS_CUI_PAN_COMMIT_PX || velocity > 0.42;
    pan.tracking = false;

    setCuiPanSettling(true);
    if (shouldClose) {
      setCuiPanActive(true);
      setCuiPanX(window.innerWidth);
      window.setTimeout(() => {
        window.history.back();
        resetCuiPan();
      }, 150);
      return;
    }

    setCuiPanX(0);
    window.setTimeout(resetCuiPan, 180);
  }, [resetCuiPan]);

  // ── Shared props for AgentChatView — single source of truth ──
  // Both desktop panel and mobile overlay use these. Add new props HERE
  // to avoid desktop/mobile divergence bugs (e.g. missing onMusicSelect).
  const cuiSharedProps = {
    messages,
    messagesLoading: messages.length === 0 && !isAgentActive && (initialSnapshots?.length ?? 0) > 0,
    isAgentActive,
    agentStatus,
    currentImage: currentDisplayImage,
    onSendMessage: handleCuiSend,
    onAbort: handleAgentAbort,
    onInputBarHeight: (h: number) => { cuiInputBarH.current = h; },
    onImageTap: handleImageTap,
    onVideoTap: handleVideoTap,
    snapshots,
    currentSnapshotIndex: isViewingVideo ? (currentSnapIndex + 1) : (snapFromTimeline(viewIndex, draftParentIndex) ?? draftParentIndex ?? 0) + 1,
    preferredModel: preferredModel as PreferredModel,
    onModelChange: setPreferredModel,
    agentModel,
    onAgentModelChange: handleAgentModelChange,
    videoAuto,
    onVideoAutoChange: (auto: boolean) => {
      setVideoAuto(auto);
      if (auto) {
        const defaultModel = getDefaultVideoModelId();
        setVideoModel(defaultModel);
        setVideoResolution('auto');
        setAnimationState(prev => prev ? { ...prev, videoModel: defaultModel, videoResolution: 'auto' } : prev);
      } else {
        const defaultModel = getDefaultVideoModelId();
        const defaultResolution = normalizeVideoResolution(defaultModel, 'auto');
        setVideoModel(defaultModel);
        setVideoResolution(defaultResolution);
        setAnimationState(prev => prev ? { ...prev, videoModel: defaultModel, videoResolution: defaultResolution } : prev);
      }
    },
    videoModel,
    onVideoModelChange: (m: import('@/types').VideoModel) => {
      if (m === 'upload') return;
      setVideoAuto(false);
      setVideoModel(m);
      const defaultResolution = normalizeVideoResolution(m, 'auto');
      setVideoResolution(defaultResolution);
      setAnimationState(prev => prev ? { ...prev, videoModel: m, videoResolution: defaultResolution } : prev);
    },
    videoResolution,
    onVideoResolutionChange: (resolution: import('@/types').VideoResolution) => {
      setVideoAuto(false);
      setVideoResolution(resolution);
      setAnimationState(prev => prev ? { ...prev, videoResolution: resolution } : prev);
    },
    onDesignPoster: handleDesignPoster,
    onMusicSelect: handleMusicSelect,
    onArtifactAction: handleArtifactAction,
    draftText: cuiDraftText,
    draftAttachments: cuiDraftAttachments.length > 0 ? cuiDraftAttachments : undefined,
    hasBackgroundTask: musicPollingRef.current || animationState?.status === 'polling' || snapshots.some(s => s.type === 'video' && s.videoMeta?.status === 'processing'),
    skills: availableSkills,
    selectedSkill,
    onSkillChange: setSelectedSkill,
    onDeleteSkill: (name: string) => {
      setAvailableSkills(prev => {
        const next = prev.filter(s => s.name !== name);
        writeNativeJSONCache('/api/skills', { skills: next });
        return next;
      });
      if (selectedSkill === name) setSelectedSkill(null);
      fetch('/api/skills', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => {});
    },
    onUploadSkill: () => skillFileRef.current?.click(),
    installingSkill,
    onDropSkillFile: handleSkillUpload,
    onOpenCreditPopup: () => setCreditPopupOpen(true),
    projectId,
    readOnly,
  };

  return (
    <div
      data-testid="editor"
      data-tips-status={isTipsFetching ? 'loading' : (currentTips.length ? 'ready' : 'empty')}
      data-tips-count={snapshots.reduce((n, s) => n + (s.tips?.length || 0), 0)}
      data-agent-status={isAgentActive ? 'active' : 'idle'}
      data-snapshot-count={snapshots.length}
      data-current-snapshot={viewIndex}
      data-view-mode={viewMode}
      data-preferred-model={preferredModel}
      data-agent-model={agentModel}
      className={`makaron-editor-shell h-dvh bg-black relative z-[1] overflow-hidden flex ${isDesktop ? 'flex-row' : 'flex-col'}`}
    >
      <input
        ref={fileInputRef}
        data-testid="editor-file-upload"
        aria-label="Upload photo to editor"
        type="file"
        accept="image/*,video/*,.heic,.heif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.type.startsWith('video/')) {
            handleVideoUpload(file);
          } else {
            compressAndUpload(file);
          }
          e.target.value = '';
        }}
      />
      {/* New project file input */}
      <input
        ref={newProjectFileInputRef}
        type="file"
        accept="image/*,video/*,.heic,.heif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onNewProject?.(file);
          e.target.value = '';
        }}
      />

      {/* GUI mode — always visible on desktop, toggled on mobile (also during pull-down for gesture tracking) */}
      {(isDesktop || viewMode === 'gui' || pullProgress !== null || cuiPanActive) && (
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
            {showCanvasPlaceholder ? (
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
                    className="mkr-liquid-empty-state flex flex-col items-center gap-4 text-white/60 hover:text-white/80 transition-colors active:scale-[0.98]"
                    style={{
                      borderRadius: 24,
                      padding: '28px 30px 24px',
                      minWidth: 220,
                    }}
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
                key={`${viewIndex}:${timeline[viewIndex] ?? ''}:${currentVideo?.videoUrl ?? ''}:${currentSnap?.videoMeta?.videoUrl ?? ''}:${annotationMode ? 'annotate' : 'browse'}`}
                timeline={timeline}
                currentIndex={viewIndex}
                onIndexChange={handleIndexChange}
                referenceCount={referenceCount}
                animatedDesigns={designsMap}
                draftDesign={draftDesign}
                isEditing={isEditing}
                isDraft={isViewingDraft}
                isDraftLoading={isViewingDraft && (activeDraftType === 'design' ? !draftDesignPoster : activeDraftType === 'tips' ? (!draftFullLoaded && !!draftFullUrl?.startsWith('http')) : false)}
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
                onAnimate={undefined}

























                hasVideo={hasVideo}
                isVideoEntry={isViewingVideo}
                videoUrl={isViewingVideoV2
                  ? (currentSnap?.videoMeta?.videoUrl ?? null)
                  : (currentVideo?.videoUrl ?? null)}
                videoProcessing={isViewingVideoV2
                  ? (currentSnap?.videoMeta?.status === 'processing')
                  : (isViewingVideo && !currentVideo?.videoUrl && animations.some(a => a.status === 'processing'))}
                videoFailed={isViewingVideoV2 ? (currentSnap?.videoMeta?.status === 'failed') : false}
                videoTaskId={isViewingVideoV2
                  ? (currentSnap?.videoMeta?.taskId ?? null)
                  : (currentVideo?.taskId ?? null)}
                videoModel={isViewingVideoV2
                  ? (currentSnap?.videoMeta?.model ?? null)
                  : (currentVideo?.videoModel ?? null)}
                videoPosterImage={isViewingVideoV2
                  ? (currentSnap?.image || currentSnap?.imageUrl)
                  : snapshots[snapshots.length - 1]?.image}
                videoPlayTrigger={videoPlayTrigger}
                videoStartTime={videoStartTimeRef.current}
                videoTimelineIndices={videoTimelineIndices}
                onVideoPosterCapture={(dataUrl) => {
                  const snap = snapshotsRef.current[viewIndex];
                  if (!snap || snap.type !== 'video') return;
                  if (snap.imageUrl?.includes('/posters/')) return;
                  setSnapshots(prev => prev.map(s => s.id === snap.id ? { ...s, image: dataUrl } : s));
                  import('@/lib/supabase/client').then(async ({ createClient }) => {
                    const supabase = createClient();
                    const uid = (await supabase.auth.getUser()).data.user?.id;
                    if (!uid || !projectId) return;
                    const blob = await fetch(dataUrl).then(r => r.blob());
                    const path = `${uid}/${projectId}/posters/${snap.id}.jpg`;
                    await supabase.storage.from('images').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
                    const { data: urlData } = supabase.storage.from('images').getPublicUrl(path);
                    if (urlData?.publicUrl) {
                      setSnapshots(prev => prev.map(s => s.id === snap.id ? { ...s, imageUrl: urlData.publicUrl } : s));
                      await supabase.from('snapshots').update({ image_url: urlData.publicUrl }).eq('id', snap.id);
                    }
                  });
                }}
                onVideoTimeUpdate={(time, duration) => {
                  setVideoGuiTime(time);
                  if (duration && Number.isFinite(duration)) setVideoGuiDuration(duration);
                }}
                videoFrameCaptureRequest={videoFrameCaptureRequest}
                onVideoFrameCaptured={handleVideoFrameCaptured}
                pullDownActive={pullProgress !== null}
                onPullDown={handlePullDown}
                onPullDownEnd={handlePullDownEnd}
                editableFields={isViewingDesign ? currentDesignEditables : undefined}
                designProps={isViewingDesign ? currentDesignProps : undefined}
                selectedEditableId={selectedEditableFieldId}
                onSelectEditable={setSelectedEditableFieldId}
                onUpdateProp={handleDesignPropUpdate}
                onStartEditEditable={setEditingDesignFieldId}
                onVisibleEditableFields={handleVisibleEditableFields}
                onDesignContentSize={handleDesignContentSize}
                activeTrimFieldId={editingDesignField?.type === 'video' ? editingDesignField.id : null}
              />
            )}

            {/* TODO: Floating text input for annotation text tool — uncomment when text editing flow is ready */}

            {/* Top toolbar — hidden in design editor mode */}
            {snapshots.length > 0 && !selectedEditableFieldId && (
              <div className="makaron-editor-topbar absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent z-10">
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
                  {!readOnly && (
                  <button
                    onClick={() => newProjectFileInputRef.current?.click()}
                    className="text-white/80 hover:text-white p-2 cursor-pointer"
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                  )}
                  {/* Annotation (paintbrush) toggle */}
                  {!readOnly && !isViewingVideo && timeline.length > 0 && (
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
                  {!readOnly && !isViewingVideo && timeline.length > 0 && (
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
                  {/* Babel CDN loading indicator */}
                  {babelStatus === 'loading' && (
                    <span className="flex items-center gap-1 text-[10px] text-white/30" title="Loading design engine...">
                      <svg className="animate-spin w-3 h-3 text-fuchsia-400/60" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    </span>
                  )}
                  {babelStatus === 'error' && (
                    <span className="text-[10px] text-red-400/60" title="Design engine failed to load">⚠</span>
                  )}
                  {snapshots.length > 0 && (
                    <>
                    <ShareButton projectId={projectId || ''} readOnly={readOnly} />
                    <button
                      onClick={handleDownload}
                      disabled={isSaving}
                      className={`mkr-liquid-pill px-3 py-1.5 rounded-full text-xs font-medium border transition-all cursor-pointer active:scale-95 disabled:cursor-default ${
                        isSaving
                          ? 'text-white/55'
                          : 'text-white'
                      }`}
                      style={{
                        border: isSaving ? '0.5px solid rgba(232,121,249,0.18)' : '0.5px solid rgba(232,121,249,0.30)',
                        background: isSaving
                          ? 'linear-gradient(145deg, rgba(217,70,239,0.12), rgba(10,10,14,0.34))'
                          : 'linear-gradient(145deg, rgba(217,70,239,0.20), rgba(10,10,14,0.38))',
                      }}
                    >
                      {isSaving ? (
                        <span className="flex items-center gap-1.5">
                          <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Saving
                        </span>
                      ) : pendingVideoRef.current && /iPhone|iPad|Android/i.test(navigator.userAgent) ? t('editor.share') : 'Save'}
                    </button>
                    </>
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
              width: 340,
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

          {/* Hidden proxy input — iOS keyboard focus anchor (must be in DOM before edit starts) */}
          {/* Design text/video editor — floating panel (like AnnotationToolbar) */}
          {isDesktop && editingDesignField && currentDesignSnap?.design && editingDesignField.type !== 'image' && (
            <DesignEditorFrame
              isDesktop={isDesktop}
              keyboardInset={editorKbInset}
              desktopWidth={editingDesignField.type === 'video' ? 420 : 340}
            >
              <DesignFieldEditor
                field={editingDesignField}
                design={currentDesignSnap.design}
                posterImage={currentDesignSnap.image || currentDesignSnap.imageUrl || currentDisplayImage}
                onUpdateProp={handleDesignPropUpdate}
                onClose={() => setEditingDesignFieldId(null)}
                isDesktop={isDesktop}
              />
            </DesignEditorFrame>
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
              <div className="makaron-editor-bottom-bar flex-shrink-0 bg-gradient-to-t from-black from-70% via-black/95 to-transparent">
                <AgentStatusBar
                  statusText={agentStatus}
                  isActive={isAgentActive}
                  onOpenChat={openCUI}
                  isViewingDraft={isViewingDraft}
                  hideChat={isDesktop}
                  snapshotCount={snapshots.length}
                  notification={creditExhausted ? { text: 'Credits exhausted · Top up' } : pendingNotification}
                  onSeeNotification={creditExhausted ? () => setCreditPopupOpen(true) : handleSeeNotification}
                  onAnimate={undefined}
                  hasVideo={hasVideo}
                />
                {isViewingVideo ? (
                  <VideoResultCard
                    animations={isViewingVideoV2 && currentSnap?.videoMeta ? [{
                      id: currentSnap.id,
                      projectId: projectId ?? '',
                      taskId: currentSnap.videoMeta.taskId,
                      videoUrl: currentSnap.videoMeta.videoUrl,
                      prompt: currentSnap.videoMeta.prompt,
                      snapshotUrls: currentSnap.videoMeta.sourceUrls || [],
                      imageUrl: currentSnap.imageUrl,
                      status: currentSnap.videoMeta.status,
                      duration: currentSnap.videoMeta.duration,
                      createdAt: currentSnap.videoMeta.createdAt || new Date().toISOString(),
                      videoModel: currentSnap.videoMeta.model,
                      videoResolution: currentSnap.videoMeta.resolution,
                      videoAspectRatio: currentSnap.videoMeta.aspectRatio,
                      error: currentSnap.videoMeta.error,
                    }] : animations}
                    selectedVideoId={isViewingVideoV2 ? currentSnap?.id ?? null : selectedVideoId}
                    onSelectVideo={isViewingVideoV2 ? () => {} : setSelectedVideoId}
                    onCreateNew={() => { if (!isDesktop) setViewMode('cui'); }}
                    onAbandon={(taskId) => {
                      if (isViewingVideoV2 && currentSnap) {
                        setSnapshots(prev => prev.map(s =>
                          s.id === currentSnap.id ? { ...s, videoMeta: { ...s.videoMeta!, status: 'abandoned' as const } } : s
                        ));
                        fetch(`/api/video-snapshot/${currentSnap.id}`, { method: 'DELETE' }).catch(() => {});
                      } else {
                        setAnimations(prev => prev.filter(a => a.taskId !== taskId));
                        fetch(`/api/animate/${taskId}`, { method: 'DELETE' }).catch(() => {});
                      }
                    }}
                    onRetry={async (anim) => {
                      const images = anim.snapshotUrls?.length ? anim.snapshotUrls : snapshots.map(s => s.imageUrl).filter((u): u is string => !!u && u.startsWith('http')).slice(0, 7);
                      try {
                        const res = await fetch('/api/video-snapshot', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ projectId, imageUrls: images, prompt: anim.prompt, duration: anim.duration, videoModel: anim.videoModel || getDefaultVideoModelId(), videoResolution: anim.videoResolution || 'auto', aspectRatio: anim.videoAspectRatio }),
                        });
                        const json = await res.json();
                        if (!res.ok) throw new Error(json.error || 'Retry failed');
                        // Update frontend state
                        setAnimations(prev => prev.map(a => a.id === anim.id ? { ...a, taskId: json.taskId, status: 'processing' as const, videoUrl: null, createdAt: new Date().toISOString() } : a));
                        const newMeta = { taskId: json.taskId, status: 'processing' as const, videoUrl: null, error: undefined };
                        setSnapshots(prev => prev.map(s => s.id === anim.id && s.videoMeta ? { ...s, videoMeta: { ...s.videoMeta, ...newMeta } } : s));
                        // Persist to DB (v2: update snapshot video_meta)
                        const { createClient } = await import('@/lib/supabase/client');
                        const supabase = createClient();
                        const snap = snapshots.find(s => s.id === anim.id && s.videoMeta);
                        if (snap?.videoMeta) {
                          await supabase.from('snapshots').update({
                            video_meta: { ...snap.videoMeta, ...newMeta },
                          }).eq('id', anim.id);
                        }
                      } catch (e) {
                        console.error('Video retry failed:', e);
                      }
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
                        videoModel: anim.videoModel && anim.videoModel !== 'upload' ? anim.videoModel : videoModel,
                        videoResolution: anim.videoResolution || 'auto',
                      });
                    }}
                    onFrameEdit={handleVideoFrameEdit}
                    currentTime={videoGuiTime}
                    currentDuration={videoGuiDuration}
                    isDesktop={isDesktop}
                  />
                ) : !isDesktop && editingDesignField && currentDesignSnap?.design ? (
                  <div data-design-editor-slot="mobile-inline">
                    <DesignEditorFrame
                      isDesktop={false}
                      keyboardInset={editorKbInset}
                      desktopWidth={editingDesignField.type === 'video' ? 420 : 340}
                    >
                      <DesignFieldEditor
                        field={editingDesignField}
                        design={currentDesignSnap.design}
                        posterImage={currentDesignSnap.image || currentDesignSnap.imageUrl || currentDisplayImage}
                        onUpdateProp={handleDesignPropUpdate}
                        onClose={() => setEditingDesignFieldId(null)}
                        isDesktop={false}
                      />
                    </DesignEditorFrame>
                  </div>
                ) : isViewingDesign && currentDesignEditables.length > 0 ? (
                  <DesignEditPanel
                    editables={visibleEditableIds.length > 0
                      ? currentDesignEditables.filter(f => visibleEditableIds.includes(f.id))
                      : currentDesignEditables}
                    props={currentDesignProps}
                    onUpdateProp={(key, value) => handleDesignPropUpdate(key, value)}
                    selectedFieldId={selectedEditableFieldId}
                    onSelectField={setSelectedEditableFieldId}
                    onStartEdit={(fieldId) => setEditingDesignFieldId(prev => prev === fieldId ? null : fieldId)}
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

          {/* AnimateSheet — detail mode only (view video info, no creation) */}
          {detailAnimation && projectId && animationState && (
            <AnimateSheet
              snapshots={snapshots.filter(s => s.imageUrl || s.image)}
              projectId={projectId}
              isDesktop={isDesktop}
              desktopWidth={cuiPanelWidth}
              mode="detail"
              detailAnimation={detailAnimation}
              onClose={() => { setDetailAnimation(null); setAnimationState(null); }}
              onOpenCUI={() => { if (!isDesktop) setViewMode('cui'); }}
              animationState={animationState}
              onStateChange={(update) => setAnimationState(prev => prev ? { ...prev, ...update } : prev)}
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
            {...cuiSharedProps}
            mode="panel"
            onBack={() => {}}
            onPipTap={() => {}}
            onNavigateToSnapshot={handleNavigateToSnapshot}
          />
        </div>
      </>) : viewMode === 'cui' ? (
        <div
          data-makaron-cui-pan="true"
          className="fixed inset-0 z-40"
          style={{
            transform: `translate3d(${cuiPanX}px, 0, 0)`,
            transition: cuiPanSettling ? 'transform 170ms ease-out' : 'none',
            willChange: cuiPanActive ? 'transform' : undefined,
            touchAction: 'pan-y',
          }}
          onTouchStart={handleCuiPanStart}
          onTouchMove={handleCuiPanMove}
          onTouchEnd={handleCuiPanEnd}
          onTouchCancel={handleCuiPanEnd}
        >
          <AgentChatView
            {...cuiSharedProps}
            onBack={() => {
              if (snapshots.length === 0 && onBack) {
                onBack();
              } else {
                window.history.back();
              }
            }}
            onPipTap={handlePipTap}
            hidePip={heroAnim !== null || pullProgress !== null}
            focusOnOpen={isViewingDraft}
            onNavigateToSnapshot={undefined}
          />
        </div>
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
            {t('editor.enteringChat')}
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
            { }
            <img
              src={currentDisplayImage}
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

            <img src={heroAnim.src} draggable={false} alt="" className="w-full h-full object-cover" />
          ) : (

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
          className="fixed top-20 left-1/2 -translate-x-1/2 z-[300] px-5 py-2.5 rounded-full bg-black/80 backdrop-blur-sm text-white text-sm font-medium shadow-lg"
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
      {/* pendingDesign: capture poster FIRST, then create snapshot with poster image */}
      {pendingDesign && (() => {
        const msgId = pendingDesignMsgIdRef.current;
        if (msgId) {
          pendingDesignMsgIdRef.current = '';
          const snapId = pendingDesignSnapIdRef.current || generateId();
          pendingDesignSnapIdRef.current = '';
          const currentDesign = pendingDesign;
          const designDesc = (currentDesign as unknown as Record<string, unknown>).description as string | undefined;
          setPendingDesign(null);
          setActiveDraftType(null); // clear draft type — published design replaces virtual draft
          setDraftDesign(null); // clear draft — published design replaces it
          setDraftParentIndex(null); // clear virtual draft slot — published replaces it
          setAgentStatus(t('status.renderingDesign'));
          // Poster-first: wait 500ms for fonts/images to load, capture poster, THEN add snapshot
          queueMicrotask(async () => {
            let posterImage = '';
            try {
              const { captureDesignPoster } = await import('@/components/RemotionRenderer');
              await new Promise(r => setTimeout(r, 500)); // wait for fonts/images
              posterImage = await captureDesignPoster(currentDesign) || '';
            } catch (e) {
              console.warn('[design] poster capture failed:', e);
            }
            const newSnapshot: Snapshot = {
              id: snapId,
              image: posterImage, // poster already captured — all existing code works
              tips: [],
              messageId: msgId,
              description: designDesc || '[composition]',
              design: currentDesign,
            };
            const newIndex = snapshotsRef.current.length;
            setSnapshots(prev => {
              if (prev.some(s => s.id === snapId)) return prev;
              const next = [...prev, newSnapshot];
              snapshotsRef.current = next;
              return next;
            });
            viewIndexRef.current = newIndex;
            setViewIndex(newIndex);
            onSaveSnapshot?.(newSnapshot, newIndex, (url) => {
              setSnapshots(prev => prev.map(s => s.id === snapId ? { ...s, imageUrl: url } : s));
            });
            setMessages((prev) => prev.map((m) =>
              m.id === msgId ? { ...m, image: posterImage, design: currentDesign } : m
            ));
            setAgentStatus(t('status.designCreated'));
          });
        }
        return null;
      })()}

      {/* Credit popup */}
      <CreditPopup
        open={creditPopupOpen}
        onClose={() => { setCreditPopupOpen(false); setCreditExhausted(false); setCreditSuccess(false); setCreditWaiting(false); }}
        balance={creditBalance}
        subscription={creditSubscription}
        projectId={projectId ?? undefined}
        success={creditSuccess}
        waiting={creditWaiting}
        autoDetectPayment
        onBalanceUpdate={(bal, sub) => {
          setCreditBalance(bal);
          if (sub) setCreditSubscription(sub);
          setMessages(prev => prev.filter(m => !m.content?.startsWith('[CREDITS_EXHAUSTED:')));
          setCreditExhausted(false);
        }}
      />
      <input ref={skillFileRef} type="file" accept=".zip" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleSkillUpload(f); e.target.value = ''; }} />
    </div>
  );
}
