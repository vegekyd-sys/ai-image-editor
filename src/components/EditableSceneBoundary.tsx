'use client';

import React, { useLayoutEffect, useRef } from 'react';
import type { EditableField } from '@/types';
import { applySceneNodeTransforms } from '@/lib/editor/scene-registry';

interface EditableSceneBoundaryProps {
  fields?: EditableField[];
  inputProps: Record<string, unknown>;
  fontFamily?: string;
  children?: React.ReactNode;
}

export default function EditableSceneBoundary({
  fields = [],
  inputProps,
  fontFamily,
  children,
}: EditableSceneBoundaryProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const apply = () => {
      applySceneNodeTransforms({
        container,
        fields,
        props: inputProps,
      });
    };

    apply();
    const mutationObserver = new MutationObserver(apply);
    mutationObserver.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      // Remotion animation writes style every frame. Watching style/class here
      // would rescan the whole scene at playback FPS and make dragging stutter.
      attributeFilter: ['data-editable'],
    });
    const resizeObserver = new ResizeObserver(apply);
    resizeObserver.observe(container);

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  });

  return (
    <div
      ref={containerRef}
      data-makaron-scene-boundary=""
      style={{ width: '100%', height: '100%', fontFamily }}
    >
      {children}
    </div>
  );
}
