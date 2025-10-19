import { BaseWindowController } from '../common/IWindowController';

export class WindowsWindowController extends BaseWindowController {
  readonly platform = 'win32';

  async initialize(): Promise<void> {
    await super.initialize();
    // TODO: Connect to Win32 APIs via native add-on.
  }
}

export default WindowsWindowController;
