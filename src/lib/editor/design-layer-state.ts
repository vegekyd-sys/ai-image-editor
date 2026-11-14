import type { DesignPayload, EditableField } from '@/types';

/** Bottom to top. Deleted layers retain their source and position for restoration. */
export interface DesignLayerState { order: string[]; deleted: string[]; stacking?: boolean }
export const DESIGN_LAYER_STATE_PROP = '_layerState';

export function readDesignLayerState(fields: EditableField[], props: Record<string, unknown>, renderedOrder: string[] = []): DesignLayerState {
  const ids = fields.map(field => field.id);
  const known = new Set(ids);
  const raw = props[DESIGN_LAYER_STATE_PROP] as Partial<DesignLayerState> | undefined;
  const order = Array.isArray(raw?.order) ? [...new Set(raw.order.filter(id => known.has(id)))] : [];
  const fallback = [...new Set([...renderedOrder.filter(id => known.has(id)), ...ids])];
  return {
    order: [...order, ...fallback.filter(id => !order.includes(id))],
    deleted: Array.isArray(raw?.deleted) ? [...new Set(raw.deleted.filter(id => known.has(id)))] : [],
    ...(raw?.stacking === true ? { stacking: true } : {}),
  };
}

export function changeDesignLayer(state: DesignLayerState, id: string, action: 'forward' | 'backward' | 'delete'): DesignLayerState {
  if (!state.order.includes(id)) return state;
  if (action === 'delete') return { ...state, deleted: [...state.deleted.filter(item => item !== id), id] };
  const active = state.order.filter(item => !state.deleted.includes(item));
  const adjacent = active[active.indexOf(id) + (action === 'forward' ? 1 : -1)];
  if (!adjacent || state.deleted.includes(id)) return state;
  const order = [...state.order];
  const from = order.indexOf(id), to = order.indexOf(adjacent);
  [order[from], order[to]] = [order[to], order[from]];
  return { ...state, order, stacking: true };
}

/** Source-image decomposition has a fixed canvas, unlike flow-layout long designs. */
export function isFixedCanvasDesign(design: DesignPayload | undefined): boolean {
  if (design?.props?._canvasSizing === 'content') return false;
  const legacyOrder = (design?.props?.[DESIGN_LAYER_STATE_PROP] as DesignLayerState | undefined)?.order;
  return design?.props?._canvasSizing === 'fixed'
    || !!(design as (DesignPayload & { layerizeManifestPath?: string }) | undefined)?.layerizeManifestPath
    || (Array.isArray(legacyOrder) && legacyOrder.length > 0 && legacyOrder.every(id => typeof id === 'string' && /^layer_\d+(?:_text_\d+)?$/.test(id)));
}

export const hasDesignLayers = isFixedCanvasDesign;
