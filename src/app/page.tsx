'use client';

import { useState, useRef, useCallback, useMemo } from 'react';
import { Message, Tip, Snapshot } from '@/types';
import ChatBubble from '@/components/ChatBubble';
import ImageCanvas from '@/components/ImageCanvas';
import TipsBar from '@/components/TipsBar';

function generateId() {
  return Date.now().toString() + Math.random().toString(36).slice(2);
}

function compressClientSide(file: File, maxSize = 1024, quality = 0.85): Promise<string> {
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

async function streamChat(
  body: {
    sessionId: string;
    message: string;
    image?: string;
    wantImage?: boolean;
    aspectRatio?: string;
    reset?: boolean;
  },
  callbacks: {
    onContent: (text: string) => void;
    onImage: (image: string) => void;
  }
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error('Chat request failed');

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const message = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (message.startsWith('data: ')) {
        let data;
        try {
          data = JSON.parse(message.slice(6));
        } catch {
          continue;
        }
        switch (data.type) {
          case 'content': callbacks.onContent(data.text); break;
          case 'image': callbacks.onImage(data.image); break;
          case 'error': throw new Error(data.message || 'Stream error');
        }
      }
    }
  }
}

export default function Home() {
  const [sessionId] = useState(() => generateId());
  const [messages, setMessages] = useState<Message[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isTipsFetching, setIsTipsFetching] = useState(false);
  const [viewIndex, setViewIndex] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [lastSeenMsgCount, setLastSeenMsgCount] = useState(0);
  const [previewingTipIndex, setPreviewingTipIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewAbortRef = useRef<AbortController>(new AbortController());

  const snapshotsRef = useRef(snapshots);
  snapshotsRef.current = snapshots;
  const viewIndexRef = useRef(viewIndex);
  viewIndexRef.current = viewIndex;

  const assistantMsgCount = messages.filter((m) => m.role === 'assistant').length;
  const assistantMsgCountRef = useRef(assistantMsgCount);
  assistantMsgCountRef.current = assistantMsgCount;
  const hasUnread = assistantMsgCount > lastSeenMsgCount;

  const timeline = useMemo(() => snapshots.map((s) => s.image), [snapshots]);
  const currentTips = snapshots[viewIndex]?.tips ?? [];

  // Auto-jump to latest when timeline grows
  const prevTimelineLen = useRef(0);
  if (timeline.length !== prevTimelineLen.current) {
    if (timeline.length > prevTimelineLen.current) {
      setViewIndex(timeline.length - 1);
    }
    prevTimelineLen.current = timeline.length;
  }

  const addMessage = useCallback((role: 'user' | 'assistant', content: string, image?: string) => {
    const msg: Message = {
      id: generateId(),
      role,
      content,
      image,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, msg]);
    return msg;
  }, []);

  // Generate preview image for a single tip (fire-and-forget)
  // Uses editPrompt as key to find the tip (safe with concurrent streams)
  const generatePreviewForTip = useCallback(async (
    snapshotId: string,
    editPrompt: string,
    imageBase64: string,
    aspectRatio?: string,
  ) => {
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

      setSnapshots((prev) => prev.map((s) => {
        if (s.id !== snapshotId) return s;
        const tips = s.tips.map(t =>
          t.editPrompt === editPrompt ? { ...t, previewImage: image, previewStatus: 'done' as const } : t
        );
        return { ...s, tips };
      }));
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
  }, []);

  // Fetch tips via 3 parallel SSE streams (one per category) for faster loading
  const fetchTipsForSnapshot = useCallback((snapshotId: string, imageBase64: string) => {
    setIsTipsFetching(true);
    // Fresh abort controller for this batch of previews
    previewAbortRef.current = new AbortController();

    const categories = ['enhance', 'creative', 'wild'] as const;
    let completedCount = 0;
    let firstTipReceived = false;

    const fetchCategory = async (category: string) => {
      try {
        const res = await fetch('/api/tips', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: imageBase64, category }),
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
                if (tip.label && tip.editPrompt && tip.category) {
                  tip.previewStatus = 'pending';
                  setSnapshots((prev) => prev.map((s) =>
                    s.id === snapshotId ? { ...s, tips: [...s.tips, tip] } : s
                  ));
                  // Auto-close chat panel on first tip arrival
                  if (!firstTipReceived) {
                    firstTipReceived = true;
                    setChatOpen(false);
                  }
                  // Fire preview generation immediately
                  generatePreviewForTip(snapshotId, tip.editPrompt, imageBase64, tip.aspectRatio);
                }
              } catch { /* skip malformed */ }
            }
          }
        }
      } catch {
        // Silent fail — tips are optional
      } finally {
        completedCount++;
        if (completedCount === categories.length) {
          setIsTipsFetching(false);
        }
      }
    };

    // Fire all 3 category streams in parallel
    categories.forEach(cat => fetchCategory(cat));
  }, [generatePreviewForTip]);

  const handleSendMessage = useCallback(async (text: string, image?: string) => {
    let uploadSnapshotId: string | undefined;
    const isUpload = !!image;

    if (isUpload) {
      uploadSnapshotId = generateId();
      const immediateSnapshot: Snapshot = {
        id: uploadSnapshotId,
        image,
        tips: [],
        messageId: '',
      };
      setSnapshots([immediateSnapshot]);
      snapshotsRef.current = [immediateSnapshot];
      setViewIndex(0);
      prevTimelineLen.current = 1;
    }

    addMessage('user', text, image);

    const assistantMsgId = generateId();
    setMessages((prev) => [...prev, {
      id: assistantMsgId,
      role: 'assistant' as const,
      content: '',
      timestamp: Date.now(),
    }]);

    if (uploadSnapshotId) {
      setSnapshots((prev) =>
        prev.map((s) =>
          s.id === uploadSnapshotId ? { ...s, messageId: assistantMsgId } : s
        )
      );
    }

    setIsLoading(true);

    // Auto-open chat panel on upload so user sees streaming analysis
    if (isUpload) {
      setChatOpen(true);
      setLastSeenMsgCount(assistantMsgCountRef.current + 1);
    }

    // Upload: start tips fetch after a short delay so the chat analysis
    // gets priority (avoids API rate limit contention with 4 concurrent requests)
    if (uploadSnapshotId && image) {
      const snapId = uploadSnapshotId;
      const img = image;
      setTimeout(() => fetchTipsForSnapshot(snapId, img), 2000);
    }

    // For non-upload chat messages: send the current image + wantImage so
    // the model can generate edited images when the user asks for edits
    const chatImage = isUpload
      ? image
      : snapshotsRef.current[viewIndexRef.current]?.image || undefined;
    const chatWantImage = !isUpload && !!chatImage;

    try {
      await streamChat(
        {
          sessionId,
          message: text,
          image: chatImage,
          wantImage: chatWantImage,
          reset: isUpload,
        },
        {
          onContent: (delta) => {
            setMessages((prev) => prev.map((m) =>
              m.id === assistantMsgId ? { ...m, content: m.content + delta } : m
            ));
          },
          onImage: (imageData) => {
            // Image generated in chat (e.g. model decided to edit)
            const snapId = generateId();
            const newSnapshot: Snapshot = {
              id: snapId,
              image: imageData,
              tips: [],
              messageId: assistantMsgId,
            };
            setSnapshots((prev) => [...prev, newSnapshot]);
            // Start tips fetch immediately when image arrives
            fetchTipsForSnapshot(snapId, imageData);
          },
        }
      );
    } catch (err) {
      console.error('Send message error:', err);
      setMessages((prev) => prev.map((m) =>
        m.id === assistantMsgId
          ? { ...m, content: m.content || 'Something went wrong. Please try again.' }
          : m
      ));
    } finally {
      setIsLoading(false);
    }
  }, [addMessage, sessionId, fetchTipsForSnapshot]);

  // Commit a tip: use its preview image directly (no re-generation)
  const commitTip = useCallback((tip: Tip) => {
    if (!tip.previewImage) return;

    // Cancel remaining preview generations
    previewAbortRef.current.abort();
    setPreviewingTipIndex(null);

    // Add chat messages for context
    addMessage('user', tip.label);
    const assistantMsg = addMessage('assistant', `已应用编辑：${tip.desc}`);

    // Create new snapshot from the preview image
    const snapId = generateId();
    const newSnapshot: Snapshot = {
      id: snapId,
      image: tip.previewImage,
      tips: [],
      messageId: assistantMsg.id,
    };
    setSnapshots((prev) => [...prev, newSnapshot]);

    // Fetch new tips for the committed image
    fetchTipsForSnapshot(snapId, tip.previewImage);
  }, [addMessage, fetchTipsForSnapshot]);

  // Two-click interaction: first click = preview, second click = commit
  const handleTipInteraction = useCallback((tip: Tip, tipIndex: number) => {
    if (previewingTipIndex === tipIndex) {
      // Second click on same tip → commit
      commitTip(tip);
    } else {
      // First click → preview
      setPreviewingTipIndex(tipIndex);
    }
  }, [previewingTipIndex, commitTip]);

  // Computed preview image for canvas
  const previewImage = useMemo(() => {
    if (previewingTipIndex === null) return undefined;
    const tip = currentTips[previewingTipIndex];
    return tip?.previewImage || undefined;
  }, [previewingTipIndex, currentTips]);

  const dismissPreview = useCallback(() => {
    setPreviewingTipIndex(null);
  }, []);

  // Dismiss preview when navigating timeline
  const handleIndexChange = useCallback((index: number) => {
    setViewIndex(index);
    setPreviewingTipIndex(null);
  }, []);

  const compressAndUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/') && !file.name.match(/\.(heic|heif)$/i)) return;

    // Cancel any in-flight preview generations
    previewAbortRef.current.abort();
    setPreviewingTipIndex(null);

    const previewUrl = URL.createObjectURL(file);
    const previewId = generateId();
    setSnapshots([{ id: previewId, image: previewUrl, tips: [], messageId: '' }]);
    setViewIndex(0);
    prevTimelineLen.current = 1;

    try {
      let base64: string;
      try {
        base64 = await compressClientSide(file);
      } catch {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        if (!res.ok) throw new Error('Image conversion failed');
        base64 = (await res.json()).image;
      }
      URL.revokeObjectURL(previewUrl);

      handleSendMessage('Please analyze this image and give me editing tips.', base64);
    } catch (err) {
      console.error('Image upload error:', err);
      URL.revokeObjectURL(previewUrl);
      addMessage('assistant', 'Failed to process image. Please try a different photo.');
    }
  }, [handleSendMessage, addMessage]);

  const handleDownload = useCallback(() => {
    const img = timeline[viewIndex];
    if (!img) return;
    const link = document.createElement('a');
    link.href = img;
    link.download = `ai-edited-${Date.now()}.jpg`;
    link.click();
  }, [timeline, viewIndex]);

  const handleChatOpen = useCallback(() => {
    setChatOpen(true);
    setLastSeenMsgCount(assistantMsgCount);
  }, [assistantMsgCount]);

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

      {/* Canvas area (fills remaining space) */}
      <div className="flex-1 relative min-h-0">
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
            previewImage={previewImage}
            onDismissPreview={dismissPreview}
          />
        )}

        {/* Top toolbar */}
        {snapshots.length > 0 && (
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent z-10">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-white/80 hover:text-white p-2"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>

            <div className="flex items-center gap-2">
              {timeline.length > 1 && (
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

      {/* Bottom tips bar */}
      {snapshots.length > 0 && (
        <div className="flex-shrink-0 bg-gradient-to-t from-black via-black/90 to-transparent">
          <TipsBar
            tips={currentTips}
            isLoading={isLoading || isTipsFetching}
            isEditing={isEditing}
            onTipClick={handleTipInteraction}
            previewingIndex={previewingTipIndex}
          />
        </div>
      )}

      {/* Chat button — fixed bottom-right */}
      {snapshots.length > 0 && (
        <button
          onClick={handleChatOpen}
          className="fixed bottom-[env(safe-area-inset-bottom)] right-3 mb-3 z-20 w-10 h-10 rounded-full bg-fuchsia-600 text-white shadow-lg shadow-fuchsia-500/25 flex items-center justify-center hover:bg-fuchsia-500 active:scale-95 transition-all"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {hasUnread && (
            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-fuchsia-300 rounded-full border-2 border-black" />
          )}
        </button>
      )}

      {/* Chat panel */}
      <ChatBubble
        messages={messages}
        isLoading={isLoading || isEditing}
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        onSendMessage={handleSendMessage}
        hasImage={snapshots.length > 0}
        scrollToMessageId={snapshots[viewIndex]?.messageId}
      />
    </div>
  );
}
