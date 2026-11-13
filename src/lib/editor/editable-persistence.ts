import type { DesignPayload } from '@/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function createPersistedEditableDesign(value: unknown): DesignPayload {
  if (!isRecord(value) || typeof value.code !== 'string' || !value.code.trim()) {
    throw new Error('Invalid design code');
  }
  if (
    typeof value.width !== 'number'
    || !Number.isFinite(value.width)
    || value.width <= 0
    || typeof value.height !== 'number'
    || !Number.isFinite(value.height)
    || value.height <= 0
  ) {
    throw new Error('Invalid design dimensions');
  }
  if (value.props !== undefined && !isRecord(value.props)) {
    throw new Error('Invalid design props');
  }
  if (value.animation !== undefined && !isRecord(value.animation)) {
    throw new Error('Invalid design animation');
  }
  if (value.editables !== undefined && !Array.isArray(value.editables)) {
    throw new Error('Invalid design editables');
  }
  if (value.fontSubstitutions !== undefined && !isRecord(value.fontSubstitutions)) {
    throw new Error('Invalid design font substitutions');
  }

  return {
    code: value.code,
    width: value.width,
    height: value.height,
    ...(value.animation ? { animation: value.animation as DesignPayload['animation'] } : {}),
    ...(value.props ? { props: value.props } : {}),
    ...(value.editables ? { editables: value.editables as DesignPayload['editables'] } : {}),
    ...(value.fontSubstitutions
      ? { fontSubstitutions: value.fontSubstitutions as Record<string, string> }
      : {}),
  };
}

export function mergePersistedEditableProps(
  persistedValue: unknown,
  propsValue: unknown,
  revision: number,
  unsetProps: unknown = [],
): DesignPayload & Record<string, unknown> & { __makaronEditableRevision: number } {
  if (!isRecord(propsValue)) throw new Error('Invalid design props');
  const persisted = createPersistedEditableDesign(persistedValue);
  if (!Array.isArray(unsetProps) || unsetProps.length > 256 || unsetProps.some(key => typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error('Invalid removed design properties');
  const props = { ...(persisted.props || {}), ...propsValue };
  for (const key of unsetProps) if (!Object.hasOwn(propsValue, key)) delete props[key];
  return {
    ...(isRecord(persistedValue) ? persistedValue : {}),
    ...persisted,
    props,
    __makaronEditableRevision: revision,
  };
}
