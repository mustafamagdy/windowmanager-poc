"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const layout_1 = require("../src/core/layout");
describe('DockLayout', () => {
    it('computes placements for horizontal and vertical splits', () => {
        const layout = new layout_1.DockLayout((0, layout_1.createSplit)('horizontal', 0.5, (0, layout_1.createLeaf)('left'), (0, layout_1.createSplit)('vertical', 0.5, (0, layout_1.createLeaf)('topRight'), (0, layout_1.createLeaf)('bottomRight'))));
        const placements = layout.computePlacements({ x: 0, y: 0, width: 1000, height: 800 });
        const placementMap = Object.fromEntries(placements.map((p) => [p.id, p.bounds]));
        expect(placementMap.left).toEqual({ x: 0, y: 0, width: 500, height: 800 });
        expect(placementMap.topRight).toEqual({ x: 500, y: 0, width: 500, height: 400 });
        expect(placementMap.bottomRight).toEqual({ x: 500, y: 400, width: 500, height: 400 });
    });
    it('serializes and deserializes layouts', () => {
        const layout = new layout_1.DockLayout((0, layout_1.createLeaf)('window-1'));
        const serialized = layout.serialize();
        const restored = layout_1.DockLayout.deserialize(serialized);
        expect(restored.serialize()).toEqual(serialized);
    });
});
