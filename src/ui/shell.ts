import readline from 'node:readline';
import { WorkspaceManager } from '../core/workspaceManager';
import { Workspace, WindowState } from '../core/workspace';
import { DockingDirection } from '../core/docking';
import { Rect } from '../core/layout';
import { BaseWindowController } from '../platform/common/IWindowController';
import { WorkspacePersistence } from './workspacePersistence';

export interface WorkspaceShellOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  prompt?: string;
}

export interface WorkspaceShellContext {
  manager: WorkspaceManager;
  controller: BaseWindowController;
  persistence: WorkspacePersistence;
}

export class WorkspaceShell {
  private readonly manager: WorkspaceManager;
  private readonly controller: BaseWindowController;
  private readonly persistence: WorkspacePersistence;
  private readonly input: NodeJS.ReadableStream;
  private readonly output: NodeJS.WritableStream;
  private readonly prompt: string;
  private rl?: readline.Interface;
  private running = false;
  private closePromise?: Promise<void>;

  constructor(context: WorkspaceShellContext, options: WorkspaceShellOptions = {}) {
    this.manager = context.manager;
    this.controller = context.controller;
    this.persistence = context.persistence;
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    this.prompt = options.prompt ?? 'workspace> ';
  }

  async start(): Promise<void> {
    if (this.running) {
      return this.closePromise ?? Promise.resolve();
    }

    this.rl = readline.createInterface({ input: this.input, output: this.output, terminal: true });
    this.running = true;

    this.rl.on('line', (line) => {
      void this.handleLine(line);
    });

    this.rl.on('close', () => {
      this.running = false;
      this.rl = undefined;
      if (this.closePromiseResolver) {
        this.closePromiseResolver();
        this.closePromiseResolver = undefined;
      }
    });

    this.write('Interactive workspace shell ready. Type "help" for available commands.');
    this.rl.setPrompt(this.prompt);
    this.rl.prompt();

    this.closePromise = new Promise<void>((resolve) => {
      this.closePromiseResolver = resolve;
    });
    return this.closePromise;
  }

  async execute(rawCommand: string): Promise<string> {
    const tokens = tokenize(rawCommand);
    if (tokens.length === 0) {
      return '';
    }
    const [command, ...args] = tokens;

    switch (command.toLowerCase()) {
      case 'help':
        return this.renderHelp();
      case 'workspaces':
        return this.renderWorkspaces();
      case 'switch':
        return this.handleSwitch(args);
      case 'windows':
        return this.renderWindows(args[0]);
      case 'add-window':
        return this.handleAddWindow(args);
      case 'dock':
        return this.handleDock(args);
      case 'dock-magnetic':
        return this.handleMagneticDock(args);
      case 'layout':
        return this.renderLayout(args);
      case 'focus':
        return this.handleFocus(args);
      case 'move':
        return this.handleMove(args);
      case 'controller-windows':
        return this.renderControllerWindows();
      case 'persist':
        return this.handlePersist();
      case 'exit':
      case 'quit':
        this.stop();
        return 'Exiting workspace shell.';
      default:
        return `Unknown command "${command}". Type 'help' to list commands.`;
    }
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.rl?.close();
  }

  private async handleLine(line: string): Promise<void> {
    try {
      const response = await this.execute(line);
      if (response) {
        this.write(response);
      }
    } catch (error) {
      this.write(`Error: ${WorkspaceShell.describeError(error)}`);
    } finally {
      if (this.running) {
        this.rl?.setPrompt(this.prompt);
        this.rl?.prompt();
      }
    }
  }

  private handleSwitch(args: string[]): string {
    const [workspaceId] = args;
    if (!workspaceId) {
      throw new Error('Usage: switch <workspaceId>');
    }
    this.manager.setActiveWorkspace(workspaceId);
    return `Activated workspace ${workspaceId}.`;
  }

  private renderWorkspaces(): string {
    const activeId = this.manager.getActiveWorkspace()?.id;
    const entries = this.manager.getWorkspaces().map((workspace) => {
      const prefix = workspace.id === activeId ? '*' : ' ';
      return `${prefix} ${workspace.id} - ${workspace.name}`;
    });
    return entries.length > 0 ? entries.join('\n') : 'No workspaces registered.';
  }

  private renderWindows(workspaceId?: string): string {
    const workspace = workspaceId
      ? this.manager.getWorkspace(workspaceId)
      : this.manager.getActiveWorkspace();
    if (!workspace) {
      throw new Error('No workspace available. Use "workspaces" to view available ids.');
    }
    const windows = workspace.getWindows();
    return windows
      .map((window) => `${window.id} - ${window.title}`)
      .join('\n') || `Workspace ${workspace.id} does not contain any windows.`;
  }

  private handleAddWindow(args: string[]): string {
    const [id, ...titleParts] = args;
    if (!id || titleParts.length === 0) {
      throw new Error('Usage: add-window <id> <title>');
    }
    const title = titleParts.join(' ');
    const workspace = this.ensureActiveWorkspace();
    workspace.addWindow({ id, title });
    return `Added window ${id} to workspace ${workspace.id}.`;
  }

  private handleDock(args: string[]): string {
    const [windowId, targetId, directionRaw, ratioRaw] = args;
    if (!windowId || !targetId || !directionRaw) {
      throw new Error('Usage: dock <windowId> <targetId> <direction> [ratio]');
    }
    const direction = this.parseDirection(directionRaw);
    const ratio = ratioRaw !== undefined ? Number(ratioRaw) : undefined;
    const workspace = this.ensureActiveWorkspace();
    const window = this.resolveWindowState(workspace, windowId);
    workspace.dock({ window, targetWindowId: targetId, direction, ratio });
    return `Docked ${windowId} ${direction} of ${targetId}.`;
  }

