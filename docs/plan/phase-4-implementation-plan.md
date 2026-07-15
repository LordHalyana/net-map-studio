# NetPlan Studio — Phase 4 Implementation Plan

> Audience: the implementing model executing this build autonomously.
> Target: **Phase 4 — advanced integrations** (design §3.14 Phase 4). Phase 4 makes the product _more capable_; it does **not** complete the first usable release — that was done at the end of Phase 3 (all ten §3.15 acceptance criteria are already met).
> Prerequisite: **Phase 3 is complete** — the rule engine, finding detection/disposition split, Fingerprint reconciliation, Baseline entity, the full §3.8 rule families, network-wide correlation, findings UI and the redacted findings report all exist (Phase-3 M1–M12).
> Status: ready for execution.
> Decisions: **ADR-0026** (Phase 4 stays single-operator local-first), **ADR-0027** (single guarded egress door), **ADR-0028** (enrichment is collection, not detection). These three are binding for this phase.

---

## 0. How to use this plan

1. **Read first, always:** `CONTEXT.md` (ubiquitous language, now including **Enrichment** and **Egress door**) and every file in `docs/adr/`. The Phase-4 decisions live in **ADR-0026–0028**; ADR-0001 (single-operator local-first), 0008 (provenance sidecar), 0010 (Operation-log spine), 0017 (Zod single source), 0018 (owned import contract), 0019 (evidence store + background worker), 0020 (canonical observation pipeline), 0022 (identity scope / directory adapter → P4), 0023 (derived detection / persisted disposition) and 0024 (hybrid rule engine) are load-bearing here too. ADRs are binding; if this plan and an ADR conflict, stop and surface it.
2. **Phase 4 has no spine — it has invariants.** Unlike P1 (Operation log), P2 (Observation pipeline) and P3 (rule engine), Phase 4 is a set of **largely independent, additive tracks** with a single small shared foundation (the egress door). There is no data structure that threads all of them. The discipline is **invariant preservation**, not spine-following. Every milestone must uphold all four:
   - **(I1) Everything traces to read-only Evidence** with Provenance (ADR-0018/0020).
   - **(I2) Detection is a pure recomputation** — never a live external call (ADR-0023, ADR-0028).
   - **(I3) Every model mutation goes through the Operation log** (ADR-0010).
   - **(I4) All network egress passes the single guarded door** (ADR-0027).
     If a track cannot be built without breaking one of these, **stop and surface it** — do not weaken the invariant.
3. **Work milestone by milestone.** Each has a **Definition of Done (DoD)** with an observable check. M1 → M2 is a hard dependency (threat-intel needs the door). M3–M6 are independent and may proceed in any order once M1 is green; the recommended order retires risk first.
4. **Build the egress door foundation-first, with a _stub_ provider,** before any real outbound integration — mirroring how P3 hardened the rule engine with a _fixture rule_ and P2 built the observation pipeline before real adapters. The headline test lands in M1: **egress off ⇒ provably zero outbound packets.**
5. **Local-first stays the default truth.** Egress is off by default, opt-in per project, disclosed and audited. Every egress-touching feature must be fully usable with the door shut (local/offline feeds). Egress only ever _enriches_ — no core workflow may require it.
6. **Test the foundation hard, test the leaves lightly.** TDD the egress door (M1: the off-switch guarantee, the audit record, the disclosure gate) and the enrichment-as-Evidence pipeline (M2: determinism under re-analysis, TTL/staleness). Each adapter (M3, M4) TDDs its pure parse→Observation function against fixtures. Worker hardening (M5) TDDs cancel/resume/bounded behaviour. UI touches get Playwright smoke coverage.
7. **Additive, never a reshape.** Every track drops into an existing seam (Observation pipeline, rule engine, Operation log, redacted report). If a track wants to _extend_ a core shape (e.g. add an Observation `targetKind`), that is out of scope — see §4. Only build the hooks that make the deferred feature additive later.
8. **Commit granularly** on a feature branch — one coherent, DoD-passing step per commit. Not `main`.

