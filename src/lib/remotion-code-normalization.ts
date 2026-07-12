export function normalizeRemotionScopeDeclarations(code: string): string {
  return code
    .trim()
    .replace(/^\s*(?:const|let|var)\s*\{[^}]*\}\s*=\s*(?:window\.)?Remotion\s*;?\s*$/gm, '')
    .replace(/^\s*(?:const|let|var)\s+Remotion\s*=\s*window\.Remotion\s*;?\s*$/gm, '')
    .replace(/\bwindow\.Remotion\./g, '')
    .replace(/\bRemotion\./g, '')
    .trim();
}

// Common names injected as parameters by DynamicDesign. Declaring one with
// const/let inside the generated body is a syntax error in new Function().
export const DYNAMIC_DESIGN_SCOPE_NAMES = [
  'React', 'useState', 'useEffect', 'useCallback', 'useMemo', 'useRef', 'THREE',
  'Composition', 'AbsoluteFill', 'Audio', 'Video', 'OffthreadVideo', 'Sequence',
  'MakaronCaptionOverlay',
  'Series', 'Img', 'IFrame', 'Folder', 'Still', 'Freeze', 'Loop',
  'Html5Audio', 'Html5Video', 'AnimatedImage', 'useCurrentFrame', 'useVideoConfig',
  'interpolate', 'spring', 'Easing', 'random', 'staticFile', 'delayRender',
  'continueRender', 'cancelRender', 'getInputProps', 'getRemotionEnvironment',
  'makePath', 'evolvePath', 'interpolatePath', 'noise2D', 'noise3D', 'noise4D',
] as const;
