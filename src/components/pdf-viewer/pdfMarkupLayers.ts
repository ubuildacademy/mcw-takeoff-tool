/** Split SVG overlay: committed markups vs pointer-driven ephemeral graphics (no full SVG clear on mousemove). */

export const SVG_COMMITTED_GROUP_ID = 'pdf-markup-committed';

export const SVG_EPHEMERAL_GROUP_ID = 'pdf-markup-ephemeral';

/** Class on `<g>` wrappers around measurements being move-dragged; transform updated without full SVG rebuild. */
export const SVG_MOVE_DRAG_MEASUREMENT_WRAP_CLASS = 'pdf-markup-move-drag-measurement';

/** Class on `<g>` wrappers around annotations being move-dragged. */
export const SVG_MOVE_DRAG_ANNOTATION_WRAP_CLASS = 'pdf-markup-move-drag-annotation';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Ensures `<g id="pdf-markup-committed">` then `<g id="pdf-markup-ephemeral">` exist as direct children
 * (ephemeral last so it paints above). Returns the two groups.
 */
export function ensureMarkupLayerGroups(svg: SVGSVGElement): {
  committed: SVGGElement;
  ephemeral: SVGGElement;
} {
  let committed = svg.querySelector(`#${SVG_COMMITTED_GROUP_ID}`) as SVGGElement | null;
  let ephemeral = svg.querySelector(`#${SVG_EPHEMERAL_GROUP_ID}`) as SVGGElement | null;

  if (!committed) {
    committed = document.createElementNS(SVG_NS, 'g');
    committed.setAttribute('id', SVG_COMMITTED_GROUP_ID);
    svg.appendChild(committed);
  }
  if (!ephemeral) {
    ephemeral = document.createElementNS(SVG_NS, 'g');
    ephemeral.setAttribute('id', SVG_EPHEMERAL_GROUP_ID);
    ephemeral.setAttribute('pointer-events', 'none');
    svg.appendChild(ephemeral);
  } else if (ephemeral.previousElementSibling !== committed && committed.parentNode === svg) {
    svg.removeChild(ephemeral);
    svg.appendChild(ephemeral);
  }

  return { committed, ephemeral };
}

/** Replace all children of the committed layer only. */
export function clearCommittedMarkupLayer(committed: SVGGElement): void {
  committed.innerHTML = '';
}

/** Replace all children of the ephemeral layer only. */
export function clearEphemeralMarkupLayer(ephemeral: SVGGElement): void {
  ephemeral.innerHTML = '';
}
