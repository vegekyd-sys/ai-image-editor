'use client';

/**
 * Evaluate Agent-generated JSX code as a React component.
 * Strategy: Sucrase first (bundled, fast, ~1MB), Babel CDN fallback for edge cases.
 *
 * Convention: Agent writes a COMPLETE function with return statement:
 *   function Design(props) { return (<div>...</div>); }
 */

import { transform as sucraseTransform } from 'sucrase';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as Remotion from 'remotion';
import { Audio, Video } from '@remotion/media';
import * as RemotionPaths from '@remotion/paths';
import * as RemotionNoise from '@remotion/noise';

const { Sequence, useVideoConfig } = Remotion;

// Sequence wrapper: auto-inject premountFor={fps*3} when not specified
// 3 seconds of premount gives video elements enough time to buffer before their scene starts
const AutoPremountSequence = React.forwardRef(function AutoPremountSequence(

  props: any,
  ref: React.Ref<HTMLDivElement>,
) {
  const { fps } = useVideoConfig();
  return React.createElement(Sequence, { ...props, premountFor: props.premountFor ?? fps * 3, ref });
});

/** All Remotion APIs available to Agent's React code — open scope, no artificial limits */
const REMOTION_SCOPE: Record<string, unknown> = {
  React, useState, useEffect, useCallback, useMemo, useRef,
  ...Remotion,
  ...RemotionPaths,
  ...RemotionNoise,
  // @remotion/media Video/Audio: supports web-renderer export + trimBefore/trimAfter
  Audio, Video,
  // OffthreadVideo not supported in web-renderer — alias to @remotion/media Video
  OffthreadVideo: Video,
  // Override: Sequence with auto premountFor
  Sequence: AutoPremountSequence,
};
// Remove keys that are invalid as function parameter names
delete REMOTION_SCOPE['default'];
delete REMOTION_SCOPE['__esModule'];

// Babel CDN fallback (lazy-loaded only when Sucrase fails)

let _babelTransform: ((code: string, opts: any) => { code: string }) | null = null;

/** Observable loading state for UI feedback */
export type BabelStatus = 'idle' | 'loading' | 'ready' | 'error';
let _babelStatus: BabelStatus = 'idle';
let _babelError: string | null = null;
const _listeners: Set<() => void> = new Set();

