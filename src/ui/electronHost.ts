import { app, BrowserWindow, ipcMain } from 'electron';
import type { BrowserWindowConstructorOptions } from 'electron';
import type { ElectronBrowserWindow, ElectronHost } from './electronWorkspaceUi';

export class DefaultElectronHost implements ElectronHost {
  readonly app = app;
  readonly ipcMain = ipcMain;
  readonly platform: NodeJS.Platform = process.platform;

  createWindow(options: BrowserWindowConstructorOptions): ElectronBrowserWindow {
    return new BrowserWindow(options);
  }
}

