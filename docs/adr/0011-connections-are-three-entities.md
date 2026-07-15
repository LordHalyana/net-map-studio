# A connection is three entities, unified only at render

`Link`, `Flow` and `PolicyRule` are three distinct entities with different physics, not one polymorphic connection table. They are unified *only* at the canvas rendering layer as "an edge." Links are structural and low-cardinality; Flows are observed, high-cardinality and time-windowed; PolicyRules are intended and carry action/logging/owner/justification and get validated for conflicts. Collapsing them would bloat every row with the others' concerns and muddy both the rule-validation and flow-aggregation engines.

## Considered Options

- **One polymorphic `Connection` with a `type` field** — matches the UI's single type dropdown, but forces Flow's time-series and PolicyRule's policy fields onto every Link. The dropdown is an authoring convenience, not a storage truth. Rejected.

## Consequences

- The canvas edge layer needs a small read-side adapter ("all edges touching this node" spans three tables) — the only place the three ever look alike.
