# Window Manager Proof-of-Concept Architecture

## Overview

This proof-of-concept demonstrates a modular window manager that separates
core layout logic, platform abstractions, and UI orchestration. The project is
organized around a TypeScript runtime for shared logic with an Electron main
process hosting the desktop UI. Native modules can later bridge to operating
system APIs as the platform controllers mature.

```
src/
  core/          Core models for workspaces, layouts, and docking logic.
  platform/      Platform-specific controllers and native shims.
  ui/            Application bootstrap, Electron host, and renderer orchestration.
tests/           Unit and integration-style tests for core behaviours.
```

## Docking Algorithm

Dock layouts are represented as a recursive binary tree composed of
`leaf` nodes (individual windows) and `split` nodes (horizontal or vertical
partitions). The `DockLayout` class walks the tree to produce concrete window
bounds based on the workspace viewport. Dock operations insert or remove nodes
from the tree while preserving ratios and parent directionality. Tabbed docking
is modelled as a special relationship without modifying the tree structure.

When docking a new window the algorithm:

1. Locates the target leaf node within the layout tree.
2. Chooses a split direction based on the requested docking direction.
3. Inserts a new split node containing the existing leaf and the new leaf.
4. Normalizes ratios to keep the layout stable after modifications.

Layouts, relationships, and workspace metadata can be serialized to persist and
restore configurations across sessions.

## Workspace Management

`Workspace` aggregates the `DockLayout`, tracked windows, and the relationship
graph produced by docking operations. The class exposes methods to add/remove
windows, update the active window, and dock new windows relative to existing
ones. Serialization captures window metadata, the docking tree, and adjacency
relationships. Deserialization rebuilds the `Workspace` with identical state,
allowing configuration persistence.

## Platform Abstraction Layer

`IWindowController` defines the API surface used by the UI layer to interact
with native windowing backends. Minimal platform-specific controllers are
implemented for Windows, macOS, and Linux, each extending `BaseWindowController`
and acting as stubs for future native integrations. The controllers will
ultimately be backed by native modules compiled via CMake targets under
`src/platform/<platform>/native`.

`src/ui/electronWorkspaceUi.ts` owns the desktop presentation layer. It
connects the `WorkspaceManager` to Electron, renders workspace summaries inside
a `BrowserWindow`, and exposes IPC endpoints for activating workspaces, adding
windows, docking layouts, and querying platform controller windows. Tests
exercise the UI by providing a mocked Electron host, ensuring the logic remains
portable across platforms.

## Roadmap

- **Window Types**: Add support for floating, modal, and notification windows in
the layout tree, including policy-level rules for stacking and z-order.
- **Persistence**: Implement adapters for syncing workspace snapshots to disk and
remote services.
- **Interactivity**: Extend the Electron renderer with drag-and-drop docking,
  richer workspace editing tools, and window previews.
- **Native Integrations**: Implement platform-specific native modules using OS APIs
(e.g., Win32, Cocoa, Wayland/X11) to move and resize real windows.
- **Testing**: Expand the automated test suite with integration harnesses that
exercise native controllers once implemented.
