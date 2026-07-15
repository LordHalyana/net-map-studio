# NetPlan Studio — Phase 3 Implementation Plan

> Audience: the implementing model executing this build autonomously.
> Target: **Phase 3 — security findings** (ADR-0014, design §3.8 / §3.14 Phase 3). This is the phase that completes the §3.15 "first usable release" — acceptance **#8** ("clearly labelled, evidence-backed security findings").
> Prerequisite: **Phase 2 is complete** — the Evidence store, ImportJob framework, canonical Observation pipeline, reconciliation-as-ChangeSet, device-state / Nmap / tshark adapters, provenance surfacing, AS-IS/TO-BE/Diff and Identity overlay all exist (Phase-2 M1–M10).
> Status: ready for execution.

---

## 0. How to use this plan

1. **Read first, always:** `CONTEXT.md` (ubiquitous language) and every file in `docs/adr/`. The Phase-3 decisions live in **ADR-0023–0025**; ADR-0008 (provenance sidecar), 0009 (AS-IS/TO-BE overlay), 0010 (Operation-log spine), 0014 (phasing), 0016/0017 (bundle + Zod single source), 0019 (background worker), 0020 (observation pipeline) are load-bearing here too. ADRs are binding; if this plan and an ADR conflict, stop and surface it.
2. **Use the glossary's words.** A **Rule** emits **Findings**; a Finding has a derived **detection** half and a persisted **disposition** half, joined by a **Fingerprint** (ADR-0023). A **Baseline** is the expected-state yardstick a Finding measures deviation against (ADR-0025). A Finding is _never_ a confirmed-compromise verdict. A §3.11 `RuleWarning` (policy validation, already shipped in Phase 1) is **not** a Finding.
3. **Work milestone by milestone, in order.** Each has a **Definition of Done (DoD)** with an observable check. Do not start N+1 until N's DoD passes.
4. **The spine is still sacred.** Every _disposition_ mutation — status change, note, accept-risk — goes through the Operation log (ADR-0010, ADR-0023). **Detection output is never written through the Operation log**: it is a pure recomputation. There is no findings path that mutates entity tables outside the log for the persisted half, and no logged mutation for the derived half.
5. **Build the P3 spine before real rules.** M1–M4 (rule-engine harness → disposition → confidence/severity → Baseline) are hardened with a **fixture rule** and TDD'd _before_ any real detection is written (M5+). This mirrors how Phase 2 built the observation pipeline before real adapters, and Phase 1 built the Operation engine before the UI.
6. **Test the spine hard, test the leaves lightly.** TDD the fingerprint/reconciliation (M1), the disposition/undo (M2), confidence derivation (M3) and Baseline apply (M4). Each rule family (M5–M9) TDDs its pure detection function against fixtures. UI (M11) gets Playwright smoke coverage.
7. **Conservative by construction.** Breadth is the full §3.8 category set; _depth_ of each heuristic stays conservative (obvious high-signal only), thresholds tunable via rule config (ADR-0024). Never emit a confirmed-compromise verdict; network-wide warnings say the network **may be** compromised and show the correlation chain (§3.8).
8. **Commit granularly** on a feature branch — one coherent, DoD-passing step per commit. Not `main`.

### Working agreements

- TypeScript `strict`; no `any`; no `as` outside tests (prefer `shoehorn`).
- **Zod schemas are the single source of truth** (ADR-0017). The `Rule` config schema, `Baseline` entity, finding **disposition** entity and the detection record are all Zod-first; types are `z.infer`red.
- All primary keys are **UUIDv7** (ADR-0015). The existing `findingIdSchema` / `severitySchema` in `packages/domain/src/seams.ts` are promoted from seam to real, wired types here.
- Detection logic lives in a `findings/` subtree in **`packages/domain`** (next to `rule-validation.ts`), pure and unit-testable. The **server** background worker (ADR-0019) invokes the engine and persists disposition; the **web** app renders findings.
- No network egress in Phase 3. "Known indicator match" uses **local operator IoC lists** only (rule config); external threat-intel is Phase 4.
- Dark mode only. Prefer boring, well-supported libraries.

---

## 1. Milestone dependency graph

