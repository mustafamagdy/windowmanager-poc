import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';
import { WorkspaceCollectionSnapshot } from '../core';

export interface WorkspacePersistenceOptions {
  baseDir?: string;
  fileName?: string;
}

const DEFAULT_FILE_NAME = 'workspaces.json';
const DEFAULT_DIR_NAME = '.windowmanager-poc';

export class WorkspacePersistence {
  private readonly filePath: string;

  constructor(options: WorkspacePersistenceOptions = {}) {
    const baseDir = options.baseDir ?? path.join(os.homedir(), DEFAULT_DIR_NAME);
    const fileName = options.fileName ?? DEFAULT_FILE_NAME;
    this.filePath = path.resolve(baseDir, fileName);
  }

  get path(): string {
    return this.filePath;
  }

  async load(): Promise<WorkspaceCollectionSnapshot | undefined> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as unknown;
      this.assertValidSnapshot(data);
      return data;
    } catch (error) {
      if (WorkspacePersistence.isMissingFileError(error)) {
        return undefined;
      }
      throw new Error(`Failed to load workspace snapshot: ${WorkspacePersistence.describeError(error)}`);
    }
  }

  async save(snapshot: WorkspaceCollectionSnapshot): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const serialized = JSON.stringify(snapshot, null, 2);
    await fs.writeFile(this.filePath, serialized, 'utf-8');
  }

  private assertValidSnapshot(data: unknown): asserts data is WorkspaceCollectionSnapshot {
    if (!WorkspacePersistence.isPlainObject(data)) {
      throw new Error('Snapshot is not an object.');
    }
    if (data.activeWorkspaceId !== undefined && typeof data.activeWorkspaceId !== 'string') {
      throw new Error('Snapshot activeWorkspaceId must be a string when provided.');
    }
    if (!Array.isArray(data.workspaces)) {
      throw new Error('Snapshot workspaces must be an array.');
    }

    data.workspaces.forEach((workspace, index) => {
      if (!WorkspacePersistence.isPlainObject(workspace)) {
        throw new Error(`Workspace entry at index ${index} is not an object.`);
      }
      if (typeof workspace.id !== 'string' || typeof workspace.name !== 'string') {
        throw new Error(`Workspace entry at index ${index} is missing id or name.`);
      }
      if (!WorkspacePersistence.isPlainObject(workspace.layout)) {
        throw new Error(`Workspace entry at index ${index} has an invalid layout.`);
      }
      if (!Array.isArray(workspace.windows)) {
        throw new Error(`Workspace entry at index ${index} has an invalid windows array.`);
      }
      if (workspace.activeWindowId !== undefined && typeof workspace.activeWindowId !== 'string') {
        throw new Error(`Workspace entry at index ${index} has an invalid activeWindowId.`);
      }
      if (!Array.isArray(workspace.relationships)) {
        throw new Error(`Workspace entry at index ${index} has an invalid relationships array.`);
      }
    });
  }

  private static isPlainObject(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private static isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT';
    }
    return WorkspacePersistence.describeError(error).includes('ENOENT');
  }

  private static describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
