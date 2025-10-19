import { calculateSplitRatio, inferMagneticIntent } from '../src/core/magnet';
import { DockingDirection } from '../src/core/docking';

describe('magnetic docking helpers', () => {
  it('infers docking intent based on proximity', () => {
    const intent = inferMagneticIntent(
      { x: 390, y: 0, width: 200, height: 400 },
      { x: 600, y: 0, width: 200, height: 400 },
      { threshold: 20 }
    );

    expect(intent).toEqual({ direction: 'left', distance: 10, overlap: 400 });
  });

  it.each<[
    DockingDirection,
    number
  ]>([
    ['left', 0.3333333333333333],
    ['right', 0.6666666666666666],
    ['top', 0.3333333333333333],
    ['bottom', 0.6666666666666666],
    ['tab', 0.5]
  ])('calculates split ratio for %s docking', (direction, expected) => {
    const ratio = calculateSplitRatio(
      direction,
      { x: 0, y: 0, width: 200, height: 100 },
      { x: 200, y: 0, width: 400, height: 200 }
    );

    expect(ratio).toBeCloseTo(expected);
  });
});
