'use client';

import { Message } from '@/types';

interface MessageBubbleProps {
  message: Message;
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-primary text-white rounded-br-md'
            : 'bg-surface text-foreground rounded-bl-md shadow-sm border border-border'
        }`}
      >
        {message.image && (
          <img
            src={message.image}
            alt="uploaded"
            className="rounded-lg mb-2 max-w-full max-h-48 object-contain"
          />
        )}
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex justify-start mb-3">
      <div className="bg-surface rounded-2xl rounded-bl-md px-4 py-3 shadow-sm border border-border">
        <div className="flex gap-1.5">
          <span className="typing-dot w-2 h-2 bg-text-secondary rounded-full" />
          <span className="typing-dot w-2 h-2 bg-text-secondary rounded-full" />
          <span className="typing-dot w-2 h-2 bg-text-secondary rounded-full" />
        </div>
      </div>
    </div>
  );
}
