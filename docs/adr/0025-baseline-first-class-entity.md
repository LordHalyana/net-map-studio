# Baseline is a first-class model entity, not rule config

A **Baseline** — an operator's statement of _expected_ services or traffic for a scope (Zone, Network or Device) — is a **first-class model entity persisted and mutated through the Operation log** (ADR-0010), referencing model objects by id. It is the yardstick a Finding measures deviation against: an exposed service or a cross-zone flow is only a Finding when it departs from the Baseline. Findings **cite the specific Baseline id + version as evidence**. This is distinct from the opaque operator allow/deny string lists (filenames, hashes, approved-software names), which are Rule config (ADR-0024).

## Considered Options

- **Fold baselines into rule config** — simplest, no new entity, but an "expected services for Zone X" statement is an assertion _about the modelled environment_ that references real Devices/Zones/Networks by UUID, must be audited and undoable, and is cited by findings. Burying it in a config blob loses referential integrity (orphaned references when an object is deleted), audit and undo. Rejected.
- **A single global baseline** — one expected-state document per project, no scope. Too coarse: expectations differ per Zone/segment, and exposure/segmentation findings need scope-local expectations. Rejected.

## Consequences

- New glossary term **Baseline** (in `CONTEXT.md`), explicitly separated from Rule-config string lists and from PolicyRule.
- Baselines are edited through the Operation log like every other entity — undoable, audited, and part of the `.netplan` bundle.
- Because a Baseline references objects by id, deleting a referenced object surfaces as an orphaned-reference concern the same way §3.11 already handles orphaned PolicyRules — reusing existing machinery.
- Exposed-service, cross-VLAN/segmentation and "observed traffic with no matching expectation" findings have a real, versioned object to compare against and to cite.
- A Finding's Confidence can incorporate the Baseline's own provenance/certainty, consistent with provenance-derived confidence (ADR-0023, ADR-0024).
