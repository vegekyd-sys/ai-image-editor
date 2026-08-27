export function normalizeRemotionScopeDeclarations(code: string): string {
  return code
    .trim()
    .replace(/^\s*(?:const|let|var)\s*\{[^}]*\}\s*=\s*(?:window\.)?Remotion\s*;?\s*$/gm, '')
    .replace(/^\s*(?:const|let|var)\s+Remotion\s*=\s*window\.Remotion\s*;?\s*$/gm, '')
    .replace(/\bwindow\.Remotion\./g, '')
    .replace(/\bRemotion\./g, '')
    .trim();
}

/**
 * Build the evaluator body used by every in-browser Remotion runtime.
 *
 * Agent-authored code is normal application code, so it may contain imports,
 * exports, CommonJS assignments, or declarations such as
 * `const Composition = ...`. Evaluating every injected Remotion symbol as a
 * `new Function()` parameter made those perfectly ordinary declarations
 * collide with the harness. A `with` scope keeps runtime helpers available
 * while allowing lexical declarations in the authored module to shadow them.
 */
export function buildRemotionEvaluatorBody(compiled: string, componentName: string): string {
  return `with (__scope) {
  return (function () {
${compiled}
    const __namedComposition = typeof ${componentName} !== 'undefined' ? ${componentName} : undefined;
    const __moduleDefault = module.exports && module.exports.default;
    const __exportsDefault = exports && exports.default;
    return __moduleDefault || __exportsDefault || __namedComposition || module.exports;
  }).call(undefined);
}`;
}

/** Distinguish a natural Remotion module from the legacy outer run_code body. */
export function isDirectRemotionCompositionSource(code: string): boolean {
  if (/\breturn\s*\{\s*type\s*:\s*['"](?:render|design|patch)['"]/.test(code)) return false;
  const hasComponent = (
    /\b(?:export\s+(?:default\s+)?)?function\s+[A-Za-z_$][\w$]*\s*\(/.test(code)
    || /\b(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(code)
    || /\bexport\s+default\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(code)
  );
  const hasReactOutput = /<[A-Za-z][^>]*>|\bReact\.createElement\s*\(/.test(code);
  return hasComponent && hasReactOutput;
}

// Common names made available through DynamicDesign's open runtime scope.
export const DYNAMIC_DESIGN_SCOPE_NAMES = [
  'React', 'useState', 'useEffect', 'useCallback', 'useMemo', 'useRef', 'THREE',
  'Composition', 'AbsoluteFill', 'Audio', 'Video', 'OffthreadVideo', 'Sequence',
  'Series', 'Img', 'IFrame', 'Folder', 'Still', 'Freeze', 'Loop',
  'Html5Audio', 'Html5Video', 'AnimatedImage', 'useCurrentFrame', 'useVideoConfig',
  'interpolate', 'spring', 'Easing', 'random', 'staticFile', 'delayRender',
  'continueRender', 'cancelRender', 'getInputProps', 'getRemotionEnvironment',
  'makePath', 'evolvePath', 'interpolatePath', 'noise2D', 'noise3D', 'noise4D',
] as const;
