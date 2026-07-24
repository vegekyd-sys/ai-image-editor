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
  result.code = autoFixVideoTags(result.code);

  // Check 1: Syntax — Sucrase compile only (no runtime execution)
  const compileError = checkCompile(result.code);
  if (compileError) return compileError;

  const timelineDurationError = validateTimelineDuration(result);
  if (timelineDurationError) return timelineDurationError;

  // Check 2: Image references
  const imageError = checkImageReferences(result.code, result.props);
  if (imageError) return imageError;

  // Check 3: Image URLs valid
  const urlError = checkImageUrls(result.code);
  if (urlError) return urlError;

  // Check 4: Editables validation
  const missingEditablesError = validateMissingEditables(result.editables, result.code);
  if (missingEditablesError) return missingEditablesError;

  const editablesError = validateEditables(result.editables, result.code);
  if (editablesError) return editablesError;

  const hardcodedTextError = validateHardcodedEditableText(result.editables, result.code);
  if (hardcodedTextError) return hardcodedTextError;

  return null;
}

/** Validate editable fields declaration. Returns error message or null. */
export function validateEditables(editables?: EditableField[], code = ''): string | null {
  if (!editables || editables.length === 0) return null;
  for (const field of editables) {
    if (!field.id || !field.type || !field.propKey) {
      return '⚠️ Editable field missing required properties (id, type, propKey). Each editable must have { id, type, label, propKey }.';
    }
    if (!['text', 'image', 'video'].includes(field.type)) {
      return `⚠️ Editable field "${field.id}" has unsupported type "${field.type}". Supported types: text, image, video.`;
    }

    const openingTag = findEditableOpeningTag(code, field.id);
    const hasDynamicTextWrapper = field.type === 'text' && hasDynamicEditableReference(code, field.id);
    if (!openingTag && !hasDynamicTextWrapper) {
      return `⚠️ Editable field "${field.id}" is declared but no JSX element has data-editable="${field.id}". Add data-editable to the visible editable wrapper.`;
    }

    if (!codeReadsProp(code, field.propKey)) {
      return `⚠️ Editable field "${field.id}" declares prop key "${field.propKey}", but the design code does not read props.${field.propKey}. Avoid hardcoded content; wire the editable element to props.${field.propKey}.`;
    }

    if ((field.type === 'image' || field.type === 'video') && (!openingTag || !editableWrapperHasMeasurableBox(openingTag))) {
      return `⚠️ Editable ${field.type} field "${field.id}" must put data-editable on a measurable wrapper with an explicit box (width+height or inset). Moveable cannot resize/move a zero-size wrapper.`;
    }

    if (field.type === 'video') {
      const trimBeforeError = validateVideoTrimProp(code, field.id, 'trimBefore', field.trimBeforePropKey);
      if (trimBeforeError) return trimBeforeError;
      const trimAfterError = validateVideoTrimProp(code, field.id, 'trimAfter', field.trimAfterPropKey);
      if (trimAfterError) return trimAfterError;
    }
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateTimelineDuration(result: DesignResult): string | null {
  const animation = result.animation as { durationInSeconds?: unknown; fps?: unknown } | undefined;
  const duration = typeof animation?.durationInSeconds === 'number' ? animation.durationInSeconds : null;
  if (duration === null || duration > 1.5) return null;

  const sequenceCount = (result.code.match(/<Sequence\b/g) || []).length;
  const hasTimeline = sequenceCount > 0;
  if (!hasTimeline) return null;

  return '⚠️ Composition timeline appears longer than 1 second, but animation.durationInSeconds is 1. Set animation.durationInSeconds to the requested/final timeline duration (for example 30 for a 30s composition).';
}

function hasQuotedToken(code: string, token: string): boolean {
  return new RegExp(`["'\`]${escapeRegExp(token)}["'\`]`).test(code);
}

function hasDynamicEditableReference(code: string, id: string): boolean {
  if (!hasQuotedToken(code, id)) return false;
  return /\bdata-editable\s*=\s*\{\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])?\s*\}/.test(code);
}

