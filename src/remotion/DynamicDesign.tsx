/**
 * DynamicDesign — a Remotion composition that compiles and renders Agent-generated JSX code.
 * Used by server-side renderStill to preview designs.
 * Mirrors the browser-side evalRemotionJSX logic.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Sequence,
  Series,
  Img,
  AbsoluteFill,
  delayRender,
  continueRender,
} from 'remotion';
import { Audio } from '@remotion/media';
import { transform as sucraseTransform } from 'sucrase';

const REMOTION_SCOPE: Record<string, unknown> = {
  React,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Sequence,
  Series,
  Img,
  AbsoluteFill,
  Audio,
};

function compileAndEval(code: string): React.ComponentType<Record<string, unknown>> | null {
  try {
    const src = code.trim();
    const { code: compiled } = sucraseTransform(src, {
      transforms: ['typescript', 'jsx'],
      jsxRuntime: 'classic',
    });
    const fnMatch = src.match(/function\s+(\w+)/);
    const fnName = fnMatch?.[1] || 'Design';
    const execCode = `${compiled}\nreturn ${fnName};`;
    const scopeKeys = Object.keys(REMOTION_SCOPE);
    const scopeValues = Object.values(REMOTION_SCOPE);
    const factory = new Function(...scopeKeys, execCode);
    return factory(...scopeValues);
  } catch (err) {
    console.error('[DynamicDesign] compile error:', err);
    return null;
  }
}

/** Preload Google Fonts from @import/href in design code. Ensures fonts render in headless Chrome. */
async function preloadFonts(code: string): Promise<void> {
  const fontUrls = new Set<string>();
  for (const m of code.matchAll(/@import\s+url\(['"]?(https:\/\/fonts\.googleapis\.com\/[^'")\s]+)['"]?\)/g))
    fontUrls.add(m[1]);
  for (const m of code.matchAll(/href=["'](https:\/\/fonts\.googleapis\.com\/[^"']+)["']/g))
    fontUrls.add(m[1]);
  if (fontUrls.size === 0) return;

  const fontFamilies = new Set<string>();
  await Promise.all([...fontUrls].map(async url => {
    try {
      const css = await fetch(url).then(r => r.text());
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
      for (const m of css.matchAll(/font-family:\s*['"]?([^;'"]+)['"]?\s*;/g))
        fontFamilies.add(m[1].trim());
    } catch { /* skip */ }
  }));

  // Force-load all discovered font families
  await Promise.all([...fontFamilies].map(f =>
    document.fonts.load(`1em "${f}"`).catch(() => {})
  ));
  await document.fonts.ready;
}

export const DynamicDesign: React.FC<Record<string, unknown>> = ({ code, designProps }) => {
  const codeStr = typeof code === 'string' ? code : '';
  const propsObj = (typeof designProps === 'object' && designProps !== null ? designProps : {}) as Record<string, unknown>;
  const Component = useMemo(() => compileAndEval(codeStr), [codeStr]);

  // Wait for Google Fonts before rendering (critical for headless/Sandbox)
  const [fontsReady, setFontsReady] = useState(false);
  const handleRef = useRef<number | null>(null);

  useEffect(() => {
    if (!codeStr) return;
    const handle = delayRender('Loading fonts for design');
    handleRef.current = handle;

    preloadFonts(codeStr)
      .then(() => {
        setFontsReady(true);
        continueRender(handle);
        handleRef.current = null;
      })
      .catch(() => {
        // Don't block render forever if fonts fail
        setFontsReady(true);
        continueRender(handle);
        handleRef.current = null;
      });

    return () => {
      // Cleanup: if component unmounts before fonts load, release the delay
      if (handleRef.current !== null) {
        continueRender(handleRef.current);
        handleRef.current = null;
      }
    };
  }, [codeStr]);

  if (!Component || !fontsReady) {
    return (
      <AbsoluteFill style={{ background: '#1a1a2e', color: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: 14 }}>
        {!Component ? 'Failed to compile design code' : 'Loading fonts...'}
      </AbsoluteFill>
    );
  }
  return <Component {...propsObj} />;
};
