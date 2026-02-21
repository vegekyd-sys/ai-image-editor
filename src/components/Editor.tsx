'use client';

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Message, Tip, Snapshot, PhotoMetadata } from '@/types';
import ImageCanvas from '@/components/ImageCanvas';
import TipsBar from '@/components/TipsBar';
import AgentStatusBar from '@/components/AgentStatusBar';
import AgentChatView from '@/components/AgentChatView';
import { streamAgent } from '@/lib/agentStream';

function generateId() {
  return Date.now().toString() + Math.random().toString(36).slice(2);
}

// Extract EXIF metadata (location + time) from a photo file
async function extractPhotoMetadata(file: File): Promise<PhotoMetadata | undefined> {
  try {
    const exifr = (await import('exifr')).default;
    // reviveValues:false keeps datetime as raw string — avoids timezone conversion
    const exif = await exifr.parse(file, { gps: true, reviveValues: false });
    if (!exif) return undefined;

    const lat = exif.latitude;
    const lng = exif.longitude;
    const datetimeRaw: string | undefined = exif.DateTimeOriginal || exif.CreateDate;

    // Parse "YYYY:MM:DD HH:MM:SS" directly — no timezone conversion (EXIF stores local time)
    let takenAt: string | undefined;
    if (datetimeRaw && typeof datetimeRaw === 'string') {
      const m = datetimeRaw.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/);
      if (m) {
        const utcOffset = lat !== undefined && lng !== undefined
          ? Math.round(lng / 15)
          : undefined;
        const tzStr = utcOffset !== undefined
          ? ` (UTC${utcOffset >= 0 ? '+' : ''}${utcOffset})`
          : '';
        takenAt = `${m[1]}年${parseInt(m[2])}月${parseInt(m[3])}日 ${m[4]}:${m[5]}${tzStr}`;
      }
    }

    // Reverse geocode — zoom=14 for neighborhood level (more reliable than building-level)
    let location: string | undefined;
    if (lat && lng) {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&accept-language=zh-CN`,
          { headers: { 'User-Agent': 'Makaron-App/1.0' } }
        );
        if (res.ok) {
          const geo = await res.json();
          const addr = geo.address;
          const city = addr.city || addr.town || addr.village || addr.county;
          location = [city, addr.country].filter(Boolean).join(', ');
        }
      } catch { /* geocoding failure is non-critical */ }
    }

    if (!takenAt && !location) return undefined;
    return { takenAt, location, raw: { lat, lng, datetime: datetimeRaw } };
  } catch {
    return undefined;
  }
}

const AGENT_GREETING = 'Hi! 想怎么编辑这张照片？';

/**
 * Ensure an image is a base64 data URL.
 * If already base64, returns as-is. If a URL, fetches and converts.
 */
async function ensureBase64(image: string): Promise<string> {
  if (image.startsWith('data:')) return image;
  const res = await fetch(image);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function compressClientSide(file: File, maxSize = 2048, quality = 0.92): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { naturalWidth: w, naturalHeight: h } = img;
      const scale = Math.min(1, maxSize / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}


interface EditorProps {
  projectId?: string;
  initialSnapshots?: Snapshot[];
  initialMessages?: Message[];
  pendingImage?: string;
  pendingMetadata?: PhotoMetadata;
  onSaveSnapshot?: (snapshot: Snapshot, sortOrder: number) => void;
  onSaveMessage?: (message: Message) => void;
  onUpdateTips?: (snapshotId: string, tips: Tip[]) => void;
  onUpdateDescription?: (snapshotId: string, description: string) => void;
  initialTitle?: string;
  onRenameProject?: (title: string) => void;
  onBack?: () => void;
  onNewProject?: (file: File) => void;
}

export default function Editor({
  projectId,
  initialSnapshots,
  initialMessages,
  pendingImage,
  pendingMetadata,
  onSaveSnapshot,
  onSaveMessage,
  onUpdateTips,
  onUpdateDescription,
  initialTitle,
  onRenameProject,
  onBack,
  onNewProject,
}: EditorProps = {}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages ?? []);
  const [snapshots, setSnapshots] = useState<Snapshot[]>(initialSnapshots ?? []);
  const [isEditing, setIsEditing] = useState(false);
  const [isTipsFetching, setIsTipsFetching] = useState(false);
  const [viewIndex, setViewIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'gui' | 'cui'>('gui');
  const [previewingTipIndex, setPreviewingTipIndex] = useState<number | null>(null);
  const [draftParentIndex, setDraftParentIndex] = useState<number | null>(null);
  const [isAgentActive, setIsAgentActive] = useState(false);
  const [agentStatus, setAgentStatus] = useState(AGENT_GREETING);
  const agentAbortRef = useRef<AbortController>(new AbortController());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newProjectFileInputRef = useRef<HTMLInputElement>(null);
  const previewAbortRef = useRef<AbortController>(new AbortController());
  // Snapshots pending auto-analysis after current agent run finishes
  const pendingAnalysisRef = useRef<{ id: string; image: string }[]>([]);
  const lastEditPromptRef = useRef<string | null>(null); // captures editPrompt from generate_image tool calls
  const lastEditInputImagesRef = useRef<string[] | null>(null); // captures input images from generate_image tool calls

  const snapshotsRef = useRef(snapshots);
  snapshotsRef.current = snapshots;
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
  const pendingTeaserRef = useRef<{ snapshotId: string; tips: Tip[] } | null>(null);
  const isReactionInFlightRef = useRef(false);
  // Track which snapshot's teaser has already been displayed (prevents progress bar from overwriting)
  const teaserSnapshotRef = useRef<string | null>(null);
  // Track if we've already triggered auto-naming this session (only once per new project)
  const hasTriggeredNamingRef = useRef(false);
  // Track which snapshots have already received "previews ready" CUI notification
  // Pre-seed with initialSnapshots so restored projects don't re-trigger
  const previewsNotifiedRef = useRef<Set<string>>(
    new Set(initialSnapshots?.map(s => s.id) ?? [])
  );

  // Draft mode: draftParentIndex !== null means a virtual draft entry exists in timeline
  const isDraft = draftParentIndex !== null;

  // Draft image is computed from the selected tip's preview (or parent image as fallback)
  const draftImage = useMemo(() => {
    if (draftParentIndex === null || previewingTipIndex === null) return null;
    const parentTips = snapshots[draftParentIndex]?.tips ?? [];
    const tip = parentTips[previewingTipIndex];
    return tip?.previewImage || snapshots[draftParentIndex]?.image || null;
  }, [draftParentIndex, previewingTipIndex, snapshots]);

  // Timeline: committed snapshots + virtual draft (if exists)
  const timeline = useMemo(() => {
    const base = snapshots.map((s) => s.image);
    if (draftImage) base.push(draftImage);
    return base;
  }, [snapshots, draftImage]);

  // Are we currently viewing the draft entry (last timeline position when draft exists)?
  const isViewingDraft = isDraft && viewIndex >= snapshots.length;

  // Tips come from the parent snapshot when viewing draft, otherwise from the viewed snapshot
  const tipsSourceIndex = isViewingDraft ? draftParentIndex : viewIndex;
  const currentTips = snapshots[tipsSourceIndex]?.tips ?? [];

  // Auto-jump to latest when timeline grows; clamp when it shrinks (draft dismissed)
  const prevTimelineLen = useRef(0);
  if (timeline.length !== prevTimelineLen.current) {
    if (timeline.length > prevTimelineLen.current) {
      setViewIndex(timeline.length - 1);
    } else if (viewIndex >= timeline.length) {
      setViewIndex(Math.max(0, timeline.length - 1));
    }
    prevTimelineLen.current = timeline.length;
  }

  // Trigger a one-sentence teaser about the tips shown in StatusBar
  const triggerTipsTeaser = useCallback(async (snapshotId: string, tips: Tip[]) => {
    if (!projectId) return;
    // Check user is still viewing this snapshot
    if (snapshotsRef.current[viewIndexRef.current]?.id !== snapshotId) return;

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

    const image = tipImage || snapshotsRef.current[viewIndexRef.current]?.image || '';
    const imageBase64 = image ? await ensureBase64(image) : '';

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

  const addMessage = useCallback((role: 'user' | 'assistant', content: string, image?: string) => {
    const msg: Message = {
      id: generateId(),
      role,
      content,
      image,
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
  ) => {
    // Ensure we have base64 for the API
    const imageBase64 = await ensureBase64(imageInput);

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
        body: JSON.stringify({ image: imageBase64, editPrompt, aspectRatio }),
        signal: previewAbortRef.current.signal,
      });

      if (!res.ok) throw new Error('Preview failed');
      const { image } = await res.json();

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

  // Fetch tips via 3 parallel calls to Claude (fast, ~2-3s vs Gemini ~15s)
  // previewMode: 'full' = all tips get preview; 'selective' = 1 enhance + 1 wild; 'none' = no previews
  const fetchTipsForSnapshot = useCallback((
    snapshotId: string,
    imageInput: string,
    previewMode: 'full' | 'selective' | 'none' = 'full',
  ) => {
    setIsTipsFetching(true);
    previewDoneBaselineRef.current = 0;
    previewAbortRef.current = new AbortController();
    if (!isAgentActiveRef.current) {
      setAgentStatus('正在发现有趣的可能...');
    }

    const categories = ['enhance', 'creative', 'wild'] as const;
    let completedCount = 0;
    const previewGenerated: Record<string, number> = { enhance: 0, wild: 0 };

    const fetchCategory = async (category: string) => {
      const imageBase64 = await ensureBase64(imageInput);
      const MAX_RETRIES = 2;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const res = await fetch('/api/tips', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image: imageBase64,
              category,
              metadata: snapshotsRef.current.find(s => s.id === snapshotId)?.metadata,
            }),
          });
          if (!res.ok) throw new Error(`Tips ${category} failed: ${res.status}`);

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
                  if (tip.label && tip.editPrompt && tip.category) {
                    tip.previewStatus = 'pending';
                    setSnapshots((prev) => prev.map((s) =>
                      s.id === snapshotId ? { ...s, tips: [...s.tips, tip] } : s
                    ));

                    const shouldPreview = (() => {
                      if (previewMode === 'none') return false;
                      if (previewMode === 'full') return true;
                      const cat = tip.category as string;
                      if ((cat === 'enhance' || cat === 'wild') && previewGenerated[cat] === 0) {
                        previewGenerated[cat]++;
                        return true;
                      }
                      return false;
                    })();

                    if (shouldPreview) {
                      generatePreviewForTip(snapshotId, tip.editPrompt, imageBase64, tip.aspectRatio);
                    } else {
                      setSnapshots((prev) => prev.map((s) =>
                        s.id === snapshotId ? {
                          ...s,
                          tips: s.tips.map(t => t.label === tip.label ? { ...t, previewStatus: 'none' } : t),
                        } : s
                      ));
                    }
                  }
                } catch { /* skip malformed */ }
              }
            }
          }
          break;
        } catch {
          if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
      }

      completedCount++;
      if (completedCount === categories.length) {
        setIsTipsFetching(false);
        if (onUpdateTips) {
          setSnapshots((prev) => {
            const snap = prev.find(s => s.id === snapshotId);
            if (snap?.tips.length) {
              const tipsForDb = snap.tips.map(({ previewImage, previewStatus, ...rest }) => rest) as Tip[];
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
            setAgentStatus(AGENT_GREETING);
          }
        }, 100);
      }
    };

    categories.forEach(cat => fetchCategory(cat));
  }, [generatePreviewForTip, onUpdateTips, triggerTipsTeaser]);

  // Auto-analyze a snapshot: runs silently in background, stores result in snapshot.description only
  const runAutoAnalysis = useCallback(async (
    snapshotId: string,
    imageBase64: string,
    context: 'initial' | 'post-edit' = 'initial',
  ) => {
    if (!projectId) return;

    setIsAgentActive(true);
    setAgentStatus('分析图片中...');
    agentAbortRef.current = new AbortController();

    let description = '';
    // For initial upload: show analysis as a CUI message so the user sees it
    const isInitial = context === 'initial';
    const msgId = isInitial ? generateId() : null;
    if (isInitial && msgId) {
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
          onStatus: (s) => setAgentStatus(s),
          onContent: (delta) => {
            description += delta;
            // Stream into the CUI message for initial uploads
            if (isInitial && msgId) {
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
              // Append a hint about tips being generated, then persist the CUI message
              if (isInitial && msgId) {
                const suffix = '\n\n正在为你想一些好玩的修图点子~';
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
              // Auto-name the project once, based on the image analysis description
              if (!hasTriggeredNamingRef.current && (!initialTitle || initialTitle === 'Untitled' || initialTitle === '未命名' || initialTitle === '未命名项目')) {
                hasTriggeredNamingRef.current = true;
                triggerProjectNaming(description);
              }
            }
            // Only fall back to GREETING if tips failed entirely (useEffect handles other cases)
            if (!isTipsFetchingRef.current) {
              const snap = snapshotsRef.current.find(s => s.id === snapshotId);
              if (!snap || snap.tips.length === 0) {
                setAgentStatus(AGENT_GREETING);
              }
            }
          },
          onError: () => {},
        },
        agentAbortRef.current.signal,
      );
    } catch (err) {
      console.error('[runAutoAnalysis] error:', err);
    } finally {
      setIsAgentActive(false);
      // Drain any pending teaser that was queued while analysis was running
      const pending = pendingTeaserRef.current;
      if (pending) {
        pendingTeaserRef.current = null;
        setTimeout(() => triggerTipsTeaser(pending.snapshotId, pending.tips), 400);
      }
    }
  }, [projectId, onUpdateDescription, onSaveMessage, triggerTipsTeaser, initialTitle, triggerProjectNaming]);

  // Agent request: route user message through Makaron Agent
  const handleAgentRequest = useCallback(async (text: string) => {
    // When viewing a draft, use the preview image; otherwise use the snapshot image
    let currentImage = snapshotsRef.current[viewIndexRef.current]?.image;
    let contextSnapshotIndex = viewIndexRef.current;
    if (!currentImage && draftParentIndexRef.current !== null && previewingTipIndexRef.current !== null) {
      const parentTips = snapshotsRef.current[draftParentIndexRef.current]?.tips ?? [];
      currentImage = parentTips[previewingTipIndexRef.current]?.previewImage
        || snapshotsRef.current[draftParentIndexRef.current]?.image;
      contextSnapshotIndex = draftParentIndexRef.current;
    }
    if (!currentImage || !projectId) return;

    const imageBase64 = await ensureBase64(currentImage);
    addMessage('user', text);
    const assistantMsgId = generateId();
    setMessages((prev) => [...prev, {
      id: assistantMsgId,
      role: 'assistant' as const,
      content: '',
      timestamp: Date.now(),
    }]);

    // Auto-switch to CUI
    setViewMode('cui');
    setIsAgentActive(true);
    setAgentStatus('Agent 正在思考...');
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
      .slice(-30)
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

    const fullPrompt = `${snapshotWarning}${metaContext}${descriptionContext}${tipsContext}${historyContext}[当前请求]\n${text}`;

    // Always pass the original snapshot (index 0) as reference for face/person preservation
    const originalSnapshot = snapshotsRef.current[0];
    const originalImageBase64 = originalSnapshot?.image
      ? await ensureBase64(originalSnapshot.image)
      : undefined;

    try {
      await streamAgent(
        { prompt: fullPrompt, image: imageBase64, originalImage: originalImageBase64, projectId },
        {
          onStatus: (status) => setAgentStatus(status),
          onNewTurn: () => {
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
          },
          onImage: (imageData) => {
            const snapId = generateId();
            const newSnapshot: Snapshot = {
              id: snapId,
              image: imageData,
              tips: [],
              messageId: currentMsgId,
            };
            setSnapshots((prev) => [...prev, newSnapshot]);
            onSaveSnapshot?.(newSnapshot, snapshotsRef.current.length);
            fetchTipsForSnapshot(snapId, imageData, 'none'); // CUI edit: text only, no auto-preview
            setAgentStatus('图片已生成');
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
                editInputImages: capturedInputImages ?? undefined,
              } : m
            ));
            // Queue auto-analysis of the new snapshot after this agent run finishes
            pendingAnalysisRef.current.push({ id: snapId, image: imageData });
          },
          onToolCall: (tool, input, images) => {
            // Capture editPrompt and input images from generate_image calls
            if (tool === 'generate_image' && typeof input.editPrompt === 'string') {
              lastEditPromptRef.current = input.editPrompt;
              lastEditInputImagesRef.current = images ?? null;
            }
          },
          onDone: () => {
            setAgentStatus('完成');
            // Persist all assistant messages created in this agent run
            setMessages((prev) => {
              const toSave = prev.filter(m => agentMsgIds.includes(m.id) && m.content);
              toSave.forEach(m => onSaveMessage?.(m));
              return prev;
            });
            // After a short delay, run auto-analysis on any newly generated snapshots
            const pending = [...pendingAnalysisRef.current];
            pendingAnalysisRef.current = [];
            if (pending.length > 0) {
              setTimeout(() => {
                pending.forEach(({ id, image }) => runAutoAnalysis(id, image, 'post-edit'));
              }, 800);
            } else {
              // Drain pending teaser or reset to greeting
              const pendingTeaser = pendingTeaserRef.current;
              if (pendingTeaser) {
                pendingTeaserRef.current = null;
                setTimeout(() => triggerTipsTeaser(pendingTeaser.snapshotId, pendingTeaser.tips), 400);
              } else {
                setTimeout(() => setAgentStatus(AGENT_GREETING), 2000);
              }
            }
          },
          onError: (msg) => {
            console.error('Agent error:', msg);
            const id = currentMsgId;
            setMessages((prev) => {
              const updated = prev.map((m) =>
                m.id === id ? { ...m, content: m.content || `出错了，请重试` } : m
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
      console.error('Agent request failed:', err);
    } finally {
      setIsAgentActive(false);
    }
  }, [addMessage, projectId, fetchTipsForSnapshot, onSaveSnapshot, messages, runAutoAnalysis, triggerTipsTeaser]);


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
    const newSnapshot: Snapshot = {
      id: snapId,
      image: tip.previewImage,
      tips: [],
      messageId: assistantMsg.id,
    };
    setSnapshots((prev) => [...prev, newSnapshot]);
    onSaveSnapshot?.(newSnapshot, snapshots.length);

    // Clear draft state (timeline length stays the same: draft replaced by committed)
    setDraftParentIndex(null);
    setPreviewingTipIndex(null);

    // Fetch new tips — selective preview (1 enhance + 1 wild) after commit
    fetchTipsForSnapshot(snapId, tip.previewImage, 'selective');

    // Trigger agent CUI reaction to the committed tip
    const tipSnapshot = { emoji: tip.emoji, label: tip.label, desc: tip.desc, category: tip.category };
    const tipImg = tip.previewImage;
    // Pass other tips so agent can recommend a real one as next step
    const siblings = parentTips
      .filter((_, i) => i !== previewingTipIndex)
      .map(t => ({ emoji: t.emoji, label: t.label, desc: t.desc, category: t.category }));
    setTimeout(() => triggerTipCommitReaction(tipSnapshot, tipImg, siblings), 200);
  }, [draftParentIndex, previewingTipIndex, snapshots, addMessage, fetchTipsForSnapshot, onSaveSnapshot, triggerTipCommitReaction]);

  // Click tip:
  //   - Same tip clicked again (while viewing draft) → commit
  //   - First click (no draft) → create draft
  //   - Different tip (while viewing draft) → switch draft image
  //   - Tip click while navigated away from draft → dismiss old draft, create new from current
  const handleTipInteraction = useCallback((tip: Tip, tipIndex: number) => {
    const viewingDraft = draftParentIndex !== null && viewIndex >= snapshots.length;

    if (viewingDraft && previewingTipIndex === tipIndex) {
      // Same tip clicked again on draft → COMMIT
      if (tip.previewStatus === 'done' && tip.previewImage) {
        commitDraft();
      }
      return;
    }

    // If tip has no preview yet ('none'), trigger generation only — don't select as draft yet
    if (!tip.previewImage && (tip.previewStatus === 'none' || !tip.previewStatus)) {
      // In draft state viewIndex is out of bounds; use draftParentIndex instead
      const snapIdx = viewIndex < snapshots.length ? viewIndex : (draftParentIndex ?? 0);
      const snap = snapshots[snapIdx];
      if (snap && tip.editPrompt) {
        previewDoneBaselineRef.current = snap.tips.filter(t => t.previewStatus === 'done').length;
        setSnapshots(prev => prev.map(s =>
          s.id === snap.id ? {
            ...s,
            tips: s.tips.map(t => t.label === tip.label ? { ...t, previewStatus: 'pending' } : t),
          } : s
        ));
        generatePreviewForTip(snap.id, tip.editPrompt, snap.image, tip.aspectRatio);
      }
      return; // don't create draft until image is ready
    }

    // If tip is still generating, ignore click
    if (tip.previewStatus === 'pending' || tip.previewStatus === 'generating') return;

    // Update tip selection (switches draft image via draftImage memo)
    setPreviewingTipIndex(tipIndex);

    if (draftParentIndex === null) {
      // No draft → create one from current snapshot
      setDraftParentIndex(viewIndex);
    } else if (!viewingDraft) {
      // Viewing a committed snapshot with an existing draft elsewhere
      // → update draft parent to current snapshot
      setDraftParentIndex(viewIndex);
      setViewIndex(snapshots.length);
    }
  }, [draftParentIndex, viewIndex, snapshots, previewingTipIndex, commitDraft, generatePreviewForTip]);

  // Retry a failed preview generation
  const handleRetryPreview = useCallback((tip: Tip, tipIndex: number) => {
    // Find which snapshot owns this tip
    const tipsSourceIdx = isViewingDraft ? draftParentIndex : viewIndex;
    const snap = tipsSourceIdx !== null ? snapshots[tipsSourceIdx] : null;
    if (!snap) return;
    // Baseline = done count right now, so x/y resets to 0/1 (or 0/N for multi-retry)
    previewDoneBaselineRef.current = snap.tips.filter(t => t.previewStatus === 'done').length;
    generatePreviewForTip(snap.id, tip.editPrompt, snap.image, tip.aspectRatio);
  }, [isViewingDraft, draftParentIndex, viewIndex, snapshots, generatePreviewForTip]);

  // Previous image for long-press compare
  const previousImage = useMemo(() => {
    if (isViewingDraft && draftParentIndex !== null) {
      // Viewing draft: "before" = parent snapshot's image
      return snapshots[draftParentIndex]?.image;
    }
    // Normal mode: "before" = previous snapshot
    return viewIndex > 0 ? snapshots[viewIndex - 1]?.image : undefined;
  }, [isViewingDraft, draftParentIndex, snapshots, viewIndex]);

  // Dismiss draft: remove virtual draft entry, return to parent
  const dismissDraft = useCallback(() => {
    setDraftParentIndex(null);
    setPreviewingTipIndex(null);
    // viewIndex will auto-clamp via prevTimelineLen shrink handler
  }, []);

  // Navigate timeline: keep draft alive so user can swipe back
  const handleIndexChange = useCallback((index: number) => {
    setViewIndex(index);
  }, []);

  const compressAndUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/') && !file.name.match(/\.(heic|heif)$/i)) return;

    previewAbortRef.current.abort();
    setPreviewingTipIndex(null);
    setDraftParentIndex(null);
    setMessages([]);

    const previewUrl = URL.createObjectURL(file);
    const snapId = generateId();
    const previewSnapshot: Snapshot = { id: snapId, image: previewUrl, tips: [], messageId: '' };
    setSnapshots([previewSnapshot]);
    snapshotsRef.current = [previewSnapshot];
    setViewIndex(0);
    prevTimelineLen.current = 1;

    // Extract EXIF metadata in parallel (non-blocking)
    const metadataPromise = extractPhotoMetadata(file);

    try {
      // A1: try client-side compression first (fast), start tips immediately
      let base64: string | null = null;
      let tipsStarted = false;
      try {
        base64 = await compressClientSide(file);
        // Start tips generation immediately with client-compressed image (A1)
        const newSnapshot: Snapshot = { id: snapId, image: base64, tips: [], messageId: '' };
        setSnapshots([newSnapshot]);
        snapshotsRef.current = [newSnapshot];
        fetchTipsForSnapshot(snapId, base64, 'full');
        tipsStarted = true;
      } catch {
        // HEIC or other format — fall through to server upload
      }

      if (!base64) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        if (!res.ok) throw new Error('Image conversion failed');
        base64 = (await res.json()).image;
      }
      URL.revokeObjectURL(previewUrl);

      // Attach metadata when available
      const metadata = await metadataPromise;

      // Update snapshot image with final base64 + metadata
      const newSnapshot: Snapshot = { id: snapId, image: base64!, tips: [], messageId: '', metadata };
      setSnapshots([newSnapshot]);
      snapshotsRef.current = [newSnapshot];
      onSaveSnapshot?.(newSnapshot, 0);
      // Only start tips if not already started (HEIC path)
      if (!tipsStarted) {
        fetchTipsForSnapshot(snapId, base64!, 'full');
      }
      // Auto-analyze the uploaded photo
      runAutoAnalysis(snapId, base64!);
    } catch (err) {
      console.error('Image upload error:', err);
      URL.revokeObjectURL(previewUrl);
    }
  }, [fetchTipsForSnapshot, onSaveSnapshot]);

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

  const pendingHandled = useRef(false);
  useEffect(() => {
    if (pendingImage && !pendingHandled.current) {
      pendingHandled.current = true;
      const snapId = generateId();
      const newSnapshot: Snapshot = { id: snapId, image: pendingImage, tips: [], messageId: '', metadata: pendingMetadata };
      setSnapshots([newSnapshot]);
      snapshotsRef.current = [newSnapshot];
      prevTimelineLen.current = 1;
      setViewIndex(0);
      onSaveSnapshot?.(newSnapshot, 0);
      fetchTipsForSnapshot(snapId, pendingImage);
      // Auto-analyze the uploaded photo
      runAutoAnalysis(snapId, pendingImage);
    }
  }, [pendingImage, pendingMetadata, fetchTipsForSnapshot, onSaveSnapshot, runAutoAnalysis]);

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
        setAgentStatus('正在生成修图建议 Ready to Suprise');
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
      setAgentStatus(`正使用nano banana pro生成图片 ${x}/${y}`);
    } else if (settled === total && !isAgentActive) {
      setAgentStatus(prev => prev.includes('nano banana') ? AGENT_GREETING : prev);
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


  const handleDownload = useCallback(async () => {
    const img = timeline[viewIndex];
    if (!img) return;
    const filename = `ai-edited-${Date.now()}.jpg`;

    // Convert base64 data URL to Blob
    try {
      const res = await fetch(img);
      const blob = await res.blob();

      // Use Web Share API on mobile for Camera Roll access
      if (navigator.share && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
        const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
        await navigator.share({ files: [file] });
        return;
      }

      // Desktop fallback: download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      // Final fallback
      const link = document.createElement('a');
      link.href = img;
      link.download = filename;
      link.click();
    }
  }, [timeline, viewIndex]);

  // CUI: tap inline image → find snapshot → switch to GUI at that index
  const handleImageTap = useCallback((messageId: string) => {
    const idx = snapshots.findIndex(s => s.messageId === messageId);
    if (idx >= 0) setViewIndex(idx);
    setViewMode('gui');
  }, [snapshots]);

  // Intercept browser/iOS back gesture when CUI is open:
  // push a history state on enter, listen for popstate to go back to GUI.
  useEffect(() => {
    if (viewMode !== 'cui') return;
    window.history.pushState({ makaronCui: true }, '');
    const handlePop = () => setViewMode('gui');
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, [viewMode]);

  return (
    <div className="h-dvh bg-black relative overflow-hidden flex flex-col">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
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
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onNewProject?.(file);
          e.target.value = '';
        }}
      />

      {/* GUI mode */}
      {viewMode === 'gui' && (
        <>
          {/* Canvas area (fills remaining space) */}
          <div className="flex-1 relative min-h-0 overflow-hidden">
            {timeline.length === 0 ? (
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
            ) : (
              <ImageCanvas
                timeline={timeline}
                currentIndex={viewIndex}
                onIndexChange={handleIndexChange}
                isEditing={isEditing}
                isDraft={isViewingDraft}
                onDismissDraft={dismissDraft}
                previousImage={previousImage}
              />
            )}

            {/* Top toolbar */}
            {snapshots.length > 0 && (
              <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent z-10">
                <div className="flex items-center gap-1">
                  {onBack && (
                    <button
                      onClick={onBack}
                      className="text-white/80 hover:text-white p-2"
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => newProjectFileInputRef.current?.click()}
                    className="text-white/80 hover:text-white p-2"
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {(viewIndex > 0 || isViewingDraft) && (
                    <button
                      onClick={handleDownload}
                      className="px-3 py-1.5 rounded-full text-xs font-medium text-white bg-fuchsia-500/20 backdrop-blur-sm border border-fuchsia-500/30"
                    >
                      Save
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Bottom bar: Agent status bar (always) + Tips */}
          {snapshots.length > 0 && (
            <div className="flex-shrink-0 bg-gradient-to-t from-black via-black/90 to-transparent">
              <AgentStatusBar
                statusText={agentStatus}
                isActive={isAgentActive}
                onOpenChat={() => setViewMode('cui')}
                isViewingDraft={isViewingDraft}
              />
              <TipsBar
                tips={currentTips}
                isLoading={isTipsFetching}
                isEditing={isEditing}
                onTipClick={handleTipInteraction}
                onRetryPreview={handleRetryPreview}
                previewingIndex={isViewingDraft ? previewingTipIndex : null}
              />
            </div>
          )}
        </>
      )}

      {/* CUI mode */}
      {viewMode === 'cui' && (
        <AgentChatView
          messages={messages}
          isAgentActive={isAgentActive}
          agentStatus={agentStatus}
          currentImage={timeline[viewIndex]}
          onSendMessage={handleAgentRequest}
          onBack={() => window.history.back()}
          onPipTap={() => window.history.back()}
          onImageTap={handleImageTap}
          focusOnOpen={isViewingDraft}
        />
      )}
    </div>
  );
}
