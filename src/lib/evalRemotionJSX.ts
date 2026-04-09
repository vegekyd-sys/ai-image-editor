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
    return factory(...scopeValues);
  } catch (err) {
    console.error('[evalRemotionJSX] compile error:', err);
    return null;
  }
}
