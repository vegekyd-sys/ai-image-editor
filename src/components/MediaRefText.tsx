'use client';

import { useMemo } from 'react';
import ImageRefChip from '@/components/ImageRefChip';
import type { Snapshot } from '@/types';

interface MediaRefTextProps {
  text: string;
  mediaUrls: string[];
  onNavigate?: (index: number) => void;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Renders text with <<<media_N>>> / <<<image_N>>> tokens replaced by clickable ImageRefChip.
 * mediaUrls[0] corresponds to <<<media_1>>>, etc.
 */
export default function MediaRefText({ text, mediaUrls, onNavigate, className, style }: MediaRefTextProps) {
  const snapshots: Snapshot[] = useMemo(
    () => mediaUrls.map((url, i) => ({ id: `media-${i}`, image: '', imageUrl: url, tips: [], messageId: '' })),
    [mediaUrls],
  );

  const parts = useMemo(() => {
    const result: (string | { index: number })[] = [];
    const regex = /<<<(?:image|media)_(\d+)>>>/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        result.push(text.slice(lastIndex, match.index));
      }
      result.push({ index: parseInt(match[1]) - 1 });
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
      result.push(text.slice(lastIndex));
    }
    return result;
  }, [text]);

  return (
    <span className={className} style={style}>
      {parts.map((part, i) =>
        typeof part === 'string' ? (
          <span key={i}>{part}</span>
        ) : (
          <ImageRefChip
            key={i}
            index={part.index}
            snapshot={snapshots[part.index]}
            onNavigate={onNavigate}
          />
        ),
      )}
    </span>
  );
}
