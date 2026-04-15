/**
 * DynamicDesign — a Remotion composition that compiles and renders Agent-generated JSX code.
 * Used by both browser-side Player and server-side Sandbox (renderStillOnVercel).
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

// ─── Font loading ─────────────────────────────────────────────────────────────

/** Check if text contains CJK characters */
function hasCJK(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text);
}

/**
 * Load Noto Sans SC via @remotion/google-fonts (type-safe, with waitUntilDone).
 * Works in both browser and headless Chrome (Sandbox).
 */
async function loadCJKFont(): Promise<void> {
  try {
    const { loadFont } = await import('@remotion/google-fonts/NotoSansSC');
    const { waitUntilDone } = loadFont('normal', {
      weights: ['400', '700', '900'],
    });
    await waitUntilDone();
  } catch (e) {
    console.warn('[DynamicDesign] CJK font load failed:', e);
  }
}

/**
 * Dynamically load Google Fonts referenced in code via @import/href.
 * Fetches CSS → injects @font-face → waits for fonts.ready.
 */
async function loadFontsFromCode(code: string): Promise<void> {
  const fontUrls = new Set<string>();
  // @import url('...')
  for (const m of code.matchAll(/@import\s+url\(['"]?(https:\/\/fonts\.googleapis\.com\/[^'")\s]+)['"]?\)/g))
    fontUrls.add(m[1]);
  // href="..." (HTML)
  for (const m of code.matchAll(/href=["'](https:\/\/fonts\.googleapis\.com\/[^"']+)["']/g))
    fontUrls.add(m[1]);
  // href: "..." (JSX)
  for (const m of code.matchAll(/href:\s*["'](https:\/\/fonts\.googleapis\.com\/[^"']+)["']/g))
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

  await Promise.all([...fontFamilies].map(f =>
    document.fonts.load(`1em "${f}"`).catch(() => {})
  ));
  await document.fonts.ready;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const DynamicDesign: React.FC<Record<string, unknown>> = ({ code, designProps }) => {
  const codeStr = typeof code === 'string' ? code : '';
  const propsObj = (typeof designProps === 'object' && designProps !== null ? designProps : {}) as Record<string, unknown>;
  const Component = useMemo(() => compileAndEval(codeStr), [codeStr]);

  // Combine code + props for font detection
  const allText = useMemo(() => {
    const propsStr = Object.values(propsObj).filter(v => typeof v === 'string').join(' ');
    return codeStr + '\n' + propsStr;
  }, [codeStr, propsObj]);

  // Wait for fonts before rendering (critical for headless/Sandbox)
  const [fontsReady, setFontsReady] = useState(false);
  const handleRef = useRef<number | null>(null);

  useEffect(() => {
    if (!codeStr) return;
    const handle = delayRender('Loading fonts for design');
    handleRef.current = handle;

    const fontPromises: Promise<void>[] = [];

    // Layer 1: CJK → Noto Sans SC via @remotion/google-fonts
    if (hasCJK(allText)) {
      fontPromises.push(loadCJKFont());
    }

    // Layer 2: Dynamic Google Fonts from code URLs
    fontPromises.push(loadFontsFromCode(codeStr));

    Promise.all(fontPromises)
      .then(() => {
        setFontsReady(true);
        continueRender(handle);
        handleRef.current = null;
      })
      .catch(() => {
        setFontsReady(true);
        continueRender(handle);
        handleRef.current = null;
      });

    return () => {
      if (handleRef.current !== null) {
        continueRender(handleRef.current);
        handleRef.current = null;
      }
    };
  }, [codeStr, allText]);

  if (!Component || !fontsReady) {
    return (
      <AbsoluteFill style={{ background: '#1a1a2e', color: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: 14 }}>
        {!Component ? 'Failed to compile design code' : 'Loading fonts...'}
      </AbsoluteFill>
    );
  }
  return <Component {...propsObj} />;
};
