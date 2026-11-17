/**
 * Concept card placement (pure, unit-tested). The card is position: fixed, so
 * it is never clipped by the article container; it opens below the term when
 * there is room, otherwise above, and is clamped inside the viewport.
 */
export interface Box {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface Placement {
  top: number;
  left: number;
  side: 'below' | 'above';
}

export function placeCard(
  /** Line boxes of the term (a wrapped term has several). */
  rects: readonly Box[],
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
  gap = 6,
): Placement {
  const first = rects[0];
  const last = rects[rects.length - 1];
  const spaceBelow = viewport.height - last.bottom - gap - margin;
  const spaceAbove = first.top - gap - margin;
  const side = card.height <= spaceBelow || spaceBelow >= spaceAbove ? 'below' : 'above';
  const anchor = side === 'below' ? last : first;
  let top = side === 'below' ? anchor.bottom + gap : anchor.top - gap - card.height;
  top = Math.max(margin, Math.min(top, viewport.height - card.height - margin));
  const maxLeft = Math.max(margin, viewport.width - card.width - margin);
  const left = Math.min(Math.max(anchor.left, margin), maxLeft);
  return { top, left, side };
}
