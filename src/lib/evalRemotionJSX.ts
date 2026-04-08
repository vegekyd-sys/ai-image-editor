'use client';

/**
 * Evaluate Agent-generated JSX code as a React component.
 * Uses sucrase to transpile JSX → React.createElement (same as video-maker).
 * Injects Remotion APIs into scope so Agent code can use useCurrentFrame, etc.
 */

import { transform } from 'sucrase';
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

/**
 * Transpile Agent JSX code → React component.
 * @param codeBody — Function body that returns JSX (not a full module)
 * @returns React component or null on error
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function evalRemotionJSX(codeBody: string): React.ComponentType<any> | null {
  const body = codeBody.trim();

  // Try to compile a given function body string
  function tryCompile(src: string): React.ComponentType<any> | null {
    try {
      const wrapped = `function __AgentDesign__(props) {\n${src}\n}`;
      const { code: compiled } = transform(wrapped, {
        transforms: ['typescript', 'jsx'],
        jsxRuntime: 'classic',
      });
      const execCode = `${compiled}\nreturn __AgentDesign__;`;
      const scopeKeys = Object.keys(REMOTION_SCOPE);
      const scopeValues = Object.values(REMOTION_SCOPE);
      const factory = new Function(...scopeKeys, execCode);
      return factory(...scopeValues);
    } catch (err) {
      return null;
    }
  }

  // Try to add `return` before the root JSX expression
  function addAutoReturn(src: string): string | null {
    if (src.startsWith('<') || src.startsWith('(')) {
      // Pure JSX or IIFE expression — wrap with return
      return 'return (\n' + src + '\n)';
    }
    // Find first opening tag after a statement terminator
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith('<') && !trimmed.startsWith('</')) {
        const prev = i > 0 ? lines[i - 1].trimEnd() : '';
        if (!prev || prev.endsWith(';') || prev.endsWith('}') || prev.endsWith('*/')) {
          // Check not already returned
          if (/\breturn[\s(]/.test(lines[i]) ||
              (i > 0 && /\breturn\s*$/.test(lines[i - 1]))) {
            return null; // already has return
          }
          lines[i] = 'return (' + lines[i];
          lines.push(')');
          return lines.join('\n');
        }
      }
    }
    return null;
  }

  // Strategy: try with auto-return first (most agent code needs it),
  // fall back to original if auto-return breaks compilation.
  const withReturn = addAutoReturn(body);
  if (withReturn) {
    const comp = tryCompile(withReturn);
    if (comp) return comp;
    console.warn('[evalRemotionJSX] auto-return broke compilation, trying original');
  }

  // Try original code (may already have return, or will render undefined)
  const comp = tryCompile(body);
  if (comp) return comp;

  console.error('[evalRemotionJSX] all compile attempts failed');
  return null;
}
