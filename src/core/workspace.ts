import EventEmitter from 'eventemitter3';
import {
  DockLayout,
  DockNode,
  SerializedDockNode,
  createLeaf,
  createSplit
} from './layout';

export type DockingDirection = 'left' | 'right' | 'top' | 'bottom' | 'tab';

export interface WindowState {
  id: string;
  title: string;
  metadata?: Record<string, unknown>;
}

export interface DockingRelationship {
  sourceWindowId: string;
  targetWindowId: string;
  direction: DockingDirection;
}

export interface WorkspaceSnapshot {
  id: string;
  name: string;
  layout: SerializedDockNode;
  windows: WindowState[];
  activeWindowId?: string;
  relationships: DockingRelationship[];
}

export interface DockRequest {
  window: WindowState;
  targetWindowId: string;
  direction: DockingDirection;
  ratio?: number;
}

export class Workspace extends EventEmitter {
  private layout: DockLayout;
  private readonly windows = new Map<string, WindowState>();
  private readonly relationships = new Set<string>();
  private activeWindowId?: string;

  constructor(
    public readonly id: string,
    public name: string,
    layout: DockLayout,
    initialWindows: WindowState[] = [],
    activeWindowId?: string,
    relationships: DockingRelationship[] = []
  ) {
    super();
    this.layout = layout;
    initialWindows.forEach((window) => this.windows.set(window.id, window));
    this.activeWindowId = activeWindowId ?? initialWindows[0]?.id;
    relationships.forEach((relationship) =>
      this.relationships.add(Workspace.serializeRelationshipKey(relationship))
    );
  }

  getLayout(): DockLayout {
    return this.layout;
  }

  getWindows(): WindowState[] {
    return [...this.windows.values()];
  }

  getActiveWindow(): WindowState | undefined {
    return this.activeWindowId ? this.windows.get(this.activeWindowId) : undefined;
  }

  setActiveWindow(windowId: string | undefined): void {
    if (windowId && !this.windows.has(windowId)) {
      throw new Error(`Cannot activate unknown window '${windowId}'.`);
    }
    this.activeWindowId = windowId;
    this.emit('active-window-changed', windowId);
  }

  addWindow(window: WindowState, targetWindowId?: string): void {
    if (this.windows.has(window.id)) {
      throw new Error(`Window '${window.id}' already exists in workspace.`);
    }
    this.windows.set(window.id, window);
    if (!this.activeWindowId) {
      this.activeWindowId = window.id;
    }
    if (!targetWindowId) {
      // If no docking target is provided, append as a floating leaf root.
      const newLeaf = createLeaf(window.id);
      const newRoot = createSplit('horizontal', 0.5, this.layout.root, newLeaf);
      this.layout = new DockLayout(newRoot);
    }
    this.emit('window-added', window);
  }

  removeWindow(windowId: string): void {
    if (!this.windows.delete(windowId)) {
      return;
    }

    if (this.activeWindowId === windowId) {
      this.activeWindowId = this.windows.size > 0 ? this.getWindows()[0].id : undefined;
    }

    this.pruneLayout(windowId);
    this.removeRelationshipsFor(windowId);
    this.emit('window-removed', windowId);
  }

  dock(request: DockRequest): void {
    const { window, targetWindowId, direction } = request;
    const ratio = request.ratio ?? 0.5;
    if (!this.windows.has(targetWindowId)) {
      throw new Error(`Cannot dock relative to unknown window '${targetWindowId}'.`);
    }

    if (!this.windows.has(window.id)) {
      this.windows.set(window.id, window);
    }

    const newRoot = dockLeaf(this.layout.root, targetWindowId, window.id, direction, ratio);
    if (!newRoot) {
      throw new Error(`Unable to dock window '${window.id}' relative to '${targetWindowId}'.`);
    }
    this.layout = new DockLayout(newRoot);

    const relationship: DockingRelationship = {
      sourceWindowId: window.id,
      targetWindowId,
      direction
    };
    this.relationships.add(Workspace.serializeRelationshipKey(relationship));
    this.emit('window-docked', relationship);
  }

