import { PassThrough } from 'node:stream';
import { DockLayout, Workspace, WorkspaceManager, createLeaf } from '../src/core';
import VirtualWindowController from '../src/platform/common/virtualWindowController';
import { WorkspaceShell, WorkspaceShellContext } from '../src/ui/shell';
import { WorkspacePersistence } from '../src/ui/workspacePersistence';

function createWorkspace(): Workspace {
  const layout = new DockLayout(createLeaf('root'));
  return new Workspace('ws', 'Workspace', layout, [
    { id: 'root', title: 'Root Window' }
  ]);
}

describe('WorkspaceShell', () => {
  let controller: VirtualWindowController;
  let manager: WorkspaceManager;
  let shell: WorkspaceShell;
  let persistence: WorkspacePersistence;

  beforeEach(() => {
    controller = new VirtualWindowController();
    controller.registerWindow({ id: 'root', title: 'Root Window' });
    const workspace = createWorkspace();
    manager = new WorkspaceManager([workspace], workspace.id);
    persistence = {
      path: '/tmp/workspaces.json',
      save: jest.fn().mockResolvedValue(undefined),
      load: jest.fn()
    } as unknown as WorkspacePersistence;

    const context: WorkspaceShellContext = { manager, controller, persistence };
    shell = new WorkspaceShell(context, { input: new PassThrough(), output: new PassThrough() });
  });

  it('lists workspaces and windows', async () => {
    const workspacesOutput = await shell.execute('workspaces');
    expect(workspacesOutput).toContain('* ws - Workspace');

    const windowsOutput = await shell.execute('windows');
    expect(windowsOutput).toContain('root - Root Window');
  });

  it('adds windows and performs docking actions', async () => {
    const addOutput = await shell.execute('add-window secondary "Secondary Window"');
    expect(addOutput).toContain('Added window secondary');

    const dockOutput = await shell.execute('dock secondary root right 0.4');
    expect(dockOutput).toContain('Docked secondary right of root');

    const layoutOutput = await shell.execute('layout 1200 800');
    const panes = layoutOutput.split('\n').filter(Boolean);
    expect(panes.length).toBeGreaterThanOrEqual(2);
  });

  it('magnetically docks windows based on bounds', async () => {
    await shell.execute('add-window secondary "Secondary Window"');
    await shell.execute('dock secondary root right 0.5');

    const message = await shell.execute('dock-magnetic magnetic 700 0 200 400 1400 800');
    expect(message).toContain('Magnetically docked magnetic right of secondary');
  });

  it('invokes controller operations and persistence', async () => {
    controller.registerWindow({ id: 'secondary', title: 'Secondary' });

    const controllerList = await shell.execute('controller-windows');
    expect(controllerList).toContain('root - Root Window');

    const focusOutput = await shell.execute('focus root');
    expect(focusOutput).toContain('Focused window root');

    const moveOutput = await shell.execute('move root 10 20 300 200');
    expect(moveOutput).toContain('Moved window root');

    const persistOutput = await shell.execute('persist');
    expect(persistOutput).toContain('Persisted');
    expect((persistence.save as jest.Mock)).toHaveBeenCalled();
  });
});
