import http, { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { DockingDirection } from '../core/docking';
import { Rect } from '../core/layout';
import { Workspace } from '../core/workspace';
import { WorkspaceManager } from '../core/workspaceManager';
import { BaseWindowController } from '../platform/common/IWindowController';
import { WorkspacePersistence } from './workspacePersistence';

const DEFAULT_PREVIEW_SURFACE: Rect = { x: 0, y: 0, width: 1200, height: 800 };

export interface WorkspaceUiContext {
  manager: WorkspaceManager;
  controller: BaseWindowController;
  persistence: WorkspacePersistence;
}

export interface WorkspaceUi {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface WorkspaceWebServerOptions {
  port?: number;
  host?: string;
  previewSurface?: Rect;
}

interface WorkspaceSummary {
  id: string;
  name: string;
  windows: ReturnType<Workspace['getWindows']>;
  activeWindowId?: string;
  layout: ReturnType<Workspace['getLayout']>['root'];
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

function resolvePort(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 65535) {
    console.warn(`Ignoring invalid PORT environment value: '${raw}'`);
    return undefined;
  }
  return parsed;
}

class HttpError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export class WorkspaceWebServer implements WorkspaceUi {
  private server?: http.Server;
  private readonly port: number;
  private readonly host: string;
  private readonly previewSurface: Rect;

  constructor(
    private readonly context: WorkspaceUiContext,
    private readonly options: WorkspaceWebServerOptions = {}
  ) {
    this.port = options.port ?? resolvePort(process.env.PORT) ?? 3000;
    this.host = options.host ?? process.env.HOST ?? '0.0.0.0';
    this.previewSurface = options.previewSurface ?? DEFAULT_PREVIEW_SURFACE;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = http.createServer((req, res) => {
      void this.routeRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server?.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.server?.off('error', onError);
        const address = this.server?.address();
        if (address && typeof address === 'object') {
          console.log(
            `Workspace manager UI listening on http://${address.address}:${address.port}`
          );
        } else {
          console.log(
            `Workspace manager UI listening on http://${this.host}:${this.port}`
          );
        }
        resolve();
      };

      this.server?.once('error', onError);
      this.server?.once('listening', onListening);
      this.server?.listen(this.port, this.host);
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  getAddress(): { host: string; port: number } | undefined {
    const address = this.server?.address();
    if (!address || typeof address === 'string') {
      return undefined;
    }
    return { host: address.address, port: address.port };
  }

  private async routeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!req.url) {
        throw new HttpError(404, 'Not found');
      }
      const url = new URL(req.url, 'http://localhost');
      const method = req.method ?? 'GET';

      if (method === 'GET' && url.pathname === '/') {
        this.sendHtml(res, INDEX_HTML);
        return;
      }

      if (method === 'GET' && url.pathname === '/api/state') {
        const state = await this.buildState();
        this.sendJson(res, 200, state);
        return;
      }

      if (method === 'POST' && url.pathname === '/api/persist') {
        await this.persistActiveWorkspace();
        this.sendJson(res, 200, { ok: true });
        return;
      }

      const activateMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/activate$/);
      if (method === 'POST' && activateMatch) {
        const workspaceId = this.decodeId(activateMatch[1]);
        this.context.manager.setActiveWorkspace(workspaceId);
        this.sendJson(res, 200, { activeWorkspaceId: workspaceId });
        return;
      }

      const addWindowMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/windows$/);
      if (method === 'POST' && addWindowMatch) {
        const workspaceId = this.decodeId(addWindowMatch[1]);
        const body = await this.readJson(req);
        const workspace = this.ensureWorkspace(workspaceId);
        const rawId = body.id;
        const id =
          typeof rawId === 'string' && rawId.trim().length > 0 ? rawId : `window-${Date.now()}`;
        const rawTitle = body.title;
        const title =
          typeof rawTitle === 'string' && rawTitle.trim().length > 0 ? rawTitle : id;
        const metadata = this.normalizeMetadata(body.metadata);
        const targetWindowId =
          typeof body.targetWindowId === 'string' && body.targetWindowId.trim().length > 0
            ? body.targetWindowId
            : undefined;
        workspace.addWindow({ id, title, metadata }, targetWindowId);
        this.sendJson(res, 201, { id, title });
        return;
      }

      const dockMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/windows\/([^/]+)\/dock$/);
      if (method === 'POST' && dockMatch) {
        const workspaceId = this.decodeId(dockMatch[1]);
        const windowId = this.decodeId(dockMatch[2]);
        const body = await this.readJson(req);
        const direction = body.direction as DockingDirection | undefined;
        const targetId = body.targetWindowId as string | undefined;
        if (!direction || !targetId) {
          throw new HttpError(400, 'Docking requires direction and targetWindowId.');
        }
        const workspace = this.ensureWorkspace(workspaceId);
        const window = workspace.getWindows().find((item) => item.id === windowId);
        if (!window) {
          throw new HttpError(404, `Unknown window '${windowId}'.`);
        }
        workspace.dock({
          window,
          targetWindowId: targetId,
          direction,
          ratio: typeof body.ratio === 'number' ? body.ratio : undefined
        });
        this.sendJson(res, 200, { ok: true });
        return;
      }

      const focusMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/windows\/([^/]+)\/focus$/);
      if (method === 'POST' && focusMatch) {
        const workspaceId = this.decodeId(focusMatch[1]);
        const windowId = this.decodeId(focusMatch[2]);
        const workspace = this.ensureWorkspace(workspaceId);
        workspace.setActiveWindow(windowId);
        await this.context.controller.focusWindow(windowId).catch((error) => {
          console.warn('Failed to focus window via controller:', error);
        });
        this.sendJson(res, 200, { ok: true, activeWindowId: windowId });
        return;
      }

      const removeMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/windows\/([^/]+)$/);
      if (method === 'DELETE' && removeMatch) {
        const workspaceId = this.decodeId(removeMatch[1]);
        const windowId = this.decodeId(removeMatch[2]);
        const workspace = this.ensureWorkspace(workspaceId);
        workspace.removeWindow(windowId);
        this.sendJson(res, 200, { ok: true });
        return;
      }

      const controllerWindowsMatch = url.pathname === '/api/controller/windows';
      if (method === 'GET' && controllerWindowsMatch) {
        const windows = await this.context.controller.listWindows();
        this.sendJson(res, 200, windows);
        return;
      }

      throw new HttpError(404, 'Not found');
    } catch (error) {
      this.handleError(res, error);
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

  private async persistActiveWorkspace(): Promise<void> {
    const activeWorkspace = this.context.manager.getActiveWorkspace();
    if (!activeWorkspace) {
      return;
    }
    await this.context.controller
      .persistWorkspace(activeWorkspace.serialize())
      .catch((error) => {
        console.warn('Failed to persist workspace via controller:', error);
      });
    await this.context.persistence.save(this.context.manager.serialize());
  }

  private decodeId(value: string): string {
    return decodeURIComponent(value);
  }

  private ensureWorkspace(workspaceId: string): Workspace {
    const workspace = this.context.manager.getWorkspace(workspaceId);
    if (!workspace) {
      throw new HttpError(404, `Unknown workspace '${workspaceId}'.`);
    }
    return workspace;
  }

  private normalizeMetadata(value: unknown): Record<string, unknown> | undefined {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return undefined;
  }

  private async readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    if (chunks.length === 0) {
      return {};
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) {
      return {};
    }
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new HttpError(400, 'Invalid JSON body.');
    }
  }

  private sendJson(res: ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  }

  private sendHtml(res: ServerResponse, html: string): void {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  }

  private handleError(res: ServerResponse, error: unknown): void {
    if (error instanceof HttpError) {
      this.sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    console.error('Unexpected workspace UI error:', error);
    this.sendJson(res, 500, { error: 'Internal server error.' });
  }
}

