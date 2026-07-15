# NetPlan Studio — Phase 2 Implementation Plan

> Audience: the implementing model executing this build autonomously.
> Target: **Phase 2 — import & AS-IS reconstruction** (ADR-0014). Findings (Phase 3) and directory sync (Phase 4) are **not** built here; their seams are.
> Prerequisite: **Phase 1 is complete** (manual planner MVP through M11 — the Operation-log spine, ChangeSet, `.netplan` bundle and 100-device canvas all exist).
> Status: ready for execution.

---

## 0. How to use this plan

1. **Read first, always:** `CONTEXT.md` (ubiquitous language) and every file in `docs/adr/`. The Phase-2 decisions live in **ADR-0018–0022**; ADR-0008, 0009, 0010, 0016, 0017 are load-bearing here too. ADRs are binding; if this plan and an ADR conflict, stop and surface it.
2. **Use the glossary's words.** An **Adapter** emits **Observations**; Observations normalize, dedup and score into a **proposed ChangeSet**; committing it makes **Observed/Inferred** entities. A `Link`, `Flow` and `PolicyRule` are never collectively a "connection" in the data model (ADR-0011).
3. **Work milestone by milestone, in order.** Each has a **Definition of Done (DoD)** with an observable check. Do not start N+1 until N's DoD passes.
4. **The spine is still sacred.** Every model mutation — imports included — goes through the Operation log (ADR-0010). Import commit is _applying a ChangeSet_, not a bulk `INSERT`. There is no import fast-path that bypasses `apply`.
5. **Build the P2 spine before real parsers.** M1–M3 (evidence store → observation pipeline → reconciliation-commit) are hardened with a **fixture adapter** and TDD'd _before_ any real format is parsed (M4+). This mirrors how Phase 1 built the Operation engine before the UI.
6. **Test the spine hard, test the leaves lightly.** TDD the observation pipeline (M2), the reconciliation/commit/rollback (M3) and each Adapter's format→Observation mapping. UI (M7–M10) gets Playwright smoke coverage.
7. **Commit granularly** on a feature branch — one coherent, DoD-passing step per commit. Not `main`.

### Working agreements

- TypeScript `strict`; no `any`; no `as` outside tests (prefer `shoehorn`).
- **Zod schemas are the single source of truth** (ADR-0017). The canonical device-state schema, the Observation type and the new entity tables are all Zod-first; types are `z.infer`red; the JSON-Schema artifact is _generated_ from Zod, never hand-written.
- All primary keys are **UUIDv7** (ADR-0015), mintable client or server.
- The Phase-1 seams in `packages/domain/src/seams.ts` (`Evidence`, `ImportJob`, `Flow`, `FieldProvenance`, `Identity` scope) become **real, persisted tables** here — with **no reshape** of Phase-1 entity tables (that was the point of ADR-0008/0016).
- Dark mode only. Prefer boring, well-supported libraries.

---

## 1. Milestone dependency graph

```
M1 Evidence store + ImportJob framework (background worker, hash-on-ingest,
   split-by-class retention, bundle evidence subtree, FIXTURE adapter)   ← P2 spine
   └─> M2 Canonical Observation model + provenance sidecar +
          normalization / dedup / confidence scoring                     ⭐ TDD
          └─> M3 Reconciliation-as-ChangeSet-editing (propose → resolve →
                 commit → rollback)                                       ⭐ TDD, the spine
                 ├─> M4 Device-state schema + validator CLI + device-state adapter
                 │      └─> M5 Nmap XML adapter (second source → dedup/confidence merge)
                 │             └─> M6 tshark flow-summary adapter (aggregation at scale)
                 ├─> M7 Reconciliation UI (review screen, conflict panel, commit/rollback)
                 │      └─> M8 Provenance surfacing + evidence views (acceptance #6)
                 ├─> M9 AS-IS / TO-BE / Diff overlay (ADR-0009)
                 └─> M10 Identity overlay + cross-host principal reconciliation
```

**Out of Phase 2** (build the shape, not the feature): the `Finding` engine (Phase 3), the AD/Entra/LDAP **directory adapter** (Phase 4, ADR-0022), the **Netcat** supplemental adapter (later — §3.14 omits it), threat-intel enrichment (Phase 4), and **Access-Role enforcement** (multi-user, ADR-0001).

---

## 2. Milestones

### M1 — Evidence store & ImportJob framework ← the P2 spine begins

**Realizes:** ADR-0016, ADR-0019, ADR-0006.

**Deliverables**

- Drizzle tables promoting the seams to real persistence: `evidence`, `import_jobs` (from `packages/domain/src/seams.ts`). `drizzle-zod` alignment test proves they match the domain Zod schemas (ADR-0017). **No Phase-1 entity table is reshaped.**
- **Evidence store:** SHA-256 **hash on ingest**, original evidence **read-only after import**, **split-by-class retention** (ADR-0019) — structured evidence stored inline in the bundle's evidence subtree; PCAP raw blob opt-in (default: hash + manifest only).
- `.netplan` bundle envelope gains the **evidence subtree + hash manifest** (the ADR-0016 seam comes online).
- **ImportJob state machine:** `pending → parsing → review → committed | rolledBack | failed`.
- **Background worker harness:** isolated parse jobs with resource limits (file size, execution time, recursion depth, decompression ratio). Ships with a trivial **fixture adapter** emitting canned Observations — **no real parser yet**.
- API: `POST /projects/:id/imports` (create ImportJob, store Evidence, enqueue parse); `GET …/imports/:jobId` (status).

