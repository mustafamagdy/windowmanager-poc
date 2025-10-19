import VirtualWindowController from '../common/virtualWindowController';

export class WindowsWindowController extends VirtualWindowController {
  readonly platform = 'win32';

  async initialize(): Promise<void> {
    await super.initialize();
    // TODO: Connect to Win32 APIs via native add-on.
  }
}

export default WindowsWindowController;
