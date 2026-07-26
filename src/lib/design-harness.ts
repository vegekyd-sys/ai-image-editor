/**
 * Design harness — compile check + auto-fix on Agent's run_code design output.
 * It performs static checks only. Runtime dry-runs with a mock scope used to
 * reject valid compositions that call injected helpers such as noise2D.
 */

import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import { transform as sucraseTransform } from 'sucrase';
import type { EditableField } from '@/types';
import { compileEditableManifest } from './editor/editable-manifest';
import {
  buildRemotionEvaluatorBody,
  DYNAMIC_DESIGN_SCOPE_NAMES,
  normalizeRemotionScopeDeclarations,
} from './remotion-code-normalization';

export interface DesignResult {
  code: string;
  props?: Record<string, unknown>;
  editables?: EditableField[];
  animation?: { fps?: number; durationInSeconds?: number; format?: string };
}

const SAFE_RUNTIME_GLOBALS = new Set([
  ...DYNAMIC_DESIGN_SCOPE_NAMES,
  'undefined', 'NaN', 'Infinity',
  'Object', 'Function', 'Boolean', 'Symbol', 'Error', 'AggregateError',
  'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError',
  'Number', 'BigInt', 'Math', 'Date', 'String', 'RegExp', 'Array',
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'BigInt64Array', 'BigUint64Array',
  'Float32Array', 'Float64Array', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry',
  'JSON', 'Promise', 'Reflect', 'Proxy', 'Intl',
  'parseFloat', 'parseInt', 'isFinite', 'isNaN', 'decodeURI', 'decodeURIComponent',
  'encodeURI', 'encodeURIComponent', 'escape', 'unescape',
  'console', 'globalThis', 'window', 'document', 'navigator', 'location',
  'performance', 'crypto', 'CSS', 'URL', 'URLSearchParams', 'Blob', 'File',
  'FileReader', 'FormData', 'Headers', 'Request', 'Response', 'TextEncoder',
  'TextDecoder', 'AbortController', 'AbortSignal', 'Image', 'ImageData',
  'fetch', 'atob', 'btoa', 'structuredClone', 'queueMicrotask',
  'require', 'module', 'exports',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame',
]);

/**
 * Validate a design result from run_code. Returns null if valid,
 * or an error message string if the design should be rejected.
 */
export function validateDesign(result: DesignResult): string | null {
  const diagnostics = validateDesignDiagnostics(result);
  if (diagnostics.length === 0) return null;
  if (diagnostics.length === 1) return diagnostics[0];
  return `Composition validation found ${diagnostics.length} blocking issues:\n${diagnostics.map(item => `- ${item}`).join('\n')}`;
}

/** Return every independent static diagnostic in one model repair turn. */
export function validateDesignDiagnostics(result: DesignResult): string[] {
  // Auto-fix: Replace <img> with Remotion <Img> for delayRender support
  result.code = autoFixImgTags(result.code);
  result.code = autoFixVideoTags(result.code);

  const manifest = compileEditableManifest({
    code: result.code,
    props: result.props,
    editables: result.editables,
  });
  result.code = manifest.code;
  result.editables = manifest.editables;

  // Check 1: Syntax — Sucrase compile only (no runtime execution)
  const compileError = checkCompile(result.code);
  if (compileError) return [compileError];

  const timelineDurationError = validateTimelineDuration(result);
  const diagnostics: string[] = [...manifest.diagnostics];
  if (timelineDurationError) diagnostics.push(timelineDurationError);

  // Check 2: Hooks evaluated while the composition module is being created.
  const hookError = checkTopLevelHookCalls(result.code);
  if (hookError) diagnostics.push(hookError);

  // Check 3: References that would only fail once Player/export evaluates code
  const referenceError = checkUnresolvedIdentifiers(result.code);
  if (referenceError) diagnostics.push(referenceError);

  // Check 4: Image references
  const imageError = checkImageReferences(result.code, result.props);
  if (imageError) diagnostics.push(imageError);

  // Check 5: Image URLs valid
  const urlError = checkImageUrls(result.code);
  if (urlError) diagnostics.push(urlError);

  // Check 6: Editables validation
  const editablesError = validateEditables(result.editables, result.code, result.props);
  if (editablesError) diagnostics.push(editablesError);

  const hardcodedTextError = validateHardcodedEditableText(result.editables, result.code);
  if (hardcodedTextError) diagnostics.push(hardcodedTextError);

  return [...new Set(diagnostics)];
}

