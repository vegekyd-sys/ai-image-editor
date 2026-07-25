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
        width: '100%',
        maxWidth: 480,
        margin: '0 auto',
        paddingBottom: keyboardInset,
        transition: keyboardInset > 0 ? 'padding-bottom 0.1s ease-out' : undefined,
      };

  return (
    <div
      data-design-editor-layout={isDesktop ? 'floating' : 'inline'}
      style={style}
    >
      {children}
    </div>
  );
}