  private handleMagneticDock(args: string[]): string {
    const [windowId, xRaw, yRaw, widthRaw, heightRaw, surfaceWidthRaw, surfaceHeightRaw, thresholdRaw] = args;
    if (!windowId || !xRaw || !yRaw || !widthRaw || !heightRaw) {
      throw new Error(
        'Usage: dock-magnetic <windowId> <x> <y> <width> <height> [surfaceWidth surfaceHeight threshold]'
      );
    }

    const surfaceWidth = surfaceWidthRaw !== undefined ? Number(surfaceWidthRaw) : 1280;
    const surfaceHeight = surfaceHeightRaw !== undefined ? Number(surfaceHeightRaw) : 800;
    const threshold = thresholdRaw !== undefined ? Number(thresholdRaw) : undefined;

    const workspace = this.ensureActiveWorkspace();
    const window: WindowState =
      workspace.getWindows().find((entry) => entry.id === windowId) ?? {
        id: windowId,
        title: windowId
      };

    const relationship = workspace.dockMagnetically({
      window,
      bounds: {
        x: Number(xRaw),
        y: Number(yRaw),
        width: Number(widthRaw),
        height: Number(heightRaw)
      },
      surface: { x: 0, y: 0, width: surfaceWidth, height: surfaceHeight },
      threshold
    });

    return `Magnetically docked ${windowId} ${relationship.direction} of ${relationship.targetWindowId}.`;
  }

  private renderLayout(args: string[]): string {
    const width = args[0] ? Number(args[0]) : 1280;
    const height = args[1] ? Number(args[1]) : 800;
    const workspace = this.ensureActiveWorkspace();
    const placements = workspace
      .getLayout()
      .computePlacements({ x: 0, y: 0, width, height })
      .map(
        (placement) =>
          `${placement.id}: (${placement.bounds.x}, ${placement.bounds.y}) ${placement.bounds.width}x${placement.bounds.height}`
      );
    return placements.join('\n');
  }

  private async handlePersist(): Promise<string> {
    await this.persistence.save(this.manager.serialize());
    return `Persisted ${this.manager.getWorkspaces().length} workspaces to ${this.persistence.path}.`;
  }

  private async renderControllerWindows(): Promise<string> {
    const windows = await this.controller.listWindows();
    if (windows.length === 0) {
      return 'Controller did not report any windows.';
    }
    return windows.map((window) => `${window.id} - ${window.title}`).join('\n');
  }

  private async handleFocus(args: string[]): Promise<string> {
    const [windowId] = args;
    if (!windowId) {
      throw new Error('Usage: focus <windowId>');
    }
    await this.controller.focusWindow(windowId);
    return `Focused window ${windowId}.`;
  }

  private async handleMove(args: string[]): Promise<string> {
    const [windowId, xRaw, yRaw, widthRaw, heightRaw] = args;
    if (!windowId || !xRaw || !yRaw || !widthRaw || !heightRaw) {
      throw new Error('Usage: move <windowId> <x> <y> <width> <height>');
    }
    const bounds: Rect = {
      x: Number(xRaw),
      y: Number(yRaw),
      width: Number(widthRaw),
      height: Number(heightRaw)
    };
    await this.controller.moveWindow(windowId, bounds);
    return `Moved window ${windowId} to (${bounds.x}, ${bounds.y}) ${bounds.width}x${bounds.height}.`;
  }

  private ensureActiveWorkspace(): Workspace {
    const workspace = this.manager.getActiveWorkspace();
    if (!workspace) {
      throw new Error('No active workspace configured.');
    }
    return workspace;
  }

  private parseDirection(directionRaw: string): DockingDirection {
    const value = directionRaw.toLowerCase();
    if (value === 'left' || value === 'right' || value === 'top' || value === 'bottom' || value === 'tab') {
      return value;
    }
    throw new Error(`Invalid docking direction "${directionRaw}".`);
  }

  private resolveWindowState(workspace: Workspace, windowId: string) {
    const window = workspace.getWindows().find((entry) => entry.id === windowId);
    if (!window) {
      throw new Error(`Window '${windowId}' is not registered in workspace ${workspace.id}.`);
    }
    return window;
  }

  private renderHelp(): string {
    return [
      'workspaces                       - List registered workspaces',
      'switch <id>                      - Activate a workspace by id',
      'windows [workspaceId]            - List windows within the (active) workspace',
      'add-window <id> <title>          - Add a window to the active workspace',
      'dock <id> <target> <dir> [ratio] - Dock window relative to target',
      'dock-magnetic <id> <x> <y> <w> <h> [surfaceW surfaceH threshold] - Dock using magnetic snapping',
      'layout [width height]            - Render the layout placements',
      'controller-windows               - List windows reported by the controller',
      'focus <id>                       - Focus a window via the controller',
      'move <id> <x> <y> <w> <h>        - Move a window via the controller',
      'persist                          - Persist current workspace state to disk',
      'exit|quit                        - Exit the shell'
    ].join('\n');
  }

  private write(message: string): void {
    this.output.write(`${message}\n`);
  }

  private static describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private closePromiseResolver?: () => void;
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}
