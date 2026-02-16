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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const snapshotsRef = useRef(snapshots);
  snapshotsRef.current = snapshots;
  const viewIndexRef = useRef(viewIndex);
  viewIndexRef.current = viewIndex;

  const assistantMsgCount = messages.filter((m) => m.role === 'assistant').length;
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

  // Fetch tips via SSE stream — each tip appears as soon as it's generated
  const fetchTipsForSnapshot = useCallback(async (snapshotId: string, imageBase64: string) => {
    setIsTipsFetching(true);
    try {
      const res = await fetch('/api/tips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageBase64 }),
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
                setSnapshots((prev) => prev.map((s) =>
                  s.id === snapshotId ? { ...s, tips: [...s.tips, tip] } : s
                ));
              }
            } catch { /* skip malformed */ }
          }
        }
      }
    } catch {
      // Silent fail — tips are optional
    } finally {
      setIsTipsFetching(false);
    }
  }, []);

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

    // Upload: start tips fetch immediately in parallel with text analysis
    if (uploadSnapshotId && image) {
      fetchTipsForSnapshot(uploadSnapshotId, image);
    }

    try {
      await streamChat(
        {
          sessionId,
          message: text,
          image: image || undefined,
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

  const handleTipClick = useCallback(async (tip: Tip) => {
    addMessage('user', tip.label);

    const assistantMsgId = generateId();
    setMessages((prev) => [...prev, {
      id: assistantMsgId,
      role: 'assistant' as const,
      content: '',
      timestamp: Date.now(),
    }]);

    setIsEditing(true);

    try {
      let newSnapshotId: string | undefined;
      const currentImage = snapshotsRef.current[viewIndexRef.current]?.image;

      await streamChat(
        {
          sessionId,
          message: tip.editPrompt,
          image: currentImage || undefined,
          wantImage: true,
          aspectRatio: tip.aspectRatio,
        },
        {
          onContent: (delta) => {
            setMessages((prev) => prev.map((m) =>
              m.id === assistantMsgId ? { ...m, content: m.content + delta } : m
            ));
          },
          onImage: (imageData) => {
            newSnapshotId = generateId();
            const newSnapshot: Snapshot = {
              id: newSnapshotId,
              image: imageData,
              tips: [],
              messageId: assistantMsgId,
            };
            setSnapshots((prev) => [...prev, newSnapshot]);
            // Start tips fetch immediately when image arrives
            fetchTipsForSnapshot(newSnapshotId, imageData);
          },
        }
      );

      if (!newSnapshotId) {
        setMessages((prev) => prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: m.content || 'Image editing failed. Please try again.' }
            : m
        ));
      }
    } catch (err) {
      console.error('Tip click error:', err);
      setMessages((prev) => prev.map((m) =>
        m.id === assistantMsgId
          ? { ...m, content: 'Image editing failed. Please try again.' }
          : m
      ));
    } finally {
      setIsEditing(false);
    }
  }, [addMessage, sessionId, fetchTipsForSnapshot]);

  const compressAndUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/') && !file.name.match(/\.(heic|heif)$/i)) return;

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
            onIndexChange={setViewIndex}
            isEditing={isEditing}
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
            isLoading={isLoading || isEditing || isTipsFetching}
            isEditing={isEditing}
            onTipClick={handleTipClick}
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
