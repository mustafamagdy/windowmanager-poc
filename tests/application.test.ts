import { DockLayout, Workspace, WorkspaceManager, createLeaf } from '../src/core';
import { BaseWindowController } from '../src/platform/common/IWindowController';
import { Application } from '../src/ui';
import { WorkspaceShell } from '../src/ui/shell';
import { WorkspacePersistence } from '../src/ui/workspacePersistence';

class TestController extends BaseWindowController {
  platform = 'test';
  initialize = jest.fn(async () => {});
  persistWorkspace = jest.fn(async () => {});
}

function createWorkspace(id: string): Workspace {
  const layout = new DockLayout(createLeaf(`${id}-root`));
  return new Workspace(
    id,
    `Workspace ${id}`,
    layout,
    [
      {
        id: `${id}-root`,
        title: `Window ${id}`
      }
    ],
    `${id}-root`
  );
}

describe('Application bootstrap', () => {
  let controller: TestController;
  let saveMock: jest.Mock;
  let loadMock: jest.Mock;
  let persistence: WorkspacePersistence;

  beforeEach(() => {
    controller = new TestController();
    saveMock = jest.fn().mockResolvedValue(undefined);
    loadMock = jest.fn();
    persistence = {
      path: '/tmp/workspaces.json',
      save: saveMock,
      load: loadMock
    } as unknown as WorkspacePersistence;
  });

  it('restores persisted workspace collections', async () => {
    const workspace = createWorkspace('alpha');
    const manager = new WorkspaceManager([workspace], workspace.id);
    const snapshot = manager.serialize();
    loadMock.mockResolvedValue(snapshot);

    const app = new Application('linux', { controller, persistence });
    await app.bootstrap();

    expect(controller.initialize).toHaveBeenCalledTimes(1);
    expect(controller.persistWorkspace).toHaveBeenCalledWith(workspace.serialize());
    expect(saveMock).toHaveBeenCalledWith(snapshot);
    expect(app.getWorkspaceManager().serialize()).toEqual(snapshot);
  });

  it('creates a default workspace when nothing is persisted', async () => {
    loadMock.mockResolvedValue(undefined);

    const app = new Application('linux', { controller, persistence });
    await app.bootstrap();

    expect(controller.persistWorkspace).toHaveBeenCalledWith(app.workspace.serialize());
    expect(app.workspace.id).toBe('default');
    expect(saveMock).toHaveBeenCalledWith(app.getWorkspaceManager().serialize());
  });

  it('persists changes when the active workspace updates', async () => {
    const workspace = createWorkspace('primary');
    const manager = new WorkspaceManager([workspace], workspace.id);
    const snapshot = manager.serialize();
    loadMock.mockResolvedValue(snapshot);

    const app = new Application('linux', { controller, persistence });
    await app.bootstrap();

    controller.persistWorkspace.mockClear();
    saveMock.mockClear();

    const activeWorkspace = app.workspace;
    activeWorkspace.addWindow({ id: 'secondary', title: 'Secondary' });

    expect(controller.persistWorkspace).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it('launches an interactive shell when requested', async () => {
    loadMock.mockResolvedValue(undefined);

    const startMock = jest.fn().mockResolvedValue(undefined);
    const factory = jest.fn(() => ({ start: startMock } as unknown as WorkspaceShell));

    const app = new Application('linux', { controller, persistence, shellFactory: factory });
    await app.bootstrap();
    await app.launchShell({ prompt: 'test> ' });

    expect(factory).toHaveBeenCalled();
    expect(startMock).toHaveBeenCalledTimes(1);
  });
});
