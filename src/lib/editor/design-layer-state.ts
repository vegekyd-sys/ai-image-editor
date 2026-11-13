import type { DesignPayload, EditableField } from '@/types';

/** Bottom to top. Deleted layers retain their source and position for restoration. */
export interface DesignLayerState { order: string[]; deleted: string[] }
export const DESIGN_LAYER_STATE_PROP = '_layerState';

export function readDesignLayerState(fields: EditableField[], props: Record<string, unknown>): DesignLayerState {
  const ids = fields.map(field => field.id);
  const known = new Set(ids);
  const raw = props[DESIGN_LAYER_STATE_PROP] as Partial<DesignLayerState> | undefined;
  const order = Array.isArray(raw?.order) ? [...new Set(raw.order.filter(id => known.has(id)))] : [];
  return {
    order: [...order, ...ids.filter(id => !order.includes(id))],
    deleted: Array.isArray(raw?.deleted) ? [...new Set(raw.deleted.filter(id => known.has(id)))] : [],
  };
}

export function changeDesignLayer(state: DesignLayerState, id: string, action: 'forward' | 'backward' | 'delete' | 'restore'): DesignLayerState {
  if (!state.order.includes(id)) return state;
  if (action === 'delete') return { ...state, deleted: [...state.deleted.filter(item => item !== id), id] };
  if (action === 'restore') return { ...state, deleted: state.deleted.filter(item => item !== id) };
  const active = state.order.filter(item => !state.deleted.includes(item));
  const adjacent = active[active.indexOf(id) + (action === 'forward' ? 1 : -1)];
  if (!adjacent || state.deleted.includes(id)) return state;
  const order = [...state.order];
  const from = order.indexOf(id), to = order.indexOf(adjacent);
  [order[from], order[to]] = [order[to], order[from]];
  return { ...state, order };
}

/** Source-image decomposition has a fixed canvas, unlike flow-layout long designs. */
export function hasDesignLayers(design: DesignPayload | undefined): boolean {
  return !!design?.props?.[DESIGN_LAYER_STATE_PROP]
    || !!(design as (DesignPayload & { layerizeManifestPath?: string }) | undefined)?.layerizeManifestPath;
}
