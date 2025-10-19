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
});
