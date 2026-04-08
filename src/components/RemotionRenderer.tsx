'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring, Sequence, Series, Img, AbsoluteFill } from 'remotion';
import html2canvas from 'html2canvas';

/**
 * Design payload from Agent's run_code.
 * Agent writes React component code as a string, which gets executed
 * inside a Remotion-compatible context with access to all Remotion APIs.
 */
export interface DesignPayload {
  code: string;          // React component body (string)
  width: number;
  height: number;
  props?: Record<string, unknown>;  // Props passed to the component (snapshot URLs, etc.)
  animation?: {          // If present, render as video/GIF
    fps: number;
    durationInSeconds: number;
    format?: 'mp4' | 'gif';
  };
}

/**
 * Create a React component from Agent's code string.
 * Injects all Remotion APIs into the function scope.
 */
function createComponentFromCode(code: string): React.FC<Record<string, unknown>> {
  try {
    // Wrap Agent code in a function that receives Remotion APIs + React
    const factory = new Function(
      'React',
      'useCurrentFrame',
      'useVideoConfig',
      'interpolate',
      'spring',
      'Sequence',
      'Series',
      'Img',
      'AbsoluteFill',
      'props',
      // Return a component function
      `return function AgentDesign(componentProps) {
        const props = { ...componentProps, ...arguments[arguments.length - 1] };
        ${code}
      }`
    );

    return factory(
      React,
      useCurrentFrame,
      useVideoConfig,
      interpolate,
      spring,
      Sequence,
      Series,
      Img,
      AbsoluteFill,
    );
  } catch (e) {
    // If code parsing fails, return error component
    return () => React.createElement('div', {
      style: { color: 'red', padding: 20, fontFamily: 'monospace', fontSize: 14 },
    }, `Code error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

interface RemotionRendererProps {
  design: DesignPayload;
  onComplete: (dataUrl: string) => void;
  onError: (error: string) => void;
}

/**
 * Hidden renderer that:
 * 1. Creates React component from Agent's code
 * 2. Renders in a hidden container
 * 3. Waits for fonts to load
 * 4. Captures as image via html2canvas
 * 5. Returns data URL to parent
 */
export default function RemotionRenderer({ design, onComplete, onError }: RemotionRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [Component, setComponent] = useState<React.FC<Record<string, unknown>> | null>(null);
  const [rendering, setRendering] = useState(false);

  // Create component from code
  useEffect(() => {
    try {
      const comp = createComponentFromCode(design.code);
      setComponent(() => comp);
    } catch (e) {
      onError(`Failed to create component: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [design.code, onError]);

  // Capture after render
  const capture = useCallback(async () => {
    if (!containerRef.current || rendering) return;
    setRendering(true);

    try {
      // Wait for fonts to load
      await document.fonts.ready;

      // Small delay for images/layout to settle
      await new Promise(r => setTimeout(r, 500));

      // Capture
      const canvas = await html2canvas(containerRef.current, {
        width: design.width,
        height: design.height,
        scale: 1,
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
      });

      const dataUrl = canvas.toDataURL('image/png');
      onComplete(dataUrl);
    } catch (e) {
      onError(`Capture failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRendering(false);
    }
  }, [design.width, design.height, onComplete, onError, rendering]);

  // Trigger capture after component mounts
  useEffect(() => {
    if (Component) {
      // Wait a frame for React to render, then capture
      const timer = setTimeout(capture, 800);
      return () => clearTimeout(timer);
    }
  }, [Component, capture]);

  if (!Component) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: -9999,
        top: -9999,
        width: design.width,
        height: design.height,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <div
        ref={containerRef}
        style={{ width: design.width, height: design.height, position: 'relative' }}
      >
        <Component {...(design.props || {})} />
      </div>
    </div>
  );
}