### Working agreements

- TypeScript `strict`; no `any`; no `as` outside tests (prefer `shoehorn`).
- **Zod schemas are the single source of truth** (ADR-0017). The egress-call audit record, the enrichment Evidence payload, the `ThreatIntelProvider` interface's request/response types, the directory-export and Zeek/NetFlow Observation mappings, and the ChangeSet review-status field are all Zod-first; types are `z.infer`red.
- All primary keys are **UUIDv7** (ADR-0015).
- Enrichment logic that a Rule consumes lives in the `findings/` subtree of **`packages/domain`**, pure and deterministic over stored Evidence (ADR-0028). The **egress door and its providers live in the server** (the only tier permitted to make outbound calls); the **web** app renders enrichment provenance, the egress audit trail, the new evidence views and the ChangeSet sign-off control.
- **Egress is server-only and single-doored.** No outbound network call may originate outside the egress-door module. A lint/architecture check should fail any other network client in server code.
- The threat-intel `ThreatIntelProvider` interface ships with the **local/offline feed implementation only**. Online providers (VirusTotal-style, self-hosted MISP) are seams — do not build them.
- Dark mode only. Prefer boring, well-supported libraries.

---

## 1. Milestone dependency graph

```
M1 Egress door: single guarded chokepoint, off-by-default + per-project opt-in,       ⭐ TDD  ← P4 foundation
   disclosure gate, audit record (Zod), STUB provider. "off ⇒ zero packets" test.
   └─> M2 Threat-intel enrichment: ThreatIntelProvider interface (LOCAL-FEED impl      ⭐ TDD
          only), enrichment fetch → read-only Evidence (provider/query/response/
          fetched-at/TTL), Rule consumes it deterministically, staleness surfaced,
          hash-first with IP/domain gated. Enrichment provenance in redacted report.

   ── independent additive tracks (any order once M1 green; recommended order below) ──
   ├─> M3 Directory-export adapter (LDIF flagship) → Observations → Identity          ⭐ TDD (parse fn)
   │      reconciliation (reuses P2-M10 cross-host principal correlation). Hermetic.
   ├─> M4 Zeek/NetFlow flow adapter → Flow (existing targetKind). Hermetic.           ⭐ TDD (parse fn)
   ├─> M5 Worker hardening: resumable / cancellable / concurrent ImportJobs,          ⭐ TDD
   │      backpressure + bounds so a pathological capture can't OOM/wedge. SMB tier
   │      unchanged (ADR-0019); queue-shaped seam for a future higher tier.
   └─> M6 ChangeSet approval-status seam: draft → proposed → approved/rejected,       ⭐ TDD
          log-driven (ADR-0010), solo sign-off gate before applying a TO-BE proposal.

   M7 Phase-4 polish: egress audit view, enrichment surfacing in findings UI +
      redacted report, disclosure copy, seams documented. → Phase-4 DoD checklist
```

**Recommended track order after M1→M2:** M3 (directory-export) and M4 (Zeek/NetFlow) first — lowest risk, prove the additive-adapter path; then M5 (worker hardening); then M6 (approval-status seam, smallest and most isolated); then M7 polish.

**Out of Phase 4** (build the shape, not the feature) — see §4.

---

## 2. Milestones

### M1 — Egress door ⭐ TDD ← the P4 foundation

Build the single guarded chokepoint (ADR-0027) with a **stub provider** — no real outbound integration yet.

- Server-only egress module: **all** outbound calls must route through it (architecture check fails any other network client).
- Per-project **egress-enabled** flag, **off by default**; a **disclosure gate** the operator must acknowledge (what leaves, to whom) before the flag can be set.
- **Audit record** (Zod, UUIDv7): timestamp, provider id, indicator type, exact query, outcome. Every call through the door writes one.
- Stub provider returns canned responses so the plumbing is testable without egress.

