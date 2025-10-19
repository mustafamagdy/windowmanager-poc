import http from 'node:http';
import { DockLayout, Workspace, WorkspaceManager, createLeaf } from '../src/core';
import { WorkspaceWebServer } from '../src/ui/webServer';
import { WorkspacePersistence } from '../src/ui/workspacePersistence';
import VirtualWindowController from '../src/platform/common/virtualWindowController';

function createWorkspace(): Workspace {
  const layout = new DockLayout(createLeaf('root'));
  return new Workspace('ws', 'Workspace', layout, [
    { id: 'root', title: 'Root Window' }
  ]);
}

describe('WorkspaceWebServer', () => {
  let controller: VirtualWindowController;
  let manager: WorkspaceManager;
  let persistence: WorkspacePersistence;
  let server: WorkspaceWebServer;
  let host: string;
  let port: number;

  beforeEach(async () => {
    const workspace = createWorkspace();
    manager = new WorkspaceManager([workspace], workspace.id);
    controller = new VirtualWindowController();
    controller.registerWindow({ id: 'root', title: 'Root Window' });
    persistence = {
      path: '/tmp/workspaces.json',
      save: jest.fn().mockResolvedValue(undefined),
      load: jest.fn()
    } as unknown as WorkspacePersistence;

    server = new WorkspaceWebServer(
      { manager, controller, persistence },
      { port: 0, host: '127.0.0.1' }
    );
    await server.start();
    const address = server.getAddress();
    if (!address) {
      throw new Error('Server did not expose an address.');
    }
    host = address.host === '::' ? '127.0.0.1' : address.host;
    port = address.port;
  });

  afterEach(async () => {
    await server.stop();
  });

  it('serves the interactive HTML UI', async () => {
    const response = await httpRequest('/');
    expect(response.status).toBe(200);
    expect(response.body).toContain('<title>Workspace Manager UI</title>');
  });

  it('reports workspace state and reflects window mutations', async () => {
    let response = await httpRequest('/api/state');
    let state = JSON.parse(response.body);
    expect(state.activeWorkspaceId).toBe('ws');
    expect(state.workspaces[0].windows).toHaveLength(1);

    await httpRequest('/api/workspaces/ws/windows', {
      method: 'POST',
      json: { id: 'chart', title: 'Chart Window' }
    });

    response = await httpRequest('/api/state');
    state = JSON.parse(response.body);
    expect(state.workspaces[0].windows).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'chart' })])
    );

    await httpRequest('/api/workspaces/ws/windows/chart/focus', { method: 'POST' });
    response = await httpRequest('/api/state');
    state = JSON.parse(response.body);
    expect(state.workspaces[0].activeWindowId).toBe('chart');
  });

  it('supports docking workflows through the API', async () => {
    await httpRequest('/api/workspaces/ws/windows', {
      method: 'POST',
      json: { id: 'chart', title: 'Chart' }
    });

    const dockResponse = await httpRequest('/api/workspaces/ws/windows/chart/dock', {
      method: 'POST',
      json: { targetWindowId: 'root', direction: 'right', ratio: 0.4 }
    });
    expect(dockResponse.status).toBe(200);

    const stateResponse = await httpRequest('/api/state');
    const state = JSON.parse(stateResponse.body);
    const workspace = state.workspaces.find((entry: any) => entry.id === 'ws');
    expect(workspace.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceWindowId: 'chart', targetWindowId: 'root', direction: 'right' })
      ])
    );
    expect(workspace.placements.length).toBeGreaterThanOrEqual(2);
  });

  it('exposes controller windows from the platform layer', async () => {
    controller.registerWindow({ id: 'secondary', title: 'Secondary Window' });
    const response = await httpRequest('/api/controller/windows');
    const windows = JSON.parse(response.body);
    expect(windows).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'secondary', title: 'Secondary Window' })])
    );
  });

  async function httpRequest(
    path: string,
    options: { method?: string; json?: unknown } = {}
  ): Promise<{ status: number; body: string }> {
    const method = options.method ?? 'GET';
    const payload = options.json !== undefined ? JSON.stringify(options.json) : undefined;

    return await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = http.request(
        {
          host,
          port,
          path,
          method,
          headers:
            payload !== undefined
              ? {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(payload)
                }
              : undefined
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            resolve({ status: res.statusCode ?? 0, body });
          });
        }
      );

      request.on('error', reject);
      if (payload) {
        request.write(payload);
      }
      request.end();
    });
  }
});
