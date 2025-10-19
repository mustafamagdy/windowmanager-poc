import { BaseWindowController } from '../common/IWindowController';

export class LinuxWindowController extends BaseWindowController {
  readonly platform = 'linux';

  async initialize(): Promise<void> {
    await super.initialize();
    // TODO: Connect to Wayland/X11 backends.
  }
}

export default LinuxWindowController;