  listRelationships(): DockingRelationship[] {
    return [...this.relationships].map(Workspace.deserializeRelationshipKey);
  }

  serialize(): WorkspaceSnapshot {
    return {
      id: this.id,
      name: this.name,
      layout: this.layout.serialize(),
      windows: this.getWindows(),
      activeWindowId: this.activeWindowId,
      relationships: this.listRelationships()
    };
  }

  static deserialize(snapshot: WorkspaceSnapshot): Workspace {
    const layout = DockLayout.deserialize(snapshot.layout);
    return new Workspace(
      snapshot.id,
      snapshot.name,
      layout,
      snapshot.windows,
      snapshot.activeWindowId,
      snapshot.relationships
    );
  }

  private pruneLayout(windowId: string): void {
    const [prunedRoot, pruned] = pruneLeaf(this.layout.root, windowId);
    if (pruned && prunedRoot) {
      this.layout = new DockLayout(prunedRoot);
    }
  }

  private removeRelationshipsFor(windowId: string): void {
    for (const key of this.relationships) {
      const relationship = Workspace.deserializeRelationshipKey(key);
      if (relationship.sourceWindowId === windowId || relationship.targetWindowId === windowId) {
        this.relationships.delete(key);
      }
    }
  }

  private static serializeRelationshipKey(relationship: DockingRelationship): string {
    return `${relationship.sourceWindowId}->${relationship.direction}->${relationship.targetWindowId}`;
  }

  private static deserializeRelationshipKey(key: string): DockingRelationship {
    const [sourceWindowId, direction, targetWindowId] = key.split('->') as [
      string,
      DockingDirection,
      string
    ];
    return { sourceWindowId, direction, targetWindowId };
  }
}

function dockLeaf(
  root: DockNode,
  targetId: string,
  newId: string,
  direction: DockingDirection,
  ratio: number
): DockNode | undefined {
  if (root.kind === 'leaf') {
    if (root.id !== targetId) {
      return undefined;
    }

    if (direction === 'tab') {
      // Tab docking is modelled as reusing the same leaf; we keep layout unchanged.
      return root;
    }

    const newLeaf = createLeaf(newId);
    const splitDirection = direction === 'left' || direction === 'right' ? 'horizontal' : 'vertical';
    const isFirst = direction === 'left' || direction === 'top';

    return isFirst
      ? createSplit(splitDirection, ratio, newLeaf, root)
      : createSplit(splitDirection, ratio, root, newLeaf);
  }

  const updatedFirst = dockLeaf(root.first, targetId, newId, direction, ratio);
  if (updatedFirst) {
    return { ...root, first: updatedFirst };
  }
  const updatedSecond = dockLeaf(root.second, targetId, newId, direction, ratio);
  if (updatedSecond) {
    return { ...root, second: updatedSecond };
  }
  return undefined;
}

function pruneLeaf(root: DockNode, leafId: string): [DockNode | undefined, boolean] {
  if (root.kind === 'leaf') {
    if (root.id === leafId) {
      return [undefined, true];
    }
    return [root, false];
  }

  const [first, firstPruned] = pruneLeaf(root.first, leafId);
  const [second, secondPruned] = pruneLeaf(root.second, leafId);

  if (!first && !second) {
    return [undefined, firstPruned || secondPruned];
  }

  if (!first) {
    return [second, true];
  }

  if (!second) {
    return [first, true];
  }

  if (firstPruned || secondPruned) {
    const ratio = Math.min(0.9, Math.max(0.1, root.ratio));
    return [
      {
        kind: 'split',
        direction: root.direction,
        ratio,
        first,
        second
      },
      true
    ];
  }

  return [root, false];
}
