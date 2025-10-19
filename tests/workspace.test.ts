import { DockLayout, Workspace, createLeaf } from '../src/core';

function createWorkspace(): Workspace {
  return new Workspace('ws-1', 'Workspace 1', new DockLayout(createLeaf('root-window')), [
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

  it('supports magnetic docking', () => {
    const workspace = createWorkspace();
    workspace.addWindow({ id: 'secondary', title: 'Secondary' }, 'root-window');
    workspace.dock({
      window: { id: 'secondary', title: 'Secondary' },
      targetWindowId: 'root-window',
      direction: 'right',
      ratio: 0.4
    });

    const relationship = workspace.dockMagnetically({
      window: { id: 'magnetic', title: 'Magnetic' },
      bounds: { x: 700, y: 0, width: 200, height: 400 },
      surface: { x: 0, y: 0, width: 1400, height: 800 }
    });

    expect(relationship.direction).toBe('tab');
    expect(relationship.targetWindowId).toBe('secondary');
    expect(workspace.listRelationships()).toEqual(
      expect.arrayContaining([
        { sourceWindowId: 'magnetic', targetWindowId: 'secondary', direction: 'tab' }
      ])
    );
  });
});