export function getBabelStatus(): { status: BabelStatus; error: string | null } {
  return { status: _babelStatus, error: _babelError };
}
export function subscribeBabelStatus(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
function _notify(status: BabelStatus, error?: string) {
  _babelStatus = status;
  _babelError = error ?? null;
  _listeners.forEach(fn => fn());
}

/** Load Babel from CDN (only called when Sucrase fails). 15s timeout. */
export async function preloadBabel(): Promise<void> {
  if (_babelTransform) return;
  if (_babelStatus === 'loading') {
    return new Promise<void>((resolve, reject) => {
      const unsub = subscribeBabelStatus(() => {
        if (_babelStatus === 'ready') { unsub(); resolve(); }
        else if (_babelStatus === 'error') { unsub(); reject(new Error(_babelError || 'Babel load failed')); }
      });
    });
  }
  _notify('loading');
  try {
    await new Promise<void>((resolve, reject) => {

      if ((window as any).Babel) { resolve(); return; }
      const timeout = setTimeout(() => reject(new Error('Babel CDN timeout (15s)')), 15000);
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js';
      script.onload = () => { clearTimeout(timeout); resolve(); };
      script.onerror = () => { clearTimeout(timeout); reject(new Error('Failed to load Babel from CDN')); };
      document.head.appendChild(script);
    });

    _babelTransform = (window as any).Babel.transform;
    _notify('ready');
  } catch (e) {
    _notify('error', e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** Compile code string to JS using Sucrase (fast, bundled) */
function compileSucrase(src: string): string | null {
  try {
    const { code } = sucraseTransform(src, {
      transforms: ['typescript', 'jsx'],
      jsxRuntime: 'classic',
    });
    return code;
  } catch {
    return null;
  }
}

/** Compile code string to JS using Babel (CDN, full syntax support) */
function compileBabel(src: string): string | null {
  if (!_babelTransform) return null;
  try {
    const result = _babelTransform(src, {
      presets: ['react', 'typescript'],
      plugins: ['proposal-optional-chaining', 'proposal-nullish-coalescing-operator'],
      filename: 'design.tsx',
    });
    return result.code;
  } catch {
    return null;
  }
}

export function normalizeRemotionScopeDeclarations(code: string): string {
  return code
    .trim()
    .replace(/^\s*(?:const|let|var)\s*\{[^}]*\}\s*=\s*(?:window\.)?Remotion\s*;?\s*$/gm, '')
    .replace(/^\s*(?:const|let|var)\s+Remotion\s*=\s*window\.Remotion\s*;?\s*$/gm, '')
    .replace(/\bwindow\.Remotion\./g, '')
    .replace(/\bRemotion\./g, '')
    .trim();
}

export function pickRemotionComponentName(code: string): string {
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

/**
 * Transpile Agent JSX code → React component.
 * Tries Sucrase first (bundled, instant). Falls back to Babel CDN if Sucrase fails.
 */

export function evalRemotionJSX(code: string): React.ComponentType<any> | null {
  try {
    const src = normalizeRemotionScopeDeclarations(code);

    // Try Sucrase first (bundled, no CDN dependency)
    let compiled = compileSucrase(src);

    // Fallback to Babel if Sucrase fails and Babel is loaded
    if (!compiled) {
      console.warn('[evalRemotionJSX] Sucrase failed, trying Babel...');
      compiled = compileBabel(src);
    }

    if (!compiled) {
      console.error('[evalRemotionJSX] Both Sucrase and Babel failed to compile');
      return null;
    }

    // Prefer the primary composition function. Agent code often declares helper
    // components first (Caption, Badge, etc.) and the real composition last.
    const fnName = pickRemotionComponentName(src);
    const execCode = `${compiled}\nreturn ${fnName};`;

    const scopeKeys = Object.keys(REMOTION_SCOPE);
    const scopeValues = Object.values(REMOTION_SCOPE);
    const factory = new Function(...scopeKeys, execCode);
    const comp = factory(...scopeValues);
    return comp ? wrapWithEditableTransforms(comp) : null;
  } catch (err) {
    console.error('[evalRemotionJSX] compile error:', err);
    return null;
  }
}


/**
 * Module-level ref for current transform props.
 * Updated by the HOC's render, read by the Proxy createElement.
 */
let _currentTransformProps: Record<string, unknown> = {};

/**
 * Patched createElement: intercepts [data-editable] elements and injects
 * CSS independent properties (style.translate / style.scale).
 *
 * Unlike style.transform, these independent properties:
 * - Do NOT appear in getComputedStyle().transform (verified: returns "none")
 * - Do NOT interfere with Moveable coordinate calculation
 * - Do NOT affect browser hit-testing (no ghost pointerdown)
 * - ARE correctly read by @remotion/web-renderer (via our patch)
 */
const _origCE = React.createElement;

const _patchedCE = function(type: any, elProps: any, ...children: any[]) {
  if (elProps && typeof elProps === 'object' && elProps['data-editable']) {
    const id = elProps['data-editable'] as string;
    const pos = _currentTransformProps[`_pos_${id}`] as { x: number; y: number } | undefined;
    const sc = _currentTransformProps[`_scale_${id}`] as { w: number; h: number } | undefined;
    if (pos || sc) {
      const existingStyle = (elProps.style || {}) as Record<string, unknown>;
      elProps = { ...elProps, style: {
        ...existingStyle,
        ...(pos ? { translate: `${pos.x}px ${pos.y}px` } : {}),
        ...(sc ? { scale: `${+sc.w.toFixed(4)} ${+sc.h.toFixed(4)}` } : {}),
      }};
    }
  }
  return _origCE.call(React, type, elProps, ...children);
};

const PATCHED_REACT = new Proxy(React, {
  get(target, prop) {
    if (prop === 'createElement') return _patchedCE;
    return Reflect.get(target, prop);
  }
});

REMOTION_SCOPE.React = PATCHED_REACT;

/**
 * HOC: sets _currentTransformProps before Component renders (synchronous).
 * Agent code uses PATCHED_REACT.createElement → reads _currentTransformProps
 * → injects style.translate/scale on [data-editable] elements.
 */

function wrapWithEditableTransforms(Component: React.ComponentType<any>): React.ComponentType<any> {
  return function WrappedDesign(props: Record<string, unknown>) {
    _currentTransformProps = props;
    return _origCE.call(React, Component, props);
  };
}
