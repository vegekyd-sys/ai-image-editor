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
  if (manifest.diagnostics.length > 0) return design;

  return {
    ...design,
    code: manifest.code,
    props,
    editables: manifest.editables,
  };
}
