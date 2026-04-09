'use client';

/**
 * Evaluate Agent-generated JSX code as a React component.
 * Uses Babel standalone (dynamically loaded) to transpile JSX → React.createElement.
 * Supports all modern JS/TS syntax (optional chaining, nullish coalescing, etc.)
 *
 * Convention: Agent writes a COMPLETE function with return statement:
 *   function Design(props) { return (<div>...</div>); }
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

// Lazy-loaded Babel transform function (37MB — must not be in initial bundle)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _babelTransform: ((code: string, opts: any) => { code: string }) | null = null;

/** Pre-load Babel standalone. Call this early to avoid delay on first design render. */
export async function preloadBabel(): Promise<void> {
  if (_babelTransform) return;
  // @ts-expect-error — @babel/standalone has no types
  const babel = await import('@babel/standalone');
  _babelTransform = babel.transform;
}

/**
 * Transpile Agent JSX code → React component.
 * Agent must write a complete function: `function Design(props) { return (...); }`
 * IMPORTANT: Call preloadBabel() before first use.
 * @param code — Complete function definition
 * @returns React component or null on error
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function evalRemotionJSX(code: string): React.ComponentType<any> | null {
  if (!_babelTransform) {
    console.error('[evalRemotionJSX] Babel not loaded yet. Call preloadBabel() first.');
    return null;
  }

  try {
    const src = code.trim();

    // Transpile JSX + modern syntax → React.createElement via Babel
    const result = _babelTransform(src, {
      presets: ['react', 'typescript'],
      plugins: ['proposal-optional-chaining', 'proposal-nullish-coalescing-operator'],
      filename: 'design.tsx',
    });
    const compiled = result.code;

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
