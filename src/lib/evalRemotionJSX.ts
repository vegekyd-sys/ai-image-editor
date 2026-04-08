'use client';

/**
 * Evaluate Agent-generated JSX code as a React component.
 * Uses sucrase to transpile JSX → React.createElement.
 * Injects Remotion APIs into scope so Agent code can use useCurrentFrame, etc.
 *
 * Convention: Agent writes a COMPLETE function with return statement:
 *   function Design(props) { return (<div>...</div>); }
 * No auto-return regex needed.
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
 * Agent must write a complete function: `function Design(props) { return (...); }`
 * @param code — Complete function definition
 * @returns React component or null on error
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function evalRemotionJSX(code: string): React.ComponentType<any> | null {
  try {
    const src = code.trim();

    // Transpile JSX → React.createElement
    const { code: compiled } = transform(src, {
      transforms: ['typescript', 'jsx'],
      jsxRuntime: 'classic',
    });

    // Extract the function name and return it
    // Agent writes: function Design(props) { ... }
    // After transpile: function Design(props) { ... }
    // We execute the code and return the function by name
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
