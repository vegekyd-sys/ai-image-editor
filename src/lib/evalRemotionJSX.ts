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
  try {
    // Wrap in named function so sucrase can transpile
    const wrapped = `function __AgentDesign__(props) {\n${codeBody}\n}`;

    // Transpile JSX → React.createElement
    const { code: compiled } = transform(wrapped, {
      transforms: ['typescript', 'jsx'],
      jsxRuntime: 'classic', // uses React.createElement
    });

    // Build executable: define function + return it
    const execCode = `${compiled}\nreturn __AgentDesign__;`;

    // Create function with Remotion scope injected as arguments
    const scopeKeys = Object.keys(REMOTION_SCOPE);
    const scopeValues = Object.values(REMOTION_SCOPE);
    const factory = new Function(...scopeKeys, execCode);
    return factory(...scopeValues);
  } catch (err) {
    console.error('[evalRemotionJSX] transpile error:', err);
    return null;
  }
}