/** Hooks may run inside components/custom hooks, never while evaluating the source module. */
function checkTopLevelHookCalls(code: string): string | null {
  try {
    const ast = parse(normalizeRemotionScopeDeclarations(code), {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript'],
    });
    const hooks = new Set<string>();
    traverse(ast, {
      CallExpression(path) {
        if (path.getFunctionParent()) return;
        const callee = path.node.callee;
        if (callee.type === 'Identifier' && /^use[A-Z0-9]/.test(callee.name)) {
          hooks.add(callee.name);
          return;
        }
        if (
          callee.type === 'MemberExpression'
          && !callee.computed
          && callee.object.type === 'Identifier'
          && callee.object.name === 'React'
          && callee.property.type === 'Identifier'
          && /^use[A-Z0-9]/.test(callee.property.name)
        ) {
          hooks.add(`React.${callee.property.name}`);
        }
      },
    });
    if (hooks.size === 0) return null;
    return `⚠️ Composition compile error: React/Remotion hook${hooks.size === 1 ? '' : 's'} ${[...hooks].join(', ')} called outside a component or custom hook. Move each hook call inside Composition or a helper component, then try again.`;
  } catch {
    // Syntax errors are already reported by checkCompile().
    return null;
  }
}

/** Catch missing constants/components before a remote render discovers them. */
function checkUnresolvedIdentifiers(code: string): string | null {
  try {
    const ast = parse(normalizeRemotionScopeDeclarations(code), {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript'],
    });
    const unresolved = new Set<string>();
    traverse(ast, {
      ReferencedIdentifier(path) {
        const name = path.node.name;
        if (!path.scope.hasBinding(name) && !SAFE_RUNTIME_GLOBALS.has(name)) {
          unresolved.add(name);
        }
      },
    });
    if (unresolved.size === 0) return null;
    const names = [...unresolved].sort();
    const shown = names.slice(0, 8).join(', ');
    const suffix = names.length > 8 ? `, +${names.length - 8} more` : '';
    return `⚠️ Composition compile error: unresolved identifier${names.length === 1 ? '' : 's'} ${shown}${suffix}. Define every constant and component in the composition, then try again.`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `⚠️ Composition compile error: ${msg}. Fix the syntax error in your code and try again.`;
}
}

