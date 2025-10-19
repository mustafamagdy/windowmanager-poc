# Window Manager Proof of Concept

This prototype provides a cross-platform workspace orchestrator with an Electron-powered desktop shell for inspecting layouts, activating workspaces, and managing window docking relationships without relying on a browser or HTTP server.

## Getting started

```bash
npm install
npm start
```

`npm start` compiles the TypeScript sources and launches Electron with the compiled main process (`dist/ui/index.js`). From the desktop UI you can:

- Activate and inspect workspaces
- Add, focus, and remove workspace windows via the control panel
- Dock windows using directional prompts and view the resulting layout preview
- Monitor windows exposed by the underlying platform controller

## Testing

```bash
npm test
npm run lint
```

Both commands exercise the workspace core as well as the Electron integration layer.
