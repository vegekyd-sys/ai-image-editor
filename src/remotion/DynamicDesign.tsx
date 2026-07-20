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
import { transform as sucraseTransform } from 'sucrase';
import { normalizeRemotionScopeDeclarations } from '@/lib/remotion-code-normalization';
import {
  fetchRemotionFontManifest,
  loadPreparedRemotionFonts,
  prepareRemotionFontCode,
  type PreparedRemotionFonts,
} from '@/remotion/font-catalog';

const { Sequence, useVideoConfig, delayRender, continueRender, cancelRender } = Remotion;

// Sequence wrapper: auto-inject premountFor={fps} for smooth video cuts

const AutoPremountSequence = React.forwardRef(function AutoPremountSequence(props: any, ref: React.Ref<HTMLDivElement>) {
  const { fps } = useVideoConfig();
  return React.createElement(Sequence, { ...props, premountFor: props.premountFor ?? fps, ref });
});

function createRemotionScope(useOffthreadVideo: boolean, useNativeVideo: boolean): Record<string, unknown> {
  const serverVideo = Remotion.OffthreadVideo || MediaVideo;
  const nativeVideo = Remotion.Video || MediaVideo;
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
    OffthreadVideo: useOffthreadVideo ? serverVideo : MediaVideo,
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
      transforms: ['typescript', 'jsx'],
      jsxRuntime: 'classic',
    });
    const fnName = pickRemotionComponentName(src);
    const execCode = `${compiled}\nreturn ${fnName};`;
    const scopeKeys = Object.keys(scope);
    const scopeValues = Object.values(scope);
    const factory = new Function(...scopeKeys, execCode);
    return factory(...scopeValues);
  } catch (err) {
    console.error('[DynamicDesign] compile error:', err);
    return null;
  }
}

// ─── Component ────────────────────────────────────────────────────────────

export const DynamicDesign: React.FC<Record<string, unknown>> = ({
  code,
  designProps,
  fontManifestUrl,
  fontSubstitutions,
  useOffthreadVideo,
  useNativeVideo,
}) => {
  const codeStr = typeof code === 'string' ? code : '';
  const manifestUrl = typeof fontManifestUrl === 'string' ? fontManifestUrl : '';
  const propsObj = useMemo(
    () => (typeof designProps === 'object' && designProps !== null ? designProps : {}) as Record<string, unknown>,
    [designProps],
  );
  const remotionScope = useMemo(
    () => createRemotionScope(useOffthreadVideo === true, useNativeVideo === true),
    [useNativeVideo, useOffthreadVideo],
  );
  const substitutions = useMemo(
    () => (typeof fontSubstitutions === 'object' && fontSubstitutions !== null
      ? fontSubstitutions
      : {}) as Record<string, string>,
    [fontSubstitutions],
  );
  const [prepared, setPrepared] = useState<PreparedRemotionFonts | null>(null);
  const [fontError, setFontError] = useState<Error | null>(null);
  const Component = useMemo(
    () => prepared ? compileAndEval(prepared.code, remotionScope) : null,
    [prepared, remotionScope],
  );

  // Combine code + props for font detection
  const allText = useMemo(() => {
    const propsStr = Object.values(propsObj).filter(v => typeof v === 'string').join(' ');
    return codeStr + '\n' + propsStr;
  }, [codeStr, propsObj]);

  const handleRef = useRef<number | null>(null);

  useEffect(() => {
    if (!codeStr) return;
    if (!manifestUrl) {
      const error = new Error('fontManifestUrl is required for Remotion rendering');
      setFontError(error);
      cancelRender(error);
      return;
    }
    let cancelled = false;
    setPrepared(null);
    setFontError(null);
    const handle = delayRender('Loading fonts for design');
    handleRef.current = handle;

    (async () => {
      try {
        const manifest = await fetchRemotionFontManifest(manifestUrl);
        const nextPrepared = prepareRemotionFontCode({ code: codeStr, manifest, substitutions });
        if (cancelled) return;
        setPrepared(nextPrepared);
        await loadPreparedRemotionFonts({ manifest, prepared: nextPrepared, text: allText });
        if (cancelled) return;
        continueRender(handle);
        handleRef.current = null;
      } catch (error) {
        if (cancelled) return;
        const fontLoadError = error instanceof Error ? error : new Error(String(error));
        setFontError(fontLoadError);
        handleRef.current = null;
        cancelRender(fontLoadError);
      }
    })();

    return () => {
      cancelled = true;
      if (handleRef.current !== null) {
        continueRender(handleRef.current);
        handleRef.current = null;
      }
    };
  }, [allText, codeStr, manifestUrl, substitutions]);

  if (fontError) throw fontError;
  if (!prepared) return null;

  if (!Component) {
    throw new Error('Failed to compile design code');
  }
  return (
    <div style={{ width: '100%', height: '100%', fontFamily: prepared.defaultFontFamily }}>
      <Component {...propsObj} />
    </div>
  );
};