```
M1 Rule-engine spine: Rule + RuleConfig Zod schema, detection record,          ⭐ TDD
   Fingerprint, analysis-run + op-log watermark, FIXTURE rule (no real rules)   ← P3 spine
   └─> M2 Finding disposition through the Operation log: fingerprint-keyed      ⭐ TDD, the spine
          disposition entity, status workflow, notes, undo; re-analysis
          reconciliation (unchanged / stale / new); coverage tracking
          ├─> M3 Confidence from provenance + Severity from rule config          ⭐ TDD
          ├─> M4 Baseline entity (expected services/traffic per scope,           ← spine entity
          │      through the Operation log)                                       ⭐ TDD
          │
          │   ── rule families (each: pure detection fn + config + TDD) ──
          ├─> M5  Filename / path family (+ local indicator match)
          ├─> M6  Process & persistence family
          ├─> M7  Exposed-service family (reads Baseline)                          needs M4
          ├─> M8  External-connection family: unexpected destination + beacon
          ├─> M9  Segmentation + identity-anomaly + collection-quality families
          └─> M10 Network-wide correlation capstone (two-pass)                    needs M5–M9
                 └─> M11 Findings UI: dashboard, inspector finding views,
                        disposition workflow controls, findings layer filter,
                        coverage surfacing
                        └─> M12 Findings report + client-safe redaction profile
                               + findings in CSV / JSON export                    → acceptance #8
```

**Out of Phase 3** (build the shape, not the feature): external **threat-intel enrichment** (Phase 4 — the local indicator matcher is the seam); the AD/Entra/LDAP **directory adapter** (Phase 4, ADR-0022); fully **data-defined custom rules** (Phase 4 — the rule-config seam is here); **firewall-vendor config export** (design Q12, deferred); **Access-Role enforcement** (multi-user, ADR-0001).

---

## 2. Milestones

### M1 — Rule-engine spine ⭐ TDD ← the P3 spine begins

**Realizes:** ADR-0023, ADR-0024.

**Deliverables**

