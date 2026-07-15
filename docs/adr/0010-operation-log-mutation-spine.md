# Operation log over relational current-state

Every mutation to the model is expressed as a serializable, invertible **Operation** appended to an operation log, while authoritative current state stays in normal relational tables. Undo/redo, ChangeSet grouping, import rollback and the audit trail are then one mechanism instead of four. This product is dominated by "reversible, grouped, audited change," so a single spine for it is structural, not gold-plating. Built in Phase 1.

## Considered Options

- **Direct mutation + in-memory snapshot undo** — simplest for Phase 1, but discards the *intent* of each change, so ChangeSet, rollback and audit are all rebuilt from scratch later. Rejected.
- **Full event sourcing** (current state = fold over events) — maximum purity, but the replay/versioning/migration burden is exactly the kind of decision teams reopen. Rejected in favor of keeping authoritative state in tables.

## Consequences

- Every feature must express mutations as Operations with inverses — a real discipline tax on each edit, paid so that four later features are nearly free and the audit trail is trustworthy by construction.
