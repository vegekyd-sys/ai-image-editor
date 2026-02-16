'use client';

import { useState, useRef, useEffect } from 'react';
import { Message } from '@/types';
import MessageBubble, { TypingIndicator } from './MessageBubble';
import ImageUploader from './ImageUploader';

interface ChatPanelProps {
  messages: Message[];
  isLoading: boolean;
  onSendMessage: (text: string, image?: string) => void;
}

export default function ChatPanel({ messages, isLoading, onSendMessage }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleImageSelect = (base64: string) => {
    if (isLoading) return;
    // Auto-send image for analysis
    onSendMessage('Please analyze this image and give me editing tips.', base64);
  };

  const handleSubmit = () => {
    const text = input.trim();
    if (!text) return;
    if (isLoading) return;

    onSendMessage(text);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto hide-scrollbar px-4 pt-3 pb-2">
        {messages.length === 0 && (
          <div className="text-center text-text-secondary text-sm mt-8">
            <p className="font-medium mb-1">Send a photo to get started</p>
            <p className="text-xs">I&apos;ll analyze it and suggest edits</p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isLoading && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <div className="px-3 py-2 border-t border-border bg-surface">
        <div className="flex items-end gap-2 bg-surface-secondary rounded-2xl px-2 py-1.5">
          <ImageUploader
            onImageSelect={handleImageSelect}
            disabled={isLoading}
          />
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe how to edit..."
            rows={1}
            className="flex-1 bg-transparent border-none outline-none resize-none text-sm py-2 max-h-24 placeholder:text-text-secondary"
            disabled={isLoading}
          />
          <button
            onClick={handleSubmit}
            disabled={isLoading || !input.trim()}
            className="flex items-center justify-center w-9 h-9 rounded-full bg-primary text-white disabled:opacity-40 transition-opacity"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
