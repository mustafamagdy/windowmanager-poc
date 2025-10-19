import { DockingDirection } from '../../core/docking';
import { WorkspaceSnapshot } from '../../core/workspace';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowDescriptor {
  id: string;
  title: string;
}

export interface IWindowController {
  readonly platform: string;

  initialize(): Promise<void>;

  listWindows(): Promise<WindowDescriptor[]>;

  focusWindow(windowId: string): Promise<void>;

  moveWindow(windowId: string, bounds: WindowBounds): Promise<void>;

  dockWindow(windowId: string, targetId: string, direction: DockingDirection): Promise<void>;

  persistWorkspace(snapshot: WorkspaceSnapshot): Promise<void>;
}

export abstract class BaseWindowController implements IWindowController {
  abstract readonly platform: string;

  async initialize(): Promise<void> {
    // Default implementation is a no-op for proof-of-concept builds.
  }

  async listWindows(): Promise<WindowDescriptor[]> {
    return [];
  }

  async focusWindow(_windowId: string): Promise<void> {}

  async moveWindow(_windowId: string, _bounds: WindowBounds): Promise<void> {}

  async dockWindow(
    _windowId: string,
    _targetId: string,
    _direction: DockingDirection
  ): Promise<void> {}

  async persistWorkspace(_snapshot: WorkspaceSnapshot): Promise<void> {}
}
