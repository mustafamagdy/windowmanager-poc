import { DockLayout, Workspace, WorkspaceManager, createLeaf } from '../core';
import { BaseWindowController } from '../platform/common/IWindowController';
import LinuxController from '../platform/linux/windowController';
import MacController from '../platform/mac/windowController';
import WindowsController from '../platform/win/windowController';

function createDefaultWorkspace(): Workspace {
  const layout = new DockLayout(createLeaf('welcome'));
  const workspace = new Workspace('default', 'Default Workspace', layout, [
    { id: 'welcome', title: 'Welcome' }
  ]);
  return workspace;
}

export class Application {
  private controller: BaseWindowController;
  readonly workspaceManager: WorkspaceManager;

  constructor(platform: NodeJS.Platform) {
    this.controller = this.createController(platform);
    const workspace = createDefaultWorkspace();
    this.workspaceManager = new WorkspaceManager([workspace], workspace.id);
  }

  get workspace(): Workspace {
    const workspace = this.workspaceManager.getActiveWorkspace();
    if (!workspace) {
      throw new Error('No active workspace configured.');
    }
    return workspace;
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
    const snapshot = this.workspace.serialize();
    await this.controller.persistWorkspace(snapshot);
  }
}

if (require.main === module) {
  const app = new Application(process.platform);
  app.bootstrap().catch((error) => {
    console.error('Failed to start window manager PoC', error);
    process.exitCode = 1;
  });
}
