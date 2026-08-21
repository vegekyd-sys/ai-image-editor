import type { DesignPayload } from '@/types';
import { compileEditableManifestWithProvenance } from './editable-provenance-compiler';

export function normalizeLoadedDesignManifest(
  value: unknown,
): DesignPayload | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const design = value as DesignPayload;
  if (typeof design.code !== 'string') return design;

  const props = { ...(design.props ?? {}) };
  const manifest = compileEditableManifestWithProvenance({
    code: design.code,
    props,
    editables: design.editables,
  });

  // Editable discovery is intentionally partial and fail-soft. One ambiguous
  // sink must not discard markers and aliases that were proven elsewhere in
  // the same composition. Compiler diagnostics describe only the fields that
  // remain non-editable; the visible composition stays authoritative.
  return {
    ...design,
    code: manifest.code,
    props,
    editables: manifest.editables,
  };
}
