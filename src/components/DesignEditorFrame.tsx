'use client';

import type { CSSProperties, ReactNode } from 'react';
import { MOBILE_EDITOR_SLOT_HEIGHT } from '@/lib/editor/panel-layout';

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
  const style: CSSProperties = isDesktop ? {
    position: 'absolute',
    bottom: 160,
    left: 12,
    zIndex: 201,
    width: desktopWidth,
  } : {
    position: 'relative',
    zIndex: 60,
    width: '100%',
    maxWidth: 480,
    height: MOBILE_EDITOR_SLOT_HEIGHT,
    margin: '0 auto',
  };

  return (
    <div
      data-design-editor-layout={isDesktop ? 'floating' : 'inline'}
      style={style}
    >
      {isDesktop ? children : (
        <div
          data-design-editor-overlay="mobile"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: keyboardInset,
            zIndex: 60,
            transition: keyboardInset > 0 ? 'bottom 0.1s ease-out' : undefined,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
