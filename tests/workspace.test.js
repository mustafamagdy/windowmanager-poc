"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("../src/core");
function createWorkspace() {
    return new core_1.Workspace('ws-1', 'Workspace 1', new core_1.DockLayout((0, core_1.createLeaf)('root-window')), [
        { id: 'root-window', title: 'Root' }
    ]);
}
describe('Workspace', () => {
    it('tracks windows and active window', () => {
        const workspace = createWorkspace();
        expect(workspace.getWindows()).toHaveLength(1);
        expect(workspace.getActiveWindow()?.id).toBe('root-window');
        workspace.addWindow({ id: 'second', title: 'Second' }, 'root-window');
        workspace.dock({ window: { id: 'second', title: 'Second' }, targetWindowId: 'root-window', direction: 'right' });
        expect(workspace.getWindows()).toHaveLength(2);
        expect(workspace.listRelationships()).toEqual([
            { sourceWindowId: 'second', targetWindowId: 'root-window', direction: 'right' }
        ]);
    });
    it('removes windows and prunes relationships', () => {
        const workspace = createWorkspace();
        workspace.dock({
            window: { id: 'second', title: 'Second' },
            targetWindowId: 'root-window',
            direction: 'right'
        });
        workspace.removeWindow('second');
        expect(workspace.getWindows()).toHaveLength(1);
        expect(workspace.listRelationships()).toHaveLength(0);
    });
});