function findEditableOpeningTag(code: string, id: string): string | null {
  const escaped = escapeRegExp(id);
  const patterns = [
    new RegExp(`<[A-Za-z][\\w.:-]*(?:\\s|\\n|\\r)[^>]*data-editable\\s*=\\s*"${escaped}"[^>]*>`, 'm'),
    new RegExp(`<[A-Za-z][\\w.:-]*(?:\\s|\\n|\\r)[^>]*data-editable\\s*=\\s*'${escaped}'[^>]*>`, 'm'),
    new RegExp(`<[A-Za-z][\\w.:-]*(?:\\s|\\n|\\r)[^>]*data-editable\\s*=\\s*\\{\\s*["'\`]${escaped}["'\`]\\s*\\}[^>]*>`, 'm'),
  ];
  for (const pattern of patterns) {
    const match = code.match(pattern);
    if (match) return match[0];
  }
  const dynamicPrefix = id.match(/^([A-Za-z_$][\w$-]*?)(\d+)$/)?.[1];
  if (dynamicPrefix) {
    const dynamicPattern = new RegExp(
      `<[A-Za-z][\\w.:-]*(?:\\s|\\n|\\r)[^>]*data-editable\\s*=\\s*\\{\\s*["'\`]${escapeRegExp(dynamicPrefix)}["'\`]\\s*\\+[^}]+\\}[^>]*>`,
      'm',
    );
    const match = code.match(dynamicPattern);
    if (match) return match[0];
  }
  if (hasQuotedToken(code, id)) {
    const dynamicIdPattern = /<[A-Za-z][\w.:-]*(?:\s|\n|\r)[^>]*data-editable\s*=\s*\{\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])?\s*\}[^>]*>/gm;
    for (const match of code.matchAll(dynamicIdPattern)) {
      return match[0];
    }
  }
  return null;
}

function codeReadsProp(code: string, propKey: string): boolean {
  const escaped = escapeRegExp(propKey);
  const patterns = [
    new RegExp(`props\\.${escaped}\\b`),
    new RegExp(`props\\s*\\[\\s*["'\`]${escaped}["'\`]\\s*\\]`),
  ];
  if (patterns.some(pattern => pattern.test(code))) return true;
  return hasQuotedToken(code, propKey) && /\bprops\s*\[\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])?\s*\]/.test(code);
}

function validateHardcodedEditableText(editables: EditableField[] | undefined, code: string): string | null {
  if (!editables || editables.length === 0) return null;
  const editableTokens = editables.flatMap(field => [field.id, field.propKey]);
  const hardcoded = findHardcodedVisibleTextArray(code, editableTokens);
  if (hardcoded) {
    const kind = hardcoded.kind === 'object' ? 'text data array' : 'text array';
    const fix = hardcoded.kind === 'object'
      ? 'Move every user-facing year/title/description into props, render props.* inside data-editable wrappers, and include matching text editables.'
      : 'User-facing text must be text editables: move each label into props, render props.labelKey, and include matching { type: \'text\', propKey } entries in editables.';
    return `⚠️ Visible ${kind} "${hardcoded.name}" is hardcoded (${hardcoded.literals.slice(0, 3).join(', ')}). ${fix}`;
  }
  const hardcodedTextNode = findHardcodedVisibleTextNode(code);
  if (hardcodedTextNode) {
    return `⚠️ Visible JSX text is hardcoded (${hardcodedTextNode.literals.slice(0, 3).join(', ')}). User-facing labels, badges, stats, captions, and brand text must come from props and have matching text editables.`;
  }
  return null;
}

function validateMissingEditables(editables: EditableField[] | undefined, code: string): string | null {
  if (editables && editables.length > 0) return null;
  const hardcoded = findHardcodedVisibleTextArray(code);
  if (hardcoded) {
    return `⚠️ Composition declares no editables, but visible text data "${hardcoded.name}" is hardcoded (${hardcoded.literals.slice(0, 3).join(', ')}). Put user-facing text in props, render it inside data-editable wrappers, and return matching editables so the GUI can edit it.`;
  }
  const hardcodedTextNode = findHardcodedVisibleTextNode(code);
  if (hardcodedTextNode) {
    return `⚠️ Composition declares no editables, but visible JSX text is hardcoded (${hardcodedTextNode.literals.slice(0, 3).join(', ')}). Put user-facing text in props, render it inside data-editable wrappers, and return matching editables so the GUI can edit it.`;
  }
  return null;
}

