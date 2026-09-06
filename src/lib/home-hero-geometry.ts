export type HomeHeroGeometry = {
  top: number
  left: number
  width: number
  height: number
  rotation: number
  borderRadius: number
  opacity: number
}

// The axis-aligned bounding box includes the empty corners around a tilted card.
// Recover its own dimensions and angle so the fly layer can meet the actual frame.
export function readHomeHeroGeometry(element: HTMLElement): HomeHeroGeometry {
  const bounds = element.getBoundingClientRect()
  let matrix = new DOMMatrix()
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const transform = getComputedStyle(node).transform
    if (transform !== 'none') matrix = new DOMMatrix(transform).multiply(matrix)
  }
  const style = getComputedStyle(element)
  const scaleX = Math.hypot(matrix.a, matrix.b)
  const scaleY = Math.hypot(matrix.c, matrix.d)
  const width = element.offsetWidth * scaleX
  const height = element.offsetHeight * scaleY
  return {
    top: bounds.top + (bounds.height - height) / 2,
    left: bounds.left + (bounds.width - width) / 2,
    width,
    height,
    rotation: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI,
    borderRadius: (parseFloat(style.borderTopLeftRadius) || 0) * scaleX,
    opacity: element.matches('.creative-art-frame') && element.firstElementChild
      ? Number(getComputedStyle(element.firstElementChild).opacity)
      : 1,
  }
}
