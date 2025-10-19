import VirtualWindowController from '../src/platform/common/virtualWindowController';

describe('VirtualWindowController', () => {
  it('tracks registered windows and focus state', async () => {
    const controller = new VirtualWindowController();
    controller.registerWindow({ id: 'alpha', title: 'Alpha' });
    controller.registerWindow({ id: 'beta', title: 'Beta' }, { x: 20, y: 30, width: 400, height: 300 });

    await controller.focusWindow('alpha');
    await controller.moveWindow('beta', { x: 50, y: 60, width: 420, height: 310 });

    const windows = await controller.listWindows();
    expect(windows).toHaveLength(2);

    const state = controller.getState();
    expect(state.focusedWindowId).toBe('alpha');
    expect(state.windows.find((window) => window.id === 'beta')?.bounds).toEqual({
      x: 50,
      y: 60,
      width: 420,
      height: 310
    });
  });
});
