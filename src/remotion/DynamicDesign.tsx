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
// Keep the Remotion entrypoint independently bundleable. The standalone
// Remotion bundler does not inherit Next.js' `@/` alias.
import {
  buildRemotionEvaluatorBody,
  normalizeRemotionScopeDeclarations,
} from '../lib/remotion-code-normalization';
import {
  fetchRemotionFontManifestWithTiming,
  loadPreparedRemotionFonts,
  prepareRemotionFontCode,
  type PreparedRemotionFonts,
  type RemotionFontTiming,
} from './font-catalog';

const { Artifact, Sequence, useCurrentFrame, useVideoConfig, delayRender, continueRender, cancelRender } = Remotion;

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

// ─── Component ────────────────────────────────────────────────────────────

export const DynamicDesign: React.FC<Record<string, unknown>> = ({
  code,
  designProps,
  fontManifestUrl,
  fontSubstitutions,
  fontTelemetryId,
  useOffthreadVideo,
  useNativeVideo,
}) => {
  const currentFrame = useCurrentFrame();
  const initialFrameRef = useRef(currentFrame);
  const telemetryShardIdRef = useRef(Math.random().toString(36).slice(2, 10));
  const codeStr = typeof code === 'string' ? code : '';
  const manifestUrl = typeof fontManifestUrl === 'string' ? fontManifestUrl : '';
  const telemetryId = typeof fontTelemetryId === 'string' ? fontTelemetryId : '';
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
  const [fontTiming, setFontTiming] = useState<RemotionFontTiming | null>(null);
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
    setFontTiming(null);
    const handle = delayRender('Loading fonts for design');
    handleRef.current = handle;

    (async () => {
      try {
        const totalStartedAt = performance.now();
        const manifestResult = await fetchRemotionFontManifestWithTiming(manifestUrl);
        const prepareStartedAt = performance.now();
        const nextPrepared = prepareRemotionFontCode({
          code: codeStr,
          props: propsObj,
          manifest: manifestResult.manifest,
          substitutions,
        });
        const prepareMs = Math.round((performance.now() - prepareStartedAt) * 100) / 100;
        if (cancelled) return;
        setPrepared(nextPrepared);
        const load = await loadPreparedRemotionFonts({
          manifest: manifestResult.manifest,
          prepared: nextPrepared,
          text: allText,
        });
        if (cancelled) return;
        setFontTiming({
          version: 1,
          totalMs: Math.round((performance.now() - totalStartedAt) * 100) / 100,
          manifestMs: manifestResult.durationMs,
          manifestCacheHit: manifestResult.cacheHit,
          prepareMs,
          usedFamilies: nextPrepared.usedFamilies,
          load,
        });
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
  }, [allText, codeStr, manifestUrl, propsObj, substitutions]);

  // Continue only after the timing Artifact has committed. This makes the
  // per-shard metrics part of the same render instead of racing the first frame.
  useEffect(() => {
    if (!fontTiming || handleRef.current === null) return;
    const handle = handleRef.current;
    handleRef.current = null;
    continueRender(handle);
  }, [fontTiming]);

  if (fontError) throw fontError;
  if (!prepared) return null;

  if (!Component) {
    throw new Error('Failed to compile design code');
  }
  const timingToken = (value: number) => Math.max(0, Math.round(value * 100));
  const timingFilename = fontTiming && telemetryId
    ? [
      `makaron-font-timing-${telemetryId}`,
      initialFrameRef.current,
      telemetryShardIdRef.current,
      `t${timingToken(fontTiming.totalMs)}`,
      `m${timingToken(fontTiming.manifestMs)}`,
      `s${timingToken(fontTiming.load.selectionMs)}`,
      `f${timingToken(fontTiming.load.fontFacesMs)}`,
      `r${timingToken(fontTiming.load.fontsReadyMs)}`,
      `c${timingToken(fontTiming.load.fontsCheckMs)}`,
      `n${fontTiming.load.faceCount}`,
      `u${fontTiming.load.uniqueResourceCount}`,
      `w${fontTiming.manifestCacheHit || fontTiming.load.requestCacheHit ? 1 : 0}.json`,
    ].join('-')
    : '';
  const artifact = fontTiming && telemetryId && currentFrame === initialFrameRef.current
    ? JSON.stringify({
      type: 'makaron-remotion-font-timing',
      telemetryId,
      initialFrame: initialFrameRef.current,
      timing: fontTiming,
    })
    : null;
  return (
    <div style={{ width: '100%', height: '100%', fontFamily: prepared.defaultFontFamily }}>
      {artifact ? (
        <Artifact
          filename={timingFilename}
          content={artifact}
        />
      ) : null}
      <Component {...propsObj} />
    </div>
  );
};