**DoD:** upload a fixture file → an `ImportJob` is created, the file is hashed and stored read-only, the worker runs the fixture adapter to `review`; an over-limit / decompression-bomb file is rejected by the worker limits **without crashing the app**; the drizzle-zod alignment test passes; a bundle round-trips an evidence subtree + manifest.

---

### M2 — Canonical Observation model & provenance sidecar ⭐ TDD

**Realizes:** ADR-0008, ADR-0020.

**Deliverables**

- **`Observation`** Zod type in `packages/domain`: a neutral per-source claim `{ targetKind, fields, confidenceContributor, evidenceRef }` (glossary term).
- **`FieldProvenance` sidecar table** (ADR-0008) keyed by `(entityType, entityId, field)`. Write path **denormalizes the winning value onto the entity table transactionally through the Operation log** — same spine as every other mutation.
- **Pipeline stages, each independently testable:** normalization (canonical MAC/IP/hostname forms) → deduplication (entity-keying rules; **Flow aggregation** to one record per `(source, destination, service)` with count/first-seen/last-seen) → confidence scoring (the §3.7 contributor table).

**DoD (TDD this):** Observations of the same host from two sources dedup to **one** entity with a provenance row **per field**; conflicting values produce **competing sidecar rows** (no silent merge — §3.7); Flow observations aggregate with correct count/first/last; confidence scores match the §3.7 table; the denormalized entity value always equals the current winning sidecar row.

---

### M3 — Reconciliation as ChangeSet editing ⭐ TDD, the spine

**Realizes:** ADR-0009, ADR-0010, ADR-0021.

**Deliverables**

- **Builder:** scored Observations → a **proposed ChangeSet** of Operations (`CreateEntity`/`SetField`, `lifecycleState: observed | inferred`), **not yet applied**.
- **Conflict detector** against the committed graph.
- **Resolution operations that rewrite the pending ChangeSet:** `merge` (rewrite a Create into a SetField on the existing object), `keep-separate`, `replace`, `ignore` (drop the Operation).
- **Commit:** apply the edited ChangeSet through the existing (M2/Phase-1) apply-engine; the ChangeSet **is** the ImportJob's rollback boundary. **Rollback = ChangeSet inversion** (already built in Phase-1 M2).

**DoD (TDD this):** a proposed ChangeSet against an empty graph commits N `Observed` objects; a `merge` resolution rewrites a Create into a SetField and commits onto the **existing** object; `ignore` drops it; rolling back an ImportJob inverts the whole ChangeSet atomically; **confirm by test there is no import path that mutates entity tables outside the Operation log.**

---

### M4 — Device-state schema, validator CLI & device-state adapter

**Realizes:** ADR-0017, ADR-0018.

**Deliverables**

- **`packages/import-contract`:** the canonical **device-state Zod schema** (P2-reconstruction fields **required/strict**; P3 security fields **optional/loose** — ADR-0018), a `schemaVersion` constant, a **generated JSON-Schema artifact**, and a **standalone validator CLI** bin the client runs offline / in CI. One Zod definition feeds the CLI, the in-app adapter and the JSON Schema.
- **Device-state Adapter:** JSON → Observations for `Device`, `Interface`, `Address`, `Service` (from listening ports + owning process), `Flow` (from active connections), and `Identity` + `RoleAssignment` (from local users/groups/admins/sudoers; a domain principal is recorded with `Identity.scope = domain` — ADR-0022).

**DoD:** the validator CLI accepts a conformant sample and rejects a malformed one **offline, without the app**; importing a device-state file for 3 hosts yields the expected Devices/Interfaces/Services/Identities through the M1–M3 pipeline; `DOMAIN\admin` as a local admin becomes a domain-scoped Identity RoleAssignment; the `ImportJob` records the `schemaVersion`.

---

### M5 — Nmap XML adapter

**Realizes:** ADR-0018, ADR-0020.

**Deliverables**

- **Nmap XML Adapter** → Observations: hosts, addresses, MAC/vendor, open ports, service identification, OS guesses, script output, scan timestamps — each carrying its §3.7 confidence contributor.

**DoD:** importing an Nmap XML that overlaps a device-state host **corroborates** it (dedups to one Device carrying provenance from **both** sources); an exact MAC match scores strong confidence; an OS guess scores lower; a **conflicting hostname does not silently merge** — it enters the reconciliation queue.

---

### M6 — tshark flow-summary adapter

**Realizes:** ADR-0019, ADR-0020.

**Deliverables**

- **tshark JSON/CSV flow-summary Adapter** → aggregated `Flow` Observations. This milestone exercises **pre-aggregation + the background worker at SMB scale** (ADR-0019).

