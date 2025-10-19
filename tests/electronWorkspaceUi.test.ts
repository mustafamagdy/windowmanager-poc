import { DockLayout, Workspace, WorkspaceManager, createLeaf } from '../src/core';
import { WorkspaceUiContext } from '../src/ui/uiTypes';
import { ElectronWorkspaceUi, ElectronHost, ElectronBrowserWindow, IPC_CHANNELS } from '../src/ui/electronWorkspaceUi';
import { WorkspacePersistence } from '../src/ui/workspacePersistence';
import { BaseWindowController } from '../src/platform/common/IWindowController';

class TestController extends BaseWindowController {
  platform = 'test';
  focusWindow = jest.fn(async () => {});
  listWindows = jest.fn(async () => [{ id: 'os-window', title: 'System Window' }]);
}

class TestWindow implements ElectronBrowserWindow {
  destroyed = false;
  loadURL = jest.fn(async () => {});
  show = jest.fn();
  focus = jest.fn();
  close = jest.fn(() => {
    this.destroyed = true;
    this.closedListeners.forEach((listener) => listener());
  });
  webContents = {
    send: jest.fn()
  };

  private closedListeners: Array<() => void> = [];

  on(event: 'closed', listener: () => void): void {
    if (event === 'closed') {
      this.closedListeners.push(listener);
    }
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

class TestHost implements ElectronHost {
  platform: NodeJS.Platform = 'linux';
  window = new TestWindow();
  createWindow = jest.fn(() => this.window);
  app = {
    whenReady: jest.fn(async () => {}),
    on: jest.fn(),
    quit: jest.fn()
  };

  ipcMain = {
    handle: jest.fn((channel: string, handler: (event: unknown, ...args: any[]) => any) => {
      this.handlers.set(channel, handler);
    }),
    removeHandler: jest.fn((channel: string) => {
      this.handlers.delete(channel);
    })
  };

  private handlers = new Map<string, (event: unknown, ...args: any[]) => any>();

  async invoke(channel: string, ...args: any[]): Promise<any> {
    const handler = this.handlers.get(channel);
    if (!handler) {
      throw new Error(`No handler registered for ${channel}`);
    }
    return await handler({}, ...args);
  }
}

function createWorkspaceContext(): WorkspaceUiContext {
  const layout = new DockLayout(createLeaf('root'));
  const workspace = new Workspace('ws', 'Workspace', layout, [
    { id: 'root', title: 'Root Window' }
  ]);
  const manager = new WorkspaceManager([workspace], workspace.id);
  const controller = new TestController();
  const persistence = {
    path: '/tmp/workspaces.json',
    save: jest.fn(),
    load: jest.fn()
  } as unknown as WorkspacePersistence;
  return { manager, controller, persistence };
}

describe('ElectronWorkspaceUi', () => {
  it('creates a browser window and streams workspace state', async () => {
    const context = createWorkspaceContext();
    const host = new TestHost();
    const ui = new ElectronWorkspaceUi(context, host);

    await ui.start();

    expect(host.app.whenReady).toHaveBeenCalled();
    expect(host.createWindow).toHaveBeenCalled();
    expect(host.window.loadURL).toHaveBeenCalledWith(expect.stringContaining('Workspace%20Manager%20Desktop'));
    expect(host.window.show).toHaveBeenCalled();

    const sendCalls = host.window.webContents.send.mock.calls.filter((call) => call[0] === IPC_CHANNELS.state);
    expect(sendCalls.length).toBeGreaterThan(0);
    const latestState = sendCalls[sendCalls.length - 1][1];
    expect(latestState.activeWorkspaceId).toBe('ws');
    expect(latestState.workspaces[0].windows).toHaveLength(1);

    context.manager.getActiveWorkspace()?.addWindow({ id: 'chart', title: 'Chart' });
    await new Promise((resolve) => setImmediate(resolve));

    const updatedState = host.window.webContents.send.mock.calls.pop();
    expect(updatedState?.[1].workspaces[0].windows).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'chart' })])
    );
  });

  it('handles IPC commands for workspace operations', async () => {
    const context = createWorkspaceContext();
    const host = new TestHost();
    const ui = new ElectronWorkspaceUi(context, host);
    await ui.start();

    await host.invoke(IPC_CHANNELS.addWindow, 'ws', { id: 'chart', title: 'Chart' });
    const withChart = context
      .manager
      .getWorkspace('ws')
      ?.getWindows()
      .find((entry) => entry.id === 'chart');
    expect(withChart).toBeDefined();

    await host.invoke(IPC_CHANNELS.focusWindow, 'ws', 'chart');
    expect(context.controller.focusWindow).toHaveBeenCalledWith('chart');

    await host.invoke(IPC_CHANNELS.removeWindow, 'ws', 'chart');
    const withoutChart = context
      .manager
      .getWorkspace('ws')
      ?.getWindows()
      .find((entry) => entry.id === 'chart');
    expect(withoutChart).toBeUndefined();

    await host.invoke(IPC_CHANNELS.controllerWindows);
    expect(context.controller.listWindows).toHaveBeenCalled();

    await ui.stop();
    expect(host.window.close).toHaveBeenCalled();
    expect(host.ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.state);
  });
});

