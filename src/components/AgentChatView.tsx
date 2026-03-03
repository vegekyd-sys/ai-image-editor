'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Message } from '@/types';
import { compressImageFile } from '@/lib/imageUtils';

const INPUT_IMAGE_LABELS = ['当前图（编辑基础）', '原图（人脸参考）'];

/** Collapsible card showing the English editPrompt sent to Gemini, with optional input images */
function EditPromptCard({ prompt, inputImages }: { prompt: string; inputImages?: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)' }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left active:opacity-70 transition-opacity"
      >
        <span className="text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.4)' }}>
          📋 发给 Gemini 的 prompt
        </span>
        <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{open ? '收起 ▲' : '展开 ▼'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2.5">
          {inputImages && inputImages.filter(img => img && img.length > 10).length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.25)' }}>
                传入图片{inputImages.length > 1 ? `（${inputImages.length} 张）` : ''}
              </span>
              <div className="flex gap-2 flex-wrap">
                {inputImages.filter(img => img && img.length > 10).map((img, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img}
                      alt={`Input ${i + 1} to Gemini`}
                      className="rounded-lg object-cover"
                      style={{
                        width: inputImages.length > 1 ? 100 : 'auto',
                        height: inputImages.length > 1 ? 100 : 140,
                        maxHeight: 140,
                        border: '1px solid rgba(255,255,255,0.08)',
                      }}
                    />
                    {inputImages.length > 1 && (
                      <span className="text-[9px] text-center" style={{ color: 'rgba(255,255,255,0.2)' }}>
                        {INPUT_IMAGE_LABELS[i] ?? `图 ${i + 1}`}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-[11px] leading-relaxed whitespace-pre-wrap" style={{ color: 'rgba(255,255,255,0.55)', fontFamily: 'monospace' }}>
            {prompt}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Fix CommonMark strict closing-delimiter rules that break **text:**
 * When closing ** is preceded by punctuation and followed by non-whitespace,
 * it's not recognized as right-flanking. Move the trailing punctuation outside.
 * e.g. "**下一步建议:**在" → "**下一步建议**:在"
 */
function fixMarkdownDelimiters(text: string): string {
  return text.replace(
    /\*\*([^*\n]+?)([;:,.!?，。！？；：、…]+)\*\*(?=[^\s*])/g,
    '**$1**$2'
  );
}

interface AgentChatViewProps {
  messages: Message[];
  isAgentActive: boolean;
  agentStatus: string;
  currentImage?: string;
  onSendMessage: (text: string, attachedImages?: string[]) => void;
  onBack: () => void;
  onPipTap: (rect: DOMRect) => void;
  onImageTap: (messageId: string) => void;
  focusOnOpen?: boolean;
  hidePip?: boolean;
  onInputBarHeight?: (h: number) => void;
  mode?: 'overlay' | 'panel';
}

export default function AgentChatView({
  messages,
  isAgentActive,
  agentStatus,
  currentImage,
  onSendMessage,
  onBack,
  onPipTap,
  onImageTap,
  focusOnOpen = false,
  hidePip = false,
  onInputBarHeight,
  mode = 'overlay',
}: AgentChatViewProps) {
  const [input, setInput] = useState('');
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [isExiting, setIsExiting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const inputBarRef = useRef<HTMLDivElement>(null);
  const scrollStartY = useRef<number | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(56);
  const [inputBarH, setInputBarH] = useState(80);
  // ── Keyboard inset (visualViewport) — no container resize, no jump ──
  const [kbInset, setKbInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKbInset(Math.round(inset));
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
  }, []);

  // ── PiP drag state ──────────────────────────────────────────────
  type PipCorner = 'tl' | 'tr' | 'ml' | 'mr' | 'bl' | 'br';
  const PIP_SIZES = [116, 200] as const; // md / lg (small removed)
  const PIP_M = 14;
  const INPUT_GRADIENT_TOP = 32; // paddingTop on input bar wrapper (gradient zone)
  const PIP_BOTTOM_OFFSET = inputBarH - INPUT_GRADIENT_TOP + 4; // just above actual input box
  const PIP_PEEK = 28;        // px visible when hidden at right edge
  const PIP_EXTRA_PULL = 60;  // px past right margin needed to trigger tuck

  const [pipSizeIndex, setPipSizeIndex] = useState<number>(1); // default lg
  const PIP = PIP_SIZES[pipSizeIndex];
  const [pipCorner, setPipCorner] = useState<PipCorner>('bl');
  const [pipFloatPos, setPipFloatPos] = useState<{ x: number; y: number } | null>(null);
  const [pipHidden, setPipHidden] = useState(false);
  const [pipHiddenEdge, setPipHiddenEdge] = useState<'left' | 'right'>('right');
  const [pipHiddenY, setPipHiddenY] = useState(0);
  const pipDragRef = useRef<{ sx: number; sy: number; ex: number; ey: number } | null>(null);
  const pipDidDrag = useRef(false);
  // Tuck only allowed when drag started from the matching edge corner (two-step UX)
  const pipStartedAtRightEdge = useRef(false);
  const pipStartedAtLeftEdge = useRef(false);

  function pipCornerStyle(corner: PipCorner): React.CSSProperties {
    const m = PIP_M;
    const b = PIP_BOTTOM_OFFSET;
    const topY = headerH + m;
    // Middle: vertically centred in the content area between header and input bar
    const midY = Math.round((headerH + (window.innerHeight - b)) / 2 - PIP / 2);
    if (corner === 'tl') return { top: topY, left: m };
    if (corner === 'tr') return { top: topY, right: m };
    if (corner === 'ml') return { top: midY, left: m };
    if (corner === 'mr') return { top: midY, right: m };
    if (corner === 'bl') return { bottom: b, left: m };
    return { bottom: b, right: m };
  }

  const handleBack = useCallback(() => setIsExiting(true), []);

  const onPipPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation(); // block touch from reaching scroll container (prevents screen jump when keyboard is up)
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    pipDragRef.current = { sx: e.clientX, sy: e.clientY, ex: rect.left, ey: rect.top };
    pipDidDrag.current = false;
    // Only drags starting from an edge corner can tuck that side (two-step UX)
    const W = window.innerWidth;
    pipStartedAtRightEdge.current = rect.right >= W - PIP_M - 8;
    pipStartedAtLeftEdge.current = rect.left <= PIP_M + 8;
  }, [PIP_M]);

  const onPipPointerMove = useCallback((e: React.PointerEvent) => {
    if (!pipDragRef.current || pipHidden) return;
    const dx = e.clientX - pipDragRef.current.sx;
    const dy = e.clientY - pipDragRef.current.sy;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) pipDidDrag.current = true;
    if (!pipDidDrag.current) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    // Both edges: allow dragging into tuck zone past normal margin
    setPipFloatPos({
      x: Math.max(-(PIP - PIP_PEEK), Math.min(W - PIP_PEEK, pipDragRef.current.ex + dx)),
      y: Math.max(PIP_M, Math.min(H - PIP - PIP_BOTTOM_OFFSET, pipDragRef.current.ey + dy)),
    });
  }, [PIP, pipHidden, PIP_PEEK, PIP_M, PIP_BOTTOM_OFFSET]);

  const onPipPointerUp = useCallback((_e: React.PointerEvent) => {
    if (!pipDragRef.current) return;
    const wasDrag = pipDidDrag.current;
    const lastPos = pipFloatPos;
    pipDragRef.current = null;
    pipDidDrag.current = false;

    // Any interaction while hidden → reveal (tap or swipe both work)
    if (pipHidden) {
      setPipHidden(false);
      setPipFloatPos(null);
      return;
    }

    if (wasDrag && lastPos) {
      const W = window.innerWidth;
      const clampedY = Math.max(headerH + PIP_M, Math.min(window.innerHeight - PIP_BOTTOM_OFFSET - PIP, lastPos.y));

      const wasAtRightEdge = pipStartedAtRightEdge.current;
      const wasAtLeftEdge = pipStartedAtLeftEdge.current;
      pipStartedAtRightEdge.current = false;
      pipStartedAtLeftEdge.current = false;
      // Left tuck: must start from left-edge corner AND push past threshold
      if (wasAtLeftEdge && lastPos.x < -(PIP - PIP_PEEK - PIP_EXTRA_PULL)) {
        setPipHiddenEdge('left');
        setPipHiddenY(clampedY);
        setPipHidden(true);
        setPipFloatPos(null);
        return;
      }
      // Right tuck: from right-edge corner, push past right margin
      if (wasAtRightEdge && lastPos.x > W - PIP - PIP_M + PIP_EXTRA_PULL) {
        setPipHiddenEdge('right');
        setPipHiddenY(clampedY);
        setPipHidden(true);
        setPipFloatPos(null);
        return;
      }
      // Normal: snap to nearest corner
      const cx = lastPos.x + PIP / 2;
      const cy = lastPos.y + PIP / 2;
      const isLeft = cx < W / 2;
      const yTop = headerH;
      const yBot = window.innerHeight - PIP_BOTTOM_OFFSET;
      const zone1 = yTop + (yBot - yTop) / 3;
      const zone2 = yTop + (yBot - yTop) * 2 / 3;
      let corner: PipCorner;
      if (cy < zone1) corner = isLeft ? 'tl' : 'tr';
      else if (cy > zone2) corner = isLeft ? 'bl' : 'br';
      else corner = isLeft ? 'ml' : 'mr';
      setPipCorner(corner);
      setPipFloatPos(null);
    } else if (!wasDrag) {
      pipStartedAtRightEdge.current = false;
      pipStartedAtLeftEdge.current = false;
      // Tap PiP body → hero animation + return to GUI
      const pipEl = _e.currentTarget as HTMLElement;
      const kbOpen = window.visualViewport
        ? window.innerHeight - window.visualViewport.height > 50
        : false;
      if (kbOpen) {
        // Dismiss keyboard first; re-measure PiP rect after it closes, then animate
        inputRef.current?.blur();
        setTimeout(() => {
          const rect = pipEl.getBoundingClientRect();
          onPipTap?.(rect);
          handleBack();
        }, 300);
      } else {
        const rect = pipEl.getBoundingClientRect();
        onPipTap?.(rect);
        handleBack();
      }
    }
  }, [pipFloatPos, headerH, pipHidden, PIP, PIP_M, PIP_BOTTOM_OFFSET, PIP_EXTRA_PULL, handleBack, onPipTap]);
  // ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (headerRef.current) setHeaderH(headerRef.current.offsetHeight);
  }, []);

  // Track input bar height so PiP moves up when textarea grows
  useEffect(() => {
    const el = inputBarRef.current;
    if (!el) return;
    const update = () => {
      setInputBarH(el.offsetHeight);
      onInputBarHeight?.(el.offsetHeight);
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, [onInputBarHeight]);

  const isFirstScrollRef = useRef(true);
  useEffect(() => {
    if (isFirstScrollRef.current) {
      isFirstScrollRef.current = false;
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, agentStatus]);

  useEffect(() => {
    if (!focusOnOpen) return;
    inputRef.current?.focus();
    const t = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, [focusOnOpen]);

  // Dismiss keyboard when user scrolls the chat (iOS Safari: native listeners work more reliably)
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const onTouchStart = (e: TouchEvent) => { scrollStartY.current = e.touches[0].clientY; };
    const onTouchMove = (e: TouchEvent) => {
      if (scrollStartY.current === null) return;
      if (Math.abs(e.touches[0].clientY - scrollStartY.current) > 8) {
        inputRef.current?.blur();
      }
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, []);

  // Auto-resize textarea on every input change
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if ((!text && attachedImages.length === 0) || isAgentActive) return;
    onSendMessage(text, attachedImages.length > 0 ? attachedImages : undefined);
    setInput('');
    setAttachedImages([]);
  }, [input, attachedImages, isAgentActive, onSendMessage]);

  const handleAnimationEnd = useCallback(() => {
    if (isExiting) onBack();
  }, [isExiting, onBack]);

  const handleInlineImageClick = useCallback((messageId: string) => {
    setIsExiting(true);
    onImageTap(messageId);
  }, [onImageTap]);


  const isPanel = mode === 'panel';

  return (
    <div
      className={isPanel
        ? 'flex flex-col h-full'
        : `fixed inset-0 z-40 flex flex-col ${isExiting ? 'animate-slide-out-right' : 'animate-slide-in-right'}`
      }
      style={{ background: '#0a0a0a' }}
      onAnimationEnd={isPanel ? undefined : handleAnimationEnd}
    >
      {/* ── Back button (overlay mode only) ── */}
      {!isPanel && (
        <div
          ref={headerRef}
          className="absolute top-0 left-0 z-50 px-3"
          style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
        >
          <button
            onClick={handleBack}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm hover:bg-white/10 active:bg-white/15 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/80">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Floating PiP (overlay mode only) ── */}
      {!isPanel && currentImage && (
        <div
          className="absolute z-50 rounded-2xl overflow-hidden select-none"
          style={{
            width: PIP,
            height: PIP,
            ...(pipHidden
              ? {
                  ...(pipHiddenEdge === 'left'
                    ? { left: -(PIP - PIP_PEEK) }
                    : { right: -(PIP - PIP_PEEK) }
                  ),
                  top: pipHiddenY,
                  transition: 'left 0.4s cubic-bezier(0.34,1.56,0.64,1), right 0.4s cubic-bezier(0.34,1.56,0.64,1), top 0.4s cubic-bezier(0.34,1.56,0.64,1)',
                }
              : pipFloatPos
                ? { left: pipFloatPos.x, top: pipFloatPos.y, transition: 'none' }
                : { ...pipCornerStyle(pipCorner), transition: 'left 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), top 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), right 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), bottom 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), height 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)' }
            ),
            boxShadow: '0 6px 24px rgba(0,0,0,0.55)',
            border: '1.5px solid rgba(255,255,255,0.14)',
            touchAction: 'none',
            cursor: pipFloatPos ? 'grabbing' : 'grab',
            opacity: hidePip ? 0 : 1,
          }}
          onPointerDown={onPipPointerDown}
          onPointerMove={onPipPointerMove}
          onPointerUp={onPipPointerUp}
          onPointerCancel={onPipPointerUp}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentImage}
            alt="Current photo"
            className="w-full h-full object-cover pointer-events-none"
            draggable={false}
          />
          {/* Editing badge — only when visible */}
          {!pipHidden && (
            <div
              className="absolute top-0 left-0 px-1.5 py-0.5 text-[10px] font-medium tracking-wide pointer-events-none"
              style={{
                background: 'rgba(0,0,0,0.55)',
                borderBottomRightRadius: 8,
                color: 'rgba(255,255,255,0.75)',
                backdropFilter: 'blur(4px)',
              }}
            >
              Editing
            </div>
          )}
          {/* Resize handle — bottom-right corner, cycles PIP size */}
          {!pipHidden && (
            <div
              className="absolute bottom-2 right-2 w-6 h-6 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setPipSizeIndex(i => (i + 1) % PIP_SIZES.length);
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                   stroke="rgba(255,255,255,0.8)" strokeWidth="2.5" strokeLinecap="round">
                {PIP === PIP_SIZES[0]
                  ? (<>
                      <polyline points="15 3 21 3 21 9"/>
                      <polyline points="9 21 3 21 3 15"/>
                      <line x1="21" y1="3" x2="14" y2="10"/>
                      <line x1="3" y1="21" x2="10" y2="14"/>
                    </>)
                  : (<>
                      <polyline points="4 14 4 20 10 20"/>
                      <polyline points="20 10 20 4 14 4"/>
                      <line x1="14" y1="10" x2="20" y2="4"/>
                      <line x1="4" y1="20" x2="10" y2="14"/>
                    </>)
                }
              </svg>
            </div>
          )}
          {/* Peek arrow — only when hidden, on the visible edge */}
          {pipHidden && (
            <div
              className="absolute top-0 bottom-0 flex items-center justify-center"
              style={{
                [pipHiddenEdge === 'left' ? 'right' : 'left']: 0,
                width: PIP_PEEK,
                background: `linear-gradient(to ${pipHiddenEdge === 'left' ? 'right' : 'left'}, rgba(0,0,0,0.65) 0%, transparent 100%)`,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                {pipHiddenEdge === 'left'
                  ? <polyline points="9 18 15 12 9 6" />   /* > pull from left */
                  : <polyline points="15 18 9 12 15 6" />  /* < pull from right */
                }
              </svg>
            </div>
          )}
        </div>
      )}

      {/* ── Messages ── */}
      <div ref={messagesRef} className="flex-1 overflow-y-auto overscroll-contain hide-scrollbar px-4 min-h-0" style={{ gap: 0, paddingTop: isPanel ? '16px' : 'calc(max(0.75rem, env(safe-area-inset-top)) + 2.75rem)', paddingBottom: isPanel ? '0' : `${inputBarH}px` }}>
        {/* Empty state */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 pb-10">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(192,38,211,0.15)' }}
            >
              {/* M asterisk icon */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-fuchsia-400">
                <line x1="12" y1="2" x2="12" y2="22" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
              </svg>
            </div>
            <p className={`text-white/25 text-center leading-relaxed max-w-[220px] ${isPanel ? 'text-[14px]' : 'text-[19px]'}`}>
              Tell me what you&apos;d like to do with your photo
            </p>
          </div>
        )}

        {/* Message list */}
        <div className={`flex flex-col ${isPanel ? 'gap-3' : 'gap-5'}`}>
          {messages.map((msg, idx) => (
            <div key={msg.id}>
              {msg.role === 'user' ? (
                /* User bubble — right-aligned pill */
                <div className="flex justify-end">
                  <div
                    className={`text-white/90 leading-relaxed max-w-[82%] ${isPanel ? 'text-[14px]' : 'text-[21px]'}`}
                    style={{
                      background: '#222222',
                      borderRadius: isPanel ? '14px 14px 4px 14px' : '18px 18px 5px 18px',
                      wordBreak: 'break-word',
                    }}
                  >
                    {/* Attached reference images — square thumbnails */}
                    {msg.editInputImages && msg.editInputImages.length > 0 && (
                      <div className={`flex gap-1.5 p-2 ${msg.content ? 'pb-1' : ''}`}>
                        {msg.editInputImages.map((img, i) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={i} src={img} alt="" className="w-20 h-20 rounded-xl object-cover flex-shrink-0" />
                        ))}
                      </div>
                    )}
                    {msg.content && (
                      <div className={isPanel ? 'px-3 py-2' : 'px-4 py-2.5'}>{msg.content}</div>
                    )}
                  </div>
                </div>
              ) : (
                /* Assistant — no bubble, full-width text */
                <div className="flex flex-col gap-2.5">
                  <div className={`${isPanel ? 'text-[14px] leading-[1.6]' : 'text-[22px] leading-[1.68]'} pr-2`} style={{ color: 'rgba(255,255,255,0.84)', wordBreak: 'break-word' }}>
                    {msg.content && (
                      <div className="markdown-body">
                        <ReactMarkdown
                          key={msg.id}
                          remarkPlugins={[remarkGfm]}
                          components={{
                            h1: ({ children }) => <h1 className={`${isPanel ? 'text-[16px]' : 'text-[24px]'} font-bold mt-3 mb-1`}>{children}</h1>,
                            h2: ({ children }) => <h2 className={`${isPanel ? 'text-[15px]' : 'text-[22px]'} font-semibold mt-3 mb-1`}>{children}</h2>,
                            h3: ({ children }) => <h3 className={`${isPanel ? 'text-[14px]' : 'text-[21px]'} font-semibold mt-2 mb-0.5`}>{children}</h3>,
                            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                            strong: ({ children }) => <strong className="font-semibold text-white/95">{children}</strong>,
                            em: ({ children }) => <em className="italic">{children}</em>,
                            del: ({ children }) => <del className="line-through opacity-50">{children}</del>,
                            code: ({ inline, children }: { inline?: boolean; children?: React.ReactNode }) =>
                              inline ? (
                                <code className={`font-mono ${isPanel ? 'text-[12px]' : 'text-[18px]'} px-1.5 py-0.5 rounded`} style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.9)' }}>{children}</code>
                              ) : (
                                <code className={`block font-mono ${isPanel ? 'text-[12px] p-2' : 'text-[18px] p-3'} rounded-xl my-2 overflow-x-auto`} style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)' }}>{children}</code>
                              ),
                            pre: ({ children }) => <pre className="my-0">{children}</pre>,
                            ul: ({ children }) => <ul className="list-none pl-3 my-1.5 space-y-0.5">{children}</ul>,
                            ol: ({ children }) => <ol className="list-none pl-3 my-1.5 space-y-0.5 [counter-reset:item]">{children}</ol>,
                            li: ({ children, ordered }: { children?: React.ReactNode; ordered?: boolean }) => (
                              <li className={`flex gap-2 ${ordered ? '[counter-increment:item]' : ''}`}>
                                <span className="flex-shrink-0 mt-[3px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                                  {ordered ? <span className="font-mono text-[18px] before:content-[counter(item,decimal)_'.']" /> : '•'}
                                </span>
                                <span>{children}</span>
                              </li>
                            ),
                            blockquote: ({ children }) => (
                              <blockquote className="pl-3 my-2" style={{ borderLeft: '2px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.5)' }}>{children}</blockquote>
                            ),
                            hr: () => <hr className="my-3" style={{ borderColor: 'rgba(255,255,255,0.08)' }} />,
                            a: ({ href, children }) => (
                              <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2" style={{ color: 'rgba(192,38,211,0.85)' }}>{children}</a>
                            ),
                            table: ({ children }) => (
                              <div className="overflow-x-auto my-2">
                                <table className={`${isPanel ? 'text-[13px]' : 'text-[20px]'} border-collapse w-full`}>{children}</table>
                              </div>
                            ),
                            th: ({ children }) => <th className="px-3 py-1.5 text-left font-semibold" style={{ borderBottom: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.6)' }}>{children}</th>,
                            td: ({ children }) => <td className="px-3 py-1.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{children}</td>,
                          }}
                        >
                          {fixMarkdownDelimiters(msg.content.replace(/https?:\/\/\S+\.mp4\S*/g, ''))}
                        </ReactMarkdown>
                        {/* Inline video player for animation results */}
                        {(() => {
                          const mp4Match = msg.content.match(/https?:\/\/\S+\.mp4\S*/);
                          if (!mp4Match) return null;
                          return (
                            <div style={{ marginTop: 10, borderRadius: 12, overflow: 'hidden' }}>
                              <video
                                src={mp4Match[0]}
                                controls
                                playsInline
                                style={{ width: '100%', display: 'block', maxHeight: isPanel ? 200 : 360, objectFit: 'contain', background: '#000' }}
                              />
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Typing dots — show when active, last message, no content yet */}
                    {!msg.content && isAgentActive && idx === messages.length - 1 && (
                      <span className="inline-flex gap-[5px] items-center h-[18px] mt-0.5">
                        <span className="typing-dot w-[6px] h-[6px] rounded-full" style={{ background: 'rgba(255,255,255,0.3)' }} />
                        <span className="typing-dot w-[6px] h-[6px] rounded-full" style={{ background: 'rgba(255,255,255,0.3)' }} />
                        <span className="typing-dot w-[6px] h-[6px] rounded-full" style={{ background: 'rgba(255,255,255,0.3)' }} />
                      </span>
                    )}

                    {/* Inline generated image */}
                    {msg.image && (
                      <button
                        onClick={() => handleInlineImageClick(msg.id)}
                        className="block mt-3 active:opacity-75 transition-opacity"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={msg.image}
                          alt="Generated"
                          className={`rounded-2xl max-w-full object-contain ${isPanel ? 'max-h-[180px]' : 'max-h-[280px]'}`}
                          style={{ border: '1px solid rgba(255,255,255,0.08)' }}
                        />
                      </button>
                    )}

                    {/* editPrompt card — collapsible */}
                    {msg.editPrompt && (
                      <EditPromptCard prompt={msg.editPrompt} inputImages={msg.editInputImages} />
                    )}
                  </div>

                </div>
              )}
            </div>
          ))}

          {/* Agent status line — below last message */}
          {isAgentActive && agentStatus && (
            <div className="flex items-center gap-2 pl-0.5">
              <div className="w-1.5 h-1.5 rounded-full bg-fuchsia-400 animate-pulse flex-shrink-0" />
              <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.30)' }}>
                {agentStatus}
              </span>
            </div>
          )}
        </div>

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input bar ── */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          const remaining = 3 - attachedImages.length;
          const toProcess = files.slice(0, remaining);
          const compressed = await Promise.all(toProcess.map(f => compressImageFile(f)));
          setAttachedImages(prev => [...prev, ...compressed].slice(0, 3));
        }}
      />

      <div
        ref={inputBarRef}
        className={isPanel ? 'flex-shrink-0 px-3' : 'absolute left-0 right-0 px-3'}
        style={isPanel ? {
          paddingBottom: '12px',
          paddingTop: '12px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          zIndex: 20,
        } : {
          bottom: kbInset > 0 ? `${kbInset}px` : 0,
          paddingBottom: kbInset > 0 ? '8px' : 'max(0.75rem, env(safe-area-inset-bottom))',
          paddingTop: '32px',
          background: 'linear-gradient(to bottom, transparent 0%, #0a0a0a 32px)',
          zIndex: 20,
        }}
      >
        {/* Two-row layout: textarea on top, toolbar on bottom */}
        <div
          style={{
            background: '#161616',
            borderRadius: '20px',
            border: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          {/* Row 1: Textarea */}
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="你想怎么修改这张图片？"
            className={`w-full bg-transparent outline-none border-none leading-relaxed disabled:opacity-40 resize-none overflow-hidden block ${isPanel ? 'text-[14px]' : 'text-[21px]'}`}
            style={{ color: 'rgba(255,255,255,0.88)', caretColor: '#d946ef', maxHeight: '8rem', padding: isPanel ? '10px 14px 4px' : '12px 16px 6px' }}
          />

          {/* Row 2: Toolbar — 📷 | thumbnails | flex-1 spacer | ↑ */}
          <div className="flex items-center gap-2 px-3 pb-2.5">
            {/* Image attach button */}
            <button
              onClick={() => imageInputRef.current?.click()}
              disabled={isAgentActive || attachedImages.length >= 3}
              className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full transition-all active:scale-90"
              style={{
                background: attachedImages.length > 0 ? 'rgba(192,38,211,0.22)' : 'rgba(255,255,255,0.08)',
                color: attachedImages.length > 0 ? 'rgba(217,70,239,0.9)' : 'rgba(255,255,255,0.35)',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </button>

            {/* Attached image thumbnails */}
            {attachedImages.map((img, i) => (
              <div key={i} className="relative flex-shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img}
                  alt=""
                  className="w-9 h-9 rounded-lg object-cover"
                  style={{ border: '1px solid rgba(255,255,255,0.12)' }}
                />
                <button
                  onClick={() => setAttachedImages(prev => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(20,20,20,0.9)', border: '1px solid rgba(255,255,255,0.18)' }}
                >
                  <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="3.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            ))}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Send button */}
            <button
              onClick={handleSubmit}
              disabled={isAgentActive || (!input.trim() && attachedImages.length === 0)}
              className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full transition-all active:scale-90"
              style={{
                background: (input.trim() || attachedImages.length > 0) && !isAgentActive ? '#c026d3' : 'rgba(255,255,255,0.08)',
                color: (input.trim() || attachedImages.length > 0) && !isAgentActive ? '#fff' : 'rgba(255,255,255,0.25)',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
