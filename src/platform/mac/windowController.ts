import { BaseWindowController } from '../common/IWindowController';

export class MacWindowController extends BaseWindowController {
  readonly platform = 'darwin';

  async initialize(): Promise<void> {
    await super.initialize();
    // TODO: Connect to macOS Accessibility APIs or CGS routines.
  }
}

export default MacWindowController;
