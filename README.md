# OnMove

OnMove is a production-shaped “hello world” desktop app for macOS. It combines Electron, Vite,
React, TypeScript, shadcn/ui conventions, Tailwind CSS, and SQLite while keeping the renderer
sandboxed from Node.js.

## What the first version includes

- A native-feeling macOS window with inset traffic lights, light/dark appearance support, and a
  conventional application menu.
- An attractive shadcn/ui-based shell with an intentionally empty sidebar.
- A real SQLite database using Electron's bundled `node:sqlite` implementation and WAL mode.
- Versioned, transactional migrations and a typed, subclassable domain-model layer.
- Recursive parent/child items, nullable relation references, JSON metadata, and materialized status
  state backed by an immutable transition log.
- A persistent hello counter and app launch counter.
- A narrow, typed IPC bridge; `nodeIntegration` is off, `contextIsolation` and Chromium sandboxing
  are on.
- Unit, persistence, IPC, menu, component, interaction, and full Electron reopen tests.

## Development

Prerequisites: Node.js 20.19 or newer and pnpm.

```bash
pnpm install
pnpm dev
```

Useful checks:

```bash
pnpm check       # TypeScript, ESLint, and Vitest
pnpm test:e2e    # Build and launch Electron twice to verify persistence
pnpm dist:mac    # Run checks and export the macOS app bundle
```

The exported Finder-ready app is written to `release/mac-arm64/OnMove.app` on Apple Silicon (or
the corresponding `release/mac/OnMove.app` directory on Intel). A `.app` is a bundle on disk but
appears and behaves as one application in Finder.

## Data location

Electron's `userData` directory is used, which resolves to:

```text
~/Library/Application Support/OnMove/onmove.sqlite3
```

SQLite may also create `-wal` and `-shm` companion files while the app is running. The app's Help
menu and main view both include **Show Data File in Finder**.

## Domain model

The domain foundation lives in `src/main/data`. SQLite enforces cascading hierarchy deletion,
nullification of deleted relation references, JSON-object metadata, and automatic status auditing.
Typed models and repositories add validation, cycle prevention, lifecycle helpers, and UI-ready
recursive snapshots without exposing SQLite to the renderer.

See [`docs/data-model.md`](docs/data-model.md) for the schema, invariants, extension points, and API
examples.

## Distribution note

The local `.app` build is intentionally unsigned. Before distributing it to other Macs, configure
an Apple Developer ID certificate, hardened runtime entitlements, and notarization credentials in
electron-builder. None of those are required to run the local first version.
