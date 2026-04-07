export interface MarkupIdsFromPoint {
  /** All markup IDs (annotations + measurements) top → bottom. */
  orderedIds: string[];
  /** Measurement IDs only, same stacking order (subset of orderedIds). */
  measurementIdsInOrder: string[];
  /** Annotation IDs only, same stacking order. */
  annotationIdsInOrder: string[];
}

/** Markup IDs from DOM stacking order at pointer (top → bottom). */
export function getMarkupIdsFromElementsFromPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number
): MarkupIdsFromPoint {
  const elements = document.elementsFromPoint(clientX, clientY);
  const seen = new Set<string>();
  const orderedIds: string[] = [];
  const measurementIdsInOrder: string[] = [];
  const annotationIdsInOrder: string[] = [];
  for (const el of elements) {
    if (!svg.contains(el)) continue;
    const marked = el.closest?.('[data-annotation-id], [data-measurement-id]');
    if (!marked) continue;
    const measId = marked.getAttribute('data-measurement-id');
    const annId = marked.getAttribute('data-annotation-id');
    const id = measId ?? annId ?? '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    orderedIds.push(id);
    if (measId) measurementIdsInOrder.push(id);
    else if (annId) annotationIdsInOrder.push(id);
  }
  return { orderedIds, measurementIdsInOrder, annotationIdsInOrder };
}
