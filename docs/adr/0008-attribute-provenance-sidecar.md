# Provenance stored in an attribute-provenance sidecar

Per-field provenance (source, evidence reference, confidence, parser version, accept/reject/override status) is stored in a separate `FieldProvenance` sidecar keyed by `(entityType, entityId, field)`, **not** as field-envelope objects on every column and **not** as one source per record. The entity tables hold the _current accepted value_ — plain, indexable, queryable by the canvas/search/rules — while the sidecar holds provenance, history and competing observations (which the Reconciliation queue needs).

## Considered Options

- **Field-envelope** (`{value, source, confidence, …}` per column) — faithful to the spec but destroys simple querying/indexing and forces import machinery onto manual Phase-1 forms. Rejected.
- **Record-level provenance** — too coarse; a real Device draws its IP, OS and location from different sources with different confidence, which is the whole value prop. Rejected.

## Consequences

- Phase 1 builds entity tables with zero provenance machinery; Phase 2 adds the sidecar with **no entity-schema migration**.
- The "current accepted value" is denormalized from the winning sidecar row, so commit/merge writes both transactionally — the same write path the Operation log/audit already uses.
