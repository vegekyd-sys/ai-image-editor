import type { DesignPayload, EditableField } from '@/types';
import { packageLayout, packagePeerTransforms } from './package-lettering';
import { recordDesignEdit, recordDesignEditBatch } from './design-edit-history';
import { readDesignLayerState } from './design-layer-state';

/** Wire input contains identity only. Sources and prop keys always come from the owned design. */
export interface SelectedElement { snapshotId: string; fieldId: string }
export type ElementOperation =
  | { kind: 'transform'; dx?: number; dy?: number; scaleX?: number; scaleY?: number }
  | { kind: 'text'; text: string }
  | { kind: 'replace'; url: string; source: string };
export interface ElementEditReceipt {
  version: 1; id: string; agentRunId?: string; sourceSnapshotId: string; fieldId: string; operation: ElementOperation; operations?: ElementOperation[];
}
export function parseSelectedElement(value: unknown): SelectedElement | undefined {
  if (!value || typeof value !== 'object') return;
  const { snapshotId, fieldId } = value as SelectedElement;
  if (typeof snapshotId !== 'string' || !/^[\w-]{1,100}$/.test(snapshotId)
    || typeof fieldId !== 'string' || !fieldId.length || fieldId.length > 200) return;
  return { snapshotId, fieldId };
}
export function resolveElement(design: DesignPayload, fieldId: string): EditableField {
  const field = design.editables?.find(f => f.id === fieldId);
  if (!field || readDesignLayerState(design.editables || [], design.props || {}).deleted.includes(fieldId)) {
    throw new Error('The selected element is no longer available. Select it again.');
  }
  if (['__proto__', 'constructor', 'prototype', '_editHistory'].includes(field.propKey)) throw new Error('Invalid editable property');
  return field;
}
function pair(value: unknown, a: string, b: string, fallback: number): Record<string, number> {
  const v = value as Record<string, number> | undefined;
  return { [a]: Number.isFinite(v?.[a]) ? v![a] : fallback, [b]: Number.isFinite(v?.[b]) ? v![b] : fallback };
}
/** Reapply only the requested operation to the latest source. All unrelated properties survive. */
export function applyElementEdit(design: DesignPayload, receipt: ElementEditReceipt): DesignPayload {
  if (receipt.operations?.length) return receipt.operations.reduce((current, operation) => applyElementEdit(current, { ...receipt, operation, operations: undefined }), design);
  const field = resolveElement(design, receipt.fieldId), op = receipt.operation;
  let props = design.props || {};
  const record = (key: string, value: unknown, kind: 'move' | 'scale' | 'text' | 'media') => {
    const meta = { kind, fieldId: field.id, label: field.label };
    if (kind === 'move' || kind === 'scale') {
      const peers = packagePeerTransforms(packageLayout(design), props, field.id,
        kind === 'move' ? value as { x: number; y: number } : undefined,
        kind === 'scale' ? value as { w: number; h: number } : undefined);
      props = recordDesignEditBatch(props, { [key]: value, ...peers }, meta);
    } else props = recordDesignEdit(props, key, value, meta);
  };
  if (op.kind === 'transform') {
    if (op.dx !== undefined || op.dy !== undefined) {
      const p = pair(props[`_pos_${field.id}`], 'x', 'y', 0);
      record(`_pos_${field.id}`, { x: p.x + (op.dx || 0), y: p.y + (op.dy || 0) }, 'move');
    }
    if (op.scaleX !== undefined || op.scaleY !== undefined) {
      const s = pair(props[`_scale_${field.id}`], 'w', 'h', 1);
      record(`_scale_${field.id}`, { w: s.w * (op.scaleX ?? 1), h: s.h * (op.scaleY ?? op.scaleX ?? 1) }, 'scale');
    }
  } else if (op.kind === 'text') {
    if (field.type !== 'text') throw new Error('The selected element is not editable text.');
    record(field.propKey, op.text, 'text');
  } else {
    if (field.type !== 'image' || props[field.propKey] !== op.source) throw new Error('The selected image changed during generation. The generated candidate was retained; select the new image before retrying.');
    record(field.propKey, op.url, 'media');
  }
  return { ...design, props };
}
export function rebaseElementEdit(design: DesignPayload, source: DesignPayload): DesignPayload {
  const receipt = design.elementEdit;
  if (!receipt || receipt.version !== 1) return design;
  if (design.code !== source.code) throw new Error('The source composition changed during the element edit. Select it again.');
  const result = applyElementEdit(source, receipt);
  return { ...design, ...result, elementEdit: receipt };
}

/** Appearance retries start from the saved source, retaining explicit layout edits. */
export function elementLayoutReceipt(receipt: ElementEditReceipt | undefined): ElementEditReceipt | undefined {
  if (!receipt) return;
  const operations = (receipt.operations || [receipt.operation]).filter(op => op.kind !== 'replace');
  if (!operations.length) return;
  return { ...receipt, operation: operations[operations.length - 1], operations };
}
