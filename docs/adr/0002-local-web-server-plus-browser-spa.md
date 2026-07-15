# Local web-server process + browser SPA

The app ships as a local web-server process that serves a browser SPA and exposes the API, backed by embedded SQLite — not as a desktop (Electron/Tauri) app. This is the shape the design's own architecture already draws, and it is the same codebase that later scales to a shared Postgres deployment (ADR-0001, ADR-0007). The import pipeline's isolated background workers are a server-side concept; a desktop app would have to embed a hidden local server anyway.

## Considered Options

- **Desktop app (Tauri/Electron)** — nicer single-file install and OS file access, but we don't need OS file access (imports are explicit uploads) and it would fork the architecture away from the eventual shared deployment. Rejected.
