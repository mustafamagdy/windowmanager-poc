import { DockLayout, Workspace, WorkspaceSnapshot, createLeaf } from '../src/core';

describe('Workspace persistence', () => {
  it('serializes and restores workspace state', () => {
    const workspace = new Workspace(
      'ws',
      'Test Workspace',
      new DockLayout(createLeaf('primary')),
      [{ id: 'primary', title: 'Primary' }]
    );

    workspace.dock({
      window: { id: 'secondary', title: 'Secondary' },
      targetWindowId: 'primary',
      direction: 'bottom',
      ratio: 0.3
    });

    const snapshot = workspace.serialize();
    const restored = Workspace.deserialize(snapshot as WorkspaceSnapshot);

    expect(restored.serialize()).toEqual(snapshot);
    expect(restored.listRelationships()).toHaveLength(1);
    expect(restored.getWindows()).toHaveLength(2);
  });
});
