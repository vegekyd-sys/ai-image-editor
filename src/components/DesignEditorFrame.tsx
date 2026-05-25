'use client';

import type { CSSProperties, ReactNode } from 'react';

interface DesignEditorFrameProps {
  children: ReactNode;
  desktopWidth: number;
  isDesktop: boolean;
  keyboardInset: number;
}

export default function DesignEditorFrame({
  children,
  desktopWidth,
  isDesktop,
  keyboardInset,
}: DesignEditorFrameProps) {
  const style: CSSProperties = isDesktop
    ? {
        position: 'absolute',
        bottom: 160,
        left: 12,
        zIndex: 201,
        width: desktopWidth,
      }
    : {
        position: 'fixed',
        bottom: keyboardInset,
        left: 0,
        right: 0,
        zIndex: 201,
        maxWidth: 480,
        margin: '0 auto',
        transition: keyboardInset > 0 ? 'bottom 0.1s ease-out' : undefined,
      };

  return <div style={style}>{children}</div>;
}

