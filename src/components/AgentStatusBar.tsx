'use client';

interface AgentStatusBarProps {
  statusText: string;
  isActive: boolean;
  onOpenChat: () => void;
}

export default function AgentStatusBar({ statusText, isActive, onOpenChat }: AgentStatusBarProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 min-h-[52px]">
      {/* Dot — pulses only when active */}
      <div
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors ${
          isActive ? 'bg-fuchsia-400 animate-pulse' : 'bg-white/20'
        }`}
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
  );
}
