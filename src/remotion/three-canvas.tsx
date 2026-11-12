import React from 'react';
import { ThreeCanvas as RemotionThreeCanvas, type ThreeCanvasProps } from '@remotion/three';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

// Web export copies the canvas after WebGL presents its frame. Preserve the
// drawing buffer even when the composition supplies its own renderer options.
const captureOptions = { preserveDrawingBuffer: true, antialias: true };

function ThreeCanvas({ gl, ...props }: ThreeCanvasProps) {
  let options = gl ?? captureOptions;
  if (gl && typeof gl === 'object' && !('render' in gl)) {
    options = { ...gl, preserveDrawingBuffer: true };
  }
  return <RemotionThreeCanvas dpr={1} frameloop="demand" {...props} gl={options} />;
}

export const threeScope = { THREE, ThreeCanvas, useThree };
export const threeModules = {
  three: { ...THREE, default: THREE, __esModule: true },
  '@remotion/three': { ThreeCanvas, __esModule: true },
  '@react-three/fiber': { useThree, __esModule: true },
};
