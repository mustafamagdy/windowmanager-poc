import type { BrowserWindowConstructorOptions } from 'electron';
import type { DockLayout, Rect } from '../core/layout';
import type { Workspace } from '../core/workspace';
import type { WorkspaceManager } from '../core/workspaceManager';
import { WorkspaceUi, WorkspaceUiContext } from './uiTypes';

export interface ElectronBrowserWindow {
  loadURL(url: string): Promise<void> | void;
  show(): void;
  focus(): void;
  close(): void;
  on(event: 'closed', listener: () => void): void;
  isDestroyed(): boolean;
  webContents: {
    send(channel: string, payload: unknown): void;
  };
}

export interface ElectronHost {
  app: {
    whenReady(): Promise<void>;
    on(event: 'activate' | 'window-all-closed', listener: () => void): void;
    quit(): void;
  };
  createWindow(options: BrowserWindowConstructorOptions): ElectronBrowserWindow;
  ipcMain: {
    handle(channel: string, handler: (event: unknown, ...args: any[]) => any): void;
    removeHandler(channel: string): void;
  };
  platform: NodeJS.Platform;
}

export interface ElectronWorkspaceUiOptions {
  window?: BrowserWindowConstructorOptions;
  previewSurface?: Rect;
}

interface WorkspaceSummary {
  id: string;
  name: string;
  windows: ReturnType<Workspace['getWindows']>;
  activeWindowId?: string;
  layout: DockLayout['root'];
  relationships: ReturnType<Workspace['listRelationships']>;
  placements: {
    id: string;
    bounds: Rect;
  }[];
}

interface ApplicationState {
  activeWorkspaceId: string | null;
  workspaces: WorkspaceSummary[];
  controllerWindows: { id: string; title: string }[];
}

type WorkspaceEvent = 'window-added' | 'window-removed' | 'window-docked' | 'active-window-changed';

const DEFAULT_PREVIEW_SURFACE: Rect = { x: 0, y: 0, width: 1200, height: 800 };

const IPC_CHANNELS = {
  state: 'workspace:state',
  activateWorkspace: 'workspace:activate',
  addWindow: 'workspace:add-window',
  focusWindow: 'workspace:focus-window',
  removeWindow: 'workspace:remove-window',
  dockWindow: 'workspace:dock-window',
  controllerWindows: 'controller:list-windows'
} as const;

export class ElectronWorkspaceUi implements WorkspaceUi {
  private window?: ElectronBrowserWindow;
  private started = false;
  private readonly previewSurface: Rect;
  private readonly workspaceListeners = new Map<string, () => void>();
  private readonly managerListeners: Array<() => void> = [];

  constructor(
    private readonly context: WorkspaceUiContext,
    private readonly host: ElectronHost,
    private readonly options: ElectronWorkspaceUiOptions = {}
  ) {
    this.previewSurface = options.previewSurface ?? DEFAULT_PREVIEW_SURFACE;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    await this.host.app.whenReady();
    this.registerManagerListeners(this.context.manager);
    this.registerWorkspaceListeners();
    this.registerIpcHandlers();
    await this.ensureWindow();
    await this.pushState();
  }

