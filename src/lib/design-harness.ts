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

  // ── Check 1: Compile ──
  const compileError = checkCompile(result.code);
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

  // ── Check 5: data-editable in code requires editables + props ──
  const missingEditables = checkEditablesPresence(result.code, result.editables, result.props);
  if (missingEditables) return missingEditables;

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

/** Check that code with data-editable attributes has matching editables array and props */
function checkEditablesPresence(code: string, editables?: EditableField[], props?: Record<string, unknown>): string | null {
  const dataEditableMatches = code.match(/data-editable=["'`]([^"'`]+)["'`]/g);
  if (!dataEditableMatches || dataEditableMatches.length === 0) return null; // no data-editable → skip

  const ids = dataEditableMatches.map(m => {
    const match = m.match(/data-editable=["'`]([^"'`]+)["'`]/);
    return match?.[1] || '';
  }).filter(Boolean);

  if (!editables || editables.length === 0) {
    console.warn(`⚠️ [design-harness] code has data-editable (${ids.slice(0, 3).join(', ')}...) but no editables array`);
    return `⚠️ Design rejected: Code uses data-editable="${ids[0]}" but no \`editables\` array was returned. Add editables: [{ id, type: 'text', label, propKey }] for each data-editable field, and include a \`props\` object with initial values. Regenerate.`;
  }

  if (!props || Object.keys(props).length === 0) {
    console.warn('⚠️ [design-harness] editables declared but no props object');
    return '⚠️ Design rejected: `editables` declared but no `props` object returned. Add props: { key: value } with initial text values for each editable field. Regenerate.';
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

/** Check that code compiles with Sucrase AND passes new Function() parsing */
function checkCompile(code: string): string | null {
  try {
    const { code: compiled } = sucraseTransform(code.trim(), {
      transforms: ['typescript', 'jsx'],
      jsxRuntime: 'classic',
    });

    // Dry-run: verify compiled JS is valid in new Function() (matches browser eval path)
    const fnName = code.match(/function\s+(\w+)/)?.[1] || 'Design';
    new Function(compiled + '\nreturn ' + fnName + ';');

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

  // Large base64 embedded in code or props (>500KB base64 = too heavy for rendering)
  // Small base64 (<500KB) is allowed for thumbnails, icons, etc.
  if (/data:image\/[^;]+;base64,[A-Za-z0-9+/=]{512000,}/.test(serialized)) {
    console.warn('⚠️ [design-harness] found large base64 (>500KB) in design');
    return '⚠️ Design rejected: Base64 image data >500KB found in code/props. Use ctx.snapshotImages[N] URLs for full-size images. Regenerate.';
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