const INDEX_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Workspace Manager UI</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    }
    body {
      margin: 0;
      padding: 0;
      background: #05060a;
      color: #f5f6fa;
    }
    .app {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }
    header {
      padding: 24px 32px;
      background: linear-gradient(135deg, #1e213a, #16182a);
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
    }
    header h1 {
      margin: 0 0 8px;
      font-size: 28px;
      letter-spacing: 0.5px;
    }
    header p {
      margin: 0;
      color: #a0a3bd;
    }
    main {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 24px;
      padding: 24px 32px 48px;
      flex: 1;
    }
    section {
      background: rgba(22, 24, 42, 0.8);
      border-radius: 16px;
      padding: 20px;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    h2 {
      margin: 0;
      font-size: 20px;
      color: #e1e4ff;
    }
    h3 {
      margin: 0;
      font-size: 16px;
      color: #c7cbff;
    }
    .workspace-card {
      border-radius: 12px;
      padding: 12px 16px;
      background: rgba(4, 6, 15, 0.45);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      transition: transform 0.15s ease, background 0.15s ease;
    }
    .workspace-card.active {
      background: rgba(92, 125, 255, 0.28);
      box-shadow: 0 0 0 1px rgba(92, 125, 255, 0.4);
    }
    .workspace-card:not(.active):hover {
      transform: translateY(-2px);
      background: rgba(255, 255, 255, 0.08);
    }
    .workspace-card button {
      background: #5c7dff;
      color: #fff;
      border: none;
      border-radius: 999px;
      padding: 6px 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease, box-shadow 0.15s ease;
    }
    .workspace-card button:disabled {
      background: rgba(255, 255, 255, 0.25);
      cursor: default;
    }
    .workspace-card button:not(:disabled):hover {
      background: #7791ff;
      box-shadow: 0 6px 16px rgba(92, 125, 255, 0.35);
    }
    form label {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 14px;
      color: #b0b3cc;
    }
    input[type="text"] {
      background: rgba(9, 10, 18, 0.6);
      border: 1px solid rgba(92, 125, 255, 0.35);
      border-radius: 10px;
      padding: 10px 12px;
      color: #f0f1ff;
      font-size: 14px;
      outline: none;
      transition: border 0.15s ease, box-shadow 0.15s ease;
    }
    input[type="text"]:focus {
      border-color: #8ea2ff;
      box-shadow: 0 0 0 2px rgba(142, 162, 255, 0.35);
    }
    form button[type="submit"],
    #refresh-button {
      align-self: flex-start;
      background: linear-gradient(135deg, #5c7dff, #9b6bff);
      border: none;
      color: #fff;
      padding: 10px 18px;
      border-radius: 999px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    form button[type="submit"]:hover,
    #refresh-button:hover {
      transform: translateY(-1px);
      box-shadow: 0 8px 18px rgba(124, 103, 255, 0.45);
    }
    .window-entry {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(12, 14, 28, 0.7);
      border-radius: 12px;
      padding: 10px 14px;
      margin-bottom: 8px;
    }
    .window-entry button {
      margin-left: 8px;
      border-radius: 10px;
      border: none;
      padding: 6px 10px;
      font-size: 13px;
      background: rgba(255, 255, 255, 0.12);
      color: #e6e8ff;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .window-entry button:hover {
      background: rgba(255, 255, 255, 0.2);
    }
    .layout-preview {
      position: relative;
      width: 100%;
      padding-top: calc(800 / 1200 * 100%);
      background: rgba(8, 9, 18, 0.8);
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid rgba(92, 125, 255, 0.3);
    }
    .layout-panel {
      position: absolute;
      border: 2px solid rgba(92, 125, 255, 0.45);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #dee1ff;
      background: rgba(92, 125, 255, 0.2);
    }
    .layout-panel.active {
      border-color: #ffaf6d;
      background: rgba(255, 175, 109, 0.25);
      color: #ffe7d0;
      font-weight: 600;
    }
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      gap: 16px;
      padding: 32px 28px;
      border-radius: 16px;
      border: 1px dashed rgba(142, 162, 255, 0.45);
      background: rgba(10, 12, 26, 0.6);
      box-shadow: inset 0 0 0 1px rgba(92, 125, 255, 0.12);
    }
    .empty-state h3 {
      margin: 0;
      font-size: 18px;
      color: #e8eaff;
    }
    .empty-state p {
      margin: 0;
      color: #aeb3dd;
      max-width: 420px;
      line-height: 1.5;
    }
    .sample-layout {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 12px;
      width: 100%;
      max-width: 460px;
    }
    .sample-layout .sample-column {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .sample-window {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
      padding: 14px;
      border-radius: 12px;
      background: rgba(42, 46, 88, 0.65);
      border: 1px solid rgba(108, 128, 255, 0.35);
      text-align: left;
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.25);
    }
    .sample-window strong {
      color: #f0f2ff;
    }
    .sample-window span {
      color: #b9bff7;
      font-size: 13px;
    }
    .empty-callouts {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      justify-content: center;
    }
    .empty-callouts span {
      background: rgba(92, 125, 255, 0.2);
      border-radius: 999px;
      padding: 6px 14px;
      color: #cfd5ff;
      font-size: 13px;
      border: 1px solid rgba(92, 125, 255, 0.4);
    }
    .controller-window {
      background: rgba(9, 10, 18, 0.7);
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 8px;
      border: 1px solid rgba(92, 125, 255, 0.18);
    }
    ul.window-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .workspace-title {
      font-weight: 600;
      color: #f7f8ff;
    }
    .workspace-heading {
      font-size: 16px;
      color: #d0d4ff;
    }
  </style>
</head>
<body>
  <div class="app">
    <header>
      <h1>Workspace Manager</h1>
      <p>Visualize layouts, manage windows, and orchestrate workspaces in real time.</p>
    </header>
    <main>
      <section>
        <h2>Workspaces</h2>
        <div id="workspace-list"></div>
        <form id="add-window-form">
          <h3>Add window to active workspace</h3>
          <label>
            Window id
            <input type="text" name="windowId" placeholder="e.g. chart-panel" required />
          </label>
          <label>
            Title
            <input type="text" name="title" placeholder="Window title" required />
          </label>
          <button type="submit">Add window</button>
        </form>
      </section>
      <section>
        <h2>Active workspace</h2>
        <div id="active-workspace"></div>
        <h3>Layout preview</h3>
        <div id="layout-preview" class="layout-preview"></div>
        <h3>Window actions</h3>
        <div id="window-actions"></div>
      </section>
      <section>
        <h2>Controller windows</h2>
        <div id="controller-windows"></div>
        <button id="refresh-button" type="button">Refresh now</button>
      </section>
    </main>
  </div>
  <script>
    const state = { data: null };
    const SAMPLE_WINDOWS = [
      {
        title: 'Market Overview',
        description: 'Anchor charts and heatmaps to monitor price action at a glance.'
      },
      {
        title: 'Order Flow',
        description: 'Stage complex orders and tweak parameters before routing.'
      },
      {
        title: 'News & Events',
        description: 'Dock news feeds and macro calendars alongside your layouts.'
      },
      {
        title: 'Custom Notebook',
        description: 'Pin strategy notes or scripts and keep them in sync per workspace.'
      }
    ];
    const SAMPLE_PLACEMENTS = [
      { id: 'market-overview', x: 0, y: 0, width: 720, height: 480 },
      { id: 'order-flow', x: 0, y: 480, width: 720, height: 320 },
      { id: 'news-events', x: 720, y: 0, width: 480, height: 320 },
      { id: 'custom-notebook', x: 720, y: 320, width: 480, height: 480 }
    ];

    async function refresh() {
      try {
        const response = await fetch('/api/state');
        state.data = await response.json();
        render();
      } catch (error) {
        console.error('Failed to refresh state', error);
      }
    }

    function render() {
      if (!state.data) {
        return;
      }
      renderWorkspaces();
      renderActiveWorkspace();
      renderControllerWindows();
    }

    function renderWorkspaces() {
      const container = document.getElementById('workspace-list');
      container.innerHTML = '';
      state.data.workspaces.forEach((workspace) => {
        const card = document.createElement('div');
        card.className = 'workspace-card';
        if (workspace.id === state.data.activeWorkspaceId) {
          card.classList.add('active');
        }

        const title = document.createElement('div');
        title.className = 'workspace-title';
        title.textContent = workspace.name + ' (' + workspace.id + ')';
        card.appendChild(title);

        const activate = document.createElement('button');
        activate.textContent = workspace.id === state.data.activeWorkspaceId ? 'Active' : 'Activate';
        activate.disabled = workspace.id === state.data.activeWorkspaceId;
        activate.onclick = () => activateWorkspace(workspace.id);
        card.appendChild(activate);

        container.appendChild(card);
      });
    }

    function renderActiveWorkspace() {
      const container = document.getElementById('active-workspace');
      const actions = document.getElementById('window-actions');
      const layoutContainer = document.getElementById('layout-preview');

      container.innerHTML = '';
      actions.innerHTML = '';
      layoutContainer.innerHTML = '';

      const activeId = state.data.activeWorkspaceId;
      if (!activeId) {
        container.textContent = 'Select a workspace to begin managing windows.';
        return;
      }

      const workspace = state.data.workspaces.find((item) => item.id === activeId);
      if (!workspace) {
        container.textContent = 'Selected workspace unavailable.';
        return;
      }

      if (!workspace.windows.length) {
        renderEmptyWorkspaceState(container, actions, layoutContainer);
        return;
      }

      const heading = document.createElement('div');
      heading.className = 'workspace-heading';
      heading.textContent = 'Active window: ' + (workspace.activeWindowId ?? 'None');
      container.appendChild(heading);

      const windowList = document.createElement('ul');
      windowList.className = 'window-list';
      container.appendChild(windowList);

      workspace.windows.forEach((win) => {
        const item = document.createElement('li');
        item.textContent = win.title + ' (' + win.id + ')';
        windowList.appendChild(item);

        const entry = document.createElement('div');
        entry.className = 'window-entry';
        const label = document.createElement('span');
        label.textContent = win.title + ' (' + win.id + ')';
        entry.appendChild(label);

        const controls = document.createElement('div');
        controls.className = 'window-controls';

        const focusButton = document.createElement('button');
        focusButton.textContent = 'Focus';
        focusButton.onclick = () => focusWindow(workspace.id, win.id);
        controls.appendChild(focusButton);

        const dockButton = document.createElement('button');
        dockButton.textContent = 'Dock';
        dockButton.onclick = () => promptDock(workspace.id, win.id);
        controls.appendChild(dockButton);

        const removeButton = document.createElement('button');
        removeButton.textContent = 'Remove';
        removeButton.onclick = () => removeWindow(workspace.id, win.id);
        controls.appendChild(removeButton);

        entry.appendChild(controls);
        actions.appendChild(entry);
      });

      workspace.placements.forEach((placement) => {
        const panel = document.createElement('div');
        panel.className = 'layout-panel';
        panel.style.left = (placement.bounds.x / 1200 * 100) + '%';
        panel.style.top = (placement.bounds.y / 800 * 100) + '%';
        panel.style.width = (placement.bounds.width / 1200 * 100) + '%';
        panel.style.height = (placement.bounds.height / 800 * 100) + '%';
        panel.textContent = placement.id;
        if (placement.id === workspace.activeWindowId) {
          panel.classList.add('active');
        }
        layoutContainer.appendChild(panel);
      });
    }

    function renderEmptyWorkspaceState(container, actions, layoutContainer) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';

      const title = document.createElement('h3');
      title.textContent = 'This workspace is waiting for its first windows.';
      empty.appendChild(title);

      const description = document.createElement('p');
      description.textContent =
        'Drag OS windows into view or use the form on the left to stage demo panels. Start with a few layout ideas below.';
      empty.appendChild(description);

      const callouts = document.createElement('div');
      callouts.className = 'empty-callouts';
      ['Stack charts side-by-side', 'Dock analytics against trading tickets', 'Pin research in tab stacks'].forEach(
        (tip) => {
          const pill = document.createElement('span');
          pill.textContent = tip;
          callouts.appendChild(pill);
        }
      );
      empty.appendChild(callouts);

      const sampleLayout = document.createElement('div');
      sampleLayout.className = 'sample-layout';

      const primaryColumn = document.createElement('div');
      primaryColumn.className = 'sample-column';
      const secondaryColumn = document.createElement('div');
      secondaryColumn.className = 'sample-column';

      SAMPLE_WINDOWS.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'sample-window';

        const heading = document.createElement('strong');
        heading.textContent = item.title;
        card.appendChild(heading);

        const body = document.createElement('span');
        body.textContent = item.description;
        card.appendChild(body);

        if (index < 2) {
          primaryColumn.appendChild(card);
        } else {
          secondaryColumn.appendChild(card);
        }
      });

      sampleLayout.appendChild(primaryColumn);
      sampleLayout.appendChild(secondaryColumn);
      empty.appendChild(sampleLayout);

      container.appendChild(empty);

      SAMPLE_PLACEMENTS.forEach((placement) => {
        const panel = document.createElement('div');
        panel.className = 'layout-panel';
        panel.style.left = (placement.x / 1200 * 100) + '%';
        panel.style.top = (placement.y / 800 * 100) + '%';
        panel.style.width = (placement.width / 1200 * 100) + '%';
        panel.style.height = (placement.height / 800 * 100) + '%';
        panel.textContent = placement.id;
        layoutContainer.appendChild(panel);
      });

      const hint = document.createElement('div');
      hint.className = 'empty-state';
      hint.style.padding = '20px 18px';
      hint.style.alignItems = 'stretch';
      hint.style.gap = '12px';

      const hintTitle = document.createElement('strong');
      hintTitle.textContent = 'Tip';
      hint.appendChild(hintTitle);

      const hintBody = document.createElement('span');
      hintBody.textContent =
        'Use "Add window" to stage demo panels or drag existing application windows near each other to trigger magnetic docking.';
      hint.appendChild(hintBody);

      actions.appendChild(hint);
    }

    function renderControllerWindows() {
      const container = document.getElementById('controller-windows');
      container.innerHTML = '';
      if (!state.data.controllerWindows.length) {
        container.textContent = 'Controller has no registered windows.';
        return;
      }

      state.data.controllerWindows.forEach((win) => {
        const entry = document.createElement('div');
        entry.className = 'controller-window';
        entry.textContent = win.title + ' (' + win.id + ')';
        container.appendChild(entry);
      });
    }

    async function activateWorkspace(id) {
      await fetch('/api/workspaces/' + encodeURIComponent(id) + '/activate', {
        method: 'POST'
      });
      await refresh();
    }

    async function focusWindow(workspaceId, windowId) {
      await fetch('/api/workspaces/' + encodeURIComponent(workspaceId) + '/windows/' + encodeURIComponent(windowId) + '/focus', {
        method: 'POST'
      });
      await refresh();
    }

    async function removeWindow(workspaceId, windowId) {
      await fetch('/api/workspaces/' + encodeURIComponent(workspaceId) + '/windows/' + encodeURIComponent(windowId), {
        method: 'DELETE'
      });
      await refresh();
    }

    async function promptDock(workspaceId, windowId) {
      const target = window.prompt('Dock relative to window id:');
      if (!target) {
        return;
      }
      const direction = window.prompt('Direction (left, right, top, bottom):');
      if (!direction) {
        return;
      }
      const ratioInput = window.prompt('Split ratio (0.1 - 0.9, optional):');
      const body = {
        targetWindowId: target,
        direction: direction.toLowerCase()
      };
      if (ratioInput) {
        const parsed = Number(ratioInput);
        if (Number.isFinite(parsed)) {
          body.ratio = parsed;
        }
      }
      await fetch('/api/workspaces/' + encodeURIComponent(workspaceId) + '/windows/' + encodeURIComponent(windowId) + '/dock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      await refresh();
    }

    document.getElementById('add-window-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);
      const windowId = formData.get('windowId');
      const title = formData.get('title');
      if (!windowId || !title) {
        return;
      }
      if (!state.data || !state.data.activeWorkspaceId) {
        window.alert('Activate a workspace before adding windows.');
        return;
      }
      await fetch('/api/workspaces/' + encodeURIComponent(state.data.activeWorkspaceId) + '/windows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: windowId, title })
      });
      form.reset();
      await refresh();
    });

    document.getElementById('refresh-button').addEventListener('click', refresh);

    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>`;