- **`Rule` model** in `packages/domain/src/findings/`: a typed detection unit `{ id, ruleVersion, category, defaultSeverity, frameworkRefs?, detect(ctx) }` plus a **Zod `RuleConfig` schema** (thresholds, per-rule severity override, enable/disable, references to allow/deny string lists and Baselines). The config carries its own **version/hash**.
- **Detection record** (the derived half of a Finding, ADR-0023): `{ fingerprint, ruleId, ruleVersion, configHash, category, title, affected, evidenceRefs, contributingProvenanceRows, severity, confidence, explanation, verificationSteps }`. Recomputed, cached per run — **never written through the Operation log**.
- **`Fingerprint`** = stable hash of `(ruleId, affected object id, salient evidence key)`. Deterministic; the join key to disposition.
- **Analysis-run harness:** runs enabled rules over a `ProjectState` + provenance + evidence in the **background worker** (ADR-0019); stamps the **Operation-log watermark** (op position analyzed) on the run so staleness is computable.
- **Fixture rule** emitting canned detections — **no real detection logic yet** (mirrors Phase-2's fixture adapter).

**DoD (TDD this):** the fixture rule run over a fixture graph produces detection records with **stable fingerprints** (same input → identical fingerprint; a changed affected object → different fingerprint); a run records the op-log watermark; the config hash changes when config changes and is stamped on every detection; **no detection output touches the Operation log** (assert by test).

---

### M2 — Finding disposition through the Operation log ⭐ TDD, the spine

**Realizes:** ADR-0010, ADR-0023.

**Deliverables**

- **Disposition entity** (promotes `findingSchema`/`findingIdSchema` from `seams.ts`) keyed by **fingerprint**: `status` (`new | acknowledged | underReview | falsePositive | acceptedRisk | resolved`), `notes`, audit history. Persisted as a real Drizzle table with a `drizzle-zod` alignment test (ADR-0017).
- **Disposition mutations are Operations** (`SetFindingStatus`, `SetFindingNote`) applied through the existing Phase-1 apply-engine — **undoable and audited** like every other change. Invertible (Phase-1 M2 inversion).
- **Re-analysis reconciliation:** after a run, join detections to dispositions by fingerprint — unchanged fingerprint **keeps its disposition**; a fingerprint present in disposition but absent from the new run is **retained and marked stale/resolved-by-evidence**; a new fingerprint starts at `new`.
- **Coverage tracking:** per device, record which input classes were available this run (so M9's collection-quality rule and M11's coverage surfacing have data); mark rules that could not run as **not-evaluated**, not passed.

**DoD (TDD this):** set a finding to `falsePositive`, re-run analysis on the same graph → the finding **keeps `falsePositive`** (not reset to `new`); a status change is **undoable** and appears in the audit history; a finding whose evidence disappears is marked stale, not silently deleted; a brand-new detection appears as `new`; **confirm by test there is no disposition path that mutates the findings table outside the Operation log.**

---

### M3 — Confidence from provenance, Severity from rule config ⭐ TDD

**Realizes:** ADR-0023, ADR-0024; design §3.8 (Severity ⟂ Confidence).

**Deliverables**

- **Severity** is **rule-declared** (`defaultSeverity`), overridable by rule config — a property of the _kind_ of problem, not computed from data.
- **Confidence** is **derived from the provenance** of the fields a finding rests on: a function of the combined/minimum `Confidence` of the `FieldProvenance` rows the detection referenced (the §3.7 contributor scores from Phase-2 M2), plus any rule-specific certainty factor. The detection record's `contributingProvenanceRows` makes this traceable and recomputable.

**DoD (TDD this):** a finding built on an exact-MAC-matched, two-source-corroborated field scores **higher confidence** than the same finding built on a single low-confidence OS guess; changing an underlying provenance row's confidence and re-running changes the finding's confidence; severity is unchanged by data and equals the rule's declared value (or its config override); Severity and Confidence are always independent values.

---

### M4 — Baseline entity ← spine entity ⭐ TDD

**Realizes:** ADR-0025, ADR-0010.

**Deliverables**

- **`Baseline`** Zod entity + Drizzle table (`drizzle-zod` aligned): an operator-declared statement of **expected services / expected traffic** for a **scope** (`Zone | Network | Device` by id), versioned. Edited **through the Operation log** (`CreateEntity`/`SetField` Operations) — undoable, audited, part of the `.netplan` bundle.
- **Orphaned-reference handling** reusing the §3.11 pattern: a Baseline referencing a deleted object surfaces the same way orphaned PolicyRules do.
- Findings **cite a Baseline id + version** in their evidence when they measure deviation against it.

**DoD (TDD this):** create a Baseline of expected services for a Zone through the Operation log; it round-trips in the `.netplan` bundle; editing it is undoable; deleting a referenced Device surfaces the Baseline's now-orphaned reference; a rule can read the Baseline for a scope and cite its id+version.

---

### M5 — Filename / path rule family

**Realizes:** design §3.8 (suspicious filename·path, masquerading/double-extension, unexpected executable location, known indicator match).

**Deliverables**

- Pure detection functions + config for: **suspicious filename/path**, **potential masquerading / double-extension**, **unexpected executable location**, and **known indicator match** against a **local operator IoC list** (hashes / filenames / destinations in rule config — no egress).
- Inputs: filenames, executable paths, file hashes from the device-state contract (P3 optional fields, ADR-0018).

**DoD:** a double-extension executable in a temp path yields the expected findings with rule-declared severity and provenance-derived confidence; a hash matching the local IoC list yields a `known indicator match`; **absent** file data yields **no false clean** (feeds M9 coverage, not a silent pass); each finding traces to its evidence.

---

### M6 — Process & persistence rule family

**Realizes:** design §3.8 (unusual persistence entry, unapproved remote-access software).

**Deliverables**

- Pure detection functions + config for **unusual persistence entry** (startup entries, scheduled tasks, services) and **unapproved remote-access / administration software** (matched against an approved-software allowlist in config).
- Inputs: startup/scheduled-task/service entries, installed remote-access software, running processes and parent/child when available.

**DoD:** an installed remote-access tool not on the approved-software allowlist yields an `unapproved remote-access software` finding; a persistence entry launching from an unexpected location yields an `unusual persistence entry` finding; allowlisting the tool in config and re-running drops the finding (or, if already dispositioned, respects the disposition); hosts with no process/persistence data produce no false clean.

---

### M7 — Exposed-service rule family (reads Baseline)

**Realizes:** design §3.8 (high-risk exposed management service, clear-text/obsolete protocol); ADR-0025.

**Deliverables**

- Pure detection functions + config for **high-risk exposed management service** (management ports exposed beyond the Baseline's expected services for the scope) and **clear-text / obsolete protocol use**.
- Reads the **Baseline** (M4): a service is a finding when it departs from the scope's expected-service Baseline; the finding cites the Baseline id+version.

**DoD:** a management service exposed on a host, absent from that Zone's expected-service Baseline, yields a `high-risk exposed management service` finding citing the Baseline; the same service _in_ the Baseline yields nothing; a clear-text protocol yields a `clear-text/obsolete protocol` finding at rule-declared severity.

---

### M8 — External-connection rule family

**Realizes:** design §3.8 (unexpected external destination, beacon-like periodic communication).

**Deliverables**

- Pure detection functions + config for **unexpected external destination** (external IP/domain connections outside expected-traffic Baseline) and **beacon-like periodic communication** (periodicity over aggregated `Flow` first-seen/last-seen/count; conservative threshold in config).
- Reads Phase-2 `Flow` aggregates; a destination with no known Device produces a low-confidence finding **without inventing a Device** (consistent with Phase-2 M6).

**DoD:** flows to an external destination not in the Baseline yield an `unexpected external destination` finding; a periodic flow pattern crossing the configured beacon threshold yields a `beacon-like` finding; a sub-threshold pattern yields nothing; a flow endpoint with no known Device is handled without fabricating one.

---

### M9 — Segmentation, identity-anomaly & collection-quality families

**Realizes:** design §3.8 (unexpected cross-VLAN communication, privileged-user/service-account anomaly, evidence conflict / incomplete collection); §3.11.

**Deliverables**

- **Unexpected cross-VLAN / segmentation** detection: observed `Flow`s that cross security zones in conflict with the segmentation Baseline / intended PolicyRules (reuses §3.11 segmentation-bypass logic where applicable, but emits a **Finding**, not a `RuleWarning`).
- **Privileged user / service-account anomaly** detection over Phase-2 `Identity` / `RoleAssignment` (e.g. a service account with interactive-admin scope across hosts).
- **Collection-quality** rule (coverage-aware, ADR/plan §7): emit **`evidence conflict or incomplete collection`** findings from the M2 coverage data — high **confidence** (we know data is missing), low **severity** — naming the rule families that could not run per host.

**DoD:** a flow crossing zones against the segmentation Baseline yields a `cross-VLAN` finding (distinct from any §3.11 `RuleWarning`); a service account holding admin on multiple hosts yields a `privileged/service-account anomaly` finding; a host imported without process data yields a low-severity, high-confidence `incomplete collection` finding listing the un-evaluable rule families.

---

### M10 — Network-wide correlation capstone (two-pass)

**Realizes:** design §3.8 (network-wide compromise assessment, conservative thresholds).

**Deliverables**

- **Second correlation pass** consuming the per-object findings (M5–M9) plus flows/identities and emitting **network-scoped Findings** (`affected = null` or a Zone/Network endpoint — the schema already allows it). Correlation rules are "findings about findings."
- Conservative threshold config for the §3.8 examples: same suspicious destination contacted by several unrelated devices; similar persistence/executable indicators across hosts; a privileged principal communicating with many internal systems unusually; observed lateral communication conflicting with the segmentation model.
- Every network-wide Finding states the network **may be** compromised, identifies the **correlation logic** and shows the **evidence chain** — **never** confirmed compromise (§3.8).

**DoD:** the same local-IoC-matched destination detected on three unrelated hosts crosses the correlation threshold and yields **one** network-wide Finding naming the correlation logic and the three evidence chains; a single-host indicator does **not** trigger it; the network-wide Finding is a normal Finding (fingerprint, disposition, undoable) with network scope; it never states confirmed compromise.

---

### M11 — Findings UI

**Realizes:** design §2 (Findings dashboard), §3.2 (inspector), §3.8; layer filters (§3.2 "findings" layer).

**Deliverables**

- **"Findings" left-nav section + dashboard:** findings grouped by severity, filterable by category/status/scope; run-status and **staleness banner** ("computed as of op #N — N operations behind → Re-run").
- **Inspector finding views:** per affected object, its findings with category, severity, confidence, **evidence chain**, detection rule + rule/config version, operator explanation and **verification steps**.
- **Disposition workflow controls:** acknowledge / under-review / false-positive / accepted-risk / resolved + notes — each an undoable Operation (M2).
- **Findings canvas layer filter** (§3.2) and **coverage surfacing** (per-device "N/M rule families evaluable").
- **"Run analysis" / "Re-run"** action; auto-run on ImportJob commit is wired server-side (background worker).

**DoD (Playwright smoke):** import evidence → findings appear without a manual step (auto-run on commit); open a finding → see its evidence chain, rule version and verification steps; mark it false-positive → status persists and is undoable; re-run after a manual edit → staleness banner clears; coverage shows per-device evaluability.

---

### M12 — Findings report, client-safe redaction & exports → acceptance #8

**Realizes:** design §3.12 (security findings report, CSV/JSON, redaction profiles), §3.13; design Q15.

**Deliverables**

- **Dedicated Security Findings report** (§3.12): grouped by severity, evidence chain per finding, rule + version, verification steps, and the correlation logic for network-wide findings. Built on the existing `buildHtmlReport` / report infrastructure.
- **Findings in existing exports:** `findings` CSV type and JSON export, flowing through the existing `applyRedaction` / `redactionProfileSchema` pipeline.
- **`client-safe` default redaction profile** (design Q15): masks usernames, secret-like hashes, external IPs and evidence paths by default when exporting outside the engineering team (§3.13). One named profile reusing existing redaction machinery — not a new subsystem.

**DoD:** export a Security Findings report → every finding shows severity, confidence, evidence references and verification steps (**acceptance #8**); the `findings` CSV and JSON round-trip through redaction; applying the `client-safe` profile masks usernames/hashes/external-IPs/evidence-paths while leaving finding titles/severity intact; the report is generated from the model, reproducible against the stamped rule/config versions.

---

## 3. Phase-3 Definition of Done (completes design §3.15)

Phase 3 is complete when an operator can:

- ✅ Receive **clearly labelled, evidence-backed security findings** across the full §3.8 category set (**acceptance #8** → M5–M10, M11).
- ✅ See each finding's **Severity and Confidence as independent values**, its **evidence chain**, its **detection rule + version**, and **verification steps** (§3.8 → M3, M8, M11).
- ✅ **Disposition** findings (acknowledge / false-positive / accepted-risk / resolved) durably and **undoably**, surviving re-analysis and re-import (ADR-0023 → M2).
- ✅ Get a **network-wide "may be compromised" assessment** only when conservative correlation thresholds are met, with the correlation logic and evidence chain — never a confirmed verdict (§3.8 → M10).
- ✅ Export a **Security Findings report** and findings in CSV/JSON, with a **client-safe redaction** default (§3.12, Q15 → M12).

With Phase 1 (#1–#3, #9 image/#10 restore), Phase 2 (#4–#7) and Phase 3 (#8, plus the findings report completing #9), **all ten §3.15 acceptance criteria are met** — this is the first usable release (ADR-0014).

---

## 4. Seams to leave for later phases (build the shape, not the feature)

| Seam                              | Where                                                             | For                   |
| --------------------------------- | ----------------------------------------------------------------- | --------------------- |
| External threat-intel enrichment  | local indicator matcher (M5) is the interface; off by default     | Phase 4               |
| Fully data-defined custom rules   | `RuleConfig` seam present; logic stays code in P3 (ADR-0024)      | Phase 4               |
| Directory adapter (AD/Entra/LDAP) | `Identity.scope` present; identity-anomaly reads observed only    | Phase 4 (ADR-0022)    |
| Classification-framework mapping  | `Rule.frameworkRefs?` optional field; §3.8 categories are primary | Later (design Q9)     |
| Firewall-vendor config export     | vendor-neutral policy modelling only                              | Deferred (design Q12) |
| Access-Role enforcement           | `AccessRole` modellable, not enforced                             | Multi-user (ADR-0001) |

**Do not build these.** Only ensure the types/config hooks/interfaces exist so adding them later is additive, never a reshape.

---

## 5. First actions

1. Create and check out a feature branch (not `main`).
2. Read `CONTEXT.md` and **ADR-0023–0025** end to end (plus ADR-0008, 0009, 0010, 0017, 0019, 0020).
3. Execute **M1**; stop at its DoD and confirm before proceeding.
4. Proceed milestone by milestone, committing at each green DoD. TDD the spine (M1–M4) before writing any real rule.
