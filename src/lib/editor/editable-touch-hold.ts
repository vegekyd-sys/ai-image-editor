export const EDITABLE_HOLD_MS = 350;
/** A navigation swipe must win before the canvas claims a layer drag. */
export function createEditableTouchHold(activate: (pointerId: number) => void) {
  let pending: { id: number; x: number; y: number } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { if (timer) clearTimeout(timer); timer = undefined; pending = undefined; };
  return {
    start(id: number, x: number, y: number) {
      cancel(); pending = { id, x, y };
      timer = setTimeout(() => { const point = pending; timer = undefined; pending = undefined; if (point) activate(point.id); }, EDITABLE_HOLD_MS);
    },
    move(id: number, x: number, y: number) { if (pending?.id === id && Math.hypot(x - pending.x, y - pending.y) > 8) cancel(); },
    cancel,
  };
}
export function editableLabelPosition(rect: { left: number; top: number }, width: number, height: number) {
  const left = Math.max(4, Math.min(rect.left, Math.max(4, width - 100)));
  return { left, top: Math.max(4, Math.min(rect.top - 24, Math.max(4, height - 24))), maxWidth: Math.max(0, width - left - 4) };
}
