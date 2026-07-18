# NetPlan Studio — Codebase Health Implementation Plan

> Audience: the implementing model executing this build.
> Source: four-way codebase audit (domain packages, server, web, tooling) performed 2026-07-18 against `CONTEXT.md`, the ADRs, and the working agreements. No feature work in scope — this plan hardens what exists: automation, performance, consistency, and test coverage.
> Status: ready for execution.

---

## 0. How to use this plan

1. **Read first:** `CONTEXT.md` (Endpoint, Flow, Finding), ADR-0010 (Operation-log mutation spine), ADR-0012 (polymorphic endpoints), ADR-0019 (evidence store scale targets), ADR-0023 (findings = derived detection + persisted disposition), ADR-0027 (single guarded egress door).
2. **No behaviour changes unless a milestone says so.** Most milestones are refactors or hardening — existing tests are the safety net and must stay green untouched wherever possible. Where a milestone fixes a defect (C-track), add the regression test in the same commit.
3. **The Operation log stays the spine** (ADR-0010). C2 changes _how many_ Operations a secret scan emits, not whether secrets flow through Operations.
4. **Keep the tests green.** The e2e suite shares one DB (`workers: 1`) and uses the per-test reset fixture from `apps/web/e2e/fixtures` — any new e2e test imports `test` from `'./fixtures'` and seeds its own state.
5. **Commit granularly** on a feature branch — one coherent, DoD-passing milestone step per commit.
6. **Track A lands first.** It builds the net (CI + real linting) that catches regressions from every other track. B, C and D are then independent of each other.

### Dependency shape

- **A1 → A2** (the hook can only shrink once CI runs the full suite). A3–A4 follow A1 but are independent of each other. **A3 will surface new lint errors — fixing them is part of A3's DoD.**
- **B1 → B2** (the cross-zone rule's fix consumes B1's per-run index). B3–B4 independent.
- **C1–C4** independent of each other.
- **D1 → D2** (the shared fetch helper is what the operation-log hook builds on). D3–D6 independent.

---

## Track A — Automation & guardrails

### Current state (audit 2026-07-18)

There is no `.github/` directory — nothing runs typecheck, lint, or tests on push/PR. The only enforcement point is `.husky/pre-commit`, which runs `pnpm exec lint-staged` (Prettier only, per `.lintstagedrc`), then a **full-repo** `pnpm run typecheck`, then a **full-repo** `pnpm run test` — the ~3-minute commit stall. ESLint never runs automatically anywhere, so the working agreements it encodes (`no-explicit-any: error`, `consistent-type-assertions: never` in `eslint.config.js`) are enforced by nothing. The config also uses the non-type-checked preset (no `no-floating-promises` on an async Fastify codebase) and has no react-hooks plugin for `apps/web`.

### A1 — CI workflow

Create `.github/workflows/ci.yml` running on PRs and pushes to `main`:

1. Jobs (parallel where possible): `typecheck` (`pnpm -r typecheck`), `lint` (`pnpm lint` + `pnpm format:check`), `test` (`pnpm -r test`), `e2e` (`pnpm --filter @netplan/web exec playwright install chromium --with-deps`, then `pnpm test:e2e`).
2. pnpm via `corepack enable` or `pnpm/action-setup`; Node 22 (matches `engines`); cache the pnpm store.
3. Upload the Playwright report as an artifact on e2e failure.

