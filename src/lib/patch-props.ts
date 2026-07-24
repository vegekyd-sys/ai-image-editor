function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mergePatchValue(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  // Arrays are ordered values, not object-shaped patches. Replacing them keeps
  // removed timeline items, captions, and keyframes from surviving as stale
  // tail entries after a props-only patch.
  if (Array.isArray(patch)) return patch;
  if (isPlainRecord(base) && isPlainRecord(patch)) {
    const merged: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(patch)) {
      merged[key] = mergePatchValue(base[key], value);
    }
    return merged;
  }
  return patch;
}

export function mergePatchProps(
  baseProps: Record<string, unknown> | undefined,
  patchProps: unknown,
): Record<string, unknown> | undefined {
  if (patchProps === undefined) return baseProps;
  if (!isPlainRecord(patchProps)) return baseProps;
  return mergePatchValue(baseProps || {}, patchProps) as Record<string, unknown>;
}
