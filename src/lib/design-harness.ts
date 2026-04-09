/**
 * Design harness — automated checks on Agent's run_code design output.
 * Catches common errors before sending to frontend. Returns error message
 * for Agent to retry, or null if all checks pass.
 */

import { transform as sucraseTransform } from 'sucrase';

export interface DesignResult {
  code: string;
  props?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Validate a design result from run_code. Returns null if valid,
 * or an error message string if the design should be rejected.
 * Agent receives the error and can retry.
 */
export function validateDesign(result: DesignResult): string | null {
  // ── Check 1: Compile ──
  const compileError = checkCompile(result.code);
  if (compileError) return compileError;

  // ── Check 2: Image references ──
  const imageError = checkImageReferences(result.code, result.props);
  if (imageError) return imageError;

  // ── Check 3: Image URLs valid ──
  const urlError = checkImageUrls(result.code);
  if (urlError) return urlError;

  return null; // all checks passed
}

/** Check that code compiles with Sucrase */
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

  // Unresolved ctx.snapshotImages string literal (should be URL, not literal text)
  if (serialized.includes('"ctx.snapshotImages') || serialized.includes("'ctx.snapshotImages")) {
    console.warn('⚠️ [design-harness] found unresolved ctx.snapshotImages string literal');
    return '⚠️ Design rejected: ctx.snapshotImages[N] was passed as a string literal instead of being evaluated. Use template literal interpolation: `${ctx.snapshotImages[N]}` to embed the actual URL. Regenerate.';
  }

  // Large base64 embedded in code or props (>10KB = likely an image)
  if (/data:image\/[^;]+;base64,[A-Za-z0-9+/=]{10000,}/.test(serialized)) {
    console.warn('⚠️ [design-harness] found large base64 in design');
    return '⚠️ Design rejected: Large base64 image data found in code/props. Use ctx.snapshotImages[N] URLs instead of converting images to base64. Regenerate.';
  }

  return null;
}

/** Check that image src values in code are valid HTTPS URLs (not empty, undefined, or localhost) */
function checkImageUrls(code: string): string | null {
  // Extract all src="..." values from JSX
  const srcMatches = code.match(/src=["'`]([^"'`]*)["'`]/g) || [];
  // Also match template literal: src="${...}" after interpolation → src="https://..."
  const srcValues = srcMatches.map(m => {
    const match = m.match(/src=["'`]([^"'`]*)["'`]/);
    return match?.[1] || '';
  });

  for (const src of srcValues) {
    if (!src || src === 'undefined' || src === 'null' || src === '') {
      console.warn(`⚠️ [design-harness] empty/undefined image src found`);
      return '⚠️ Design rejected: An <img> tag has an empty or undefined src. Make sure all ctx.snapshotImages[N] have valid URLs. Some snapshots may not have uploaded yet — check ctx.snapshotImages values before using them. Regenerate.';
    }
    // Must be HTTPS URL (not http localhost, not relative path, not data: unless small)
    if (!src.startsWith('https://') && !src.startsWith('data:image/')) {
      console.warn(`⚠️ [design-harness] non-HTTPS image src: ${src.substring(0, 80)}`);
      return `⚠️ Design rejected: Image src "${src.substring(0, 60)}..." is not a valid HTTPS URL. Use ctx.snapshotImages[N] which contains Supabase Storage URLs. Regenerate.`;
    }
  }

  return null;
}
