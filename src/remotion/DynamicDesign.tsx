/**
 * DynamicDesign — a Remotion composition that compiles and renders Agent-generated JSX code.
 * Used by both browser-side Player and server-side Sandbox (renderStillOnVercel).
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
import { getAvailableFonts } from '@remotion/google-fonts';
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

// ─── Font loading via @remotion/google-fonts ──────────────────────────────

const ALL_FONTS = getAvailableFonts();

/**
 * Scan code + props for any Google Font family names and load them.
 * Uses @remotion/google-fonts — no regex parsing of CSS needed.
 * Just checks if the font name appears anywhere in the text.
 */
async function loadGoogleFontsFromText(text: string): Promise<void> {
  const fontsToLoad = ALL_FONTS.filter(f => text.includes(f.fontFamily));
  if (fontsToLoad.length === 0) return;

  await Promise.all(fontsToLoad.map(async (font) => {
    try {
      const loaded = await font.load();
      const { waitUntilDone } = loaded.loadFont();
      await waitUntilDone();
    } catch (e) {
      console.warn(`[DynamicDesign] font load failed: ${font.fontFamily}`, e);
    }
  }));
}

/** Check if text contains CJK characters */
function hasCJK(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text);
}

/** Check if text contains emoji characters */
function hasEmoji(text: string): boolean {
  return /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA00}-\u{1FA9F}]/u.test(text);
}

/** Load Noto Color Emoji font */
async function loadEmojiFont(): Promise<void> {
  try {
    const font = ALL_FONTS.find(f => f.fontFamily === 'Noto Color Emoji');
    if (!font) return;
    const loaded = await font.load();
    const { waitUntilDone } = loaded.loadFont();
    await waitUntilDone();
  } catch (e) {
    console.warn('[DynamicDesign] emoji font load failed:', e);
  }
}

// ─── Component ────────────────────────────────────────────────────────────

export const DynamicDesign: React.FC<Record<string, unknown>> = ({ code, designProps }) => {
  const codeStr = typeof code === 'string' ? code : '';
  const propsObj = (typeof designProps === 'object' && designProps !== null ? designProps : {}) as Record<string, unknown>;
  const Component = useMemo(() => compileAndEval(codeStr), [codeStr]);

  // Combine code + props for font detection
  const allText = useMemo(() => {
    const propsStr = Object.values(propsObj).filter(v => typeof v === 'string').join(' ');
    return codeStr + '\n' + propsStr;
  }, [codeStr, propsObj]);

  const [fontsReady, setFontsReady] = useState(false);
  const handleRef = useRef<number | null>(null);

  useEffect(() => {
    if (!codeStr) return;
    const handle = delayRender('Loading fonts for design');
    handleRef.current = handle;

    (async () => {
      try {
        // Load all Google Fonts referenced in code + props
        await loadGoogleFontsFromText(allText);

        // Emoji font — headless Chrome has no emoji font installed
        if (hasEmoji(allText)) {
          await loadEmojiFont();
        }

        // If CJK text present, inject global fallback font-family
        // so text renders even when Agent doesn't specify fontFamily
        if (hasCJK(allText)) {
          const style = document.createElement('style');
          style.textContent = `*, *::before, *::after { font-family: 'Noto Sans SC', sans-serif; }`;
          document.head.appendChild(style);
        }
      } catch { /* continue even if fonts fail */ }

      setFontsReady(true);
      continueRender(handle);
      handleRef.current = null;
    })();

    return () => {
      if (handleRef.current !== null) {
        continueRender(handleRef.current);
        handleRef.current = null;
      }
    };
  }, [codeStr, allText]);

  if (!Component) {
    return (
      <AbsoluteFill style={{ background: '#1a1a2e', color: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: 14 }}>
        Failed to compile design code
      </AbsoluteFill>
    );
  }
  // Always render Component so <Img> can register its own delayRender for image loading.
  // Font delayRender runs in parallel — Remotion waits for ALL handles before capturing.
  return <Component {...propsObj} />;
};
