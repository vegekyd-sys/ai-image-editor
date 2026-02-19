'use client';

interface AgentStatusBarProps {
  statusText: string;
  isActive: boolean;
  onOpenChat: () => void;
}

export default function AgentStatusBar({ statusText, isActive, onOpenChat }: AgentStatusBarProps) {
  // Determine dot color and breathe speed based on state
  const isGeneratingImages = statusText.includes('正使用nano banana');
  const isFetchingTips = statusText.includes('Ready to Suprise');

  let dotColor: string;
  let breatheDuration: string;
  if (isActive) {
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

  return (
    <>
      <style>{`
        @keyframes breathe {
          0%, 100% { transform: scale(1);   opacity: 0.55; }
          50%       { transform: scale(1.9); opacity: 1; }
        }
      `}</style>
      <div className="flex items-center gap-3 px-4 py-3 min-h-[52px]">
        {/* Dot — always colored, always breathing */}
        <div
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{
            background: dotColor,
            animation: `breathe ${breatheDuration} ease-in-out infinite`,
          }}
        />

        {/* Status / greeting text */}
        <div className="flex-1 text-white/50 text-[13px] truncate">
          {statusText}
        </div>

        {/* Chat button */}
        <button
          onClick={onOpenChat}
          className="px-3 py-1.5 rounded-full bg-white/8 text-white/70 text-[12px] font-medium hover:bg-white/12 active:scale-95 transition-all flex-shrink-0"
        >
          Chat
        </button>
      </div>
    </>
  );
}
