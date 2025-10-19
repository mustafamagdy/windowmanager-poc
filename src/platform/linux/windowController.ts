import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WindowBounds } from '../common/IWindowController';
import VirtualWindowController from '../common/virtualWindowController';

const execFileAsync = promisify(execFile);

interface WmctrlWindowEntry {
  id: string;
  title: string;
}

export class LinuxWindowController extends VirtualWindowController {
  readonly platform = 'linux';

  private wmctrlAvailable = false;

  async initialize(): Promise<void> {
    await super.initialize();
    this.wmctrlAvailable = await this.detectWmctrl();
  }

  async listWindows(): Promise<WmctrlWindowEntry[]> {
    if (!this.wmctrlAvailable) {
      return (await super.listWindows()) as WmctrlWindowEntry[];
    }

    try {
      const { stdout } = await execFileAsync('wmctrl', ['-l']);
      return stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(parseWmctrlLine);
    } catch (error) {
      this.wmctrlAvailable = false;
      return (await super.listWindows()) as WmctrlWindowEntry[];
    }
  }

  async focusWindow(windowId: string): Promise<void> {
    if (!this.wmctrlAvailable) {
      return super.focusWindow(windowId);
    }
    try {
      await execFileAsync('wmctrl', ['-ia', windowId]);
    } catch (error) {
      await super.focusWindow(windowId);
    }
  }

  async moveWindow(windowId: string, bounds: WindowBounds): Promise<void> {
    if (!this.wmctrlAvailable) {
      return super.moveWindow(windowId, bounds);
    }

    const gravity = 0;
    const geometry = `${gravity},${Math.round(bounds.x)},${Math.round(bounds.y)},${Math.round(bounds.width)},${Math.round(
      bounds.height
    )}`;

    try {
      await execFileAsync('wmctrl', ['-ir', windowId, '-e', geometry]);
    } catch (error) {
      await super.moveWindow(windowId, bounds);
    }
  }

  private async detectWmctrl(): Promise<boolean> {
    try {
      await execFileAsync('wmctrl', ['-m']);
      return true;
    } catch (error) {
      return false;
    }
  }
}

export default LinuxWindowController;

function parseWmctrlLine(line: string): WmctrlWindowEntry {
  const trimmed = line.trim();
  const match = trimmed.match(/^(\S+)\s+\S+\s+\S+\s+(.*)$/);
  if (match) {
    return { id: match[1], title: match[2] ?? '' };
  }
  const [id, ...titleParts] = trimmed.split(/\s+/);
  return { id: id ?? '', title: titleParts.join(' ') };
}
