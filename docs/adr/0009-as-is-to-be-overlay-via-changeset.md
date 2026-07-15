# AS-IS / TO-BE / Diff as an overlay via ChangeSet

AS-IS is the committed model; TO-BE is AS-IS **plus a proposal ChangeSet** (additions as new `Planned` objects, removals as `Removed-in-proposal` flags, and modifications as field-deltas against the *same* object ID). Diff is the rendered proposal. Every object also carries a **Lifecycle State** marker from day one. This is the only model that expresses a *modification* to an existing object without duplicating it, and it reuses the ChangeSet entity we already have.

## Considered Options

- **State markers only** — cheap, but a single object cannot hold both "is VLAN 10" and "will be VLAN 20"; the modification case is fatal. Rejected.
- **Two full snapshots (branch-like)** — handles everything but doubles storage and makes object-identity continuity (required for export/re-import) ambiguous. Rejected.

## Consequences

- TO-BE references the same UUIDs as AS-IS, so identity continuity is free.
- Phase 1 has no imported AS-IS (everything drawn is one planned design), so only the `lifecycleState` column is needed now; the overlay machinery lands in Phase 2.
