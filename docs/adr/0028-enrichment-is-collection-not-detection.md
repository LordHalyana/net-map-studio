# Threat-intel enrichment is a collection step producing Evidence, never a live detection step

Threat-intel is externally sourced and **time-varying** — a hash that is "clean" today is "malicious" tomorrow with no change to the operator's graph. If a **Rule** called an external provider _during_ detection, re-running analysis could flip a Finding with zero evidence change, **violating ADR-0023's guarantee that detection is a pure recomputation**. So enrichment is modelled as **collection, not detection**:

1. **An egress fetch produces a read-only Evidence artifact.** Looking up an indicator (through the ADR-0027 door) records _provider, exact query, raw response, fetched-at timestamp and TTL_ as a first-class **Evidence** artifact — the outbound call _is_ an evidence-collection event, audit-logged as such.
2. **Detection consumes cached enrichment Evidence deterministically.** A Rule (e.g. "known-malicious-indicator match") reads the stored enrichment as ordinary input and emits **Findings** through the _existing_ engine — no special finding path, no live call. This is the P3 local-indicator-matcher seam grown up: the same matcher, its indicator set now refreshable through the door into Evidence.
3. **Staleness is explicit.** Enrichment Evidence carries fetched-at + TTL; past TTL it is flagged stale until re-fetched. Time-variance becomes visible provenance, not silent nondeterminism.

## Considered Options

- **Live lookup inside detection** — a Rule calls the provider while analysing. Simpler to picture, but makes analysis results depend on _when_ they ran, breaks re-run determinism (ADR-0023), and gives findings no reproducible Evidence to cite. Disqualifying. Rejected.

## Consequences

- New glossary term **Enrichment** (`CONTEXT.md`): an externally-sourced annotation about an indicator, fetched through the egress door and stored as read-only Evidence, consumed by Rules deterministically.
- ADR-0023 (pure detection) and ADR-0018/0020 (everything traces to Evidence) both hold unchanged; enrichment is just another Evidence source.
- Re-analysis is reproducible: identical stored enrichment ⇒ identical findings. A verdict change requires a _new_ fetch (a new Evidence artifact), which is itself audited and dated.
- Enrichment-derived Findings carry Confidence/Severity like any rule output; a stale-enrichment Finding can be surfaced with lowered confidence, consistent with provenance-derived confidence (ADR-0023/0024).
