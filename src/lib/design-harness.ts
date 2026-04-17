/**
 * Design harness — automated checks on Agent's run_code design output.
 * Catches common errors before sending to frontend. Returns error message
 * for Agent to retry, or null if all checks pass.
 */

import { transform as sucraseTransform } from 'sucrase';
import type { EditableField } from '@/types';

export interface DesignResult {
  code: string;
  props?: Record<string, unknown>;
  editables?: EditableField[];
  [key: string]: unknown;
}

/**
 * Validate a design result from run_code. Returns null if valid,
 * or an error message string if the design should be rejected.
 * Agent receives the error and can retry.
 */
export function validateDesign(result: DesignResult): string | null {
  // ── Auto-fix: Replace <img> with Remotion <Img> for delayRender support ──
  result.code = autoFixImgTags(result.code);

  // ── Check 1: Compile + execute with mock scope ──
  const compileError = checkCompile(result.code, result);
  if (compileError) return compileError;

  // ── Check 2: Image references ──
  const imageError = checkImageReferences(result.code, result.props);
  if (imageError) return imageError;

  // ── Check 3: Image URLs valid ──
  const urlError = checkImageUrls(result.code);
  if (urlError) return urlError;

  // ── Check 4: Editables validation ──
  const editablesError = validateEditables(result.editables);
  if (editablesError) return editablesError;

  return null; // all checks passed
}

/** Validate editable fields declaration. Returns error message or null. */
export function validateEditables(editables?: EditableField[]): string | null {
  if (!editables || editables.length === 0) return null;
  for (const field of editables) {
    if (!field.id || !field.type || !field.propKey) {
      return '⚠️ Editable field missing required properties (id, type, propKey). Each editable must have { id, type, label, propKey }.';
    }
  }
  return null;
}

/** Replace HTML <img with Remotion <Img so renderStillOnWeb waits for image loading */
function autoFixImgTags(code: string): string {
  // <img ... /> or <img ...> → <Img ... /> or <Img ...>
  // Negative lookbehind: don't replace if already <Img
  const fixed = code.replace(/<img(?=[\s/>])/g, '<Img');
  if (fixed !== code) {
    console.log('🔧 [design-harness] auto-fixed <img> → <Img> for Remotion delayRender');
  }
  return fixed;
}

/** Compile code with Sucrase then execute component with mock scope to catch runtime errors */
function checkCompile(code: string, result?: DesignResult | null): string | null {
  try {
    const { code: compiled } = sucraseTransform(code.trim(), {
      transforms: ['typescript', 'jsx'],
      jsxRuntime: 'classic',
    });

    // Dry-run: verify compiled JS is valid in new Function() (matches browser eval path)
    const fnName = code.match(/function\s+(\w+)/)?.[1] || 'Design';

    // Execute the component with mock scope to catch runtime errors
    // (props undefined, missing variables, wrong API usage, etc.)
    const mockElement = (...args: unknown[]) => ({ type: 'div', props: args[1] || {}, children: args.slice(2) });
    const noop = () => {};
    const mockScope: Record<string, unknown> = {
      React: { createElement: mockElement, Fragment: 'Fragment' },
      useState: (init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, noop],
      useEffect: noop, useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(),
      useRef: (init: unknown) => ({ current: init }),
      useCurrentFrame: () => 0,
      useVideoConfig: () => ({ width: 1080, height: 1350, fps: 30, durationInFrames: 1 }),
      interpolate: (frame: number) => frame,
      spring: () => 0,
      Sequence: 'Sequence', Series: 'Series', Img: 'Img', AbsoluteFill: 'AbsoluteFill', Audio: 'Audio',
      // @remotion/paths
      evolvePath: () => '', getLength: () => 0, getPointAtLength: () => ({ x: 0, y: 0 }), getTangentAtLength: () => ({ x: 0, y: 0 }), interpolatePath: () => '', parsePath: () => [], resetPath: () => '', cutPath: () => '',
      // @remotion/noise
      noise2D: () => 0, noise3D: () => 0,
    };
    const scopeKeys = Object.keys(mockScope);
    const scopeValues = Object.values(mockScope);
    const factory = new Function(...scopeKeys, compiled + '\nreturn ' + fnName + ';');
    const Component = factory(...scopeValues);
    // Call with empty props — catches "props is not defined", ReferenceError, TypeError, etc.
    Component(result?.props || {});

    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`⚠️ [design-harness] compile failed: ${msg}`);
    return `⚠️ Design compile error: ${msg}. Fix the syntax error in your code and try again.`;
  }
}

/** Check for problematic image references in code/props */
function checkImageReferences(code: string, props?: Record<string, unknown>): string | null {
  const serialized = JSON.stringify({ code, props });

  // Unresolved ctx.snapshotImages string literal (should be URL, not literal text)
  if (serialized.includes('"ctx.snapshotImages') || serialized.includes("'ctx.snapshotImages")) {
    console.warn('⚠️ [design-harness] found unresolved ctx.snapshotImages string literal');
    return '⚠️ Design rejected: ctx.snapshotImages[N] was passed as a string literal instead of being evaluated. Use template literal interpolation: `${ctx.snapshotImages[N]}` to embed the actual URL. Regenerate.';
  }

  // Large base64 embedded in code or props (>5MB base64 = too heavy for rendering)
  // Smaller base64 (<5MB) is allowed for thumbnails, icons, workspace draft images, etc.
  if (/data:image\/[^;]+;base64,[A-Za-z0-9+/=]{5120000,}/.test(serialized)) {
    console.warn('⚠️ [design-harness] found large base64 (>5MB) in design');
    return '⚠️ Design rejected: Base64 image data >5MB found in code/props. Use ctx.snapshotImages[N] URLs for full-size images. Regenerate.';
  }

  return null;
}

/** Check that image src values in code are valid HTTPS URLs (not empty, undefined, or localhost) */
function checkImageUrls(code: string): string | null {
  const srcValues: string[] = [];

  // Match static: src="..." / src='...' / src=`...`
  const staticMatches = code.match(/src=["'`]([^"'`]*)["'`]/g) || [];
  for (const m of staticMatches) {
    const match = m.match(/src=["'`]([^"'`]*)["'`]/);
    if (match) srcValues.push(match[1]);
  }

  // Match JSX expressions: src={'...'} / src={"..."} / src={`...`}
  const exprMatches = code.match(/src=\{["'`]([^"'`]*)["'`]\}/g) || [];
  for (const m of exprMatches) {
    const match = m.match(/src=\{["'`]([^"'`]*)["'`]\}/);
    if (match) srcValues.push(match[1]);
  }

  for (const src of srcValues) {
    if (!src || src === 'undefined' || src === 'null' || src === '') {
      console.warn(`⚠️ [design-harness] empty/undefined image src found`);
      return '⚠️ Design rejected: An <Img> tag has an empty or undefined src. Make sure all ctx.snapshotImages[N] have valid URLs. Use direct string interpolation: src="${ctx.snapshotImages[0]}" — never nest template literals. Regenerate.';
    }
    // Must be HTTPS URL (not http localhost, not relative path, not data: unless small)
    if (!src.startsWith('https://') && !src.startsWith('data:image/')) {
      console.warn(`⚠️ [design-harness] non-HTTPS image src: ${src.substring(0, 80)}`);
      return `⚠️ Design rejected: Image src "${src.substring(0, 60)}..." is not a valid HTTPS URL. Use ctx.snapshotImages[N] which contains Supabase Storage URLs. Regenerate.`;
    }
  }

  return null;
}
