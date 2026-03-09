'use client';

import { useLocale } from '@/lib/i18n';

interface AgentStatusBarProps {
  statusText: string;
  isActive: boolean;
  onOpenChat: () => void;
  isViewingDraft?: boolean;
  hideChat?: boolean;
  onAnimate?: () => void;
  hasVideo?: boolean;
  snapshotCount?: number;
  notification?: { text: string } | null;
  onSeeNotification?: () => void;
}

export default function AgentStatusBar({ statusText, isActive, onOpenChat, isViewingDraft, hideChat, onAnimate, hasVideo, snapshotCount = 0, notification, onSeeNotification }: AgentStatusBarProps) {
  const { t } = useLocale();
  const videoLit = snapshotCount > 3 && !hasVideo;
  // Determine dot color and breathe speed based on state
  const isGeneratingImages = statusText.includes('previews') || statusText.includes('预览');
  const isFetchingTips = statusText === t('status.generatingTips');

  let dotColor: string;
  let breatheDuration: string;
  if (notification) {
    dotColor = '#e879f9'; // fuchsia-400 — important notification
    breatheDuration = '1s';
  } else if (isActive) {
    dotColor = '#e879f9'; // fuchsia-400
    breatheDuration = '1s';
  } else if (isGeneratingImages) {
    dotColor = '#c084fc'; // purple-400
    breatheDuration = '1.6s';
  } else if (isFetchingTips) {
    dotColor = '#fbbf24'; // amber-400
    breatheDuration = '2s';
  } else {
    dotColor = '#a78bfa'; // violet-400
    breatheDuration = '2.8s';
  }

  // Display text priority: notification > draft hint > normal status
  const displayText = notification ? notification.text
    : isViewingDraft ? t('statusbar.likeEffect')
    : statusText;

  return (
    <>
      <style>{`
        @keyframes breathe {
          0%, 100% { transform: scale(1);   opacity: 0.55; }
          50%       { transform: scale(1.9); opacity: 1; }
        }
      `}</style>
      <div
        className="flex items-center gap-3 px-4 py-2 min-h-[44px] active:opacity-70 transition-opacity cursor-pointer"
        onClick={onOpenChat}
      >
        {/* Dot — always colored, always breathing */}
        <div
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{
            background: dotColor,
            animation: `breathe ${breatheDuration} ease-in-out infinite`,
          }}
        />

        {/* Status / greeting text */}
        <div className={`flex-1 text-[13px] truncate ${notification ? 'text-white/80' : 'text-white/50'}`}>
          {displayText}
        </div>

        {/* "See" button — shown when there's a pending notification */}
        {notification && onSeeNotification && (
          <button
            onClick={e => { e.stopPropagation(); onSeeNotification(); }}
            className="px-3 py-1.5 rounded-full text-[12px] font-medium active:scale-95 transition-all flex-shrink-0 cursor-pointer"
            style={{
              background: 'rgba(192,38,211,0.25)',
              color: '#e879f9',
              border: '1px solid rgba(192,38,211,0.4)',
            }}
          >
            See
          </button>
        )}

        {/* Chat button (hidden on desktop where CUI panel is always visible) */}
        {!hideChat && (
          <button
            onClick={e => { e.stopPropagation(); onOpenChat(); }}
            className="px-3 py-1.5 rounded-full text-[12px] font-medium active:scale-95 transition-all flex-shrink-0 cursor-pointer"
            style={isViewingDraft && !notification ? {
              background: 'rgba(192,38,211,0.25)',
              color: '#e879f9',
              border: '1px solid rgba(192,38,211,0.4)',
            } : {
              background: 'rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.7)',
            }}
          >
            Chat
          </button>
        )}

        {/* Video button — right of Chat, lights up when snapshots > 3 or has video */}
        {onAnimate && (
          <button
            onClick={e => { e.stopPropagation(); onAnimate(); }}
            className="flex items-center justify-center px-3 h-[30px] rounded-full text-[12px] font-medium active:scale-95 transition-all flex-shrink-0 cursor-pointer"
            style={videoLit ? {
              background: 'rgba(192,38,211,0.25)',
              color: '#e879f9',
              border: '1px solid rgba(192,38,211,0.4)',
            } : {
              background: 'rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.7)',
            }}
          >
            {/* Play triangle */}
            <svg width="9" height="10" viewBox="0 0 9 10" fill="currentColor">
              <path d="M1 1.5L8 5L1 8.5V1.5Z"/>
            </svg>
          </button>
        )}
      </div>
    </>
  );
}
