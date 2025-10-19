import EventEmitter from 'eventemitter3';
import { DockLayout } from './layout';
import { Workspace, WorkspaceSnapshot, WindowState } from './workspace';

export interface WorkspaceCollectionSnapshot {
  activeWorkspaceId?: string;
  workspaces: WorkspaceSnapshot[];
}

interface WorkspaceManagerEvents {
  'workspace-added': Workspace;
  'workspace-removed': string;
  'active-workspace-changed': string | undefined;
}

export class WorkspaceManager extends EventEmitter<WorkspaceManagerEvents> {
  private readonly workspaces = new Map<string, Workspace>();
  private activeWorkspaceId?: string;

  constructor(initialWorkspaces: Workspace[] = [], activeWorkspaceId?: string) {
    super();
    initialWorkspaces.forEach((workspace) => {
      this.assertWorkspaceNotRegistered(workspace.id);
      this.workspaces.set(workspace.id, workspace);
    });

    if (activeWorkspaceId) {
      if (!this.workspaces.has(activeWorkspaceId)) {
        throw new Error(`Unknown active workspace '${activeWorkspaceId}'.`);
      }
      this.activeWorkspaceId = activeWorkspaceId;
    } else if (initialWorkspaces.length > 0) {
      this.activeWorkspaceId = initialWorkspaces[0].id;
    }
  }

  getWorkspace(id: string): Workspace | undefined {
    return this.workspaces.get(id);
  }

  getWorkspaces(): Workspace[] {
    return [...this.workspaces.values()];
  }

  getActiveWorkspace(): Workspace | undefined {
    return this.activeWorkspaceId ? this.workspaces.get(this.activeWorkspaceId) : undefined;
  }

  setActiveWorkspace(workspaceId: string | undefined): void {
    if (workspaceId && !this.workspaces.has(workspaceId)) {
      throw new Error(`Cannot activate unknown workspace '${workspaceId}'.`);
    }
    this.updateActiveWorkspace(workspaceId);
  }

  addWorkspace(workspace: Workspace, options: { activate?: boolean } = {}): void {
    this.assertWorkspaceNotRegistered(workspace.id);
    this.workspaces.set(workspace.id, workspace);
    this.emit('workspace-added', workspace);

    if (options.activate || !this.activeWorkspaceId) {
      this.updateActiveWorkspace(workspace.id);
    }
  }

  removeWorkspace(workspaceId: string): void {
    if (!this.workspaces.has(workspaceId)) {
      return;
    }

    this.workspaces.delete(workspaceId);
    this.emit('workspace-removed', workspaceId);

    if (this.activeWorkspaceId === workspaceId) {
      const nextActive = this.workspaces.keys().next();
      this.updateActiveWorkspace(nextActive.done ? undefined : nextActive.value);
    }
  }

  serialize(): WorkspaceCollectionSnapshot {
    return {
      activeWorkspaceId: this.activeWorkspaceId,
      workspaces: [...this.workspaces.values()].map((workspace) => workspace.serialize())
    };
  }

  static deserialize(snapshot: WorkspaceCollectionSnapshot): WorkspaceManager {
    const workspaces = snapshot.workspaces.map((workspaceSnapshot) =>
      Workspace.deserialize(workspaceSnapshot)
    );
    return new WorkspaceManager(workspaces, snapshot.activeWorkspaceId);
  }

  private updateActiveWorkspace(workspaceId: string | undefined): void {
    if (this.activeWorkspaceId === workspaceId) {
      return;
    }
    this.activeWorkspaceId = workspaceId;
    this.emit('active-workspace-changed', workspaceId);
  }

  private assertWorkspaceNotRegistered(workspaceId: string): void {
    if (this.workspaces.has(workspaceId)) {
      throw new Error(`Workspace '${workspaceId}' is already registered.`);
    }
  }
}

export function createWorkspaceFromLayout(
  id: string,
  name: string,
  layout: DockLayout,
  initialWindows: WindowState[] = [],
  activeWindowId?: string
): Workspace {
  return new Workspace(id, name, layout, initialWindows, activeWindowId);
}
