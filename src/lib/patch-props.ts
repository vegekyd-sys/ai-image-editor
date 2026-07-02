function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mergePatchValue(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (Array.isArray(base) && Array.isArray(patch)) {
    const merged = [...base];
    patch.forEach((item, index) => {
      merged[index] = mergePatchValue(base[index], item);
    });
    return merged;
  }
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