  async stop(): Promise<void> {
    this.started = false;
    this.managerListeners.splice(0).forEach((dispose) => dispose());
    this.workspaceListeners.forEach((dispose) => dispose());
    this.workspaceListeners.clear();
    this.unregisterIpcHandlers();
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
    }
    this.window = undefined;
  }

  private registerManagerListeners(manager: WorkspaceManager): void {
    const onWorkspaceAdded = (workspace: Workspace) => {
      this.attachWorkspace(workspace);
      void this.pushState();
    };
    const onWorkspaceRemoved = (workspaceId: string) => {
      this.detachWorkspace(workspaceId);
      void this.pushState();
    };
    const onActiveWorkspaceChanged = () => {
      void this.pushState();
    };

    manager.on('workspace-added', onWorkspaceAdded);
    manager.on('workspace-removed', onWorkspaceRemoved);
    manager.on('active-workspace-changed', onActiveWorkspaceChanged);

    this.managerListeners.push(() => manager.off('workspace-added', onWorkspaceAdded));
    this.managerListeners.push(() => manager.off('workspace-removed', onWorkspaceRemoved));
    this.managerListeners.push(() => manager.off('active-workspace-changed', onActiveWorkspaceChanged));
  }

  private registerWorkspaceListeners(): void {
    this.context.manager.getWorkspaces().forEach((workspace) => this.attachWorkspace(workspace));
  }

  private attachWorkspace(workspace: Workspace): void {
    const listener = () => {
      void this.pushState();
    };
    const events: WorkspaceEvent[] = [
      'window-added',
      'window-removed',
      'window-docked',
      'active-window-changed'
    ];
    events.forEach((event) => workspace.on(event, listener));
    this.workspaceListeners.set(workspace.id, () => {
      events.forEach((event) => workspace.off(event, listener));
    });
  }

  private detachWorkspace(workspaceId: string): void {
    const cleanup = this.workspaceListeners.get(workspaceId);
    if (cleanup) {
      cleanup();
      this.workspaceListeners.delete(workspaceId);
    }
  }

  private registerIpcHandlers(): void {
    this.host.ipcMain.handle(IPC_CHANNELS.state, async () => this.buildState());
    this.host.ipcMain.handle(IPC_CHANNELS.activateWorkspace, async (_event, workspaceId: string) => {
      const workspace = this.context.manager.getWorkspace(workspaceId);
      if (!workspace) {
        throw new Error(`Unknown workspace '${workspaceId}'.`);
      }
      this.context.manager.setActiveWorkspace(workspaceId);
      await this.pushState();
      return { ok: true };
    });
    this.host.ipcMain.handle(
      IPC_CHANNELS.addWindow,
      async (_event, workspaceId: string, window: { id: string; title: string; metadata?: Record<string, unknown> }) => {
        const workspace = this.ensureWorkspace(workspaceId);
        workspace.addWindow(window);
        await this.pushState();
        return { ok: true };
      }
    );
    this.host.ipcMain.handle(
      IPC_CHANNELS.focusWindow,
      async (_event, workspaceId: string, windowId: string) => {
        const workspace = this.ensureWorkspace(workspaceId);
        const window = workspace.getWindows().find((entry) => entry.id === windowId);
        if (!window) {
          throw new Error(`Unknown window '${windowId}'.`);
        }
        workspace.setActiveWindow(window.id);
        await this.context.controller.focusWindow(window.id).catch((error) => {
          console.warn('Failed to focus window via controller:', error);
        });
        await this.pushState();
        return { ok: true };
      }
    );
    this.host.ipcMain.handle(
      IPC_CHANNELS.removeWindow,
      async (_event, workspaceId: string, windowId: string) => {
        const workspace = this.ensureWorkspace(workspaceId);
        workspace.removeWindow(windowId);
        await this.pushState();
        return { ok: true };
      }
    );
    this.host.ipcMain.handle(
      IPC_CHANNELS.dockWindow,
      async (
        _event,
        workspaceId: string,
        params: { targetWindowId: string; windowId: string; direction: 'left' | 'right' | 'top' | 'bottom'; ratio?: number }
      ) => {
        const workspace = this.ensureWorkspace(workspaceId);
        const window = workspace.getWindows().find((entry) => entry.id === params.windowId);
        if (!window) {
          throw new Error(`Unknown window '${params.windowId}'.`);
        }
        workspace.dock({
          window,
          targetWindowId: params.targetWindowId,
          direction: params.direction,
          ratio: params.ratio
        });
        await this.pushState();
        return { ok: true };
      }
    );
    this.host.ipcMain.handle(IPC_CHANNELS.controllerWindows, async () => {
      return await this.context.controller.listWindows();
    });
  }

  private unregisterIpcHandlers(): void {
    Object.values(IPC_CHANNELS).forEach((channel) => this.host.ipcMain.removeHandler(channel));
  }

  private ensureWorkspace(workspaceId: string): Workspace {
    const workspace = this.context.manager.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`Unknown workspace '${workspaceId}'.`);
    }
    return workspace;
  }

  private async ensureWindow(): Promise<void> {
    if (this.window && !this.window.isDestroyed()) {
      return;
    }

    const options: BrowserWindowConstructorOptions = {
      width: 1280,
      height: 800,
      show: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      },
      ...this.options.window
    };

    this.window = this.host.createWindow(options);
    this.window.on('closed', () => {
      this.window = undefined;
    });

    this.host.app.on('activate', () => {
      if (!this.window) {
        void this.ensureWindow();
      } else {
        this.window.focus();
      }
    });

    this.host.app.on('window-all-closed', () => {
      if (this.host.platform !== 'darwin') {
        this.host.app.quit();
      }
    });

    await this.window.loadURL(this.renderHtml(await this.buildState()));
    this.window.show();
    this.window.focus();
  }

  private async pushState(): Promise<void> {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }
    try {
      const state = await this.buildState();
      this.window.webContents.send(IPC_CHANNELS.state, state);
    } catch (error) {
      console.warn('Failed to push workspace state to renderer:', error);
    }
  }

  private async buildState(): Promise<ApplicationState> {
    const workspaces = this.context
      .manager
      .getWorkspaces()
      .map((workspace) => this.serializeWorkspace(workspace));
    const activeWorkspaceId = this.context.manager.getActiveWorkspace()?.id ?? null;
    let controllerWindows: { id: string; title: string }[] = [];
    try {
      controllerWindows = await this.context.controller.listWindows();
    } catch (error) {
      console.warn('Failed to enumerate controller windows:', error);
    }
    return { activeWorkspaceId, workspaces, controllerWindows };
  }

  private serializeWorkspace(workspace: Workspace): WorkspaceSummary {
    const layout = workspace.getLayout();
    const placements = layout.computePlacements(this.previewSurface).map((placement) => ({
      id: placement.id,
      bounds: { ...placement.bounds }
    }));
    return {
      id: workspace.id,
      name: workspace.name,
      windows: workspace.getWindows().map((window) => ({ ...window })),
      activeWindowId: workspace.getActiveWindow()?.id,
      layout: layout.root,
      relationships: workspace.listRelationships(),
      placements
    };
  }

  private renderHtml(state: ApplicationState): string {
    const serialized = JSON.stringify(state);
    const styles = this.renderStyles();
    return `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Workspace Manager Desktop</title>
    <style>${styles}</style>
  </head>
  <body>
    <div id="app"></div>
    <script>
      const { ipcRenderer } = require('electron');
      const state = ${serialized};
      const IPC = ${JSON.stringify(IPC_CHANNELS)};

      function render(data) {
        const container = document.getElementById('app');
        container.innerHTML = '';
        const workspaces = document.createElement('div');
        workspaces.className = 'workspace-list';
        const header = document.createElement('h1');
        header.textContent = 'Workspaces';
        workspaces.appendChild(header);
        data.workspaces.forEach((ws) => {
          const card = document.createElement('div');
          card.className = 'workspace-card';
          if (ws.id === data.activeWorkspaceId) {
            card.classList.add('active');
          }
          const title = document.createElement('div');
          title.className = 'workspace-title';
          title.textContent = ws.name + ' (' + ws.id + ')';
          card.appendChild(title);
          const button = document.createElement('button');
          button.textContent = ws.id === data.activeWorkspaceId ? 'Active' : 'Activate';
          button.disabled = ws.id === data.activeWorkspaceId;
          button.onclick = () => ipcRenderer.invoke(IPC.activateWorkspace, ws.id);
          card.appendChild(button);
          workspaces.appendChild(card);
        });

        const activeWorkspace = data.workspaces.find((ws) => ws.id === data.activeWorkspaceId);
        const detail = document.createElement('div');
        detail.className = 'workspace-detail';
        if (!activeWorkspace) {
          detail.textContent = 'Select a workspace to view windows.';
        } else {
          const title = document.createElement('h2');
          title.textContent = 'Windows';
          detail.appendChild(title);
          const list = document.createElement('ul');
          list.className = 'window-list';
          activeWorkspace.windows.forEach((win) => {
            const item = document.createElement('li');
            item.textContent = win.title + ' (' + win.id + ')';
            if (win.id === activeWorkspace.activeWindowId) {
              item.classList.add('active');
            }
            list.appendChild(item);
          });
          detail.appendChild(list);
          const layout = document.createElement('div');
          layout.className = 'layout-preview';
          activeWorkspace.placements.forEach((placement) => {
            const panel = document.createElement('div');
            panel.className = 'layout-panel';
            panel.style.left = (placement.bounds.x / ${this.previewSurface.width} * 100) + '%';
            panel.style.top = (placement.bounds.y / ${this.previewSurface.height} * 100) + '%';
            panel.style.width = (placement.bounds.width / ${this.previewSurface.width} * 100) + '%';
            panel.style.height = (placement.bounds.height / ${this.previewSurface.height} * 100) + '%';
            panel.textContent = placement.id;
            if (placement.id === activeWorkspace.activeWindowId) {
              panel.classList.add('active');
            }
            layout.appendChild(panel);
          });
          detail.appendChild(layout);
        }

        const controllerSection = document.createElement('div');
        controllerSection.className = 'controller-section';
        const controllerHeader = document.createElement('h2');
        controllerHeader.textContent = 'Platform Windows';
        controllerSection.appendChild(controllerHeader);
        if (!data.controllerWindows.length) {
          const empty = document.createElement('div');
          empty.className = 'empty';
          empty.textContent = 'No controller windows registered.';
          controllerSection.appendChild(empty);
        } else {
          const list = document.createElement('ul');
          data.controllerWindows.forEach((win) => {
            const item = document.createElement('li');
            item.textContent = win.title + ' (' + win.id + ')';
            list.appendChild(item);
          });
          controllerSection.appendChild(list);
        }

        container.appendChild(workspaces);
        container.appendChild(detail);
        container.appendChild(controllerSection);
      }

      ipcRenderer.on(IPC.state, (_event, next) => render(next));
      render(state);
    </script>
  </body>
</html>`)} `;
  }

  private renderStyles(): string {
    return `body { font-family: sans-serif; margin: 0; padding: 20px; background: #121417; color: #f5f6f7; }
#app { display: grid; grid-template-columns: 260px 1fr 260px; gap: 16px; height: calc(100vh - 40px); }
.workspace-list, .workspace-detail, .controller-section { background: #1d2126; border-radius: 8px; padding: 16px; overflow: auto; }
.workspace-title { font-weight: 600; margin-bottom: 8px; }
.workspace-card { border: 1px solid #2b313a; border-radius: 6px; padding: 12px; margin-bottom: 12px; }
.workspace-card.active { border-color: #5b8def; box-shadow: 0 0 0 1px rgba(91, 141, 239, 0.4); }
.workspace-card button { margin-top: 8px; width: 100%; padding: 6px 0; }
.window-list { list-style: none; padding: 0; margin: 0; }
.window-list li { padding: 6px 8px; border-bottom: 1px solid #2b313a; }
.window-list li.active { background: rgba(91, 141, 239, 0.15); }
.layout-preview { position: relative; flex: 1; min-height: 240px; background: #111417; border: 1px solid #2b313a; border-radius: 6px; margin-top: 16px; }
.layout-panel { position: absolute; border: 1px solid #5b8def; display: flex; align-items: center; justify-content: center; font-size: 12px; text-transform: uppercase; background: rgba(91, 141, 239, 0.12); }
.layout-panel.active { background: rgba(91, 141, 239, 0.3); }
.controller-section ul { list-style: none; padding: 0; margin: 0; }
.controller-section li { padding: 6px 8px; border-bottom: 1px solid #2b313a; }
.empty { color: #8b919c; font-style: italic; }`;
  }
}

export { IPC_CHANNELS };

