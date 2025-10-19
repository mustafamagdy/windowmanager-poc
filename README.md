# Window Manager Proof of Concept

This prototype provides a cross-platform workspace orchestrator with a browser-based UI for inspecting layouts, activating workspaces, and managing window docking relationships.

## Getting started

```bash
npm install
npm run build
npm start
```

The application starts an HTTP server (default `http://127.0.0.1:3000`) that renders the workspace dashboard. From the UI you can:

- Activate and inspect workspaces
- Add windows to the active workspace
- Focus or remove windows
- Dock windows using directional prompts and view the resulting layout preview
- Monitor windows exposed by the underlying platform controller

## Testing

```bash
npm test
npm run lint
```

Both commands exercise the workspace core as well as the web interface endpoints.
