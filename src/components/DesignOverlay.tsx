'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import Moveable from 'react-moveable';
import type { EditableField } from '@/types';
import {
  EDITABLE_POINTER_MOVE_THRESHOLD,
  isEditableRectMeasurable,
  isEditableCanvasCover,
  resolveEditableEditActivation,
  resolveEditablePointerIntent,
  type EditableTapCandidate,
} from '@/lib/editor/editable-hit-test';
import {
  buildLegacySceneRegistry,
  closestEditableRuntimeElement,
  readEditableRuntimeId,
} from '@/lib/editor/scene-registry';
import { editableMediaImage, warmEditableAlpha, pickPaintedEditable, isPaintedEditableHit, pendingEditableAlphaAtPoint } from '@/lib/editor/editable-image-alpha';
import { editableDisplayLabel, editableLabelPosition } from '@/lib/editor/editable-label';
import { useLocale } from '@/lib/i18n';
import EditableSelectionTint from './EditableSelectionTint';

interface DesignOverlayProps {
  touchGestures?: boolean;
  onGestureStart?: () => void;
  containerEl: HTMLDivElement | null;
  interactionEl: HTMLDivElement | null;
  editables: EditableField[];
  props: Record<string, unknown>;
  selectedFieldId: string | null;
  onSelectField: (id: string | null) => void;
  onCanvasTap?: () => void;
  onUpdateProp: (key: string, value: unknown) => void;
  onStartEdit?: (fieldId: string) => void;
  onVisibleFieldsChange?: (visibleIds: string[]) => void;
  onRenderedOrderChange?: (ids: string[]) => void;
  filterVisibleFields?: boolean;
  playerRef?: any;
  allowCanvasCoverSelection?: boolean;
}

interface MeasuredRect {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  domEl: HTMLElement;
}

function getScrollViewportRect(containerEl: HTMLElement, fallback: DOMRect): DOMRect {
  return getNearestScrollParent(containerEl)?.getBoundingClientRect() ?? fallback;
}

