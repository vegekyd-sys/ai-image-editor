/**
 * Design harness — compile check + auto-fix on Agent's run_code design output.
 * Only checks syntax (Sucrase compile). Does NOT dry-run with mock scope —
 * that was blocking valid code using noise2D, paths, etc.
 */

import { transform as sucraseTransform } from 'sucrase';
import type { EditableField } from '@/types';
import {
  DYNAMIC_DESIGN_SCOPE_NAMES,
  normalizeRemotionScopeDeclarations,
} from './remotion-code-normalization';

export interface DesignResult {
  code: string;
  props?: Record<string, unknown>;
  editables?: EditableField[];
  [key: string]: unknown;
}

/**
 * Validate a design result from run_code. Returns null if valid,
 * or an error message string if the design should be rejected.
 */
export function validateDesign(result: DesignResult): string | null {
  // Auto-fix: Replace <img> with Remotion <Img> for delayRender support
  result.code = autoFixImgTags(result.code);
  result.code = autoFixVideoTags(result.code);

  // Check 1: Syntax — Sucrase compile only (no runtime execution)
  const compileError = checkCompile(result.code);
  if (compileError) return compileError;

  // Check 2: Image references
  const imageError = checkImageReferences(result.code, result.props);
  if (imageError) return imageError;

  // Check 3: Image URLs valid
  const urlError = checkImageUrls(result.code);
  if (urlError) return urlError;

  // Check 4: Editables validation
  const editablesError = validateEditables(result.editables);
  if (editablesError) return editablesError;

  return null;
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
  const fixed = code.replace(/<img(?=[\s/>])/g, '<Img');
  if (fixed !== code) {
    console.log('🔧 [design-harness] auto-fixed <img> → <Img> for Remotion delayRender');
  }
  return fixed;
}

/** Replace HTML <video with Remotion <Video and strip native-only attributes */
function autoFixVideoTags(code: string): string {
  let fixed = code;
  // JSX form: <video → <Video
  fixed = fixed.replace(/<video(?=[\s/>])/g, '<Video').replace(/<\/video>/g, '</Video>');
  // createElement form: createElement('video' → createElement(Video
  fixed = fixed.replace(/createElement\(\s*['"]video['"]/g, 'createElement(Video');
  // Strip attributes that don't apply to Remotion <Video> (muted is kept — Remotion supports it)
  fixed = fixed.replace(/\s+autoPlay(?=[\s/>])/g, '');
  fixed = fixed.replace(/\s+controls(?=[\s/>])/g, '');
  fixed = fixed.replace(/\s+playsInline(?=[\s/>])/g, '');
  // createElement props: autoPlay: true → remove
  fixed = fixed.replace(/,?\s*autoPlay:\s*true\s*,?/g, (m) => m.startsWith(',') && m.endsWith(',') ? ',' : '');
  if (fixed !== code) {
    console.log('🔧 [design-harness] auto-fixed <video> → <Video> for Remotion Player sync');
  }
  return fixed;
}


/** Compile code with Sucrase — syntax check only, no runtime execution */
function checkCompile(code: string): string | null {
  try {
    if (/^\s*(?:import|export)\b/m.test(code)) {
      return '⚠️ Composition compile error: import/export module syntax is not supported. Declare the component directly and try again.';
    }
    if (/\brequire\s*\(|\bmodule\.exports\b|\bexports\s*\./.test(code)) {
      return '⚠️ Composition compile error: require/module.exports syntax is not supported in DynamicDesign. Use the injected Remotion and React names directly.';
    }
    const source = normalizeRemotionScopeDeclarations(code);
    const { code: compiled } = sucraseTransform(source, {
      transforms: ['typescript', 'jsx'],
      jsxRuntime: 'classic',
    });
    // DynamicDesign evaluates the compiled body with new Function(). Parse it
    // the same way here so browser-incompatible syntax fails before rendering.
    new Function(...DYNAMIC_DESIGN_SCOPE_NAMES, `"use strict";\n${compiled}\nreturn undefined;`);
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`⚠️ [design-harness] compile failed: ${msg}`);
    return `⚠️ Composition compile error: ${msg}. Fix the syntax error in your code and try again.`;
  }
}

/** Check for problematic image references in code/props */
function checkImageReferences(code: string, props?: Record<string, unknown>): string | null {
  const serialized = JSON.stringify({ code, props });

  if (serialized.includes('"ctx.snapshotImages') || serialized.includes("'ctx.snapshotImages")) {
    return '⚠️ Composition rejected: ctx.snapshotImages[N] was passed as a string literal. Use the 1-based <<<media_N>>> marker in composition code or props; run_code resolves it before rendering. Regenerate.';
  }

  if (/<<<media_\d+>>>/.test(serialized)) {
    return '⚠️ Composition rejected: a Media Index marker could not be resolved. Check that <<<media_N>>> uses an available 1-based Media Index number, then regenerate.';
  }

  if (/data:image\/[^;]+;base64,[A-Za-z0-9+/=]{5120000,}/.test(serialized)) {
    return '⚠️ Composition rejected: Base64 image data >5MB found in code/props. Use the corresponding <<<media_N>>> marker for full-size timeline images. Regenerate.';
  }

  return null;
}

/** Check that image src values in code are valid HTTPS URLs */
function checkImageUrls(code: string): string | null {
  const srcValues: string[] = [];

  const staticMatches = code.match(/src=["'`]([^"'`]*)["'`]/g) || [];
  for (const m of staticMatches) {
    const match = m.match(/src=["'`]([^"'`]*)["'`]/);
    if (match) srcValues.push(match[1]);
  }

  const exprMatches = code.match(/src=\{["'`]([^"'`]*)["'`]\}/g) || [];
  for (const m of exprMatches) {
    const match = m.match(/src=\{["'`]([^"'`]*)["'`]\}/);
    if (match) srcValues.push(match[1]);
  }

  for (const src of srcValues) {
    if (!src || src === 'undefined' || src === 'null' || src === '') {
      return '⚠️ Composition rejected: An <Img> tag has an empty or undefined src. Use a valid <<<media_N>>> marker or HTTPS URL. Regenerate.';
    }
    if (!src.startsWith('https://') && !src.startsWith('data:image/')) {
      return `⚠️ Composition rejected: Image src "${src.substring(0, 60)}..." is not a valid HTTPS URL. Use a valid <<<media_N>>> marker or HTTPS URL. Regenerate.`;
    }
  }

  return null;
}