function findHardcodedVisibleTextArray(code: string, allowedTokens: string[] = []): { name: string; literals: string[]; kind: 'object' | 'string' } | null {
  const allowed = new Set(allowedTokens);
  const localArray = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\[([\s\S]*?)\]\s*;?/g;
  for (const match of code.matchAll(localArray)) {
    const [, name, values] = match;
    if (name === 'editables') continue;
    if (!isRenderedLocalArray(code, name)) continue;

    const objectTextLiterals = [...values.matchAll(/\b(?:title|headline|subtitle|caption|label|year|date|desc|description|body|text|copy|cta|name)\s*:\s*["'`]([^"'`{}]{2,})["'`]/gi)]
      .map(m => m[1].trim())
      .filter(value => !allowed.has(value))
      .filter(isVisibleTextLiteral);
    if (objectTextLiterals.length > 0) {
      return { name, literals: objectTextLiterals, kind: 'object' };
    }

    const literals = [...values.matchAll(/["'`]([^"'`{}]{2,})["'`]/g)]
      .map(m => m[1].trim())
      .filter(value => !allowed.has(value))
      .filter(isVisibleTextLiteral);
    if (literals.length === 0) continue;
    return { name, literals, kind: 'string' };
  }
  return null;
}

function isRenderedLocalArray(code: string, name: string): boolean {
  const escaped = escapeRegExp(name);
  const patterns = [
    new RegExp(`\\{\\s*${escaped}\\s*\\[`),
    new RegExp(`\\b${escaped}\\s*\\[`),
    new RegExp(`\\b${escaped}\\s*\\.\\s*(?:map|find|filter|slice|sort|toSorted)\\s*\\(`),
    new RegExp(`\\b${escaped}\\s*\\.\\s*(?:slice|filter|sort|toSorted)\\s*\\([^)]*\\)\\s*\\.\\s*map\\s*\\(`),
  ];
  return patterns.some(pattern => pattern.test(code));
}

function findHardcodedVisibleTextNode(code: string): { literals: string[] } | null {
  const withoutJsxComments = code.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const literals = [...withoutJsxComments.matchAll(/>\s*([^<>{}\n][^<>{}]*)\s*</g)]
    .map(m => m[1].replace(/\s+/g, ' ').trim())
    .filter(value => value.length >= 2)
    .filter(isVisibleTextLiteral);
  return literals.length > 0 ? { literals } : null;
}

function isVisibleTextLiteral(value: string): boolean {
  if (!/[\p{Script=Han}A-Za-z0-9]/u.test(value)) return false;
  // JSX/text regexes can catch tiny code-like identifiers from conditional expressions.
  // Real user-facing labels such as badges/stats are longer, numeric, Han, or uppercase brand text.
  if (/^[a-z][a-z0-9_]{0,2}$/.test(value)) return false;
  if (/^(?:https?:|data:|#[0-9a-f]{3,8}$|rgba?\(|hsla?\(|linear-gradient\()/i.test(value)) return false;
  return true;
}

function editableWrapperHasMeasurableBox(openingTag: string): boolean {
  if (!/\bstyle\s*=/.test(openingTag)) return false;
  const hasWidthAndHeight = /\bwidth\s*:/.test(openingTag) && /\bheight\s*:/.test(openingTag);
  const hasInset = /\binset\s*:/.test(openingTag);
  const hasFourEdges =
    /\bleft\s*:/.test(openingTag) &&
    /\bright\s*:/.test(openingTag) &&
    /\btop\s*:/.test(openingTag) &&
    /\bbottom\s*:/.test(openingTag);
  return hasWidthAndHeight || hasInset || hasFourEdges;
}

function validateVideoTrimProp(
  code: string,
  fieldId: string,
  propName: 'trimBefore' | 'trimAfter',
  propKey?: string,
): string | null {
  if (!propKey) return null;
  const escaped = escapeRegExp(propKey);
  const attrReadsProp = new RegExp(`${propName}\\s*=\\s*\\{\\s*(?:props\\.${escaped}\\b|props\\s*\\[\\s*["'\`]${escaped}["'\`]\\s*\\])\\s*\\}`);
  const createElementReadsProp = new RegExp(`${propName}\\s*:\\s*(?:props\\.${escaped}\\b|props\\s*\\[\\s*["'\`]${escaped}["'\`]\\s*\\])`);
  if (attrReadsProp.test(code) || createElementReadsProp.test(code)) return null;
  return `⚠️ Editable video field "${fieldId}" declares ${propName}PropKey "${propKey}", but no <Video> uses ${propName}={props.${propKey}}. Wire trimBefore/trimAfter so trim editing works.`;
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
    sucraseTransform(code.trim(), {
      transforms: ['typescript', 'jsx'],
      jsxRuntime: 'classic',
    });
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
    return '⚠️ Composition rejected: ctx.snapshotImages[N] was passed as a string literal instead of being evaluated. Use template literal interpolation: `${ctx.snapshotImages[N]}` to embed the actual URL. Regenerate.';
  }

  if (/<<<media_\d+>>>/.test(serialized)) {
    return '⚠️ Composition rejected: unresolved Media Index placeholder found. Use actual ctx.snapshotImages[N] URLs or props resolved from Media Index. Regenerate.';
  }

  if (/data:image\//i.test(serialized)) {
    return '⚠️ Composition rejected: inline data:image URLs are not export-safe. Use real HTTPS workspace or Supabase image URLs in props. Regenerate.';
  }

  if (/data:image\/[^;]+;base64,[A-Za-z0-9+/=]{5120000,}/.test(serialized)) {
    return '⚠️ Composition rejected: Base64 image data >5MB found in code/props. Use ctx.snapshotImages[N] URLs for full-size images. Regenerate.';
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
      return '⚠️ Composition rejected: An <Img> tag has an empty or undefined src. Make sure all ctx.snapshotImages[N] have valid URLs. Regenerate.';
    }
    if (!src.startsWith('https://')) {
      return `⚠️ Composition rejected: Image src "${src.substring(0, 60)}..." is not a valid HTTPS URL. Use ctx.snapshotImages[N]. Regenerate.`;
    }
  }

  return null;
}
