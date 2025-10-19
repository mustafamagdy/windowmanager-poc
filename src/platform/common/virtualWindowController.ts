import {
  BaseWindowController,
  WindowBounds,
  WindowDescriptor
} from './IWindowController';
import { DockingDirection } from '../../core/docking';
import { WorkspaceSnapshot } from '../../core/workspace';

interface ManagedWindow extends WindowDescriptor {
  bounds: WindowBounds;
}

export interface VirtualWindowControllerState {
  windows: ManagedWindow[];
  focusedWindowId?: string;
  persistedWorkspaces: WorkspaceSnapshot[];
}

const DEFAULT_BOUNDS: WindowBounds = { x: 0, y: 0, width: 640, height: 480 };

export class VirtualWindowController extends BaseWindowController {
  readonly platform: string = 'virtual';

  private readonly windows = new Map<string, ManagedWindow>();
  private focusedWindowId?: string;
  private readonly persistedSnapshots: WorkspaceSnapshot[] = [];

  registerWindow(descriptor: WindowDescriptor, bounds: WindowBounds = DEFAULT_BOUNDS): void {
    this.windows.set(descriptor.id, { ...descriptor, bounds: { ...bounds } });
  }

  unregisterWindow(windowId: string): void {
    this.windows.delete(windowId);
    if (this.focusedWindowId === windowId) {
      this.focusedWindowId = undefined;
    }
  }

  clear(): void {
    this.windows.clear();
    this.focusedWindowId = undefined;
    this.persistedSnapshots.length = 0;
  }

  async listWindows(): Promise<WindowDescriptor[]> {
    return [...this.windows.values()].map(({ id, title }) => ({ id, title }));
  }

  async focusWindow(windowId: string): Promise<void> {
    this.ensureWindow(windowId);
    this.focusedWindowId = windowId;
  }

  async moveWindow(windowId: string, bounds: WindowBounds): Promise<void> {
    const window = this.ensureWindow(windowId);
    window.bounds = { ...bounds };
  }

  async dockWindow(windowId: string, targetId: string, _direction: DockingDirection): Promise<void> {
    this.ensureWindow(windowId);
    this.ensureWindow(targetId);
    // Docking has no physical manifestation in the virtual controller, but we ensure
    // both windows exist to align with the contract.
  }

  async persistWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
    this.persistedSnapshots.push(snapshot);
  }

  getWindowBounds(windowId: string): WindowBounds | undefined {
    return this.windows.get(windowId)?.bounds;
  }

  getState(): VirtualWindowControllerState {
    return {
      windows: [...this.windows.values()].map((window) => ({ ...window, bounds: { ...window.bounds } })),
      focusedWindowId: this.focusedWindowId,
      persistedWorkspaces: [...this.persistedSnapshots]
    };
  }

  private ensureWindow(windowId: string): ManagedWindow {
    const window = this.windows.get(windowId);
    if (!window) {
      throw new Error(`Unknown window '${windowId}'.`);
    }
    return window;
  }
}

export default VirtualWindowController;
