import type { EditableField } from '@/types';

export function getVideoTrimPropKeys(field: EditableField): { startKey?: string; endKey?: string; isLegacy: boolean } {
  if (field.type !== 'video') {
    return { startKey: undefined, endKey: undefined, isLegacy: false };
  }
  return {
    startKey: field.trimBeforePropKey ?? `_trimBefore_${field.id}`,
    endKey: field.trimAfterPropKey ?? `_trimAfter_${field.id}`,
    isLegacy: !field.trimBeforePropKey || !field.trimAfterPropKey,
  };
}

