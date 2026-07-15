# NetPlan Studio — Phase 1 Implementation Plan

> Audience: the implementing model (Fable 5) executing this build autonomously.
> Target: **Phase 1 — the manual planner** (ADR-0014). Import (Phase 2) and findings (Phase 3) are **not** built here; their schema seams are.
> Status: ready for execution.

---

## 0. How to use this plan

1. **Read first, always:** `CONTEXT.md` (ubiquitous language) and every file in `docs/adr/`. The ADRs are binding decisions, not suggestions. When this plan and an ADR appear to conflict, stop and surface it.
2. **Use the glossary's words** in code, types, tests, commits and UI. A `Link`, a `Flow` and a `PolicyRule` are never collectively called a "connection" in the data model — only at render (ADR-0011).
3. **Work milestone by milestone, in order.** Each milestone has a **Definition of Done (DoD)** with an observable check. Do not start milestone N+1 until N's DoD passes.
4. **The spine is sacred.** Every model mutation goes through the Operation log (ADR-0010) from M2 onward. There is no "just this once" direct `UPDATE`. If you catch yourself mutating state outside an Operation, stop.
5. **Test the spine hard, test the leaves lightly.** TDD the operation apply/invert engine and the export round-trip (they are correctness-critical and cheap to test). UI gets Playwright smoke coverage, not exhaustive unit tests.
6. **Commit granularly** on a feature branch — one coherent step per commit, DoD-passing commits only. Do not commit to `main`.

### Working agreements
- TypeScript `strict` everywhere. No `any`; no `as` outside tests (this repo prefers `shoehorn` in tests).
- **Zod schemas in `packages/domain` are the single source of truth** (ADR-0017). Types are `z.infer`red. Never define an entity shape twice.
- All primary keys are **UUIDv7**, mintable on client or server (ADR-0015).
- Dark mode only for this release.
- Prefer boring, well-supported libraries. This plan names some; deviate only with a recorded reason.

---

## 1. Milestone dependency graph

```
M0 Scaffold
   └─> M1 Domain (Zod + Operations)
          └─> M2 Persistence + Operation-log engine   ← the spine
                 └─> M3 Application API
                        └─> M4 Canvas shell + client op-sync
                               ├─> M5 Library + Device nodes + Inspector
                               │      └─> M6 Networks (Membership) + Containers (Containment)
                               │             └─> M7 Connect mode: Links
                               │                    └─> M8 PolicyRules + Services + rule editor
                               ├─> M9 Undo/redo + ChangeSet + activity log   (depends on M4)
                               └─> M10 Export/import bundle + image/report    (depends on M8)
                                      └─> M11 Scale to 100+ nodes + layout + search + polish
```

---

## 2. Milestones

### M0 — Repo scaffolding & toolchain
**Realizes:** ADR-0003, ADR-0017.

