/**
 * DynamicDesign — a Remotion composition that compiles and renders Agent-generated JSX code.
 * Used by both browser-side Player and server-side Sandbox (renderStillOnVercel).
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import * as Remotion from 'remotion';
import { Audio as MediaAudio, Video as MediaVideo } from '@remotion/media';
import * as RemotionPaths from '@remotion/paths';
import * as RemotionNoise from '@remotion/noise';
import * as THREE from 'three';
import { getAvailableFonts } from '@remotion/google-fonts';
import { transform as sucraseTransform } from 'sucrase';
// Keep the Remotion entrypoint independently bundleable. The standalone
// Remotion bundler does not inherit Next.js' `@/` alias.
import {
  buildRemotionEvaluatorBody,
  normalizeRemotionScopeDeclarations,
} from '../lib/remotion-code-normalization';

const { Sequence, useVideoConfig, delayRender, continueRender } = Remotion;

// Sequence wrapper: auto-inject premountFor={fps} for smooth video cuts

const AutoPremountSequence = React.forwardRef(function AutoPremountSequence(props: any, ref: React.Ref<HTMLDivElement>) {
  const { fps } = useVideoConfig();
  return React.createElement(Sequence, { ...props, premountFor: props.premountFor ?? fps, ref });
});

function createRemotionScope(useOffthreadVideo: boolean, useNativeVideo: boolean): Record<string, unknown> {
  const serverVideo = Remotion.OffthreadVideo || MediaVideo;
  const nativeVideo = Remotion.Video || MediaVideo;
  const serverRendering = useOffthreadVideo || useNativeVideo;
  const scope: Record<string, unknown> = {
    React, useState, useEffect, useCallback, useMemo, useRef,
    THREE,
    ...Remotion,
    ...RemotionPaths,
    ...RemotionNoise,
    // @remotion/media keeps browser/web-renderer preview behavior; server export can opt into
    // Remotion-native Video so the renderer can collect source-video audio assets.
    Audio: MediaAudio,
    Video: useOffthreadVideo ? serverVideo : useNativeVideo ? nativeVideo : MediaVideo,
    // An explicit <OffthreadVideo> must remain meaningful in server preview/export.
    // Previously it was silently aliased back to @remotion/media whenever only
    // useNativeVideo was set, so an Agent "compatibility" patch changed the
    // component name without changing the decoder at all.
    OffthreadVideo: serverRendering ? serverVideo : MediaVideo,
    // Override: Sequence with auto premountFor
    Sequence: AutoPremountSequence,
  };
  delete scope.default;
  delete scope.__esModule;
  return scope;
}

function pickRemotionComponentName(code: string): string {
  const names = [
    ...Array.from(code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g), m => m[1]),
    ...Array.from(code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g), m => m[1]),
  ];

  const preferred = ['Composition', 'Design', 'AgentDesign', 'DevLog', 'App', 'Main', 'Scene'];
  for (const name of preferred) {
    if (names.includes(name)) return name;
  }

  const descriptive = [...names].reverse().find(name =>
    /(?:Composition|Design)$/i.test(name) &&
    !/(?:Caption|Badge|Label|Title|Subtitle|Overlay)$/i.test(name)
  );
  if (descriptive) return descriptive;

  return names[names.length - 1] || 'Design';
}

function compileAndEval(code: string, scope: Record<string, unknown>): React.ComponentType<Record<string, unknown>> | null {
  try {
    const src = normalizeRemotionScopeDeclarations(code);
    const { code: compiled } = sucraseTransform(src, {
      transforms: ['typescript', 'jsx', 'imports'],
      jsxRuntime: 'classic',
    });
    const fnName = pickRemotionComponentName(src);
    const reactModule = { ...React, default: React, __esModule: true };
    const remotionNamespace = { ...Remotion, ...scope };
    const remotionModule = { ...remotionNamespace, default: remotionNamespace, __esModule: true };
    const mediaNamespace = {
      Audio: scope.Audio,
      Video: scope.Video,
      OffthreadVideo: scope.OffthreadVideo,
    };
    const mediaModule = {
      ...mediaNamespace,
      default: mediaNamespace,
      __esModule: true,
    };
    const pathsNamespace = { ...RemotionPaths };
    const noiseNamespace = { ...RemotionNoise };
    const modules: Record<string, unknown> = {
      react: reactModule,
      remotion: remotionModule,
      '@remotion/media': mediaModule,
      '@remotion/paths': { ...pathsNamespace, default: pathsNamespace, __esModule: true },
      '@remotion/noise': { ...noiseNamespace, default: noiseNamespace, __esModule: true },
      three: { ...THREE, default: THREE, __esModule: true },
    };
    const localRequire = (id: string) => {
      if (id in modules) return modules[id];
      throw new Error(`Composition module "${id}" is not available in the browser Remotion runtime.`);
    };
    const authoredModule = { exports: {} as Record<string, unknown> };
    const factory = new Function(
      '__scope',
      'module',
      'exports',
      'require',
      buildRemotionEvaluatorBody(compiled, fnName),
    );
    return factory(scope, authoredModule, authoredModule.exports, localRequire);
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

export const DynamicDesign: React.FC<Record<string, unknown>> = ({ code, designProps, skipFontLoading, useOffthreadVideo, useNativeVideo }) => {
  const codeStr = typeof code === 'string' ? code : '';
  const propsObj = useMemo(
    () => (typeof designProps === 'object' && designProps !== null ? designProps : {}) as Record<string, unknown>,
    [designProps],
  );
  const remotionScope = useMemo(
    () => createRemotionScope(useOffthreadVideo === true, useNativeVideo === true),
    [useNativeVideo, useOffthreadVideo],
  );
  const Component = useMemo(() => compileAndEval(codeStr, remotionScope), [codeStr, remotionScope]);

  // Combine code + props for font detection
  const allText = useMemo(() => {
    const propsStr = Object.values(propsObj).filter(v => typeof v === 'string').join(' ');
    return codeStr + '\n' + propsStr;
  }, [codeStr, propsObj]);

  const [, setFontsReady] = useState(false);
  const handleRef = useRef<number | null>(null);

  useEffect(() => {
    if (!codeStr) return;
    if (skipFontLoading === true) {
      setFontsReady(true);
      return;
    }
    const handle = delayRender('Loading fonts for design');
    handleRef.current = handle;

    (async () => {
      try {
        // Load all Google Fonts referenced in code + props
        await loadGoogleFontsFromText(allText);

        // Emoji font — always load so emoji characters fallback correctly
        await loadEmojiFont();

        // If CJK text present, inject global fallback font-family
        // so text renders even when Agent doesn't specify fontFamily
        if (hasCJK(allText)) {
          const style = document.createElement('style');
          style.textContent = `*, *::before, *::after { font-family: 'Noto Sans SC', sans-serif; }`;
          document.head.appendChild(style);
        }
      } catch { /* continue even if fonts fail */ }

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
    throw new Error('Failed to compile design code');
  }
  // Always render Component so <Img> can register its own delayRender for image loading.
  // Font delayRender runs in parallel — Remotion waits for ALL handles before capturing.
  return <Component {...propsObj} />;
};
