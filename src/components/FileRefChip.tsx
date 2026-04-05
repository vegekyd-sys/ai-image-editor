'use client';

import { useState, useCallback } from 'react';

interface FileRefChipProps {
  path: string;
  onView?: (path: string) => void;
}

export default function FileRefChip({ path, onView }: FileRefChipProps) {
  const fileName = path.split('/').pop() || path;
  const [pressed, setPressed] = useState(false);

  const handleClick = useCallback(() => {
    onView?.(path);
  }, [path, onView]);

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg cursor-pointer select-none transition-all duration-150"
      style={{
        background: pressed ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)',
        color: 'rgba(255,255,255,0.85)',
        fontSize: 'inherit',
        verticalAlign: 'baseline',
      }}
      onClick={handleClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      title={path}
    >
      <span style={{ fontSize: '0.85em', opacity: 0.7 }}>📄</span>
      <span className="font-mono" style={{ fontSize: '0.9em' }}>{fileName}</span>
      <span style={{ fontSize: '0.7em', opacity: 0.4 }}>↗</span>
    </span>
  );
}
