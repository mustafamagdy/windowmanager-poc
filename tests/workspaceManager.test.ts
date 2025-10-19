import { DockLayout, Workspace, WorkspaceManager, createLeaf } from '../src/core';

function buildWorkspace(id: string, title: string): Workspace {
  return new Workspace(id, title, new DockLayout(createLeaf(`${id}-root`)), [
    { id: `${id}-root`, title: `${title} Root` }
  ]);
}

describe('WorkspaceManager', () => {
  it('activates first workspace by default and allows switching', () => {
    const ws1 = buildWorkspace('ws-1', 'Workspace 1');
    const ws2 = buildWorkspace('ws-2', 'Workspace 2');
    const manager = new WorkspaceManager([ws1, ws2]);

    expect(manager.getActiveWorkspace()?.id).toBe('ws-1');

    manager.setActiveWorkspace('ws-2');
    expect(manager.getActiveWorkspace()?.id).toBe('ws-2');

    manager.removeWorkspace('ws-2');
    expect(manager.getActiveWorkspace()?.id).toBe('ws-1');
  });

  it('serializes and restores workspace collections', () => {
    const workspace = buildWorkspace('primary', 'Primary');
    workspace.dock({
      window: { id: 'secondary', title: 'Secondary' },
      targetWindowId: 'primary-root',
      direction: 'right'
    });

    const manager = new WorkspaceManager([workspace], 'primary');
    const snapshot = manager.serialize();
    const restored = WorkspaceManager.deserialize(snapshot);

    expect(restored.serialize()).toEqual(snapshot);
    expect(restored.getActiveWorkspace()?.listRelationships()).toHaveLength(1);
    expect(restored.getActiveWorkspace()?.getWindows()).toHaveLength(2);
  });

  it('emits events when active workspace changes', () => {
    const ws1 = buildWorkspace('alpha', 'Alpha');
    const ws2 = buildWorkspace('beta', 'Beta');
    const manager = new WorkspaceManager();
    const events: Array<string | undefined> = [];

    manager.on('active-workspace-changed', (id) => events.push(id));

    manager.addWorkspace(ws1);
    manager.addWorkspace(ws2, { activate: true });
    manager.removeWorkspace('beta');

    expect(events).toEqual(['alpha', 'beta', 'alpha']);
  });
});
