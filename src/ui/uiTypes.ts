import { WorkspaceManager } from '../core/workspaceManager';
import { BaseWindowController } from '../platform/common/IWindowController';
import { WorkspacePersistence } from './workspacePersistence';

export interface WorkspaceUiContext {
  manager: WorkspaceManager;
  controller: BaseWindowController;
  persistence: WorkspacePersistence;
}

export interface WorkspaceUi {
  start(): Promise<void>;
  stop(): Promise<void>;
}

