"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("../src/core");
describe('Workspace persistence', () => {
    it('serializes and restores workspace state', () => {
        const workspace = new core_1.Workspace('ws', 'Test Workspace', new core_1.DockLayout((0, core_1.createLeaf)('primary')), [{ id: 'primary', title: 'Primary' }]);
        workspace.dock({
            window: { id: 'secondary', title: 'Secondary' },
            targetWindowId: 'primary',
            direction: 'bottom',
            ratio: 0.3
        });
        const snapshot = workspace.serialize();
        const restored = core_1.Workspace.deserialize(snapshot);
        expect(restored.serialize()).toEqual(snapshot);
        expect(restored.listRelationships()).toHaveLength(1);
        expect(restored.getWindows()).toHaveLength(2);
    });
});