**DoD:** With egress off, an automated test proves **zero outbound packets** leave for any operation. With egress on (post-disclosure), a stub call writes exactly one audit record. No network client exists in server code outside the door module.

### M2 — Threat-intel enrichment ⭐ TDD (needs M1)

- `ThreatIntelProvider` interface (Zod request/response); ship the **local/offline feed implementation only** (operator-supplied IoC set — the P3 indicator-matcher seam grown up). Online providers are seams — do not build.
- **Enrichment fetch → read-only Evidence** (ADR-0028): provider, exact query, raw response, fetched-at, TTL. The fetch is a collection event through the M1 door; the local-feed path is zero-egress.
- A **Rule consumes stored enrichment Evidence deterministically** and emits Findings through the existing engine — no live call in detection (I2).
- **Staleness:** past TTL, enrichment is flagged stale; re-fetch is an explicit door action.
- **Hash-first:** default indicator type is file-hash; IP/domain lookups gated behind a second explicit per-type opt-in and named in the disclosure (Q10).
- Enrichment provenance flows into the P3 redacted findings report ("enriched by provider X at T"), respecting the client-safe redaction profile.

**DoD:** Re-running analysis over unchanged enrichment Evidence yields **identical** findings (determinism, I2). A local-feed enrichment produces a Finding citing the enrichment Evidence, with **zero egress**. A stale enrichment is surfaced as stale. IP/domain lookup is impossible without its explicit opt-in.

### M3 — Directory-export adapter ⭐ TDD (needs M1 only for the invariant harness; hermetic)

- **LDIF** flagship parser → **Observations** (`identity` targetKind), dropping into the P2-M10 Observation → Identity reconciliation and cross-host principal correlation. Entra CSV / `Get-ADUser` JSON are additive later (do not build).
- The export file is read-only **Evidence** with Provenance, exactly like Nmap/tshark/device-state (I1). Native format — no owned contract (ADR-0026, contrast ADR-0018).
- No egress: the operator runs the export with their own tools; NetPlan ingests the file.

**DoD:** Importing a fixture LDIF produces Identity Observations that reconcile (merge/keep-separate) through the existing queue, each traceable to the LDIF Evidence. Domain principals seen on multiple hosts correlate via `Identity.scope` (ADR-0022).

### M4 — Zeek/NetFlow flow adapter ⭐ TDD (hermetic)

- Parser for Zeek `conn.log` / NetFlow-IPFIX → **Observations** (`flow` targetKind, existing), higher-fidelity than the P2 tshark adapter, dropping into the same aggregation (`(source, destination, service)`) and reconciliation.
- Read-only Evidence + Provenance (I1). No egress.

**DoD:** Importing a fixture Zeek `conn.log` produces aggregated Flow Observations that reconcile into Flows, each traceable to the Evidence, respecting the SMB-tier aggregation ceiling (ADR-0019).

### M5 — Worker hardening ⭐ TDD (SMB tier unchanged)

- Make ImportJobs **resumable, cancellable and concurrent**; add **backpressure and bounds** so a pathological large capture cannot OOM or wedge the UI. Progress granularity improved.
- **Tier unchanged** (ADR-0019 SMB: ~500 devices, ~100k raw flows → ≤~5k, ~2k identities). Keep the worker **queue-shaped** so a future higher tier / distributed queue is a swap, not a reshape. Graph-DB stays gated behind real measurements (design Alternatives).

**DoD:** A large fixture import can be **cancelled** mid-run leaving no partial commit, **resumed** to completion, and run **concurrently** with another ImportJob; a bounded pathological input is rejected/limited rather than OOM-ing. Scale target is unchanged.

### M6 — ChangeSet approval-status seam ⭐ TDD

- Add a **review status** to ChangeSet (`draft → proposed → approved / rejected`) with timestamp + note, mutated **through the Operation log** (I3). A solo **sign-off gate** before applying a TO-BE proposal to AS-IS.
- "Approver" is the single operator now; multi-user enforcement (who-may-approve, via Access Role) is a documented seam (ADR-0026) — do not build.

