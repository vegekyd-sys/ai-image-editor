export function calculateVisualViewportKeyboardInset(params: {
  layoutHeight: number;
  viewportHeight: number;
  offsetTop?: number;
}): number {
  const offsetTop = params.offsetTop ?? 0;
  const rawInset = params.layoutHeight - params.viewportHeight - offsetTop;
  return Math.round(Math.max(0, rawInset));
}

export function getVisualViewportKeyboardInset(win: Window | undefined = typeof window === 'undefined' ? undefined : window): number {
  if (!win?.visualViewport) return 0;
  return calculateVisualViewportKeyboardInset({
    layoutHeight: win.innerHeight,
    viewportHeight: win.visualViewport.height,
    offsetTop: win.visualViewport.offsetTop,
  });
}
