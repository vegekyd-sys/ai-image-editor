/**
 * Design harness — compile check + auto-fix on Agent's run_code design output.
 * Only checks syntax (Sucrase compile). Does NOT dry-run with mock scope —
 * that was blocking valid code using noise2D, paths, etc.
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
 */
export function validateDesign(result: DesignResult): string | null {
  // Auto-fix: Replace <img> with Remotion <Img> for delayRender support
  result.code = autoFixImgTags(result.code);

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

/** Compile code with Sucrase — syntax check only, no runtime execution */
function checkCompile(code: string): string | null {
  try {
    sucraseTransform(code.trim(), {
      transforms: ['typescript', 'jsx'],
      jsxRuntime: 'classic',
    });
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

  if (serialized.includes('"ctx.snapshotImages') || serialized.includes("'ctx.snapshotImages")) {
    return '⚠️ Design rejected: ctx.snapshotImages[N] was passed as a string literal instead of being evaluated. Use template literal interpolation: `${ctx.snapshotImages[N]}` to embed the actual URL. Regenerate.';
  }

  if (/data:image\/[^;]+;base64,[A-Za-z0-9+/=]{5120000,}/.test(serialized)) {
    return '⚠️ Design rejected: Base64 image data >5MB found in code/props. Use ctx.snapshotImages[N] URLs for full-size images. Regenerate.';
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
      return '⚠️ Design rejected: An <Img> tag has an empty or undefined src. Make sure all ctx.snapshotImages[N] have valid URLs. Regenerate.';
    }
    if (!src.startsWith('https://') && !src.startsWith('data:image/')) {
      return `⚠️ Design rejected: Image src "${src.substring(0, 60)}..." is not a valid HTTPS URL. Use ctx.snapshotImages[N]. Regenerate.`;
    }
  }

  return null;
}
