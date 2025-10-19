import { DockLayout, createLeaf, createSplit } from '../src/core/layout';

describe('DockLayout', () => {
  it('computes placements for horizontal and vertical splits', () => {
    const layout = new DockLayout(
      createSplit(
        'horizontal',
        0.5,
        createLeaf('left'),
        createSplit('vertical', 0.5, createLeaf('topRight'), createLeaf('bottomRight'))
      )
    );

    const placements = layout.computePlacements({ x: 0, y: 0, width: 1000, height: 800 });
    const placementMap = Object.fromEntries(placements.map((p) => [p.id, p.bounds]));

    expect(placementMap.left).toEqual({ x: 0, y: 0, width: 500, height: 800 });
    expect(placementMap.topRight).toEqual({ x: 500, y: 0, width: 500, height: 400 });
    expect(placementMap.bottomRight).toEqual({ x: 500, y: 400, width: 500, height: 400 });
  });

  it('serializes and deserializes layouts', () => {
    const layout = new DockLayout(createLeaf('window-1'));
    const serialized = layout.serialize();
    const restored = DockLayout.deserialize(serialized);
    expect(restored.serialize()).toEqual(serialized);
  });
});
