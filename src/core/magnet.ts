import { DockingDirection, isHorizontalDock, isVerticalDock } from './docking';
import { Rect } from './layout';

export interface MagneticDockIntent {
  direction: DockingDirection;
  distance: number;
  overlap: number;
}

export interface MagneticDockComputationOptions {
  threshold?: number;
}

const DEFAULT_THRESHOLD = 24;

export function inferMagneticIntent(
  dragged: Rect,
  target: Rect,
  options: MagneticDockComputationOptions = {}
): MagneticDockIntent | undefined {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const candidates: MagneticDockIntent[] = [];

  const horizontalOverlap = computeOverlap(
    dragged.y,
    dragged.y + dragged.height,
    target.y,
    target.y + target.height
  );
  const verticalOverlap = computeOverlap(
    dragged.x,
    dragged.x + dragged.width,
    target.x,
    target.x + target.width
  );

  const rightGap = Math.abs(dragged.x + dragged.width - target.x);
  if (horizontalOverlap > 0 && rightGap <= threshold) {
    candidates.push({ direction: 'left', distance: rightGap, overlap: horizontalOverlap });
  }

  const leftGap = Math.abs(dragged.x - (target.x + target.width));
  if (horizontalOverlap > 0 && leftGap <= threshold) {
    candidates.push({ direction: 'right', distance: leftGap, overlap: horizontalOverlap });
  }

  const bottomGap = Math.abs(dragged.y + dragged.height - target.y);
  if (verticalOverlap > 0 && bottomGap <= threshold) {
    candidates.push({ direction: 'top', distance: bottomGap, overlap: verticalOverlap });
  }

  const topGap = Math.abs(dragged.y - (target.y + target.height));
  if (verticalOverlap > 0 && topGap <= threshold) {
    candidates.push({ direction: 'bottom', distance: topGap, overlap: verticalOverlap });
  }

  if (containsPoint(target, dragged.x + dragged.width / 2, dragged.y + dragged.height / 2)) {
    const centerDistance = Math.min(rightGap, leftGap, bottomGap, topGap);
    candidates.push({ direction: 'tab', distance: centerDistance, overlap: Math.min(horizontalOverlap, verticalOverlap) });
  }

  candidates.sort(compareCandidates);
  return candidates[0];
}

export function calculateSplitRatio(
  direction: DockingDirection,
  dragged: Rect,
  target: Rect
): number {
  if (isHorizontalDock(direction)) {
    const totalWidth = dragged.width + target.width;
    if (totalWidth === 0) {
      return 0.5;
    }
    if (direction === 'left') {
      return clampRatio(dragged.width / totalWidth);
    }
    return clampRatio(target.width / totalWidth);
  }

  if (isVerticalDock(direction)) {
    const totalHeight = dragged.height + target.height;
    if (totalHeight === 0) {
      return 0.5;
    }
    if (direction === 'top') {
      return clampRatio(dragged.height / totalHeight);
    }
    return clampRatio(target.height / totalHeight);
  }

  return 0.5;
}

function computeOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number
): number {
  const start = Math.max(startA, startB);
  const end = Math.min(endA, endB);
  return Math.max(0, end - start);
}

function containsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function compareCandidates(a: MagneticDockIntent, b: MagneticDockIntent): number {
  if (a.distance !== b.distance) {
    return a.distance - b.distance;
  }
  return b.overlap - a.overlap;
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(0.9, Math.max(0.1, value));
}