/** Validate editable fields declaration. Returns error message or null. */
export function validateEditables(
  editables?: EditableField[],
  code = '',
  props?: Record<string, unknown>,
): string | null {
  if (!editables || editables.length === 0) return null;
  const dynamicBindings = collectDynamicEditableBindingsById(code, props);
  for (const field of editables) {
    if (!field.id || !field.type || !field.propKey) {
      return '⚠️ Editable field missing required properties (id, type, propKey). Each editable must have { id, type, label, propKey }.';
    }
    if (!['text', 'image', 'video'].includes(field.type)) {
      return `⚠️ Editable field "${field.id}" has unsupported type "${field.type}". Supported types: text, image, video.`;
    }

    const dynamicBinding = field.id === field.propKey
      ? dynamicBindings.get(field.id) ?? null
      : null;
    const openingTag = findEditableOpeningTag(code, field.id) ?? dynamicBinding?.openingTag ?? null;
    if (!openingTag) {
      return `⚠️ Editable field "${field.id}" is declared but no JSX element has data-editable="${field.id}". Add data-editable to the visible editable wrapper.`;
    }

    if (!codeReadsProp(code, field.propKey) && !dynamicBinding) {
      return `⚠️ Editable field "${field.id}" declares prop key "${field.propKey}", but the design code does not read props.${field.propKey}. Avoid hardcoded content; wire the editable element to props.${field.propKey}.`;
    }

    if (
      (field.type === 'image' || field.type === 'video')
      && (
        !openingTag
        || (
          !editableWrapperHasMeasurableBox(openingTag)
          && !/^<(?:Img|Video|OffthreadVideo)\b/.test(openingTag)
        )
      )
    ) {
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
  return null;
}

interface DynamicEditableBinding {
  expression: string;
  openingTag: string;
}

const DYNAMIC_MEMBER_EXPRESSION = '[A-Za-z_$][\\w$]*(?:(?:\\.[A-Za-z_$][\\w$]*)|(?:\\[[^\\]\\n]+\\]))*';

function normalizeDynamicExpression(expression: string): string {
  return expression.replace(/\s+/g, '');
}

function findDynamicEditableBindings(code: string): DynamicEditableBinding[] {
  const openingTagPattern = new RegExp(
    `<[A-Za-z][\\w.:-]*(?:\\s|\\n|\\r)[^>]*data-editable\\s*=\\s*\\{\\s*(${DYNAMIC_MEMBER_EXPRESSION})\\s*\\}[^>]*>`,
    'gm',
  );
  const propReadPattern = new RegExp(`\\bprops\\s*\\[\\s*(${DYNAMIC_MEMBER_EXPRESSION})\\s*\\]`, 'gm');
  const propReadExpressions = new Set(
    [...code.matchAll(propReadPattern)].map(match => normalizeDynamicExpression(match[1])),
  );

  return [...code.matchAll(openingTagPattern)]
    .map(match => ({
      expression: normalizeDynamicExpression(match[1]),
      openingTag: match[0],
    }))
    .filter(binding => propReadExpressions.has(binding.expression));
}

function collectDynamicEditableBindingsById(
  code: string,
  props?: Record<string, unknown>,
): Map<string, DynamicEditableBinding> {
  const bindingsById = new Map<string, DynamicEditableBinding>();
  const bindings = findDynamicEditableBindings(code);
  const propKeys = Object.keys(props ?? {});

  for (const binding of bindings) {
    const propertyName = binding.expression.match(/\.([A-Za-z_$][\w$]*)$/)?.[1];
    if (!propertyName) {
      for (const fieldId of propKeys) {
        if (hasQuotedToken(code, fieldId)) bindingsById.set(fieldId, binding);
      }
      continue;
    }

    const propertyPattern = new RegExp(
      `\\b${escapeRegExp(propertyName)}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`,
      'g',
    );
    for (const match of code.matchAll(propertyPattern)) {
      const fieldId = match[1];
      if (props && Object.prototype.hasOwnProperty.call(props, fieldId)) {
        bindingsById.set(fieldId, binding);
      }
    }

    const visit = (value: unknown) => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (
          key === propertyName
          && typeof child === 'string'
          && props
          && Object.prototype.hasOwnProperty.call(props, child)
        ) {
          bindingsById.set(child, binding);
        }
        visit(child);
      }
    };
    visit(props);
  }

  const compilerBindingPattern = new RegExp(
    `<[A-Za-z][\\w.:-]*(?:\\s|\\n|\\r)[^>]*data-editable\\s*=\\s*\\{\\s*(__makaronEditable_[A-Za-z_$][\\w$]*)\\s*\\}[^>]*>`,
    'gm',
  );
  for (const match of code.matchAll(compilerBindingPattern)) {
    const markerParam = match[1];
    const markerValuePattern = new RegExp(
      `\\b${escapeRegExp(markerParam)}\\s*=\\s*["'\`]([^"'\`]+)["'\`]`,
      'g',
    );
    for (const markerValue of code.matchAll(markerValuePattern)) {
      const fieldId = markerValue[1];
      if (!props || Object.prototype.hasOwnProperty.call(props, fieldId)) {
        bindingsById.set(fieldId, {
          expression: markerParam,
          openingTag: match[0],
        });
      }
    }
  }
  return bindingsById;
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
  const editableTokens = (editables ?? []).flatMap(field => [field.id, field.propKey]);
  const hardcoded = findHardcodedVisibleTextArray(code, editableTokens);
  if (hardcoded) {
    const kind = hardcoded.kind === 'object' ? 'text data array' : 'text array';
    const fix = hardcoded.kind === 'object'
      ? 'Move every user-facing year/title/description into top-level props and render those props in semantic text hosts.'
      : 'Move each user-facing label into a top-level prop and render that prop in its own semantic text host.';
    return `⚠️ Visible ${kind} "${hardcoded.name}" is hardcoded (${hardcoded.literals.slice(0, 3).join(', ')}). ${fix}`;
  }
  const hardcodedTextNode = findHardcodedVisibleTextNode(code);
  if (hardcodedTextNode) {
    return `⚠️ Visible JSX text is hardcoded (${hardcodedTextNode.literals.slice(0, 3).join(', ')}). User-facing labels, badges, stats, captions, and brand text must come from top-level props; the Editable Manifest is inferred automatically.`;
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
    // Object arrays commonly carry structural selectors such as
    // kind: 'hook' and titleKey: 'title0'. Only semantic text properties
    // above are user-facing; the generic literal fallback is for string arrays.
    if (/\{/.test(values)) continue;

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
    .filter(value => !/\b(?:return|function|const|let|var)\b|[;{}]/.test(value))
    .filter(value => !/(?:=>|&&|\|\||===|!==|>=|<=|\?\.)/.test(value))
    .filter(value => !value.startsWith('='))
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

/** Replace HTML <video> with the injected frame-synchronized runtime Video. */
function autoFixVideoTags(code: string): string {
  let fixed = code;
  fixed = fixed.replace(/<video(?=[\s/>])/g, '<Video').replace(/<\/video>/g, '</Video>');
  fixed = fixed.replace(/createElement\(\s*['"]video['"]/g, 'createElement(Video');
  // Only remove browser playback props from actual Video JSX tags. The old
  // global regex also mutated unrelated components and configuration objects.
  fixed = fixed.replace(/<Video\b[^>]*>/g, tag => tag
    .replace(/\s+autoPlay(?=[\s/>])/g, '')
    .replace(/\s+controls(?=[\s/>])/g, '')
    .replace(/\s+playsInline(?=[\s/>])/g, ''));
  if (fixed !== code) {
    console.log('🔧 [design-harness] auto-fixed <video> → <Video> for Remotion Player sync');
  }
  return fixed;
}


/** Compile code with Sucrase — syntax check only, no runtime execution */
function checkCompile(code: string): string | null {
  try {
    const source = normalizeRemotionScopeDeclarations(code);
    const { code: compiled } = sucraseTransform(source, {
      transforms: ['typescript', 'jsx', 'imports'],
      jsxRuntime: 'classic',
    });
    // Parse the exact open-scope module wrapper used by DynamicDesign. This
    // validates syntax without rejecting normal module/CommonJS authoring.
    new Function('__scope', 'module', 'exports', 'require', buildRemotionEvaluatorBody(compiled, 'Design'));
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

  if (/data:image\//i.test(serialized)) {
    return '⚠️ Composition rejected: inline data:image URLs are not export-safe. Use real HTTPS workspace or Supabase image URLs in props. Regenerate.';
  }

  if (/data:image\/[^;]+;base64,[A-Za-z0-9+/=]{5120000,}/.test(serialized)) {
    return '⚠️ Composition rejected: Base64 image data >5MB found in code/props. Use the corresponding <<<media_N>>> marker for full-size timeline images. Regenerate.';
  }

  return null;
}

/** Check that image src values in code are valid HTTPS URLs */
function checkImageUrls(code: string): string | null {
  const srcValues: string[] = [];

  // Validate only Remotion Img tags. Scanning every `src=` treated Video,
  // Audio and IFrame sources as images and rejected valid media URLs/data.
  const imgTags = code.match(/<Img\b[^>]*>/g) || [];
  for (const tag of imgTags) {
    const staticMatch = tag.match(/\bsrc=["'`]([^"'`]*)["'`]/);
    if (staticMatch) srcValues.push(staticMatch[1]);
    const expressionMatch = tag.match(/\bsrc=\{["'`]([^"'`]*)["'`]\}/);
    if (expressionMatch) srcValues.push(expressionMatch[1]);
  }

  for (const src of srcValues) {
    if (!src || src === 'undefined' || src === 'null' || src === '') {
      return '⚠️ Composition rejected: An <Img> tag has an empty or undefined src. Use a valid <<<media_N>>> marker or HTTPS URL. Regenerate.';
    }
    if (!src.startsWith('https://')) {
      return `⚠️ Composition rejected: Image src "${src.substring(0, 60)}..." is not a valid HTTPS URL. Use ctx.snapshotImages[N]. Regenerate.`;
    }
  }

  return null;
}
