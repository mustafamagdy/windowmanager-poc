export type DockSplitDirection = 'horizontal' | 'vertical';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DockPlacement {
  id: string;
  bounds: Rect;
}

export interface SerializedDockLeaf {
  kind: 'leaf';
  id: string;
}

export interface SerializedDockSplit {
  kind: 'split';
  direction: DockSplitDirection;
  ratio: number;
  first: SerializedDockNode;
  second: SerializedDockNode;
}

export type SerializedDockNode = SerializedDockLeaf | SerializedDockSplit;

export interface DockLeaf {
  kind: 'leaf';
  id: string;
}

export interface DockSplit {
  kind: 'split';
  direction: DockSplitDirection;
  ratio: number;
  first: DockNode;
  second: DockNode;
}

export type DockNode = DockLeaf | DockSplit;

export class DockLayout {
  constructor(public readonly root: DockNode) {}

  computePlacements(bounds: Rect): DockPlacement[] {
    const placements: DockPlacement[] = [];
    this.walk(this.root, bounds, placements);
    return placements;
  }

  private walk(node: DockNode, bounds: Rect, output: DockPlacement[]): void {
    if (node.kind === 'leaf') {
      output.push({ id: node.id, bounds });
      return;
    }

    const ratio = this.clampRatio(node.ratio);
    if (node.direction === 'horizontal') {
      const firstWidth = Math.round(bounds.width * ratio);
      const secondWidth = bounds.width - firstWidth;
      const firstBounds: Rect = {
        x: bounds.x,
        y: bounds.y,
        width: firstWidth,
        height: bounds.height
      };
      const secondBounds: Rect = {
        x: bounds.x + firstWidth,
        y: bounds.y,
        width: secondWidth,
        height: bounds.height
      };
      this.walk(node.first, firstBounds, output);
      this.walk(node.second, secondBounds, output);
    } else {
      const firstHeight = Math.round(bounds.height * ratio);
      const secondHeight = bounds.height - firstHeight;
      const firstBounds: Rect = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: firstHeight
      };
      const secondBounds: Rect = {
        x: bounds.x,
        y: bounds.y + firstHeight,
        width: bounds.width,
        height: secondHeight
      };
      this.walk(node.first, firstBounds, output);
      this.walk(node.second, secondBounds, output);
    }
  }

  serialize(): SerializedDockNode {
    return DockLayout.serializeNode(this.root);
  }

  static serializeNode(node: DockNode): SerializedDockNode {
    if (node.kind === 'leaf') {
      return { kind: 'leaf', id: node.id };
    }

    return {
      kind: 'split',
      direction: node.direction,
      ratio: DockLayout.clampRatio(node.ratio),
      first: DockLayout.serializeNode(node.first),
      second: DockLayout.serializeNode(node.second)
    };
  }

  static deserialize(serialized: SerializedDockNode): DockLayout {
    return new DockLayout(DockLayout.deserializeNode(serialized));
  }

  static deserializeNode(serialized: SerializedDockNode): DockNode {
    if (serialized.kind === 'leaf') {
      return { kind: 'leaf', id: serialized.id };
    }

    return {
      kind: 'split',
      direction: serialized.direction,
      ratio: DockLayout.clampRatio(serialized.ratio),
      first: DockLayout.deserializeNode(serialized.first),
      second: DockLayout.deserializeNode(serialized.second)
    };
  }

  private static clampRatio(value: number): number {
    if (!Number.isFinite(value)) {
      return 0.5;
    }
    return Math.min(0.9, Math.max(0.1, value));
  }

  private clampRatio(value: number): number {
    return DockLayout.clampRatio(value);
  }
}

export function createSplit(
  direction: DockSplitDirection,
  ratio: number,
  first: DockNode,
  second: DockNode
): DockSplit {
  return {
    kind: 'split',
    direction,
    ratio,
    first,
    second
  };
}

export function createLeaf(id: string): DockLeaf {
  return { kind: 'leaf', id };
}
