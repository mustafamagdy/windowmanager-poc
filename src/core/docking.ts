export type DockingDirection = 'left' | 'right' | 'top' | 'bottom' | 'tab';

export function isHorizontalDock(direction: DockingDirection): boolean {
  return direction === 'left' || direction === 'right';
}

export function isVerticalDock(direction: DockingDirection): boolean {
  return direction === 'top' || direction === 'bottom';
}
