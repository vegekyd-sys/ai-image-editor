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
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Sequence,
  Series,
  Img,
  AbsoluteFill,
} from 'remotion';
import { Audio } from '@remotion/media';
import { evolvePath, getLength, getPointAtLength, getTangentAtLength, interpolatePath, parsePath, resetPath, cutPath } from '@remotion/paths';
import { noise2D, noise3D } from '@remotion/noise';

/** All APIs available to Agent's React code */
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
  // @remotion/paths — SVG path animation
  evolvePath, getLength, getPointAtLength, getTangentAtLength, interpolatePath, parsePath, resetPath, cutPath,
  // @remotion/noise — organic textures
  noise2D, noise3D,
};

// Babel CDN fallback (lazy-loaded only when Sucrase fails)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((window as any).Babel) { resolve(); return; }
      const timeout = setTimeout(() => reject(new Error('Babel CDN timeout (15s)')), 15000);
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js';
      script.onload = () => { clearTimeout(timeout); resolve(); };
      script.onerror = () => { clearTimeout(timeout); reject(new Error('Failed to load Babel from CDN')); };
      document.head.appendChild(script);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

/**
 * Transpile Agent JSX code → React component.
 * Tries Sucrase first (bundled, instant). Falls back to Babel CDN if Sucrase fails.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function evalRemotionJSX(code: string): React.ComponentType<any> | null {
  try {
    const src = code.trim();

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

    // Extract the function name and return it
    const fnMatch = src.match(/function\s+(\w+)/);
    const fnName = fnMatch?.[1] || 'Design';
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
 * HOC that applies _pos_* and _scale_* props to [data-editable] DOM elements.
 * Ensures Preview (Player) and Export (renderStillOnWeb/renderMediaOnWeb)
 * produce identical results — single rendering path, no external overlay needed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapWithEditableTransforms(Component: React.ComponentType<any>): React.ComponentType<any> {
  return function WrappedDesign(props: Record<string, unknown>) {
    const containerRef = useRef<HTMLDivElement>(null);
    const propsRef = useRef(props);
    propsRef.current = props;

    const applyAll = useCallback(() => {
      const el = containerRef.current;
      if (!el) return;
      const p = propsRef.current;
      el.querySelectorAll('[data-editable]').forEach((node) => {
        const id = node.getAttribute('data-editable');
        if (!id) return;
        const htmlEl = node as HTMLElement;
        const pos = p[`_pos_${id}`] as { x: number; y: number } | undefined;
        const sc = p[`_scale_${id}`] as { w: number; h: number } | undefined;
        htmlEl.style.translate = pos ? `${pos.x}px ${pos.y}px` : '';
        htmlEl.style.scale = sc ? `${sc.w} ${sc.h}` : '';
      });
    }, []);

    // MutationObserver: apply transforms whenever children appear or change
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      applyAll();
      const mo = new MutationObserver(applyAll);
      mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-editable'] });
      return () => mo.disconnect();
    }, [applyAll]);

    // Re-apply when transform props change
    const transformKeys = Object.keys(props).filter(k => k.startsWith('_pos_') || k.startsWith('_scale_'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const transformDep = JSON.stringify(transformKeys.sort().map(k => [k, props[k]]));
    useEffect(() => { applyAll(); }, [transformDep, applyAll]);

    return React.createElement('div', { ref: containerRef, style: { width: '100%', height: '100%' } },
      React.createElement(Component, props)
    );
  };
}
