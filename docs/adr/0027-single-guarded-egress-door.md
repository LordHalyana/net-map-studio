# All network egress passes one guarded, audited, opt-in door

Phases 1–3 were hermetic — Phase 3's plan states "no network egress." Phase 4 introduces the product's first outbound calls (threat-intel enrichment). Rather than let egress become an ambient property scattered across adapters, **every outbound network call routes through a single egress door** with these properties:

- **One chokepoint.** All egress goes through one module/service — never per-adapter. Auditable in one place; "egress off ⇒ provably zero outbound packets" is a testable invariant, not a hope.
- **Off by default, opt-in per project**, behind an explicit disclosure the operator acknowledges: _what_ leaves and _to whom_.
- **Every outbound call is audit-logged as evidence-grade provenance** — the call itself is a recorded collection event (see ADR-0028).
- **Local/offline feeds are always a viable zero-egress mode**, so every egress-touching feature remains fully usable with the door shut. Egress **only ever enriches** — no core workflow requires it.
- **Indicator sensitivity is graded.** The threat-intel path defaults to **file-hash lookups only**; IP/domain lookups (which reveal who the client talks to) are gated behind a second explicit per-type opt-in and named in the disclosure — §3.5/§5 "granular lookup controls", resolving open question Q10.

This is the shared door for threat-intel; the directory adapter is deliberately kept **offline** (ADR-0026), so threat-intel is egress's sole consumer in Phase 4.

## Considered Options

- **No egress at all in Phase 4** — threat-intel ships local-feeds-only, deferring any external lookup indefinitely. Maximally safe but arguably guts the "enrichment" bullet. We instead ship the door with **local-feed as the only concrete implementation** and online providers as a documented seam — safe by default, extensible without reshape. Partially adopted.
- **Egress as an ordinary configurable feature** — no single chokepoint, no disclosure ceremony. Simpler, but erodes the trust story ("your captures never leave the box") that the product is sold on, and makes "is anything leaking?" un-auditable. Rejected.

## Consequences

- New glossary term **Egress door** (`CONTEXT.md`), distinct from an ordinary API client/connector.
- A single place to audit, rate-limit, disclose and kill all outbound traffic.
- Provider-agnostic `ThreatIntelProvider` interface lives behind the door; Phase 4 ships the **local/offline feed** implementation only (online providers, e.g. VirusTotal-style or self-hosted MISP, are seams).
- The redacted findings report (P3-M12) surfaces enrichment provenance ("enriched by provider X at T") under its client-safe redaction profile.
