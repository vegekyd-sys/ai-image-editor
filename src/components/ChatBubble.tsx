'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Message } from '@/types';

// Lightweight markdown renderer — handles **bold**, *italic*, `code`, bullet lists, headers
function renderMarkdown(text: string): string {
  return text
    // Headers: ### → h3, ## → h2, etc (must be at line start)
    .replace(/^### (.+)$/gm, '<strong class="block mt-2 mb-0.5">$1</strong>')
    .replace(/^## (.+)$/gm, '<strong class="block mt-2 mb-0.5 text-sm">$1</strong>')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="bg-white/10 px-1 rounded text-[12px]">$1</code>')
    // Bullet lists (- or *)
    .replace(/^[\-\*] (.+)$/gm, '<span class="block pl-3 relative before:content-[\'•\'] before:absolute before:left-0">$1</span>');
}

interface ChatBubbleProps {
  messages: Message[];
  isLoading: boolean;
  isOpen: boolean;
  onClose: () => void;
  onSendMessage: (text: string) => void;
  hasImage: boolean;
  scrollToMessageId?: string;
}

export default function ChatBubble({ messages, isLoading, isOpen, onClose, onSendMessage, hasImage, scrollToMessageId }: ChatBubbleProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, messages]);

  // Scroll to target message when scrollToMessageId changes (image swipe)
  useEffect(() => {
    if (isOpen && scrollToMessageId && containerRef.current) {
      const el = containerRef.current.querySelector(`[data-message-id="${scrollToMessageId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [isOpen, scrollToMessageId]);

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    onSendMessage(text);
    setInput('');
  };

  if (!isOpen) return null;

  return (
    <div className="absolute bottom-0 right-0 left-0 z-30">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />

      {/* Panel anchored bottom-right */}
      <div className="absolute bottom-2 right-3 w-[340px] max-w-[calc(100vw-24px)] bg-[#0d0d14] rounded-2xl shadow-2xl border border-fuchsia-500/20 flex flex-col overflow-hidden z-10">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 flex-shrink-0">
          <span className="text-white text-sm font-medium">AI Assistant</span>
          <button onClick={onClose} className="text-white/60 hover:text-white p-1">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div ref={containerRef} className="overflow-y-auto hide-scrollbar px-3 py-3 space-y-2.5 max-h-[50vh] min-h-[120px]">
          {messages.length === 0 && (
            <div className="text-white/40 text-xs text-center py-4">
              Upload a photo to start chatting
            </div>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              data-message-id={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-fuchsia-600 text-white rounded-br-sm'
                    : 'bg-white/10 text-white/90 rounded-bl-sm'
                }`}
              >
                {msg.image && (
                  <div className="mb-1 text-[11px] text-white/40">[Photo uploaded]</div>
                )}
                {msg.role === 'assistant' ? (
                  <div
                    className="whitespace-pre-wrap [&_strong]:font-semibold [&_em]:italic"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                  />
                ) : (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white/10 rounded-2xl rounded-bl-sm px-3.5 py-2.5">
                <div className="flex gap-1">
                  <span className="typing-dot w-1.5 h-1.5 bg-white/50 rounded-full" />
                  <span className="typing-dot w-1.5 h-1.5 bg-white/50 rounded-full" />
                  <span className="typing-dot w-1.5 h-1.5 bg-white/50 rounded-full" />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        {hasImage && (
          <div className="px-3 py-2 border-t border-white/10 flex-shrink-0">
            <div className="flex items-center gap-2 bg-white/10 rounded-full px-3 py-1.5">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder="Tell AI how to edit..."
                className="flex-1 bg-transparent border-none outline-none text-[13px] text-white placeholder:text-white/30"
                disabled={isLoading}
              />
              <button
                onClick={handleSubmit}
                disabled={isLoading || !input.trim()}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-fuchsia-600 text-white disabled:opacity-30 transition-opacity flex-shrink-0"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
