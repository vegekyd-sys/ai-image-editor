'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface ShareButtonProps {
  projectId: string;
  readOnly?: boolean;
}

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  return Promise.resolve();
}

export default function ShareButton({ projectId, readOnly }: ShareButtonProps) {
  const router = useRouter();
  const [showPopover, setShowPopover] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [toast, setToast] = useState(false);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPressRef = useRef(false);

  useEffect(() => {
    if (!showPopover) return;
    const close = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-share-popover]')) return;
      setShowPopover(false);
    };
    const timer = setTimeout(() => document.addEventListener('pointerdown', close), 100);
    return () => { clearTimeout(timer); document.removeEventListener('pointerdown', close); };
  }, [showPopover]);

  const showToast = () => {
    setToast(true);
    setTimeout(() => setToast(false), 2000);
  };

  const shareUrl = () => `${window.location.origin}/projects/${projectId}`;

  const handleClick = () => {
    if (didLongPressRef.current) { didLongPressRef.current = false; return; }
    if (showPopover) { setShowPopover(false); return; }
    const url = shareUrl();
    if (navigator.share && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
      navigator.share({ url }).catch(() => {});
    } else {
      copyToClipboard(url).then(showToast).catch(() => {});
    }
  };

  if (readOnly) {
    return (
      <button
        onClick={() => {
          sessionStorage.setItem('mkr_return_url', window.location.pathname);
          router.push('/login');
        }}
        className="px-3 py-1.5 rounded-full text-xs font-medium backdrop-blur-sm border transition-all cursor-pointer text-white bg-white/10 border-white/20 hover:bg-white/20"
      >
        Log in
      </button>
    );
  }

  return (
    <>
      <div className="relative">
        <button
          onClick={handleClick}
          onTouchStart={(e) => {
            e.preventDefault();
            didLongPressRef.current = false;
            longPressRef.current = setTimeout(() => {
              longPressRef.current = null;
              didLongPressRef.current = true;
              setShowPopover(true);
            }, 400);
          }}
          onTouchEnd={() => { if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; } }}
          onTouchCancel={() => { if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; } }}
          onPointerDown={(e) => {
            if (e.pointerType === 'touch') return;
            didLongPressRef.current = false;
            longPressRef.current = setTimeout(() => {
              longPressRef.current = null;
              didLongPressRef.current = true;
              setShowPopover(true);
            }, 400);
          }}
          onPointerUp={(e) => { if (e.pointerType === 'touch') return; if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; } }}
          onContextMenu={e => e.preventDefault()}
          className="p-1.5 rounded-full cursor-pointer text-white/80 hover:text-white transition-colors select-none"
          style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        </button>
        {showPopover && (
          <div data-share-popover className="absolute bottom-full right-0 mb-2 min-w-[200px] rounded-2xl border border-white/15 shadow-2xl p-4 z-50" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}>
            <div className="flex items-center justify-between gap-4 mb-4">
              <span className="text-sm font-medium text-white/90 whitespace-nowrap">Public link</span>
              <button
                onClick={() => {
                  const next = !isPublic;
                  setIsPublic(next);
                  fetch(`/api/projects/${projectId}/share`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ is_public: next }),
                  }).catch(() => {});
                }}
                style={{ width: 40, height: 24, flexShrink: 0 }}
                className={`rounded-full transition-colors relative cursor-pointer ${isPublic ? 'bg-fuchsia-500' : 'bg-white/20'}`}
              >
                <span
                  style={{ width: 18, height: 18, top: 3, left: isPublic ? 19 : 3 }}
                  className="absolute rounded-full bg-white transition-all duration-200"
                />
              </button>
            </div>
            <button
              onClick={() => {
                copyToClipboard(shareUrl()).then(showToast).catch(() => {});
                setShowPopover(false);
              }}
              className="w-full text-sm text-white/90 hover:text-white py-2 px-3 rounded-xl hover:bg-white/5 cursor-pointer transition-colors text-center border border-white/10"
            >
              Copy link
            </button>
          </div>
        )}
      </div>
      {toast && (
        <div
          className="fixed top-20 left-1/2 -translate-x-1/2 z-[300] px-5 py-2.5 rounded-full bg-black/80 backdrop-blur-sm text-white text-sm font-medium shadow-lg"
          style={{ animation: 'fadeInOut 2s ease both' }}
        >
          Link copied!
        </div>
      )}
    </>
  );
}
