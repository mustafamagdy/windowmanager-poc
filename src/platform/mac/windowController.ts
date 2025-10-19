import VirtualWindowController from '../common/virtualWindowController';

export class MacWindowController extends VirtualWindowController {
  readonly platform = 'darwin';

  async initialize(): Promise<void> {
    await super.initialize();
    // TODO: Connect to macOS Accessibility APIs or CGS routines.
  }
}

export default MacWindowController;
