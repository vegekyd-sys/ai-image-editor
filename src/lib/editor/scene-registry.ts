import type { EditableField, EditableType } from '@/types';
import {
  isEditableCanvasCover,
  isEditableRectMeasurable,
  type EditableCanvasRect,
} from './editable-hit-test';

export interface SceneNodeInstance {
  id: string;
  type: EditableType;
  element: HTMLElement;
  rect: DOMRect;
  isCanvasCover: boolean;
  domOrder: number;
  depth: number;
  containsSameIdDescendant: boolean;
}

export interface SceneNodeRecord {
  field: EditableField;
  instances: SceneNodeInstance[];
  activeInstance: SceneNodeInstance | null;
}

export class SceneRegistry {
  private readonly records: Map<string, SceneNodeRecord>;
  private readonly fieldOrder: string[];

  constructor(records: Map<string, SceneNodeRecord>, fieldOrder: string[]) {
    this.records = records;
    this.fieldOrder = fieldOrder;
  }

  get(id: string): SceneNodeRecord | undefined {
    return this.records.get(id);
  }

  activeInstances(): SceneNodeInstance[] {
    return this.fieldOrder
      .map(id => this.records.get(id)?.activeInstance ?? null)
      .filter((instance): instance is SceneNodeInstance => instance !== null)
      .sort((a, b) => a.domOrder - b.domOrder);
  }
}

function getElementDepth(element: Element, container: Element): number {
  let depth = 0;
  let current: Element | null = element;
  while (current && current !== container) {
    depth++;
    current = current.parentElement;
  }
  return depth;
}

function containsSameIdDescendant(element: Element, id: string): boolean {
  return Array.from(element.querySelectorAll('[data-editable]'))
    .some(descendant => descendant.getAttribute('data-editable') === id);
}

function hasDirectText(element: Element): boolean {
  return Array.from(element.childNodes)
    .some(node => node.nodeType === 3 && Boolean(node.textContent?.trim()));
}

function mediaDistance(element: Element, type: EditableType): number | null {
  const selector = type === 'video' ? 'video' : 'img';
  if (element.matches(selector)) return 0;
  const media = element.querySelector(selector);
  if (!media) return null;

  let distance = 1;
  let current = media.parentElement;
  while (current && current !== element) {
    distance++;
    current = current.parentElement;
  }
  return current === element ? distance : null;
}

function intersectionRatio(rect: DOMRect, viewport: EditableCanvasRect): number {
  if (rect.width <= 0 || rect.height <= 0) return 0;
  const width = Math.max(
    0,
    Math.min(rect.right, viewport.left + viewport.width) - Math.max(rect.left, viewport.left),
  );
  const height = Math.max(
    0,
    Math.min(rect.bottom, viewport.top + viewport.height) - Math.max(rect.top, viewport.top),
  );
  return (width * height) / (rect.width * rect.height);
}

function instanceScore(
  instance: SceneNodeInstance,
  viewportRect: EditableCanvasRect,
): number {
  let score = intersectionRatio(instance.rect, viewportRect) * 10_000;
  score += instance.depth * 10;
  score += instance.domOrder / 10_000;

  // A logical node must resolve to the rendered leaf, never an ancestor shell
  // that repeats the same id around the real text or media node.
  if (instance.containsSameIdDescendant) score -= 1_000_000;

  if (instance.type === 'text') {
    if (hasDirectText(instance.element)) score += 100_000;
    score -= Math.log1p(instance.rect.width * instance.rect.height);
  } else {
    const distance = mediaDistance(instance.element, instance.type);
    if (distance !== null) score += 100_000 / (distance + 1);
  }

  return score;
}

function isRenderedCandidate(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

export function buildLegacySceneRegistry({
  container,
  fields,
  canvasRect,
  viewportRect = canvasRect,
}: {
  container: HTMLElement;
  fields: EditableField[];
  canvasRect: EditableCanvasRect;
  viewportRect?: EditableCanvasRect;
}): SceneRegistry {
  const fieldsById = new Map(fields.map(field => [field.id, field]));
  const records = new Map<string, SceneNodeRecord>(
    fields.map(field => [
      field.id,
      { field, instances: [], activeInstance: null },
    ]),
  );

  Array.from(container.querySelectorAll<HTMLElement>('[data-editable]'))
    .forEach((element, domOrder) => {
      const id = element.getAttribute('data-editable');
      const field = id ? fieldsById.get(id) : undefined;
      if (!id || !field || !isRenderedCandidate(element)) return;

      const rect = element.getBoundingClientRect();
      if (!isEditableRectMeasurable(rect)) return;

      records.get(id)?.instances.push({
        id,
        type: field.type,
        element,
        rect,
        isCanvasCover: isEditableCanvasCover(rect, canvasRect),
        domOrder,
        depth: getElementDepth(element, container),
        containsSameIdDescendant: containsSameIdDescendant(element, id),
      });
    });

  records.forEach(record => {
    record.activeInstance = [...record.instances]
      .sort((a, b) => instanceScore(b, viewportRect) - instanceScore(a, viewportRect))[0] ?? null;
  });

  return new SceneRegistry(records, fields.map(field => field.id));
}