**DoD:** An operator can move a proposal ChangeSet to `approved` (undoably, audited) and the AS-IS→TO-BE apply respects the sign-off gate. The status transition is a logged Operation.

### M7 — Phase-4 polish

- **Egress audit view** in the web app (every outbound call, when, to whom, outcome).
- **Enrichment surfacing** in the findings UI + redacted report; disclosure copy finalised.
- Seams (§4) documented in-code and in this plan.

**DoD:** The Phase-4 DoD checklist (§3) passes end to end.

---

## 3. Phase-4 Definition of Done

§3.15 acceptance is already fully met (end of Phase 3). Phase 4 defines its **own** DoD, framed on capabilities that **preserve the four invariants**. Phase 4 is complete when an operator can:

- ✅ **Enrich findings** against a local/offline threat-intel feed, with the enrichment stored as **read-only Evidence**, consumed by Rules **deterministically** (re-analysis is reproducible — I2), and surfaced with provenance in the redacted report (M2).
- ✅ Turn egress **on per project behind a disclosure**, see **every outbound call audited**, and prove that with egress **off, zero packets leave** (I4, M1/M7).
- ✅ Import a **directory export (LDIF)** and **Zeek/NetFlow** evidence through the existing pipeline, each fact traceable to read-only Evidence (I1) and reconciled via the existing queue (M3, M4).
- ✅ **Cancel, resume and parallelise** large imports within the unchanged SMB tier without OOM/wedge (M5).
- ✅ **Sign off a proposal** (ChangeSet `approved`) before applying it, the transition logged as an Operation (I3, M6).
- ✅ Demonstrably **not** violate I1–I4 in any track (invariant review at M7).

---

## 4. Seams to leave for later phases (build the shape, not the feature)

| Seam                                   | Where                                                                   | For                        |
| -------------------------------------- | ----------------------------------------------------------------------- | -------------------------- |
| Online threat-intel providers          | `ThreatIntelProvider` interface present; only local-feed impl shipped   | Later (VirusTotal / MISP)  |
| Live directory binding (AD/Entra/LDAP) | offline export adapter is the interface; no live bind                   | Multi-user / later         |
| Firewall/switch config import          | would extend Observation `targetKind` to PolicyRule/Link — not additive | Deferred (design Q12)      |
| LLDP/CDP neighbour topology import     | same — Link is not an Observation `targetKind`                          | Deferred                   |
| Additional native directory formats    | LDIF adapter shape generalises (Entra CSV, `Get-ADUser` JSON)           | Additive later             |
| Additional additive adapters           | Nessus/OpenVAS vuln-scan → `Service`; drops into pipeline               | Additive later             |
| Fully data-defined custom rules        | `RuleConfig` seam present; logic stays code (ADR-0024)                  | Extensibility phase        |
| Higher scale tier / distributed queue  | worker kept queue-shaped; SMB tier unchanged                            | Gated behind measurements  |
| Multi-user collaborative approval      | ChangeSet review-status present; enforcement via Access Role deferred   | Multi-user (ADR-0001/0026) |
| App-level SSO / external IdP for auth  | not built; "external IdP" = modelled directory adapter only             | Multi-user (ADR-0026)      |

**Do not build these.** Only ensure the types/config hooks/interfaces exist so adding them later is additive, never a reshape.

---

## 5. First actions

1. Create and check out a feature branch (not `main`).
2. Read `CONTEXT.md` (esp. **Enrichment**, **Egress door**) and **ADR-0026–0028** end to end (plus ADR-0001, 0010, 0018, 0019, 0020, 0022, 0023, 0024).
3. Execute **M1** (egress door, stub provider); stop at its DoD — prove **egress off ⇒ zero packets** — and confirm before proceeding.
4. Proceed M2 (threat-intel), then M3–M6 in the recommended order, committing at each green DoD. TDD the foundation (M1) and the enrichment pipeline (M2) before the leaf adapters.