**DoD:** a summary of ~100k conversations **aggregates to ≤~5k Flows** with correct counts/first-seen/last-seen, parsed **in the worker without blocking the API**; flows render as **bundled edges**; a flow endpoint with no known Device produces a **low-confidence Flow without inventing a Device**.

---

### M7 — Reconciliation UI

**Realizes:** design §3.2E, §3.7; ADR-0021.

**Deliverables**

- **"Imports and Evidence"** left-nav section; an import wizard (upload → job status).
- **Review screen:** candidate records, matching evidence, conflicting values, proposed action (merge / keep-separate / replace / ignore) — the UI **edits the pending ChangeSet** (M3).
- Bottom context-panel **"Import reconciliation conflicts"** view (design §3.2E); confidence shown per candidate; **commit / rollback** controls.

**DoD:** run an import to `review`, resolve a conflict (merge) in the UI, **commit** → objects appear on the canvas as `Observed`; **rollback** removes them cleanly; the queue never auto-merges a conflict.

---

### M8 — Provenance surfacing & evidence views (acceptance #6)

**Realizes:** ADR-0008; design §3.2D, §3.4.

**Deliverables**

- **Inspector per-field provenance:** for each imported field show source type, **Evidence reference**, confidence, and accept/reject/override status; an **override** control writes a manual provenance row + an Operation (undoable).
- **Evidence viewer:** file, hash, parser name/version, chunk reference.
- Wire the **confidence / evidence-count node badges** left as empty placeholders in Phase-1 M5.

**DoD:** every imported field **traces to its Evidence** in the inspector (**acceptance #6**); overriding an imported value records provenance and is **undoable**; evidence-count and confidence badges render on imported nodes.

---

### M9 — AS-IS / TO-BE / Diff overlay

**Realizes:** ADR-0009; design §3.10.

**Deliverables**

- **Overlay machinery:** a proposal ChangeSet layered on AS-IS — additions as `Planned`, removals as `Removed-in-proposal`, **modifications as field-deltas on the same UUID** (never a duplicate object — ADR-0009).
- **AS-IS / TO-BE / Diff canvas mode toggle**; `lifecycleState`-driven rendering (Observed / Inferred / Manually-verified / Planned / Deprecated / Removed-in-proposal badges); **before/after** in the context panel.

**DoD:** a TO-BE proposal that re-VLANs an existing Device renders as a **field-delta on the same object**, not a duplicate; Diff mode lists additions/removals/modifications; toggling to AS-IS hides planned-only objects; the proposal is **one ChangeSet, undoable as a unit**.

---

### M10 — Identity overlay & cross-host principal reconciliation

**Realizes:** design §3.9; ADR-0022.

**Deliverables**

- **`Identity` / `RoleAssignment` rendering** as an **overlay + inspector views**, not on the main topology by default (§3.9 — keeps the canvas readable).
- `scope: local | domain`; **best-effort correlation** of the same domain principal observed across hosts into one Identity via the reconciliation queue.
- **"Users and Roles"** left-nav section.

**DoD:** a domain principal seen as admin on two hosts **reconciles to one domain-scoped Identity with two RoleAssignments**; local users remain per-host; identities are **hidden from the main canvas** until the overlay is enabled.

---

## 3. Phase-2 Definition of Done (maps to design §3.15)

Phase 2 is complete when an operator can:

- ✅ **Import** an Nmap XML file and a client device-state JSON file (#4 → M4, M5).
- ✅ **Review, merge or reject** automatically proposed devices and relationships (#5 → M3, M7).
- ✅ **Trace every imported property** back to its source Evidence (#6 → M8).
- ✅ **Separate observed and planned** objects via the AS-IS / TO-BE / Diff overlay (#7 → M9).
- ✅ Reconstruct **local + observed-domain identities** with RoleAssignments (§3.9 partial → M4, M10; directory sync is Phase 4).

Acceptance item **#8 (security findings)** is **out of Phase 2 scope** — it is Phase 3.

---

## 4. Seams to leave for later phases (build the shape, not the feature)

| Seam                                  | Where                                                        | For                    |
| ------------------------------------- | ------------------------------------------------------------ | ---------------------- |
| `Finding` type + rule engine          | `Finding` stub exists; consumes committed graph + provenance | Phase 3 findings       |
| Directory adapter (AD / Entra / LDAP) | `Identity.scope` present; correlation is best-effort         | Phase 4 (ADR-0022)     |
| Netcat supplemental adapter           | Observation pipeline is adapter-agnostic                     | Later (§3.14 omits it) |
| Threat-intel enrichment               | off by default; evidence carries hashes                      | Phase 4                |
| Access-Role enforcement               | `AccessRole` modellable, not enforced                        | Multi-user (ADR-0001)  |

**Do not build these.** Only ensure the types/columns/pipeline hooks exist so adding them later is additive, never a reshape.

---

## 5. First actions

1. Create and check out a feature branch (not `main`).
2. Read `CONTEXT.md` and **ADR-0018–0022** end to end.
3. Execute **M1**; stop at its DoD and confirm before proceeding.
4. Proceed milestone by milestone, committing at each green DoD.
