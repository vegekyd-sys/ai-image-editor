let annotationIdCounter = 0;

export function newAnnotationId() {
  annotationIdCounter += 1;
  return `ann_${Date.now()}_${annotationIdCounter}`;
}