**Deliverables**
- pnpm-workspaces monorepo: `packages/domain`, `apps/web`, `apps/server`.
- Root + per-package `tsconfig` (strict, composite/project references).
- Vite (`apps/web`), `tsx` dev + `tsup` build (`apps/server`).
- Vitest (unit/integration) and Playwright (e2e) configured.
- ESLint + Prettier + husky + lint-staged (use the repo's `setup-pre-commit` skill conventions).
- Root scripts: `dev`, `build`, `typecheck`, `test`, `lint`, `format`.
- **No Turborepo** yet (ADR-0017).

**DoD:** `pnpm install` clean; `pnpm -r typecheck` passes on empty packages; `pnpm -r test` runs (zero tests OK); `pnpm lint` clean; `apps/web` and `apps/server` dev servers both boot; a Playwright test opens `apps/web` and sees a root element.

---

### M1 — Domain package: entities & operations as Zod
**Realizes:** ADR-0003, ADR-0009 (lifecycleState), ADR-0011, ADR-0012, ADR-0015; seams for ADR-0008.

**Deliverables**
- Branded `Id` types (UUIDv7-backed) and a `newId()` mint helper.
- Zod schemas + inferred types for the **Phase-1 entities**: `Project`, `Site`, `Zone`, `Device`, `Interface`, `Address`, `Network`, `Link`, `Service`, `PolicyRule`.
- `lifecycleState` enum (`observed | inferred | manuallyVerified | planned | deprecated | removedInProposal`) on every modellable object; Phase-1 objects default to `planned`.
- **`Endpoint`** as a discriminated union `{ kind: 'interface'|'device'|'network'|'zone'|'subnet', id }` with per-connection-type constraint helpers (Link ⇒ interface-only; PolicyRule/Flow ⇒ broader) (ADR-0012).
- **`Operation`** as a discriminated union of invertible mutation kinds (at minimum: `CreateEntity`, `DeleteEntity`, `SetField`, `CreateLink`, `DeleteLink`, `CreatePolicyRule`, `DeletePolicyRule`, `SetMembership`, `SetContainment`), each carrying enough data to compute its inverse. Define the `invert(op, priorState): Operation` **contract** here (implementation lands in M2).
- **Seam only:** define `FieldProvenance` and the `Flow`/`Evidence`/`ImportJob`/`Finding` types as commented/exported stubs so later phases slot in without reshaping entities. Do **not** wire them anywhere.

**DoD:** `z.infer` types compile; unit tests prove each schema accepts a valid object and rejects a malformed one; endpoint constraint helpers reject a Link with a non-interface endpoint; `newId()` returns valid, sortable UUIDv7s.

---

### M2 — Persistence & the Operation-log engine  ⭐ the spine
**Realizes:** ADR-0007, ADR-0010, ADR-0015; seam for ADR-0016.

**Deliverables**
- Drizzle SQLite schema for all Phase-1 entities, UUIDv7 PKs, `lifecycleState` column on each.
- `operation_log` (append-only) and `change_sets` tables.
- **Apply/invert engine:** `apply(op)` mutates relational state **and** appends to the log in one transaction; `invert(op)` produces and applies the inverse. Current state always lives in the entity tables (not a fold over the log) — ADR-0010 forbids event-sourcing.
- `drizzle-zod` alignment check (test) proving the Drizzle tables match the domain Zod schemas (ADR-0017).
- Migration tooling wired.

**DoD (TDD this):** property/round-trip tests — for a representative sequence of Operations, `apply` then `invert` restores byte-identical state; a `ChangeSet` of N operations inverts as a unit; every `apply` writes exactly one log row; the drizzle-zod alignment test passes. **No code path mutates an entity table without going through `apply`.**

---

### M3 — Application API (Fastify)
**Realizes:** ADR-0006, ADR-0010.

**Deliverables**
- `apps/server` Fastify app.
- `Project` CRUD.
- **Single mutation surface:** `POST /projects/:id/operations` accepts one Operation or a ChangeSet, validates with the domain Zod schema, applies through the M2 engine, returns new/changed state + updated undo/redo availability. All writes funnel here.
- Read endpoints: fetch full project graph; fetch one object with its relationships; basic global search (devices, IPs, networks, rules).
- Request validation is the domain Zod schema — no hand-written validators.

**DoD:** integration tests drive the API to create a project, add a device via an Operation, read it back, search finds it; an invalid Operation is rejected with a 4xx before touching the DB; confirm (by test) there is no write route that bypasses the operation engine.

---

### M4 — Canvas shell & client op-sync
**Realizes:** ADR-0004, ADR-0005, ADR-0010, ADR-0015.

**Deliverables**
- Five-region dark-mode layout: command bar (top), component library (left nav), canvas (center), inspector (right), context panel (bottom) — matching the concept image.
- React Flow mounted: pan, zoom, minimap, fit-to-screen, zoom controls, snap-to-grid.
- Client state layer: the client **mints UUIDv7s**, applies Operations optimistically, and syncs them to `POST …/operations`; reconciles the returned state. This is the client half of the ADR-0010 spine.

**DoD:** Playwright — app loads in dark mode, all five regions render, canvas pans/zooms, minimap present; creating a trivial object optimistically appears and survives a reload (persisted through the API).

---

### M5 — Component library, Device nodes & inspector
**Realizes:** design §3.2B/§3.2D; ADR-0005.

**Deliverables**
- Left library with the concept-image categories (Network, Security, Servers/Services, Endpoints, POS/Payment, Building/IoT, Custom). Add via drag-drop, double-click, and keyboard.
- Custom React node components rendering badges: type icon, status, `lifecycleState`, (placeholders for confidence/evidence-count wired but empty in Phase 1).
- Right **inspector** for a Device: name, type, vendor, model, serial/asset, location, criticality; Interfaces with MAC/IP Addresses and Network membership; tags/notes. Edits emit Operations.
- Custom-icon upload path that still forces a structured type (design §3.2B).

**DoD:** drag a Router onto the canvas, edit it in the inspector, add an interface + IP; all changes persist via Operations and **undo** (once M9 lands) reverses them; multi-select/duplicate/delete work.

---

### M6 — Networks (Membership) & physical Containers (Containment)
**Realizes:** ADR-0013.

**Deliverables**
- `Network` rendered as a **network-node**; membership is `interface.networkId`, drawn as membership edges (a projection, not a stored Link — ADR-0013). Persist per-(network, view) layout hints.
- `Site`/`Zone` as **collapsible React Flow container nodes** (sub-flows); a Device has exactly one physical parent.
- Logical-topology layer filter that can tint/overlay by Network.

**DoD:** a dual-homed Device shows membership in **two** VLANs simultaneously (proves ADR-0013); a Device sits inside exactly one Zone; collapsing a Site hides its contents; moving a Device between VLANs is a single field edit (one Operation), not edge surgery.

---

### M7 — Connect mode: Links
**Realizes:** ADR-0011, ADR-0012; design §3.3.

**Deliverables**
- **Connect mode** (not freehand): pick source Interface → pick destination → compact form → app renders the `Link` edge (design §3.3).
- Link endpoints constrained to Interfaces (ADR-0012); invalid targets rejected in the UI.
- Edge-bundling scaffold: multiple records between the same pair collapse into one expandable edge (design §3.3).

**DoD:** create a physical Link between two device interfaces; attempting to terminate a Link on a Network/Device is prevented; two links between the same pair render as one expandable bundled edge.

---

### M8 — PolicyRules, Services & the rule editor
**Realizes:** ADR-0011, ADR-0012; design §3.11.

**Deliverables**
- `Service` objects (protocol, port/range, process).
- `PolicyRule` with polymorphic endpoints (device/network/zone/subnet — ADR-0012), direction, action (allow/deny/reject/monitor), logging, owner, justification, optional review date.
- Bottom **context panel** as the link/rule editor (matches the concept image's LINK INFO panel): source/destination, protocol/service, direction, action, logging toggle.
- Rule validation (a starter set from §3.11): overlapping/contradictory, any-to-any, orphaned (referencing deleted objects), shadowed-by-broader. Surface as inline warnings (not `Finding`s — that entity is Phase 3).

**DoD:** author an allow rule *network-to-network* (e.g. Staff-VLAN → Servers-VLAN) and a default deny; the validator flags an any-to-any rule and an orphaned rule; rules persist via Operations.

---

### M9 — Undo/redo, ChangeSet & activity log
**Realizes:** ADR-0010.

**Deliverables**
- Undo/redo controls in the command bar, wired to the M2 invert engine.
- ChangeSet grouping so a multi-step edit undoes/redoes as one unit.
- Bottom-panel **Activity log** view rendering the operation history (the audit trail, free from ADR-0010).

**DoD:** perform a 5-step edit, undo all 5 and redo all 5 with state matching at each point; a grouped ChangeSet undoes atomically; the activity log lists the operations in order.

---

### M10 — Export/import bundle, image & report
**Realizes:** ADR-0016; design §3.12; acceptance #9/#10.

**Deliverables**
- **`.netplan` bundle** export: versioned `project.json` carrying every entity with its UUIDv7 (Phase 1 = json + schema version; evidence subtree/manifest are seams — ADR-0016).
- Import/restore that preserves UUIDs and object relationships exactly.
- PNG/SVG topology export (from React Flow).
- Structured JSON + CSV export (devices, interfaces, services, links, rules); a basic HTML/PDF design report.
- Redaction-profile scaffold: a serialize-time field filter (e.g. hide usernames/public IPs/paths).

**DoD (TDD the round-trip):** export a project, start from an empty store, import the bundle, and assert **every object identifier and relationship is identical** (acceptance #10); PNG/SVG and JSON/CSV exports produce valid files; a redaction profile omits the configured fields.

---

### M11 — Scale, layout & polish
**Realizes:** design acceptance #1; §3.2C.

**Deliverables**
- Performance pass to keep **100+ devices** interactive: viewport culling, node/edge memoization, bundled edges.
- Auto-arrange via a layout engine (elkjs or dagre over React Flow) with **manual pin** flags so operator-positioned nodes aren't moved (design §3.2C).
- Global search, fit-to-screen, grid, layer filters (physical/logical), zoom presets.

**DoD:** a generated 100-device project pans/zooms/selects without perceptible lag (acceptance #1); auto-arrange rearranges unpinned nodes only; search locates a device/IP/VLAN/rule.

---

## 3. Phase-1 Definition of Done (maps to design §3.15)

Phase 1 is complete when an operator can:
- ✅ Create a Project and build **100+ Devices** without the canvas becoming impractical (#1 → M11).
- ✅ Create typed **Links** and **PolicyRules** with protocols, ports, direction and action (#2 → M7, M8).
- ✅ Model **Networks/VLANs**, **Interfaces** and physical grouping (#3 partial → M6; modelled OS **Identity/RoleAssignment** deferred to Phase 2 per ADR-0014).
- ✅ Distinguish **planned** objects via `lifecycleState` (#7 partial → M1/M5; full AS-IS/TO-BE overlay is Phase 2 per ADR-0009).
- ✅ **Export** the project, a topology image and a structured report (#9 → M10).
- ✅ **Restore** from the exported bundle without losing identifiers (#10 → M10).

Acceptance items #4 (import), #5 (reconcile), #6 (trace to evidence) and #8 (findings) are **out of Phase 1 scope** — they belong to Phases 2–3.

---

## 4. Seams to leave for later phases (build the shape, not the feature)

| Seam | Where | For |
|---|---|---|
| `FieldProvenance` sidecar type | `packages/domain` (defined, unused) | Phase 2 provenance (ADR-0008) — entity tables must need **no migration** to add it |
| `Flow`, `Evidence`, `ImportJob` types | `packages/domain` (stubs) | Phase 2 import pipeline |
| `Finding` type | `packages/domain` (stub) | Phase 3 findings engine |
| Proposal/overlay machinery | `lifecycleState` column present; overlay logic absent | Phase 2 AS-IS/TO-BE (ADR-0009) |
| Evidence subtree + hash manifest | `.netplan` bundle envelope | Phase 2 (ADR-0016) |
| Access-Role enforcement | Access-Role data modellable; not enforced | Multi-user (ADR-0001) |

**Do not build these features.** Only ensure the types/columns/envelope exist so adding them later is additive, never a reshape.

---

## 5. First actions

1. Create and check out a feature branch (do not work on `main`).
2. Execute **M0**; stop at its DoD and confirm before proceeding.
3. Proceed milestone by milestone, committing at each green DoD.
