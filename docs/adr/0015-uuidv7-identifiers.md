# UUIDv7 for all entity identifiers

Every entity's primary key is a UUIDv7, mintable on either client or server. Object identity must survive export/re-import (acceptance criterion #10), import merges of two projects, and TO-BE-referencing-AS-IS by shared ID — so identifiers must be globally unique and collision-free across projects, ruling out auto-increment integers. They must also be mintable client-side (the canvas creates a node and its Operation-log entry before any server round-trip). Among UUIDs, v7 is time-ordered, preserving index locality on the append-heavy tables (Flow, FieldProvenance, operation log) and giving natural creation ordering.

## Considered Options

- **Auto-increment integers** — compact, but collide on merge/import and can't be minted client-side. Rejected.
- **UUIDv4** — unique and mintable, but random, fragmenting index locality on write-heavy tables. Rejected in favor of v7's time-ordering; the mild creation-time leak is irrelevant for internal IDs in a local-first tool.