function getNearestScrollParent(containerEl: HTMLElement): HTMLElement | null {
  let parent = containerEl.parentElement;
  while (parent) {
    if (parent.scrollHeight > parent.clientHeight + 1 || parent.scrollWidth > parent.clientWidth + 1) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

function readCssPair(value: string): { x: number; y: number } | null {
  const parts = value.trim().split(/\s+/);
  if (!parts[0]) return null;
  const x = parseFloat(parts[0]);
  const y = parseFloat(parts[1] ?? parts[0]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

export default function DesignOverlay({
  touchGestures = false,
  onGestureStart,
  containerEl,
  interactionEl,
  editables,
  props,
  selectedFieldId,
  onSelectField,
  onCanvasTap,
  onUpdateProp,
  onStartEdit,
  onVisibleFieldsChange,
  onRenderedOrderChange,
  filterVisibleFields = false,
  playerRef,
  allowCanvasCoverSelection = false,
}: DesignOverlayProps) {
  const { t } = useLocale();
  const [rects, setRects] = useState<MeasuredRect[]>([]);
  const [scrollOffset, setScrollOffset] = useState(0);
  const rectsRef = useRef<MeasuredRect[]>([]);
  const rafRef = useRef<number>(0);
  const onVisibleFieldsChangeRef = useRef(onVisibleFieldsChange);
  onVisibleFieldsChangeRef.current = onVisibleFieldsChange;
  const onRenderedOrderChangeRef = useRef(onRenderedOrderChange);
  onRenderedOrderChangeRef.current = onRenderedOrderChange;

  const overlayRef = useRef<HTMLDivElement>(null);
  const overlayMountedRef = useRef(false);
  const moveableRef = useRef<Moveable>(null);

  const isDraggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const isMeasuringRef = useRef(false);

  // Drag snapshots
  const dragBaseOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragDomElRef = useRef<HTMLElement | null>(null);
  const dragScaleRef = useRef(1);
  const pickEditable = useCallback((x: number, y: number) => pickPaintedEditable(rectsRef.current, x, y), []);

  // Measure editable elements
  const measure = useCallback(() => {
    if (isDraggingRef.current || isMeasuringRef.current) return;
    if (!containerEl || !overlayRef.current) { setRects([]); return; }

    isMeasuringRef.current = true;

    const baseRect = overlayRef.current.getBoundingClientRect();
    const canvasRect = (
      containerEl.querySelector('.__remotion-player') as HTMLElement | null
    )?.getBoundingClientRect() ?? containerEl.getBoundingClientRect();
    const viewportRect = getScrollViewportRect(containerEl, baseRect);
    const registry = buildLegacySceneRegistry({
      container: containerEl,
      fields: editables,
      canvasRect,
      viewportRect,
    });
    const activeInstances = registry.activeInstances();

    const newRects: MeasuredRect[] = [];
    const visibleIds: string[] = [];
    activeInstances.forEach((instance) => {
      const { id, element: el } = instance;
      const image = editableMediaImage(el);
      if (image) warmEditableAlpha(image);
      // Fix inline elements — Moveable needs a box model to work correctly
      const htmlEl = el;
      htmlEl.querySelectorAll('img, video').forEach((media) => {
        const mediaEl = media as HTMLElement;
        mediaEl.setAttribute('draggable', 'false');
        mediaEl.style.pointerEvents = 'none';
        mediaEl.style.userSelect = 'none';
      });
      if (getComputedStyle(htmlEl).display === 'inline') {
        htmlEl.style.display = 'inline-block';
      }
      const elRect = el.getBoundingClientRect();
      if (!isEditableRectMeasurable(elRect)) return;
      htmlEl.toggleAttribute(
        'data-editable-canvas-cover',
        isEditableCanvasCover(elRect, canvasRect),
      );

      const rectLeft = Math.round(elRect.left - baseRect.left);
      const rectTop = Math.round(elRect.top - baseRect.top);
      const rectWidth = Math.round(elRect.width);
      const rectHeight = Math.round(elRect.height);
      newRects.push({ id, left: rectLeft, top: rectTop, width: rectWidth, height: rectHeight, domEl: el });
      if (!filterVisibleFields || (
        elRect.right > viewportRect.left + 1 &&
        elRect.left < viewportRect.right - 1 &&
        elRect.bottom > viewportRect.top + 1 &&
        elRect.top < viewportRect.bottom - 1
      )) {
        visibleIds.push(id);
      }
    });
    rectsRef.current = newRects;
    setRects(newRects);
    onRenderedOrderChangeRef.current?.(activeInstances.map(instance => instance.id));
    onVisibleFieldsChangeRef.current?.(visibleIds);
    isMeasuringRef.current = false;
  }, [containerEl, editables, filterVisibleFields, props]);

  // Mark selected element (CSS hides hover outline when Moveable frame shows)
  useEffect(() => {
    const el = selectedFieldId ? rects.find(r => r.id === selectedFieldId)?.domEl : null;
    if (el) el.setAttribute('data-editable-selected', '');
    return () => { if (el) el.removeAttribute('data-editable-selected'); };
  }, [selectedFieldId, rects]);

  // Measure triggers
  useEffect(() => { isDraggingRef.current = false; setIsDragging(false); measure(); }, [measure, props]);
  useEffect(() => { if (overlayRef.current && !overlayMountedRef.current) { overlayMountedRef.current = true; measure(); } }, [measure]);
  useEffect(() => {
    if (!playerRef) return;
    const h = () => { cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(measure); };
    try { playerRef.addEventListener('frameupdate', h); } catch { /* */ }
    return () => { try { playerRef.removeEventListener('frameupdate', h); } catch { /* */ } cancelAnimationFrame(rafRef.current); };
  }, [playerRef, measure]);
  useEffect(() => { const h = () => measure(); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, [measure]);
  useEffect(() => {
    if (!containerEl) return;
    const h = () => {
      const nearestScrollParent = getNearestScrollParent(containerEl);
      setScrollOffset(nearestScrollParent?.scrollTop ?? 0);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        measure();
        moveableRef.current?.updateRect();
      });
    };
    const scrollParents: HTMLElement[] = [];
    let parent = containerEl.parentElement;
    while (parent) {
      if (parent.scrollHeight > parent.clientHeight + 1 || parent.scrollWidth > parent.clientWidth + 1) {
        scrollParents.push(parent);
      }
      parent = parent.parentElement;
    }
    h();
    scrollParents.forEach(el => el.addEventListener('scroll', h, { passive: true }));
    window.addEventListener('scroll', h, true);
    return () => {
      scrollParents.forEach(el => el.removeEventListener('scroll', h));
      window.removeEventListener('scroll', h, true);
    };
  }, [containerEl, measure]);
  useEffect(() => {
    if (!containerEl) return;
    const o = new MutationObserver(() => { if (isDraggingRef.current) return; cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(measure); });
    o.observe(containerEl, { childList: true, subtree: true, attributes: true });
    return () => o.disconnect();
  }, [containerEl, measure]);
  useEffect(() => { const t = setTimeout(measure, 50); return () => clearTimeout(t); }, [selectedFieldId, measure]);
  useEffect(() => {
    if (!containerEl) return;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(measure); });
    ro.observe(containerEl); return () => ro.disconnect();
  }, [containerEl, measure]);

  // Bind click + double-tap-to-edit on each editable DOM element
  const onSelectFieldRef = useRef(onSelectField);
  onSelectFieldRef.current = onSelectField;
  const onStartEditRef = useRef(onStartEdit);
  onStartEditRef.current = onStartEdit;
  const selectedFieldIdRef = useRef(selectedFieldId);
  selectedFieldIdRef.current = selectedFieldId;
  const onGestureStartRef = useRef(onGestureStart);
  onGestureStartRef.current = onGestureStart;
  const onCanvasTapRef = useRef(onCanvasTap);
  onCanvasTapRef.current = onCanvasTap;

  // One surface-level pointer arbiter keeps poster, editable selection, and
  // canvas playback from competing with one another.
  useEffect(() => {
    if (!interactionEl) return;
    let disposed = false;
    let pointerSequence = 0;
    let lastCompletedTap: EditableTapCandidate | null = null;
    let activeTouches = 0;
    let gesture: {
      pointerId: number;
      startX: number;
      startY: number;
      hitFieldId: string | null;
      hitIsCanvasCover: boolean;
      moved: boolean;
    } | null = null;

    const disableNativeMediaDrag = (editableEl: Element) => {
      editableEl.querySelectorAll('img, video').forEach((media) => {
        const mediaEl = media as HTMLElement;
        mediaEl.setAttribute('draggable', 'false');
        mediaEl.style.pointerEvents = 'none';
        mediaEl.style.userSelect = 'none';
      });
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      pointerSequence++;
      const eventTarget = e.target as HTMLElement;
      if (eventTarget.closest?.('button, [data-remotion-seek], .moveable-control')) {
        lastCompletedTap = null;
        gesture = null;
        return;
      }

      const directTarget = closestEditableRuntimeElement(eventTarget);
      let id: string | null = null;
      if (overlayRef.current) id = pickEditable(e.clientX, e.clientY);
      // A fully transparent image is not a hit, even when native hit testing
      // reports its rectangular DOM box as the event target.
      id ??= directTarget && !editableMediaImage(directTarget) ? readEditableRuntimeId(directTarget) : null;
      if (id && !editables.some(f => f.id === id)) id = null;
      const hitRect = id ? rectsRef.current.find(rect => rect.id === id) : null;
      const hitTarget = hitRect?.domEl ?? directTarget;
      const hitIsCanvasCover = !allowCanvasCoverSelection && Boolean(hitTarget?.hasAttribute('data-editable-canvas-cover'));

      if (e.pointerType === 'touch') {
        activeTouches++;
        if (activeTouches > 1) {
          gesture = null;
          return;
        }
      }
      gesture = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        hitFieldId: id,
        hitIsCanvasCover,
        moved: false,
      };

      if (!id || !hitTarget) return;
      disableNativeMediaDrag(hitTarget);
      const intent = resolveEditablePointerIntent({
        hitFieldId: id,
        hitIsCanvasCover,
        selectedFieldId: selectedFieldIdRef.current,
        moved: false,
      });
      // Touch taps select on release, so a version swipe cannot also select a layer.
      if (intent !== 'select' || e.pointerType === 'touch') return;
      if (selectedFieldIdRef.current !== id) {
        const previous = selectedFieldIdRef.current;
        selectedFieldIdRef.current = id;
        onSelectFieldRef.current(id);
        // Do not let the old Moveable target start dragging through its clear pixels.
        if (previous && directTarget && readEditableRuntimeId(directTarget) === previous) e.stopPropagation();
      }
    };
    const handlePointerMove = (e: PointerEvent) => {
      if (!gesture || gesture.pointerId !== e.pointerId || gesture.moved) return;
      const distance = Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY);
      if (distance > EDITABLE_POINTER_MOVE_THRESHOLD) gesture.moved = true;
    };
    const handlePointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') activeTouches = Math.max(0, activeTouches - 1);
      if (!gesture || gesture.pointerId !== e.pointerId) return;
      if (interactionEl.dataset.editableGesture) { gesture = null; lastCompletedTap = null; return; }
      const completedGesture = gesture;
      gesture = null;
      const complete = () => {
        const intent = resolveEditablePointerIntent({
          hitFieldId: completedGesture.hitFieldId,
          hitIsCanvasCover: completedGesture.hitIsCanvasCover,
          selectedFieldId: selectedFieldIdRef.current,
          moved: completedGesture.moved,
        });
        const field = completedGesture.hitFieldId
          ? editables.find(item => item.id === completedGesture.hitFieldId)
          : null;
        if (e.pointerType === 'touch' && intent === 'select' && field) {
          selectedFieldIdRef.current = field.id;
          onSelectFieldRef.current(field.id);
        }
        const editActivation = resolveEditableEditActivation({
          fieldId: completedGesture.hitFieldId,
          fieldType: field?.type ?? null,
          selectedFieldId: selectedFieldIdRef.current,
          moved: completedGesture.moved,
          now: Date.now(),
          previousTap: lastCompletedTap,
        });
        lastCompletedTap = editActivation.nextTap;
        if (activeTouches <= 1 && editActivation.shouldEdit && completedGesture.hitFieldId) {
          onStartEditRef.current?.(completedGesture.hitFieldId);
          return;
        }
        if (intent === 'canvas-tap') onCanvasTapRef.current?.();
      };
      const pending = !completedGesture.moved && e.pointerType === 'touch'
        ? pendingEditableAlphaAtPoint(rectsRef.current, completedGesture.startX, completedGesture.startY)
        : null;
      if (!pending) { complete(); return; }
      const sequence = pointerSequence;
      void pending.then(() => {
        if (disposed || sequence !== pointerSequence) return;
        completedGesture.hitFieldId = pickEditable(completedGesture.startX, completedGesture.startY);
        const target = rectsRef.current.find(rect => rect.id === completedGesture.hitFieldId)?.domEl;
        completedGesture.hitIsCanvasCover = !allowCanvasCoverSelection && Boolean(target?.hasAttribute('data-editable-canvas-cover'));
        complete();
      });
    };
    const handlePointerCancel = (e: PointerEvent) => {
      if (e.pointerType === 'touch') activeTouches = Math.max(0, activeTouches - 1);
      if (gesture?.pointerId === e.pointerId) gesture = null;
    };
    const handleDragStart = (e: DragEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest?.('img, video') && closestEditableRuntimeElement(target)) {
        e.preventDefault();
      }
    };

    interactionEl.addEventListener('pointerdown', handlePointerDown, { capture: true });
    interactionEl.addEventListener('pointermove', handlePointerMove, { capture: true });
    interactionEl.addEventListener('pointerup', handlePointerUp, { capture: true });
    interactionEl.addEventListener('pointercancel', handlePointerCancel, { capture: true });
    interactionEl.addEventListener('dragstart', handleDragStart);
    return () => {
      disposed = true;
      interactionEl.removeEventListener('pointerdown', handlePointerDown, { capture: true });
      interactionEl.removeEventListener('pointermove', handlePointerMove, { capture: true });
      interactionEl.removeEventListener('pointerup', handlePointerUp, { capture: true });
      interactionEl.removeEventListener('pointercancel', handlePointerCancel, { capture: true });
      interactionEl.removeEventListener('dragstart', handleDragStart);
    };
  }, [interactionEl, editables, pickEditable, allowCanvasCoverSelection]);

  // Touch-only fallback drag, including the Moveable selection surface.
  // Desktop drags stay on Moveable so alignment guidelines remain visible.
  useEffect(() => {
    const overlayEl = overlayRef.current;
    if (!overlayEl || !containerEl) return;

    let dragState: {
      fieldId: string;
      target: HTMLElement;
      startX: number;
      startY: number;
      baseX: number;
      baseY: number;
      sourcePerViewportPx: number;
    } | null = null;
    let pendingDragPoint: { x: number; y: number } | null = null;
    let dragRaf = 0;

    const readCurrentOffset = (target: HTMLElement, fieldId: string) => {
      const stored = props[`_pos_${fieldId}`] as { x: number; y: number } | undefined;
      if (stored) return stored;
      return readCssPair(target.style.translate) ?? { x: 0, y: 0 };
    };

    const getSourcePerViewportPx = (target: HTMLElement) => {
      const rect = target.getBoundingClientRect();
      const style = getComputedStyle(target);
      const sourceWidth = parseFloat(style.width) || rect.width || 1;
      const scalePair = readCssPair(target.style.scale || style.scale || '1') ?? { x: 1, y: 1 };
      const renderedUntranslatedWidth = rect.width || 1;
      return (sourceWidth * (scalePair.x || 1)) / renderedUntranslatedWidth;
    };

    const startDrag = (targetEl: HTMLElement | null, clientX: number, clientY: number, pointerType?: string) => {
      if (dragState) return false;
      const fieldId = selectedFieldIdRef.current;
      if (!fieldId) return false;
      if (!targetEl || targetEl.closest('.moveable-control')) return false;
      if (targetEl.closest('.moveable-area') && !touchGestures) return false;
      if (pointerType !== 'touch') return false;

      const target = rectsRef.current.find(rect => rect.id === fieldId)?.domEl ?? null;
      if (!target || !isPaintedEditableHit(target, clientX, clientY)) return false;
      const offset = readCurrentOffset(target, fieldId);
      dragState = {
        fieldId,
        target,
        startX: clientX,
        startY: clientY,
        baseX: offset.x,
        baseY: offset.y,
        sourcePerViewportPx: getSourcePerViewportPx(target),
      };
      isDraggingRef.current = true;
      setIsDragging(true);
      return true;
    };

    let pendingTouch: { target: HTMLElement; x: number; y: number; id: number } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      if (e.isPrimary === false) { pendingTouch = null; if (dragState) finishDrag(); return; }
      if (pendingTouch || dragState) return;
      const target = e.target as HTMLElement | null;
      const selected = rectsRef.current.find(rect => rect.id === selectedFieldIdRef.current)?.domEl;
      if (!target || target.closest('.moveable-control') || !selected || !isPaintedEditableHit(selected, e.clientX, e.clientY)) return;
      pendingTouch = { target, x: e.clientX, y: e.clientY, id: e.pointerId };
    };

    const updateDrag = (clientX: number, clientY: number) => {
      if (!dragState) return;
      const dx = (clientX - dragState.startX) * dragState.sourcePerViewportPx;
      const dy = (clientY - dragState.startY) * dragState.sourcePerViewportPx;
      dragState.target.style.translate = `${dragState.baseX + dx}px ${dragState.baseY + dy}px`;
    };

    const flushDrag = () => {
      dragRaf = 0;
      const point = pendingDragPoint;
      pendingDragPoint = null;
      if (!point) return;
      updateDrag(point.x, point.y);
      moveableRef.current?.updateRect();
    };

    const onPointerMove = (e: PointerEvent) => {
      const point = pendingTouch;
      if (point?.id === e.pointerId && Math.hypot(e.clientX - point.x, e.clientY - point.y) > EDITABLE_POINTER_MOVE_THRESHOLD) {
        pendingTouch = null;
        if (startDrag(point.target, point.x, point.y, 'touch')) {
          if (interactionEl) interactionEl.dataset.editableGesture = 'drag';
          onGestureStartRef.current?.();
          try { point.target.setPointerCapture(e.pointerId); } catch { /* best effort */ }
        }
      }
      if (!dragState) return;
      pendingDragPoint = { x: e.clientX, y: e.clientY };
      if (!dragRaf) dragRaf = requestAnimationFrame(flushDrag);
      e.preventDefault();
    };

    const finishDrag = () => {
      pendingTouch = null;
      if (interactionEl) delete interactionEl.dataset.editableGesture;
      if (!dragState) return;
      if (dragRaf) {
        cancelAnimationFrame(dragRaf);
        dragRaf = 0;
      }
      flushDrag();
      const finalOffset = readCssPair(dragState.target.style.translate);
      if (finalOffset) onUpdateProp(`_pos_${dragState.fieldId}`, finalOffset);
      dragState = null;
      isDraggingRef.current = false;
      setIsDragging(false);
      requestAnimationFrame(() => {
        measure();
        moveableRef.current?.updateRect();
      });
    };

    containerEl.addEventListener('pointerdown', onPointerDown, { capture: true });
    overlayEl.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
    return () => {
      containerEl.removeEventListener('pointerdown', onPointerDown, { capture: true });
      overlayEl.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
      if (interactionEl) delete interactionEl.dataset.editableGesture;
      if (dragRaf) cancelAnimationFrame(dragRaf);
    };
  }, [containerEl, interactionEl, measure, onUpdateProp, props, touchGestures]);

  // ── Container-level pinch-to-scale ──
  // Single implementation: works regardless of where fingers land.
  // Moveable's pinchable is disabled — this is the only pinch handler.
  const pinchRef = useRef<{ startDist: number; baseW: number; baseH: number } | null>(null);

  useEffect(() => {
    if (!containerEl) return;

    const getDist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    const onTouchStart = (e: TouchEvent) => {
      if (!selectedFieldIdRef.current || e.touches.length !== 2) return;
      const sc = props[`_scale_${selectedFieldIdRef.current}`] as { w: number; h: number } | undefined;
      onGestureStartRef.current?.();
      if (interactionEl) interactionEl.dataset.editableGesture = 'scale';
      pinchRef.current = {
        startDist: getDist(e.touches),
        baseW: sc?.w ?? 1,
        baseH: sc?.h ?? 1,
      };
      isDraggingRef.current = true;
      setIsDragging(true);
    };

    const onTouchMove = (e: TouchEvent) => {
      const p = pinchRef.current;
      if (!p || e.touches.length < 2 || !selectedFieldIdRef.current) return;
      e.preventDefault();

      const ratio = getDist(e.touches) / p.startDist;
      const newW = p.baseW * ratio;
      const newH = p.baseH * ratio;

      // Apply the same independent CSS scale used by EditableSceneBoundary.
      const el = rectsRef.current.find(
        rect => rect.id === selectedFieldIdRef.current,
      )?.domEl ?? null;
      if (el) {
        el.style.scale = `${+newW.toFixed(4)} ${+newH.toFixed(4)}`;
      }

      // Update Moveable frame to follow
      moveableRef.current?.updateRect();
    };

    const onTouchEnd = () => {
      if (!pinchRef.current) return;
      if (interactionEl) delete interactionEl.dataset.editableGesture;
      const fieldId = selectedFieldIdRef.current;
      pinchRef.current = null;
      isDraggingRef.current = false;
      setIsDragging(false);

      if (!fieldId) return;
      // Persist the pinched scale (read from pinch state, not DOM)
      const el = rectsRef.current.find(rect => rect.id === fieldId)?.domEl ?? null;
      if (el && el.style.scale) {
        const parts = el.style.scale.split(' ');
        const w = parseFloat(parts[0]) || 1;
        const h = parseFloat(parts[1] ?? parts[0]) || 1;
        onUpdateProp(`_scale_${fieldId}`, { w, h });
      }
    };

    containerEl.addEventListener('touchstart', onTouchStart, { passive: true });
    containerEl.addEventListener('touchmove', onTouchMove, { passive: false });
    containerEl.addEventListener('touchend', onTouchEnd, { passive: true });
    containerEl.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      containerEl.removeEventListener('touchstart', onTouchStart);
      containerEl.removeEventListener('touchmove', onTouchMove);
      containerEl.removeEventListener('touchend', onTouchEnd);
      containerEl.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [containerEl, interactionEl, props, onUpdateProp]);

  const selectedRect = rects.find(r => r.id === selectedFieldId && r.domEl.isConnected);

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 15 }}
    >
      {selectedRect && <EditableSelectionTint element={selectedRect.domEl} overlay={overlayRef.current} moving={isDragging} />}
      {/* Label tag for selected element — hidden during drag */}
      {selectedRect && selectedFieldId && !isDragging && (() => {
        const field = editables.find(f => f.id === selectedFieldId);
        if (!field) return null;
        return (
          <div
            data-editable-label={selectedFieldId}
            title={field.label}
            className="absolute px-1.5 py-0.5 text-[10px] font-medium rounded-sm whitespace-nowrap pointer-events-none"
            style={{
              ...editableLabelPosition(selectedRect, overlayRef.current?.clientWidth || 0, overlayRef.current?.clientHeight || 0),
              overflow: 'hidden', textOverflow: 'ellipsis',
              backgroundColor: 'rgb(217,70,239)',
              color: 'white',
            }}
          >
            {editableDisplayLabel(field, t('design.background'))}
          </div>
        );
      })()}

      {/* Moveable: drag + desktop scale handles. Pinch handled by container touch listener above. */}
      {selectedRect && selectedFieldId && (
        <div style={{ transform: scrollOffset ? `translateY(${scrollOffset}px)` : undefined }}>
          <Moveable
            ref={moveableRef}
            target={selectedRect.domEl}
            rootContainer={containerEl ?? undefined}
            useAccuratePosition={true}
            draggable={!touchGestures}
            dragArea={!touchGestures}
            passDragArea={touchGestures}
            preventDefault={false}
            scalable={true}
            keepRatio={true}
            renderDirections={['nw', 'ne', 'sw', 'se']}
            pinchable={false}
            rotatable={false}
            origin={false}
            throttleDrag={0}
            throttleScale={0}
            hideDefaultLines={false}
            edge={false}
            padding={{ left: 0, top: 0, right: 0, bottom: 0 }}
            /* ── Snap & Guidelines ── */
            snappable={true}
            snapThreshold={8}
            snapGap={true}
            isDisplaySnapDigit={true}
            snapDirections={{ top: true, bottom: true, left: true, right: true, center: true, middle: true }}
            elementSnapDirections={{ top: true, bottom: true, left: true, right: true, center: true, middle: true }}
            horizontalGuidelines={overlayRef.current ? [Math.round(overlayRef.current.clientHeight / 2)] : []}
            verticalGuidelines={overlayRef.current ? [Math.round(overlayRef.current.clientWidth / 2)] : []}
            elementGuidelines={rects.filter(r => r.id !== selectedFieldId).map(r => r.domEl)}
            /* ── Drag ── */
            onDragStart={(event) => {
              if (touchGestures && event.inputEvent?.type?.startsWith('touch')) { event.stopDrag(); return false; }
              onGestureStartRef.current?.();
              const input = event.inputEvent;
              const point = input?.touches?.[0] || input;
              if (typeof point?.clientX === 'number' && !isPaintedEditableHit(selectedRect.domEl, point.clientX, point.clientY)) {
                event.stopDrag(); return false;
              }
              const { set } = event;
              isDraggingRef.current = true;
              setIsDragging(true);
              const pos = props[`_pos_${selectedFieldId}`] as { x: number; y: number } | undefined;
              dragBaseOffsetRef.current = { x: pos?.x ?? 0, y: pos?.y ?? 0 };
              dragDomElRef.current = selectedRect.domEl;
              const sc = props[`_scale_${selectedFieldId}`] as { w: number; h: number } | undefined;
              dragScaleRef.current = sc?.w ?? 1;
              set([0, 0]);
            }}
            onDrag={({ target, beforeTranslate }) => {
              const { x: baseX, y: baseY } = dragBaseOffsetRef.current;
              const s = dragScaleRef.current;
              target.style.translate = `${baseX + beforeTranslate[0] * s}px ${baseY + beforeTranslate[1] * s}px`;
            }}
            onDragEnd={({ lastEvent }) => {
              if (lastEvent) {
                const { x: baseX, y: baseY } = dragBaseOffsetRef.current;
                const s = dragScaleRef.current;
                onUpdateProp(`_pos_${selectedFieldId}`, {
                  x: baseX + lastEvent.beforeTranslate[0] * s,
                  y: baseY + lastEvent.beforeTranslate[1] * s,
                });
              }
              isDraggingRef.current = false; setIsDragging(false);
              requestAnimationFrame(measure);
            }}
            /* ── Scale (desktop handle drag only) ── */
            onScaleStart={({ set }) => {
              onGestureStartRef.current?.();
              isDraggingRef.current = true;
              setIsDragging(true);
              dragDomElRef.current = selectedRect.domEl;
              const sc = props[`_scale_${selectedFieldId}`] as { w: number; h: number } | undefined;
              dragBaseOffsetRef.current = { x: sc?.w ?? 1, y: sc?.h ?? 1 };
              set([1, 1]);
            }}
            onScale={({ target, scale: scaleVec }) => {
              const { x: baseW, y: baseH } = dragBaseOffsetRef.current;
              target.style.scale = `${+(baseW * scaleVec[0]).toFixed(4)} ${+(baseH * scaleVec[1]).toFixed(4)}`;
            }}
            onScaleEnd={({ lastEvent }) => {
              if (lastEvent) {
                const { x: baseW, y: baseH } = dragBaseOffsetRef.current;
                onUpdateProp(`_scale_${selectedFieldId}`, {
                  w: baseW * lastEvent.scale[0],
                  h: baseH * lastEvent.scale[1],
                });
              }
              isDraggingRef.current = false; setIsDragging(false);
              requestAnimationFrame(measure);
            }}
          />
        </div>
      )}
    </div>
  );
}
