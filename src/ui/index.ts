import { DockLayout, Workspace, WorkspaceManager, createLeaf } from '../core';
import { BaseWindowController } from '../platform/common/IWindowController';
import LinuxController from '../platform/linux/windowController';
import MacController from '../platform/mac/windowController';
import WindowsController from '../platform/win/windowController';
import type { ElectronWorkspaceUiOptions } from './electronWorkspaceUi';
import { WorkspaceUi, WorkspaceUiContext } from './uiTypes';
import { WorkspacePersistence } from './workspacePersistence';

function createDefaultWorkspace(): Workspace {
  const layout = new DockLayout(createLeaf('welcome'));
  const workspace = new Workspace('default', 'Default Workspace', layout, [
    { id: 'welcome', title: 'Welcome' }
  ]);
  return workspace;
}

export interface ApplicationOptions {
  controller?: BaseWindowController;
  persistence?: WorkspacePersistence;
  uiFactory?: WorkspaceUiFactory;
}

export type WorkspaceUiFactory = (
  context: WorkspaceUiContext,
  options?: ElectronWorkspaceUiOptions
) => WorkspaceUi;

export class Application {
  private controller: BaseWindowController;
  private readonly persistence: WorkspacePersistence;
  private workspaceManager?: WorkspaceManager;
  private readonly workspaceCleanup = new Map<string, () => void>();
  private readonly uiFactory?: WorkspaceUiFactory;
  private ui?: WorkspaceUi;

  constructor(platform: NodeJS.Platform, options: ApplicationOptions = {}) {
    this.controller = options.controller ?? this.createController(platform);
    this.persistence = options.persistence ?? new WorkspacePersistence();
    this.uiFactory = options.uiFactory;
  }

  get workspace(): Workspace {
    const manager = this.getWorkspaceManager();
    const workspace = manager.getActiveWorkspace();
    if (!workspace) {
      throw new Error('No active workspace configured.');
    }
    return workspace;
  }

  getWorkspaceManager(): WorkspaceManager {
    if (!this.workspaceManager) {
      throw new Error('Application has not been bootstrapped yet.');
    }
    return this.workspaceManager;
  }

  private createController(platform: NodeJS.Platform): BaseWindowController {
    switch (platform) {
      case 'darwin':
        return new MacController();
      case 'win32':
        return new WindowsController();
      default:
        return new LinuxController();
    }
  }

  async bootstrap(): Promise<void> {
    await this.controller.initialize();
    const manager = await this.loadWorkspaceManager();
    this.registerWorkspaceManager(manager);
    const activeWorkspace = manager.getActiveWorkspace();
    if (activeWorkspace) {
      await this.controller.persistWorkspace(activeWorkspace.serialize());
    }
    await this.persistence.save(manager.serialize());
  }

  private async loadWorkspaceManager(): Promise<WorkspaceManager> {
    const snapshot = await this.persistence.load();
    if (snapshot) {
      return WorkspaceManager.deserialize(snapshot);
    }

    const workspace = createDefaultWorkspace();
    return new WorkspaceManager([workspace], workspace.id);
  }

  private registerWorkspaceManager(manager: WorkspaceManager): void {
    this.workspaceManager = manager;
    manager.getWorkspaces().forEach((workspace) => this.registerWorkspace(workspace));

    manager.on('workspace-added', (workspace) => {
      this.registerWorkspace(workspace);
      this.persistState();
    });

    manager.on('workspace-removed', (workspaceId) => {
      this.unregisterWorkspace(workspaceId);
      this.persistState();
    });

    manager.on('active-workspace-changed', () => {
      const activeWorkspace = manager.getActiveWorkspace();
      if (activeWorkspace) {
        void this.controller
          .persistWorkspace(activeWorkspace.serialize())
          .catch((error) => this.reportError('persisting active workspace', error));
      }
      this.persistState();
    });
  }

  private registerWorkspace(workspace: Workspace): void {
    const listener = () => {
      if (this.getWorkspaceManager().getActiveWorkspace()?.id === workspace.id) {
        void this.controller
          .persistWorkspace(workspace.serialize())
          .catch((error) => this.reportError('persisting active workspace', error));
      }
      this.persistState();
    };

    workspace.on('window-added', listener);
    workspace.on('window-removed', listener);
    workspace.on('window-docked', listener);
    workspace.on('active-window-changed', listener);

    this.workspaceCleanup.set(workspace.id, () => {
      workspace.off('window-added', listener);
      workspace.off('window-removed', listener);
      workspace.off('window-docked', listener);
      workspace.off('active-window-changed', listener);
    });
  }

  private unregisterWorkspace(workspaceId: string): void {
    const cleanup = this.workspaceCleanup.get(workspaceId);
    if (cleanup) {
      cleanup();
      this.workspaceCleanup.delete(workspaceId);
    }
  }

  private persistState(): void {
    const manager = this.workspaceManager;
    if (!manager) {
      return;
    }
    void this.persistence
      .save(manager.serialize())
      .catch((error) => this.reportError('saving workspace state', error));
  }

  private reportError(context: string, error: unknown): void {
    console.error(`Workspace manager error while ${context}:`, error);
  }

  async launchUi(options?: ElectronWorkspaceUiOptions): Promise<void> {
    const manager = this.workspaceManager;
    if (!manager) {
      throw new Error('Application has not been bootstrapped yet.');
    }
    if (!this.ui) {
      const context: WorkspaceUiContext = {
        manager,
        controller: this.controller,
        persistence: this.persistence
      };
      if (this.uiFactory) {
        this.ui = this.uiFactory(context, options);
      } else {
        const [{ ElectronWorkspaceUi }, { DefaultElectronHost }] = await Promise.all([
          import('./electronWorkspaceUi'),
          import('./electronHost')
        ]);
        const host = new DefaultElectronHost();
        this.ui = new ElectronWorkspaceUi(context, host, options);
      }
    }
    await this.ui.start();
  }
}

if (require.main === module) {
  const app = new Application(process.platform);
  app
    .bootstrap()
    .then(() => app.launchUi())
    .catch((error) => {
      console.error('Failed to start window manager PoC', error);
      process.exitCode = 1;
    });
}

export { WorkspacePersistence };
export { ElectronWorkspaceUi } from './electronWorkspaceUi';
export type { WorkspaceUiContext, WorkspaceUi } from './uiTypes';
export type { ElectronWorkspaceUiOptions, ElectronHost, ElectronBrowserWindow } from './electronWorkspaceUi';
