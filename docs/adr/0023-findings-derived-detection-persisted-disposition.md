# Findings: derived detection, persisted disposition, joined by fingerprint

A Finding has two separable halves and they are stored differently. **Detection** — the output of a Rule over the committed graph, provenance and evidence — is a **pure, derived recomputation**: it is never written through the Operation log, because it is an _analysis of_ the model, not a _mutation of_ it. **Disposition** — the analyst workflow (`new → acknowledged → underReview → falsePositive | acceptedRisk | resolved`), notes and audit history (§3.8 "Finding structure") — is a **first-class persisted entity mutated only through the Operation log** (ADR-0010), so status changes and notes are undoable and audited like every other change.

The two halves are joined by a **Fingerprint** = a stable identity derived from `(ruleId, affected object id, salient evidence key)`. Detection is idempotent and re-runs freely (on ImportJob commit and on demand — see the trigger decision in the Phase-3 plan); each run reconciles by fingerprint: an unchanged finding **keeps its disposition**, a disappeared finding's disposition is **retained and marked stale/resolved-by-evidence**, a genuinely new fingerprint starts at `new`. Each analysis run stamps the Operation-log position it analyzed, so the UI can show findings as "computed as of op #N" and flag staleness.

## Considered Options

- **Materialize findings as full entities through the Operation log on every run** — uniform with all other data, but re-analysis after an import either wipes and re-creates findings (destroying the analyst's `falsePositive` disposition) or requires a bespoke merge that is exactly the fingerprint reconciliation below, minus the clean derived/persisted split. It also floods the audit log with machine-generated churn. Rejected.
- **Keep everything derived, disposition included** — cheapest, but analyst decisions (false-positive, accepted-risk, notes) are durable human facts that must survive re-runs, be undoable and be audited. Storing them outside the spine would fork the mutation model. Rejected.

## Consequences

- The "spine is sacred" invariant holds: only the durable, human-meaningful half (disposition) touches the Operation log; detection stays a cheap pure function in `packages/domain`.
- A Finding's persisted schema is its disposition keyed by fingerprint; the detected content (title, category, affected, evidence, contributing provenance rows, severity, confidence) is recomputed and cached per run, not logged.
- Confidence is **derived from the provenance** of the fields a finding rests on, so a finding must record its contributing provenance rows for the value to recompute correctly (see ADR-0024 and the Phase-3 plan).
- Re-analysis is safe by construction and can run automatically on every ImportJob commit without destroying analyst work.
