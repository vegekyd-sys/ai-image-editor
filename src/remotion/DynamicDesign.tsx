/**
 * DynamicDesign — a Remotion composition that compiles and renders Agent-generated JSX code.
 * Used by server-side renderStill to preview designs.
 * Mirrors the browser-side evalRemotionJSX logic.
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
import { Audio } from '@remotion/media';
import { transform as sucraseTransform } from 'sucrase';

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
};

function compileAndEval(code: string): React.ComponentType<Record<string, unknown>> | null {
  try {
    const src = code.trim();
    const { code: compiled } = sucraseTransform(src, {
      transforms: ['typescript', 'jsx'],
      jsxRuntime: 'classic',
    });
    const fnMatch = src.match(/function\s+(\w+)/);
    const fnName = fnMatch?.[1] || 'Design';
    const execCode = `${compiled}\nreturn ${fnName};`;
    const scopeKeys = Object.keys(REMOTION_SCOPE);
    const scopeValues = Object.values(REMOTION_SCOPE);
    const factory = new Function(...scopeKeys, execCode);
    return factory(...scopeValues);
  } catch (err) {
    console.error('[DynamicDesign] compile error:', err);
    return null;
  }
}

export const DynamicDesign: React.FC<Record<string, unknown>> = ({ code, designProps }) => {
  const codeStr = typeof code === 'string' ? code : '';
  const propsObj = (typeof designProps === 'object' && designProps !== null ? designProps : {}) as Record<string, unknown>;
  const Component = useMemo(() => compileAndEval(codeStr), [codeStr]);
  if (!Component) {
    return (
      <AbsoluteFill style={{ background: '#1a1a2e', color: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: 14 }}>
        Failed to compile design code
      </AbsoluteFill>
    );
  }
  return <Component {...propsObj} />;
};
