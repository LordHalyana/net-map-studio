# NetPlan Studio — Improvements Implementation Plan

> Audience: the implementing model executing this build.
> Source: cross-reference audit of the codebase against `docs/NetPlan_Studio_Design_Document.md` (2026-07-16), performed after the visual-parity pass (M0–M7, issues #41–#49) landed.
> Scope: closes the remaining **functional design-doc gaps** and a set of **visual/UX improvements** found by side-by-side comparison with `docs/concept_design_netplanner.png` and the capture set in `apps/web/e2e/.visual/`. Includes one net-new user request: resizable Site/Zone containers.
> Status: ready for execution.

---

## 0. How to use this plan

1. **Read first:** `CONTEXT.md`, ADR-0010 (Operation-log mutation spine), ADR-0011 (connections are three entities), ADR-0013 (Containment vs Membership), ADR-0019 (evidence store), ADR-0023 (findings = derived detection + persisted disposition).
2. **The Operation log stays the spine.** Any newly persisted state (container sizes, retention decisions, report records) mutates only through Operations, inherits undo/redo, and lands in the audit trail. No side-channel writes.
3. **Schema changes are allowed in this plan** (unlike the visual-parity pass) but must stay minimal, optional-field-first, and versioned through the existing bundle schema so old `.netplan` exports still import.
4. **Keep the tests green.** `data-testid` attributes are load-bearing for `apps/web/e2e/`. Every milestone DoD includes the full e2e + unit suites.
5. **Local-first stays binding.** No CDN assets, no telemetry, no new egress paths outside the egress door.
6. **Commit granularly** on a feature branch — one coherent, DoD-passing milestone step per commit.

### Dependency shape

M1–M6 are the canvas/UX track (M4 benefits from M1 landing first; the rest are independent).
M7–M8 are the analysis track (independent of each other).
M9 depends on nothing but is easier after M6 (toasts).
M10–M11 are the navigation track (M11's Reports page needs M11's Report entity step first).
M12–M14 are the backend-hardening track (independent of each other and of everything above).

---

## 1. Canvas & UX track

### M1 — Resizable Site & Zone containers

Today Site/Zone containers render at hardcoded sizes (`SITE_SIZE = 460×300`, `ZONE_SIZE = 200×150`, `apps/web/src/canvas/graphToFlow.ts:52-55`); operators cannot resize them, so a Zone with many devices overflows and a Site with two devices wastes space.

1. Add optional `size: { width, height }` to `siteSchema` and `zoneSchema` (`packages/domain/src/entities.ts`). Existing update Operations (`operations.ts:44-45`) carry it — no new op types.
2. Render React Flow's `<NodeResizer>` in `SiteNode`/`ZoneNode` (`apps/web/src/canvas/ContainerNodes.tsx`), visible when selected, with sensible minimums (collapsed sizes as floor). On resize end, dispatch an update Operation with the new size (drag preview local, persist on release — same pattern as node drag).
3. `graphToFlow.ts` uses `entity.size ?? DEFAULT` for expanded containers; collapsed sizes stay fixed.
4. Enforce child containment on shrink: either clamp the resize to the bounding box of contained zones/devices, or keep `extent: 'parent'` behavior consistent so children never end up outside. Pick the clamp — silently relocating children would fight manual pinning (§3.2C).
5. Auto-arrange (`autoArrange.ts`) respects persisted sizes instead of the constants.

**DoD:** a Site and a Zone can be resized by handle-drag; the size survives reload and export/import round-trip; resize is undoable; shrinking below content is clamped; e2e green (extend `networks.test.ts` or a new `containers.test.ts`).

### M2 — Keyboard shortcuts & canvas interaction basics

No global shortcuts exist (only Delete/Backspace via React Flow, `Canvas.tsx:366`).

1. Global `keydown` handler (ignoring focused inputs): **Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y** → store `undo`/`redo`; **Ctrl+D** → duplicate selected device (reuse `DeviceInspector.tsx:170` logic); **Ctrl+C / Ctrl+V** → copy/paste devices (paste offsets position, strips ids, re-creates via Operations — links/memberships not copied in v1); **Ctrl+F or /** → focus global search; **Escape** → clear selection / close connect mode.
2. Toolbar additions (`CanvasToolbar.tsx`): dedicated fit-to-screen button; grid/snap toggle (§3.2A "grid" control — currently always-on, `Canvas.tsx:369`).
3. Align snap grid to the visible grid: snap `[16,16]` vs background gap `22` (`Canvas.tsx:370,377`) — use one constant for both.
4. A `?`-key shortcut cheat-sheet overlay (static, no new deps).

**DoD:** all shortcuts work and are inert while typing in inputs; grid toggle round-trips; snap lands nodes on visible gridlines; e2e covers undo/redo + duplicate shortcuts.

### M3 — Flow & rule interactivity

Observed flows — the heart of AS-IS review — are un-inspectable, and rule callouts are dead to clicks.

1. Flow edges selectable: `onSelectionChange` (`Canvas.tsx:225-231`) only reads `data.linkIds`; flow edges carry `flowIds` (`graphToFlow.ts:297`). Extend selection to flows and add a **Flow details** view in the context panel (kind, endpoints, service, count, first/last seen, confidence, evidence link) — read-only, since Flows are evidence-derived.
2. PolicyRule callouts (`graphToFlow.ts:431-433`, `selectable: false`) become clickable: selecting a callout opens that rule in the Rules tab with the rule row focused/highlighted.
3. Global search (`GlobalSearch.tsx`) gains identities and findings (design §3.2A names both); a rule hit selects/scrolls to the rule, not just the tab flip (`GlobalSearch.tsx:78-80`).
4. Link Info surfaces the PolicyRules governing the selected Link's endpoints — read-only rows (action, service, direction) linking into the Rules tab. Absorbs the feature half of divergence #53 (ADR-0011 keeps the fields on PolicyRule; this is projection, not schema).

**DoD:** clicking a flow edge shows flow details with evidence provenance; clicking a rule callout lands on the focused rule; search finds an identity by name and a finding by title; Link Info lists governing rules for the demo firewall uplink; e2e green.

### M4 — Canvas layout & readability

From the capture comparison: the endpoint row overlaps itself, the minimap occludes nodes, rule callouts cluster into a band that edges route through.

1. **Leaf endpoint density:** render leaf endpoints (degree-1 devices in endpoint categories) as compact mini-nodes (icon tile + status dot; name/IP on hover and when selected) — revisits accepted divergence #51 as a usability fix, not parity. Full node when selected. Behind the existing node-rendering path in `DeviceNode.tsx` (a `compact` variant), threshold decided in `graphToFlow.ts`.
2. **Fan-out spacing:** tune `autoArrange.ts` rank/node separation so sibling endpoints never overlap at 100% zoom for the demo scene.
3. **Minimap occlusion:** make the minimap collapse to a small tab on hover-out or when the viewport intersects it (`Canvas.tsx` MiniMap props); keep bottom-left.
4. **Rule callout placement:** offset callouts perpendicular to their subject edge/node with a thin leader line; callouts become satellites in auto-arrange so edges stop routing through them.
5. **Parallel edge lanes:** fan out parallel edges to the same node via per-edge `pathOptions.offset` so runs don't stack.

**DoD:** demo-scene capture shows zero node overlap at 100%; minimap never permanently covers nodes; no edge crosses a rule callout in the demo scene; captures re-run and archived; e2e green.

### M5 — Findings on the canvas

Design §3.2C lists warning badges and a findings layer; neither exists — an analyst can't see _where_ problems are.

1. Warning badge on `DeviceNode` (count of open findings affecting the device, severity-colored, from the findings store) — appears in the badge cluster per the M1(parity) badge policy.
2. **Findings layer toggle** in `CanvasToolbar.tsx` alongside the existing layers: when on, devices with open findings get a severity-tinted outline/glow; when off, badges remain but tinting is suppressed.
3. Clicking the badge navigates to the Findings view filtered to that device.

**DoD:** demo scene seeded with a finding shows the badge and layer tint; toggle hides tint; badge click lands on the filtered findings list; e2e green.

### M6 — Visual consistency & feedback sweep

1. **Toast system:** one small notification component (queue, auto-dismiss, severity variants) replacing scattered inline notices — `syncError`/`export-notice` (`CommandBar.tsx:26,170`), `connect-notice` (`ConnectForm.tsx:110`), import notices, findings errors. Inline field-validation errors stay inline.
2. `--role-server` (#d7dde8) ≈ `--text` (`styles.css:9,25`) — pick a distinct steel-blue hue.
3. Standardize toggles: device "Pinned" checkbox (`DeviceInspector.tsx:307`) and any remaining checkboxes become the `.switch` control (`styles.css:667`).
4. "Saved · N min ago" relative timestamp in the project bar (closes divergence #55's timestamp half; Auto-Arrange dropdown stays out — single layout).
5. Deterministic membership accent: sort memberships before `memberships[0]` (`roleColors.ts:38`) so device tint doesn't depend on interface order.
6. First-run canvas empty state: brief hint pointing at the library and Imports ("drag a component… or import evidence…"), hidden once the project has any node.
7. Optional persisted `color` on `networkSchema` (`packages/domain/src/entities.ts`) with a swatch picker in `NetworkInspector`; the hash-stable palette (`networkColor.ts`) stays the fallback for unset networks. Absorbs divergence #50 (concept-fixed VLAN hues need persisted state, which the parity pass excluded).

**DoD:** all user-facing errors surface as toasts; no bare checkboxes remain; server nodes visually distinct; empty project shows the hint; captures re-run; e2e green.

---

## 2. Analysis track

### M7 — Detection-input ingestion (unstarves the Phase-3 rules)

The filename/process/persistence/software rule families exist but the device-state adapter never ingests their inputs — `packages/domain/src/findings/coverage.ts:38-44` openly lists processes, persistence, installed software and file inventory as missing classes. §3.8's detection surface can't fire on real imports.

1. Extend the device-state adapter (`apps/server/src/imports/adapters/device-state.ts`) to emit Observations for: running processes (+ executable paths, parent/child where present), persistence entries (services, scheduled tasks, startup), installed applications/packages, and file-inventory entries (+ hashes). The import contract (`packages/import-contract/src/device-state.ts`) already defines these sections (P3 fields optional/loose per ADR-0018) — verify and fill any schema holes.
2. Decide storage: these are per-device evidence-derived collections, not canvas entities. Follow the Flow precedent (`entities.ts:241-246`) — typed collections on project state with direct confidence, keyed to Device, written through the pipeline (normalize → dedupe → propose → commit), never hand-edited.
3. Wire `findings/inputs.ts` + `coverage.ts` so the rule engine consumes them and coverage reports the classes as available when present.
4. Provenance: each ingested record carries Evidence refs like every other observation.

**DoD:** importing the fixture device-state report with processes/persistence/software sections produces findings from the filename-path and process-persistence rule families end-to-end; coverage no longer lists the classes as missing when data exists; unit + server tests green.

### M8 — Rule↔Flow validation (§3.11 completion)

`packages/domain/src/rule-validation.ts` covers overlap/contradiction/any-to-any/orphaned/shadowing but not the two checks that compare intent against observation:

1. **Observed-without-rule:** any aggregated Flow whose endpoints/service match no PolicyRule → validation warning (general case; the cross-zone Finding remains the security-severity slice).
2. **Planned-never-observed:** any enabled PolicyRule matched by zero Flows → informational warning, worded per §3.11 "without assuming they are unnecessary."
3. Both need endpoint-matching between polymorphic rule endpoints (Device/Network/Zone, ADR-0012) and flow endpoints — factor a shared matcher; reuse whatever `segmentation-identity.ts` already has.
4. Surface in the Rules tab (and the M10 Rules page) alongside existing RuleWarnings.

**DoD:** demo scene + a seeded unmatched flow and an unmatched rule produce both warnings; matcher unit-tested for Device/Network/Zone endpoint kinds; suites green.

---

## 3. Inspector & navigation track

### M9 — Inspector completion

Design §3.2D sections still missing from `DeviceInspector.tsx`; the concept's calm read-view never shipped (M6-parity kept always-edit).

1. **Read-view with inline edit:** key-value rows render as text; click/focus swaps to the input; Escape/blur commits or reverts. All current edit capabilities stay reachable. (This was the parity plan's un-run prototype question — prototype first with the `/prototype` skill, 30-minute box, then commit to one mode.)
2. **Services section:** list the device's `graph.services` (protocol/port/process, provenance chip).
3. **Findings section:** open findings affecting the device, severity + status, linking into the Findings view.
4. **Users & Roles section:** identities/RoleAssignments scoped to the device (data exists — `entities.ts` Identity/RoleAssignment; overlay chips already read it, `graphToFlow.ts:135`).
5. OS confidence: show the provenance confidence next to the OS field explicitly (§3.2D "operating system and confidence level").

**DoD:** selecting the demo firewall shows Services/Findings/Users&Roles sections with real data; every previously editable field still editable; `inspector.test.ts` updated deliberately; suites green.

### M10 — Navigation destinations I: Overview, Networks & VLANs, Rules

5 of 9 design §3.2B destinations are missing (`store.ts:63`); Rules is demoted to a bottom tab.

1. **Overview page:** counts and health at a glance — devices by type/lifecycle, networks, open findings by severity, last import, recent activity. Read-only, no new endpoints (all data already reaches the client).
2. **Networks & VLANs page:** table of networks (name, kind, VLAN id, CIDR, member count), row → select network (inspector opens), create/edit/delete via existing Operations. Today networks are only editable via canvas selection.
3. **Rules page:** promote `RulesPanel` content to a full left-nav destination — full-width rule table, validation warnings (incl. M8's), filter by device/network/action; the bottom tab remains for edit-in-context.
4. Nav items + view union extended (`LibraryPanel.tsx:109-135`, `AppShell.tsx:19-29`, `store.ts:63`).

**DoD:** three new nav destinations functional; Rules page shows validation warnings; `shell.test.ts` extended; suites green.

### M11 — Navigation destinations II: Reports, Settings, Report entity, export gaps

1. **Report entity (§3.4):** minimal persisted record — id, type, createdAt, redaction profile, parameters, output hash — written through the Operation log whenever an export/report is generated. Gives client deliverables an audit trail (§3.13 also wants exports audited — the record is the audit hook M13 builds on).
2. **Reports page:** generate the existing outputs (bundle, topology image trigger, HTML design report, findings report, CSVs) from one place, with redaction profile selection; lists past Report records.
3. **Change report (§3.12):** render the existing diff/proposal machinery (`invert.ts`, `pipeline/proposal.ts`) as an AS-IS→TO-BE change report (HTML, same styling as `export/report.ts`) — additions, removals, field-deltas.
4. **CSV completeness (§3.12):** add identities and flows to the CSV entity enum (`app.ts:442-451`, `export/csv.ts`); fix the redundant double-parse (`app.ts:453-465`).
5. **HTML design report depth:** include services, identities summary, findings summary (respecting redaction), not just devices/networks/links/rules (`export/report.ts`).
6. **Settings page:** surface what already exists as project-level config — egress opt-ins (currently its own nav item — fold in or link), redaction defaults, rule-engine config knobs (`findings/config.ts`), retention policy once M13 lands. No new invented settings.

**DoD:** report generation from the Reports page produces Report records that survive export/import; change report renders a seeded proposal; identities/flows CSVs download; suites green.

---

## 4. Backend hardening track

### M12 — Import hardening: parser isolation + Netcat profiles

1. **Worker isolation (§3.5):** parsers currently run in-process on the event loop with cooperative budgets (`apps/server/src/imports/store.ts:116-136`; the seam is documented there). Move adapter execution into `worker_threads` — hard kill on wall-clock timeout, memory cap, structured result marshaling. `guards.ts` policy limits stay; they become defense-in-depth inside the worker.
2. **Netcat adapter + import profiles (§3.6):** an `ImportProfile` concept — operator-defined line-format templates (regex/field-map) stored per project — and a `netcat-text` adapter that applies a profile to produce low-confidence reachability/banner Observations (confidence per §3.7: "single Netcat text result: low unless corroborated"). Profiles are model config, edited through Operations.

**DoD:** a synthetic pathological input (huge line / deep JSON / slow regex) fails the job without stalling the server (existing endpoints stay responsive — test with a concurrent request); a sample netcat log + profile yields observations that corroborate an existing device rather than fabricating topology; suites green.

### M13 — Privacy & audit (§3.13 completion)

1. **Secrets masking:** detection pass over ingested observations (private keys, password=… patterns, connection strings, high-entropy tokens) → matched values stored masked-by-default with an explicit per-value reveal (audited), and excluded from default report/export output. Detection list is Rule-config-style data, operator-extendable.
2. **Export audit:** every export/report endpoint writes an audit record (what, when, redaction profile, entity counts) — lands naturally on M11's Report entity; bundle exports audit even without the Reports page.
3. **Retention & secure deletion:** per-project retention policy (keep raw evidence N days → auto-downgrade to hashOnly), plus an explicit evidence purge endpoint that preserves the hash + manifest entry (evidence identity survives, §3.13) and writes an audit record. Purge is the one non-undoable operation — gate it behind explicit confirmation and record it in the audit trail rather than the undo stack.

**DoD:** a seeded import containing a fake private key renders masked in UI and absent from default reports; exports appear in the audit/activity view; purge downgrades evidence to hashOnly, keeps manifest hashes, and is audited; suites green.

### M14 — API scale (§3.5 / ADR-0019 targets)

1. **Flows pagination/filtering:** dedicated `GET /projects/:id/flows` with limit/offset + endpoint/service/time filters; `GET /graph` gains an option to omit or cap flows (client fetches flows for the visible layer only). Target: ADR-0019's ~5k aggregated flows must not ride on every response.
2. **Slim mutation responses:** write endpoints return the op result + version watermark instead of the full `ProjectState` (`app.ts:204-336`); the client store already reconciles — fetch deltas or refetch on watermark mismatch.
3. **Findings analysis cache:** cache `findingsService.analyze` keyed on the operation-log watermark + rule-config hash (`app.ts:355-375,463`); recompute only when either moves.
4. **Export streaming:** stream bundle assembly (`app.ts:250`) instead of building base64 blobs fully in memory.

**DoD:** `scale.test.ts` extended toward the ADR-0019 tier (500 devices / 5k aggregated flows) with graph load and a mutation round-trip under agreed thresholds; findings endpoint returns cached results between edits; suites green.

---

## 5. Out of scope (deferred by ADR — do not do under this plan)

- Local authentication, Access Roles (Administrator…Viewer), RBAC, encryption in transit/at rest — ADR-0001 single-operator local-first; revisit when multi-user is real (design §3.9/§3.13 remain the spec for that day).
- Multi-project switcher UI, Share semantics, avatar/collaboration chrome (divergence #54; ADR-0001).
- Firewall/switch config import (open question Q12 — pipeline extension, not an adapter).
- Light mode.
- Freehand drawing/text/shape tools (divergence #52; design §2 non-goal).