**DoD:** a PR shows all four checks; a deliberately broken lint rule / failing test on a scratch branch is caught; e2e passes in CI (watch for the `:3001` port-leak gotcha — the graceful-shutdown fix from #93/#104 should hold).

### A2 — Fast pre-commit hook

1. `.lintstagedrc`: keep Prettier for `*`, add `"*.{ts,tsx}": "eslint --fix --max-warnings 0"`.
2. `.husky/pre-commit`: drop `pnpm run test` entirely (CI owns it now). Keep typecheck but consider scoping; if scoping is fiddly, a full `pnpm -r typecheck` (~seconds per package, no test run) is acceptable — the test suite was the 3-minute cost.
3. Verify a commit with a staged lint violation is rejected and a clean commit completes in well under a minute.

**DoD:** commit time drops from ~3 min to seconds; lint violations can no longer be committed; CI (A1) is the backstop for tests.

### A3 — Lint depth: type-aware rules + react-hooks

1. Switch `eslint.config.js` to `tseslint.configs.recommendedTypeChecked` with `parserOptions.projectService: true`, scoped to `src/` of all four workspaces (keep test/e2e/config files on the untyped preset to avoid project-service cost there).
2. Add `eslint-plugin-react-hooks` (flat config) scoped to `apps/web/**` — `rules-of-hooks: error`, `exhaustive-deps: warn` at minimum.
3. Fix everything the new rules surface. Expect genuine catches: unawaited promises in Fastify handlers and stale-closure deps in web effects. Do not blanket-disable; per-line disables need a reason comment.

**DoD:** `pnpm lint` green with the stricter config; no new blanket rule-offs; any per-line disables justified.

### A4 — Test-infra consistency sweep

1. **Playwright double server:** the second `webServer` entry in `apps/web/playwright.config.ts` runs root `pnpm dev`, which starts the API server a second time onto `:3001`. Change it to `pnpm --filter @netplan/web dev`.
2. **Coverage:** add `@vitest/coverage-v8` and a root `test:coverage` script; wire a coverage summary into CI (report-only, no threshold gate yet).
3. **Shared vitest base:** one `vitest.config` base (or workspace projects file) so server/domain stop relying on implicit defaults and all packages share reporter/coverage settings.
4. **Housekeeping:** align the TypeScript specifier (root `^5.9.3` vs workspaces `~5.9.3` — pick one, ideally a pnpm catalog); confirm `pnpm --filter @netplan/web typecheck` resolves `node:` builtins in `playwright.config.ts`/`e2e/` and add `@types/node` if it's resolving by accident.

**DoD:** e2e run starts exactly one server per port; `pnpm test:coverage` produces a report locally and in CI; all packages typecheck with explicit vitest config.

---

## Track B — Domain engine: resolver unification & performance

### Current state

CONTEXT.md's Endpoint entry names the resolver as the single owner of `(kind, id)` resolution, and every consumer _outside_ the domain package uses it (`apps/server/src/engine/store.ts`, `export/report.ts`, `apps/web/src/canvas/graphToFlow.ts`). But the findings rules themselves hand-roll the fan-out: `packages/domain/src/findings/rules/helpers.ts:113-135` (`flowEndpointDevice`, `endpointCoversDevice`) and `packages/domain/src/rule-validation.ts:78-90` (`endpointExists`) re-implement kind-switches and linear lookups. The cost is both drift risk (a forgotten `case 'subnet'` silently misroutes) and performance: `crossZoneFlowRule` (`findings/rules/segmentation-identity.ts:20-42`) iterates every Flow × every PolicyRule × a full interface re-scan per check — cubic over the collection CONTEXT.md calls high-cardinality.

### B1 — Per-run resolution index on RuleContext

1. Build a per-run index at engine-run start: the Map-backed `endpointResolver(state)` plus precomputed `device → networkIds` and `interface → device` maps. Attach it to `RuleContext` so every rule receives it.
2. Rewrite `flowEndpointDevice`, `endpointCoversDevice`, `deviceNetworkIds`, `policyAllows` (`helpers.ts`) and `endpointExists` (`rule-validation.ts:78-90`, including the subnet/network aliasing at `:93`) to consume the index — no `state.devices.find(...)` inside rule bodies.
3. Detection stays derived-per-run (ADR-0023): the index lives for one engine run, never persisted.

**DoD:** all findings/rule tests green unchanged (pure refactor — identical findings output on the seeded demo scene); grep shows no remaining `.find(` per-entity scans inside `findings/rules/`; a unit test asserts the index resolves each endpoint kind identically to the old helpers.

### B2 — Fix `crossZoneFlowRule` complexity

1. With B1's index, `policyAllows` becomes a lookup against precomputed device→network membership instead of re-scanning interfaces per rule per flow.
2. If rule-matching is still the hot loop, pre-bucket PolicyRules by resolved endpoint device/network/zone id once per run.
3. Add a coarse perf guard: a unit test running the engine over a generated state (~5k flows, ADR-0019's scale target) asserting completion within a generous wall-clock bound — a canary against reintroducing O(n²).

**DoD:** identical findings output; the 5k-flow canary passes comfortably.

### B3 — Findings integrity gaps

1. **Fingerprint stability tests:** `findings/fingerprint.ts` + `findings/hash.ts` are the ADR-0023 contract (dispositions survive re-runs only if fingerprints are stable) yet have no direct tests. Add: `stableStringify` key-order invariance; `computeFingerprint` stable across permuted input arrays; distinct across salient-key changes.
2. **One InputClass classifier:** `findings/coverage.ts:65-70` and `findings/inputs.ts:64-72` maintain two independent kind→`InputClass` maps that `collectionQualityRule` unions. Extract one shared classifier so a new class can't be added to one side only.
3. **Dead export:** remove `isValidPolicyEndpoint` (`endpoints.ts:61-63`, zero references) — or, if it was meant as the policy-endpoint validation seam, wire it into the operation mutation path instead. Decide, don't leave it dangling.

**DoD:** fingerprint tests in `packages/domain/test/`; one classifier with both call sites migrated; no unreferenced exports in `endpoints.ts`.

### B4 — Import-contract walker `$ref` guard

`packages/import-contract/src/format-fields.ts` walks the generated JSON Schema handling only inline `type`/`properties`/`items`. Zod's `toJSONSchema` may dedupe structurally-identical schemas into `$ref` — and `packageEntrySchema`/`remoteAccessEntrySchema` (`device-state.ts:142-152`) are byte-identical, exactly the trigger shape. If that fires, the field table silently drops branches.

1. Minimum: extend the existing round-trip test to assert the generated schema contains no `$ref`/`$defs`/`anyOf`, so the failure is loud instead of silent.
2. Preferred: teach the walker to resolve `$defs`/`$ref` (it's ~20 lines) and keep the assertion as documentation of what's handled.
3. Either way, add a comment on the twin schemas noting they are intentionally separate so they can diverge (or share a base — implementer's choice).

**DoD:** a schema containing a `$ref` can no longer silently produce a truncated field table.

---

## Track C — Server hardening

### C1 — Delete-dependency checks stop loading the whole project

`apps/server/src/engine/store.ts:677-687` (`flowTouches`/`ruleTouches`, used at `:698,708,737,758-759`) pulls **all** project flows/rules into JS and runs `.some(...)` on every zone/device/interface/network delete — against ADR-0019's 5k-flow target, and despite `queryFlows` (`:363`) already having `json_extract` SQL predicates built for this.

1. Replace with `EXISTS`/`LIMIT 1` queries using the same `json_extract` endpoint predicates, inside the same transaction.
2. Keep the error messages identical (tests assert on them).

**DoD:** existing delete-guard tests green; no `.all()` full-table load on the delete path (verify by grep); a test with a few hundred seeded flows still gets the correct rejection.

### C2 — Secret scan: batch and scope

`scanEvidenceSecrets` (`apps/server/src/imports/store.ts:823-862`, called from `POST .../commit` at `app.ts:333`) re-lists and re-decodes **all** project evidence on every commit (N+1 `getEvidenceBlob`) and emits one `engine.applyOperation` — one transaction, one op-log row — per detected secret, synchronously on the request path.

1. Scope the scan to the evidence records of the job being committed, not the whole project.
2. Collect new detections into a **single ChangeSet** applied via `applyChangeSetWith` — one transaction, one undo unit, still fully on the operation log (ADR-0010).
3. Preserve dedup against already-recorded secrets so re-commits don't duplicate.

**DoD:** a commit with N secrets produces one logged ChangeSet (assert op-log row count in a test); committing a second job does not re-decode the first job's blobs (instrument or assert via call-count spy); existing secret-detection e2e/unit tests green.

### C3 — Lifecycle & bundle-import integrity

1. **Close SQLite on shutdown:** `db/index.ts:39` returns `{ db, sqlite }` but `app.ts:92` keeps only `db`; no `onClose` closes the handle, so WAL/`-shm` files never checkpoint on graceful exit and every `buildApp` in tests leaks a handle. Capture `sqlite`, add `app.addHook('onClose', ...)` **after** the existing import-drain hook (`app.ts:111`) so the queue drains before close.
2. **Atomic `.netplan` import:** `app.ts:275-284` runs `engine.importState(...)` and `importStore.restoreAttachments(...)` (`imports/store.ts:772-788`) as two separate transactions — a failure between them leaves a project with no evidence. Fold both into one transaction.
3. **Validate restored rows' project:** `restoreAttachments` inserts `importJobs`/`evidence` rows trusting each row's own `projectId` — a crafted bundle can inject rows into a _different_ existing project. Assert `record.projectId === project.id` (jobs likewise); reject the bundle otherwise.

**DoD:** a test asserts the WAL file is checkpointed/removed after graceful close; an import that fails during attachment restore leaves no partial project; a bundle with a foreign `projectId` on an evidence row is rejected with a 4xx; suite runs leak no handles (spot-check via process handle count or repeated `buildApp` loop).

### C4 — API-consistency trio

1. **`content-disposition` sanitization:** `export/report-emitter.ts:85` interpolates `deliverable.filename` raw. Not exploitable today (enum-derived names only), but the emitter is the choke-point new exports "cannot forget." Sanitize per RFC 6266: strip control chars/quotes, emit `filename*=UTF-8''...` for non-ASCII. Unit-test with a hostile filename.
2. **404 on unknown project for enrichments:** `egress/enrichment.ts:111-138` never calls `requireProject`, so `GET /projects/:id/enrichments` returns `[]` for a nonexistent id while sibling routes 404. Add the guard.
3. **Undo/redo watermark:** `app.ts:233-245` returns `{ ...result, state }` with no `watermark` and no `?slim=1` support, unlike `POST .../operations` (`app.ts:191-194`) — a blind spot in the client's reconcile-on-watermark model and a full-state transfer every time. Return `getWatermark(id)` and honor `slim`; update the web client's `undo`/`redo` callers to consume it.

**DoD:** hostile-filename unit test; enrichments 404 test; undo/redo response shape matches operations (server test + web api-client type updated together).

---

## Track D — Web client: one fetch path, tested state, inspector split

### D1 — One `apiFetch`

The typed `api<T>` helper exists three times — `src/api/client.ts:31-49` (throws `ApiError` with status), `src/api/egress.ts:20-38` and `src/api/imports.ts:23-41` (throw plain `Error`, status lost) — and is hand-rolled twice more (`src/api/findings.ts:23-28`; `revealSecret`/`importBundle` in `src/state/store.ts:301-317,376-388`).

1. One shared `apiFetch` in `src/api/client.ts` (Zod-parse hook, `ApiError` with status, JSON handling). All five sites migrate.
2. Behaviour contract: every caller now gets `ApiError` — check the egress/imports call sites for `instanceof`/message-shape assumptions before switching.

**DoD:** one fetch implementation (grep proves it); error status reaches every caller; unit test for `apiFetch` error paths; existing panel behaviour unchanged in e2e.

### D2 — `useOperationLog()` + uniform panel fetch states

`getLog(project.id)` is fetched independently, keyed on `[project, graph]`, in `ActivityLog.tsx:50`, `DiffPanel.tsx:20`, `OverviewPanel.tsx:31`, `DeviceInspector.tsx:97` — only `ActivityLog` handles errors; the rest go silently blank. `ProvenanceSection.tsx:29-32` and `OverviewPanel.tsx:23-32` also fetch with no `.catch`/loading state (contrast `EgressPanel.tsx:53-99`, the good model).

1. A `useOperationLog()` hook (or store slice) — one fetch per graph change, shared by all four consumers, with loading/error state.
2. Sweep the no-`.catch` panels onto the same pattern: loading → `.panel-empty`/skeleton, error → toast (matching #99/#107's toast routing).

**DoD:** one log fetch per graph version (assert via network spy in a unit test or e2e request count); killing the server while a panel is open produces a visible error, not a blank panel.

### D3 — State-layer unit tests

`src/state/store.ts` (607 lines: optimistic apply, serialized `syncQueue`, adopt-server-graph-only-when-`pendingOps === 0` reconciliation at `:333-354`, rollback-on-error) and `src/state/ops.ts` (618 lines of op/ChangeSet builders) have **zero** unit tests — the subtlest client code in the repo. Only pure canvas helpers and `containment` are covered.

1. Test the store against a mocked api module: optimistic apply visible immediately; mid-burst server responses **not** adopted while `pendingOps > 0`; adopted after drain; failed op rolls back and toasts; queue serializes concurrent dispatches.
2. Test `reducer.ts`'s `applyOperationOptimistic` per op type against fixture states (table-driven).
3. `ops.ts` builders: round-trip each builder's output through the domain operation schema (`safeParse` green) so builders can't drift from the contract.

**DoD:** the reconciliation window (`:333-354`) and rollback paths have direct tests; `pnpm --filter @netplan/web test` covers state/* ; coverage report (A4) shows the state layer no longer at 0%.

### D4 — Split `DeviceInspector` + memoize derived helpers

`src/layout/DeviceInspector.tsx` is 777 lines holding eight components (`OsConfidenceHint:400`, `DeviceServicesSection:422`, `DeviceFindingsSection:466`, `DeviceUsersRolesSection:509`, `ConnectionsSection:543`, `DeviceRulesSection:593`, `InterfaceEditor:640`). It also rebuilds `networkColorMap(graph.networks)` at `:134` and **again inside every `InterfaceEditor`** (`:672`), and constructs `endpointResolver(graph)` fresh at `:544` and `:596` each render.

1. Extract the section components into `src/layout/inspector/` — mechanical move, no behaviour change, testids untouched.
2. `useMemo` the resolver and color map on `graph` once at the inspector top and pass down (or a tiny `useEndpointResolver(graph)` hook shared with other panels).

**DoD:** no file in `layout/` over ~300 lines from this split; resolver/color-map constructed once per graph change (assert via a memo test or render-count instrumentation); e2e green with unchanged testids.

### D5 — Finish IconButton adoption (+ the a11y it carries)

`CanvasToolbar.tsx:97-141,151-181` renders 12 raw icon `<button>`s with only `title` — no `aria-label`, no `aria-pressed` — despite `src/ui/IconButton.tsx` being explicitly modeled on this file. Stragglers also in `LibraryPanel` (5), `DeviceInspector` (5, e.g. `:342,:700,:736,:771`), `RulesPanel` (4), `ConnectForm` (3).

1. Migrate all icon-only buttons to `IconButton` (label → `aria-label` + `title`; toggles get `aria-pressed`).
2. The AS-IS/TO-BE/Diff segmented control (`CanvasToolbar.tsx:151-160`) exposes its active mode assistively — `aria-pressed` per button (or `radiogroup` semantics).
3. Canvas-toolbar visual chrome must not change — keep the `canvas-toolbar__btn` styling via IconButton's class pass-through; verify with `/verify` screenshots.

**DoD:** grep finds no icon-only raw `<button>` in `layout/`; every icon control announces a name; active canvas mode exposed via `aria-pressed`; screenshots pixel-comparable to before.

### D6 — Small-defect sweep

1. **Cancellable import polling:** `store.ts:452-479` polls `getImportDetail` up to 100×250 ms with no abort — a second import or navigation can write stale `selectedImport`/`importJobs`. Add a generation counter (or AbortController) checked before each `set`.
2. **Validated localStorage:** `LibraryPanel.tsx:38` casts `JSON.parse(...)` straight to `Record<string, boolean>` — the one unchecked cast over persisted input. `z.record(z.boolean()).catch({})`-style safeParse with fallback.

**DoD:** starting a second import while one polls never resurrects the first job's state (unit test with fake timers); malformed localStorage falls back cleanly instead of flowing through untyped.

---

## Out of scope

- New features, canvas behaviour changes, schema changes to entities.
- Keyset pagination for `queryFlows` (`engine/store.ts:383-391`) — the `COUNT(*)` + `OFFSET` per page is acceptable at the 5k tier; revisit only if flow volume grows past it.
- Coverage threshold gates in CI — report-only until the D3 tests land and the baseline is meaningful.
