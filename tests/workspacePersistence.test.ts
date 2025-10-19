import * as fs from 'fs/promises';
import { DockLayout, createLeaf } from '../src/core';
import { WorkspacePersistence } from '../src/ui/workspacePersistence';

jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  writeFile: jest.fn(),
  mkdir: jest.fn()
}));

const mockedFs = fs as jest.Mocked<typeof fs>;

function buildSnapshot() {
  const layout = new DockLayout(createLeaf('root'));
  return {
    activeWorkspaceId: 'primary',
    workspaces: [
      {
        id: 'primary',
        name: 'Primary',
        layout: layout.serialize(),
        windows: [{ id: 'root', title: 'Root' }],
        activeWindowId: 'root',
        relationships: []
      }
    ]
  };
}

describe('WorkspacePersistence', () => {
  let persistence: WorkspacePersistence;

  beforeEach(() => {
    jest.clearAllMocks();
    persistence = new WorkspacePersistence({ baseDir: '/tmp/windowmanager', fileName: 'state.json' });
  });

  it('saves workspace snapshots to disk', async () => {
    const snapshot = buildSnapshot();
    mockedFs.mkdir.mockResolvedValue(undefined);
    mockedFs.writeFile.mockResolvedValue(undefined);

    await persistence.save(snapshot);

    expect(mockedFs.mkdir).toHaveBeenCalledWith('/tmp/windowmanager', { recursive: true });
    expect(mockedFs.writeFile).toHaveBeenCalledWith(
      '/tmp/windowmanager/state.json',
      JSON.stringify(snapshot, null, 2),
      'utf-8'
    );
  });

  it('loads workspace snapshots from disk', async () => {
    const snapshot = buildSnapshot();
    mockedFs.readFile.mockResolvedValue(JSON.stringify(snapshot));

    const loaded = await persistence.load();

    expect(loaded).toEqual(snapshot);
  });

  it('returns undefined when snapshot file is missing', async () => {
    const error = Object.assign(new Error('ENOENT: missing file'), { code: 'ENOENT' });
    mockedFs.readFile.mockRejectedValue(error);

    await expect(persistence.load()).resolves.toBeUndefined();
  });

  it('throws when snapshot contents are invalid', async () => {
    mockedFs.readFile.mockResolvedValue('{}');

    await expect(persistence.load()).rejects.toThrow('Snapshot workspaces must be an array.');
  });
});
