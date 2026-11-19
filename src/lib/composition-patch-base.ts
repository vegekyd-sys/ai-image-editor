import { isDirectRemotionCompositionSource } from './remotion-code-normalization'

/** Composition metadata a patch can inherit when its base is a bare source file. */
export interface CompositionPatchFallback {
  width?: number
  height?: number
  props?: Record<string, unknown>
  animation?: unknown
  editables?: unknown
  videoLayout?: unknown
  fontSubstitutions?: unknown
}

export type CompositionPatchBase =
  | { design: Record<string, any>; source: 'design-json' }
  | { design: Record<string, any>; source: 'code-file' }
  /** A run_code script that returns { type: 'render', code, ... }: edits apply to the script text, then it re-runs. */
  | { source: 'executable-file' }
  | { error: string }

const EXECUTABLE_RENDER_BODY = /\breturn\s*\{[\s\S]*?\btype\s*:\s*['"](?:render|composition|design)['"]/

export interface TextEdit { old: unknown; new: unknown }

/** Apply exact-match edits; each old string must occur exactly once. */
export function applyTextEdits(text: string, edits: TextEdit[]): { text: string } | { error: string } {
  let next = text
  for (const edit of edits) {
    if (typeof edit.old !== 'string' || typeof edit.new !== 'string') {
      return { error: 'Patch failed: each edit must have "old" and "new" strings.' }
    }
    const count = next.split(edit.old).length - 1
    if (count === 0) return { error: `Patch failed: old_string not found in current code.\n"${edit.old.slice(0, 100)}"` }
    if (count > 1) return { error: `Patch failed: old_string matches ${count} times. Add more surrounding context to make it unique.\n"${edit.old.slice(0, 100)}"` }
    next = next.replace(edit.old, () => edit.new as string)
  }
  return { text: next }
}

/**
 * Resolve the base a `type: "patch"` result edits.
 *
 * A patch's code_path is either a saved composition draft (JSON with `code`)
 * or a Remotion source file written by write_code_file. For a source file the
 * file text is the code, and the remaining composition fields come from the
 * composition this run last rendered (same rule as run_code({ code_path })).
 * A run_code script that returns a render result is patched as text and re-run.
 */
export function resolveCompositionPatchBase(
  codePath: string,
  content: string,
  fallback?: CompositionPatchFallback | null,
): CompositionPatchBase {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    parsed = undefined
  }
  if (parsed && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>).code === 'string') {
    return { design: parsed as Record<string, any>, source: 'design-json' }
  }
  if (EXECUTABLE_RENDER_BODY.test(content)) return { source: 'executable-file' }
  if (isDirectRemotionCompositionSource(content)) {
    return {
      source: 'code-file',
      design: {
        width: fallback?.width || 1080,
        height: fallback?.height || 1920,
        props: fallback?.props,
        animation: fallback?.animation,
        editables: fallback?.editables,
        ...(fallback?.videoLayout ? { videoLayout: fallback.videoLayout } : {}),
        ...(fallback?.fontSubstitutions ? { fontSubstitutions: fallback.fontSubstitutions } : {}),
        code: content,
      },
    }
  }
  return {
    error: `Patch failed: "${codePath}" is not a saved composition draft, a Remotion component source file, or a script that returns { type: "render" }. Patch the composition draft path returned by run_code (for example drafts/latest-composition.json), or edit the source with write_code_file and run it again with run_code({ code_path }).`,
  }
}
