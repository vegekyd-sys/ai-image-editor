export type DesignEditKind = 'move' | 'scale' | 'reorder' | 'delete' | 'restore' | 'text' | 'media' | 'edit';
export interface DesignEditEntry {
  id: string; at: number; kind: DesignEditKind; fieldId?: string; label?: string;
  key: string; before: unknown; after: unknown; hadBefore: boolean;
  related?: Array<{ key: string; before: unknown; after: unknown; hadBefore: boolean }>;
}
export interface DesignEditHistory { version: 1; entries: DesignEditEntry[]; cursor: number }
export const DESIGN_HISTORY_PROP = '_editHistory';
const MAX_ENTRIES = 80;
const EDIT_KINDS = new Set(['move', 'scale', 'reorder', 'delete', 'restore', 'text', 'media', 'edit']);
const safeKey = (key: unknown): key is string => typeof key === 'string' && key !== DESIGN_HISTORY_PROP && !['__proto__', 'prototype', 'constructor'].includes(key);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function readDesignEditHistory(props: Record<string, unknown>): DesignEditHistory {
  const raw = props[DESIGN_HISTORY_PROP] as DesignEditHistory | undefined;
  if (raw?.version !== 1 || !Array.isArray(raw.entries)) return { version: 1, entries: [], cursor: 0 };
  const entries = raw.entries.filter(e => e && typeof e.id === 'string' && typeof e.key === 'string'
    && safeKey(e.key)
    && EDIT_KINDS.has(e.kind) && Number.isFinite(e.at)).slice(-MAX_ENTRIES).map(e => ({ ...e,
      ...(Array.isArray(e.related) ? { related: e.related.filter(change => change && safeKey(change.key)) } : {}),
    }));
  return { version: 1, entries, cursor: Math.max(0, Math.min(entries.length, Number.isInteger(raw.cursor) ? raw.cursor : entries.length)) };
}

export function recordDesignEdit(props: Record<string, unknown>, key: string, value: unknown,
  metadata: { fieldId?: string; label?: string; kind?: DesignEditKind; at?: number } = {}): Record<string, unknown> {
  if (same(props[key], value)) return props;
  const pair = value as Record<string, unknown> | null;
  if (!Object.hasOwn(props, key) && pair && typeof pair === 'object') {
    if (key.startsWith('_pos_') && pair.x === 0 && pair.y === 0) return props;
    if (key.startsWith('_scale_') && pair.w === 1 && pair.h === 1) return props;
  }
  const history = readDesignEditHistory(props), at = metadata.at ?? Date.now();
  const kind = metadata.kind ?? (key.startsWith('_pos_') ? 'move' : key.startsWith('_scale_') ? 'scale' : 'edit');
  const fieldId = metadata.fieldId ?? (key.startsWith('_pos_') ? key.slice(5) : key.startsWith('_scale_') ? key.slice(7) : undefined);
  const entries = history.entries.slice(0, history.cursor), last = entries.at(-1);
  // Coalesce typing, but keep separate pointer gestures as separate edits.
  if (history.cursor === history.entries.length && kind === 'text' && last?.kind === 'text' && last.key === key && at - last.at < 800) {
    entries[entries.length - 1] = { ...last, after: value, at };
  } else entries.push({ id: `${at}-${entries.length}`, at, kind, fieldId, label: metadata.label,
    key, before: props[key] ?? null, after: value, hadBefore: Object.hasOwn(props, key) });
  const bounded = entries.slice(-MAX_ENTRIES);
  return { ...props, [key]: value, [DESIGN_HISTORY_PROP]: { version: 1, entries: bounded, cursor: bounded.length } };
}

/** One pointer resize may update both scale and its anchored position. */
export function recordDesignEditBatch(props: Record<string, unknown>, values: Record<string, unknown>,
  metadata: { fieldId?: string; label?: string; kind?: DesignEditKind; at?: number } = {}): Record<string, unknown> {
  const changes = Object.entries(values).filter(([key, value]) => {
    if (!safeKey(key) || same(props[key], value)) return false;
    const pair = value as Record<string, unknown> | null;
    if (!Object.hasOwn(props, key) && pair && typeof pair === 'object') {
      if (key.startsWith('_pos_') && pair.x === 0 && pair.y === 0) return false;
      if (key.startsWith('_scale_') && pair.w === 1 && pair.h === 1) return false;
    }
    return true;
  });
  if (!changes.length) return props;
  const [primary, ...related] = changes;
  const next = recordDesignEdit(props, primary[0], primary[1], metadata);
  if (next === props || !related.length) return next;
  const history = readDesignEditHistory(next), entries = [...history.entries], last = entries.length - 1;
  entries[last] = { ...entries[last], related: related.map(([key, after]) => ({ key, after, before: props[key] ?? null, hadBefore: Object.hasOwn(props, key) })) };
  return { ...next, ...Object.fromEntries(related), [DESIGN_HISTORY_PROP]: { ...history, entries } };
}

export function seekDesignEditHistory(props: Record<string, unknown>, cursor: number): Record<string, unknown> {
  const history = readDesignEditHistory(props), target = Math.max(0, Math.min(history.entries.length, cursor));
  if (target === history.cursor) return props;
  const next = { ...props };
  for (let i = history.cursor - 1; i >= target; i--) {
    const entry = history.entries[i];
    for (const change of [entry, ...(entry.related || [])]) {
      if (change.hadBefore) next[change.key] = change.before;
      else delete next[change.key];
    }
  }
  for (let i = history.cursor; i < target; i++) for (const change of [history.entries[i], ...(history.entries[i].related || [])]) next[change.key] = change.after;
  next[DESIGN_HISTORY_PROP] = { ...history, cursor: target };
  return next;
}

export function historyUnsetProps(props: Record<string, unknown>): string[] {
  return [...new Set(readDesignEditHistory(props).entries.flatMap(e => [e.key, ...(e.related || []).map(change => change.key)]))].filter(key => !Object.hasOwn(props, key));
}
