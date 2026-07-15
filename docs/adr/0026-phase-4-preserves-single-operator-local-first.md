# Phase 4 preserves single-operator local-first; collaboration is a seam, "external IdP" is the directory adapter

Design §3.14 lists Phase 4 as "advanced integrations" including a **collaborative review and approval workflow** and **external identity provider integration** — both of which appear to break ADR-0001 (single-operator, local-first; multi-user deferred). They do not. Phase 4 stays **inside** the ADR-0001 boundary:

- **Collaboration ships as a seam, not a feature.** We add a **ChangeSet review/approval _status_** (`draft → proposed → approved / rejected`, log-driven per ADR-0010) — a sign-off gate that is genuinely useful to the lone operator before applying a TO-BE proposal to AS-IS. Multi-party routing, notifications and enforcement of who-may-approve (via Access Role) are **deferred to a future multi-user phase**; the status field is the only thing built now.
- **"External identity provider integration" means the modelled directory adapter, not app auth.** It ingests **observed `Identity` objects** (ADR-0022) — it is **not** SSO for NetPlan Studio users. Our glossary's hard separation between **Identity** (modelled infrastructure) and **Access Role** (application permission) is preserved.
- **The directory adapter is offline-export only** (see also ADR-0027's egress minimisation): the operator runs a native export (LDIF flagship; Entra CSV / `Get-ADUser` JSON additive later) and imports the _file_ as read-only Evidence, exactly like the Nmap / tshark / device-state adapters. **Live directory binding is deferred** — a live LDAP result has no Evidence artifact, so it would have to be snapshotted anyway, and it would enlarge the egress surface for no gain the evidence model doesn't already give.

## Considered Options

- **Make Phase 4 the multi-user phase** — build real collaborative approval and app-level SSO, superseding ADR-0001. Legitimate, but it reshapes storage, the Operation log (concurrency / conflict resolution) and auth — a different, much larger plan. The design record nowhere states multi-user is intended _now_. Rejected for Phase 4.
- **Live directory binding in Phase 4** — richer, "always fresh", but breaks the "every fact traces to a read-only Evidence artifact" model (ADR-0018/0020) and opens the egress door wider. A point-in-time export is exactly what a provenance-tracked model wants. Rejected.
- **Build no collaboration seam at all** — cheaper, but adding a lifecycle to ChangeSet (which already backs every import and proposal) later is a migration on a live entity. The status field lands now while we are in the code. Rejected.

## Consequences

- Phase 4 is a set of **additive integrations**, not a multi-user rebuild; ADR-0001 stands.
- The directory adapter drops into the existing Observation → Identity reconciliation (P2-M10), reusing cross-host principal correlation; `Identity.scope` (ADR-0022) already exists, so it is additive.
- The ChangeSet approval status is the documented seam a future multi-user workflow enforces via Access Role — additive, not a reshape.
- Live directory binding and app-level SSO remain explicit seams for a later multi-user phase.
