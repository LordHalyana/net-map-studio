# Phase 1→2→3 build order, single delivery

The system is built in phase order to de-risk — the canvas, domain model and Operation-log spine first (Phase 1: Project, Site, Zone, Device, Interface, Address, Network, Link, Service, PolicyRule + NetPlan Access-Role data), then the import pipeline (Phase 2), then the findings engine (Phase 3) — but there is no interim public ship; delivery is a single release against the design's §3.15 ten-point acceptance. Phasing is internal build sequencing, chosen so the riskiest, cheapest-to-validate bets are proven before the expensive import/correlation/findings subsystems are built.

## Considered Options

- **Build everything before validating anything** (treating §3.15 as the first milestone directly) — front-loads the two most expensive, least-validated subsystems and delays all feedback. Rejected; §3.15's "first usable release" label actually describes the Phase-3 exit.

## Consequences

- Deferred with schema seams only: Flow, Evidence, ImportJob, FieldProvenance (Phase 2), Finding (Phase 3).
- Modelled OS `Identity` / `RoleAssignment` are deferred to Phase 2 — they gain almost all their value once imported, and manually typing them for 100 devices is busywork.
