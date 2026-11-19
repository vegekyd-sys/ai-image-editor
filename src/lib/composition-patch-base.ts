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
  | { error: string }

/**
 * Resolve the base a `type: "patch"` result edits.
 *
 * A patch's code_path is either a saved composition draft (JSON with `code`)
 * or a Remotion source file written by write_code_file. For a source file the
 * file text is the code, and the remaining composition fields come from the
 * composition this run last rendered (same rule as run_code({ code_path })).
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
    error: `Patch failed: "${codePath}" is neither a saved composition draft nor a Remotion component source file. Patch the composition draft path returned by run_code (for example drafts/latest-composition.json), or edit the source with write_code_file and run it again with run_code({ code_path }).`,
  }
}
