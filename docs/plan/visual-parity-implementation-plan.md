# NetPlan Studio — Visual Parity Implementation Plan

> Audience: the implementing model executing this build.
> Target: bring the web UI as close as possible to the concept design (`docs/concept_design_netplanner.png`), which the design document names as the intended interaction model (§3.2).
> Scope: **visual pass only.** No domain-model changes, no new schema fields, no new server endpoints. Everything here is render-side (components, CSS, canvas projection). If a visual goal turns out to require persisted state, **stop and surface it** — do not quietly extend the model.
> Status: ready for execution.
> Method: each milestone with visual uncertainty starts with a **`/prototype` gate** — a throwaway mock that answers one design question by side-by-side comparison against the concept image _before_ production code is written.

---

## 0. How to use this plan

1. **Read first:** `CONTEXT.md`, ADR-0005 (React Flow canvas), ADR-0013 (Containment vs Membership — binding: a Network is a _projection_ of Membership, never a stored topological node). This plan changes how memberships _look_, never what they _are_.
2. **Prototype before implementing.** Where a milestone lists a `/prototype` step, run the `/prototype` skill with the stated question. Prototypes are throwaway (scratchpad or a git-ignored folder), compared against the concept image, and the accept/adjust decision is recorded in the milestone's commit message. Do not skip the gate because the answer "seems obvious" — the current UI is what "obvious" produced.
3. **Compare like-for-like.** M0 builds a demo scene that mirrors the concept's hotel topology and a Playwright capture script. Every milestone's DoD includes re-running the capture and comparing the same crop of the same scene against the concept.
4. **Keep the tests green.** All `data-testid` attributes are load-bearing for the e2e suite (`apps/web/e2e/`). Restyle freely; rename/remove testids only together with the tests that use them.
5. **Local-first stays binding.** No CDN fonts, no remote icons. Fonts and icon sets are bundled dependencies.
6. **Commit granularly** on a feature branch — one coherent, DoD-passing milestone step per commit.

### Working agreements

- Dark mode only (unchanged).
- Prefer boring, well-supported libraries: `lucide-react` for icons; keep `@xyflow/react` built-in edge types where possible before writing custom edges.
- All new colors become CSS custom properties in `styles.css` — no hex literals scattered through components.
- The canvas projection (`graphToFlow.ts`) stays a pure function; visual variants are data on nodes/edges, styling lives in components/CSS.

---

## 1. Visual gap audit (concept vs implemented, 2026-07-16)

Captured with Playwright at 1448×1086 against the live app and compared region-by-region with `concept_design_netplanner.png`.

| #   | Region                | Concept                                                                                                                                                                                                                                                                   | Implemented today                                                                                                                                                                                                                                                                                               | Severity |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| G1  | Device nodes          | Role-colored identity: colored border + soft glow per role (firewall red, core switch blue, internet green, VPN gray), colored line-icon, UPPERCASE name, IP/CIDR as the second line, "● Online" status.                                                                  | Every device is the same gray box (`--bg-raised` + 1px `--border`), emoji glyph, lowercase auto-name, _device type_ as the second line (no IP). Badge cluster (status dot, PLN, confidence %, ⎘) reads as clutter. `DeviceNode.tsx`, `.device-node` in `styles.css`.                                            | High     |
| G2  | VLAN / Network nodes  | VLANs are first-class-looking rectangular nodes in the hierarchy: icon tile on the left, VLAN name + CIDR, one strong color per VLAN (orange/green/purple/amber), sitting in a row under the core switch with endpoints fanned out below.                                 | A Network renders as a floating pill at the top of the canvas (fallback row at y = −140), connected by thin dashed bezier "membership" edges. Colors are assigned by array index (`palette[index]` in `graphToFlow.ts`) so they shift when networks are added/removed. **This is the known VLAN misalignment.** | High     |
| G3  | Edges                 | Orthogonal (right-angle) routing; membership/trunk edges solid and colored by network; core links neutral; small circular port dots where edges meet nodes; no text riding on the lines.                                                                                  | Default bezier curves everywhere; gray link edges carry text labels ("cable", "wireless", link label); membership edges dashed with interface-name labels; flows dashed amber. No port dots. `graphToFlow.ts` edge construction.                                                                                | High     |
| G4  | Rule callouts         | Dark annotation cards anchored to edges: "RULE — Allow: HTTPS (443), VPN (1194) / Deny: All Other" with green/red text, plus smaller allow/deny cards near VLAN uplinks.                                                                                                  | No canvas representation of PolicyRules at all; rules exist only in the bottom Rules tab.                                                                                                                                                                                                                       | Medium   |
| G5  | Left sidebar          | Brand block (logo tile + "Network planning, simplified."), icon-first nav, **LIBRARY search field**, palette as a 3-column **icon-tile grid**, "drag custom icon here or click to upload" dropzone at the bottom.                                                         | Text-list nav with emoji, no search, single-column text rows, no upload dropzone. `LibraryPanel.tsx`.                                                                                                                                                                                                           | Medium   |
| G6  | Command bar / toolbar | Two strips: a project bar (project selector ▾, "Saved 2 min ago ✓", Share / Export / settings / help / avatar) and a **canvas toolbar** (undo/redo, tool icons, "Auto Arrange ▾", zoom − 100% +, fullscreen).                                                             | One 44px bar crammed with text-toggle buttons ("Connect off", "Logical on", "AS-IS/TO-BE/Diff", "50% 100% 200%"…) that clip/wrap at moderate widths. `CommandBar.tsx`.                                                                                                                                          | Medium   |
| G7  | Canvas chrome         | Fine square-grid background (graph paper); styled dark minimap bottom-left showing colored node rects; minimal zoom controls.                                                                                                                                             | Dots background; default React Flow minimap (pale gray, bottom-right) and default Controls. `Canvas.tsx`.                                                                                                                                                                                                       | Low      |
| G8  | Inspector             | Header block (colored icon tile, NAME, IP, ● Online), Properties / Connections / Notes **tabs**, calm key-value rows, INTERFACES with colored status dots + ghost "Add Interface" row, RULES rows with toggle switches, TAGS chips, USERS & ROLES with permission badges. | "INSPECTOR" heading + action buttons, then a wall of always-editable form inputs; interfaces as heavy bordered editors with selects; no tabs, no header, no tags, no per-device rules/roles sections. `InspectorPanel.tsx`, `DeviceInspector.tsx`.                                                              | Medium   |
| G9  | Bottom panel          | LINK INFO as a designed form: Protocol/Service select, Direction select, Source and Destination **endpoint cards** (colored dot, name, IP) joined by ⟷, Action select, Log toggle.                                                                                        | Correct tab structure, but link details render as a plain card list; no endpoint-card layout, no toggles. `LinkDetails.tsx`, `ConnectForm.tsx`.                                                                                                                                                                 | Low      |
| G10 | Type & tokens         | Inter-like face, larger name/label hierarchy, generous padding, ~8–10px radii, iOS-style toggle switches, green primary accent; role/VLAN colors are the system.                                                                                                          | Segoe UI 13px, tight spacing, 4–6px radii, blue `--accent`, checkboxes and text buttons; only seven generic palette colors.                                                                                                                                                                                     | Medium   |

Not part of this pass (functional, not visual): the concept/nav destinations that don't exist yet (Overview, Networks & VLANs page, Rules page, Reports, Settings), the Connections/Notes tab _content_, and per-device Users & Roles data plumbing. Where the concept shows chrome for these (tabs, sections), build the chrome only if the data already exists; otherwise leave it out rather than shipping dead controls.

---

## 2. Milestones

Dependency shape: M0 → M1 → M2 → M3 → M4 (canvas track, strict order); M5, M6, M7 are independent of the canvas track and of each other once M0 is done.

### M0 — Tokens, icons, demo scene, comparison harness (foundation; no prototype)

1. **Sample the concept image** and extend `:root` in `styles.css`: background/panel/raised values, green primary accent, role colors (`--role-firewall`, `--role-core`, `--role-internet`, `--role-vpn`, `--role-endpoint`…), a VLAN palette (`--vlan-1…n` matching the concept's orange/green/purple/amber), radii and spacing steps. Keep the old names as aliases until the last milestone lands.
2. **Bundle Inter** (e.g. `@fontsource-variable/inter`) and set the type scale (11/13/15 with the concept's weight hierarchy). Local files only.
3. **Replace emoji glyphs with `lucide-react`** icons via `library/catalog.ts` (add an `icon` component per item; keep `glyph` until all consumers migrate). Consumers: `LibraryPanel`, `DeviceNode`, container nodes.
4. **Stable network colors:** replace index-based `networkColor()` with a deterministic hash of the network id into the VLAN palette (render-only, stable across add/remove).
5. **Demo scene:** a seed script (or e2e fixture) that recreates the concept's hotel topology — internet, firewall (with WAN/LAN/DMZ interfaces + addresses), VPN gateway, core switch, four VLANs (Staff 10 / Guest 20 / POS 40 / CCTV 50 with CIDRs), three endpoints per VLAN, links, and the concept's allow/deny rules.
6. **Capture script:** a checked-in Playwright script (`apps/web/e2e/visual-capture.ts` or similar, excluded from the test run) that loads the demo scene and screenshots the full shell plus fixed crops (node close-up, VLAN row, inspector, bottom panel) at 1448×1086.

**DoD:** capture script produces screenshots of the demo scene; SVG icons everywhere (no emoji in library or nodes); network colors stable under add/remove; e2e suite green.

### M1 — Device node visual language (G1, part of G10)

**`/prototype` gate:** _"Does the concept's role-colored node language survive contact with our real badge set?"_ Build a static mock of ~8 nodes (internet, firewall, VPN gateway, core switch, workstation, camera, POS terminal, a `custom` device) in the concept style — colored border + soft glow, colored icon, UPPERCASE name, IP second line, status dot — then layer on the things the concept doesn't have: lifecycle badge (PLN/OBS…), confidence %, evidence count, membership chips, identity chips, diff outlines. Compare against concept crops at 100% and 50% zoom. Decide: badge placement/visibility rules (e.g. collapse into a single overflow badge, reveal on hover/selection) and glow intensity.

**Implement:** rework `DeviceNode.tsx` + `.device-node` styles per the accepted prototype; add a `deviceType → role color` map; show the device's primary Address (first interface's first IP) as the second line, falling back to type; apply the badge policy from the prototype. Keep `data-testid`s.

**DoD:** demo-scene capture shows firewall red / core blue / internet green nodes with IPs, matching the concept crop; badges follow the decided policy; e2e green.

### M2 — VLAN nodes and the membership projection (G2 — the known misalignment)

**`/prototype` gate:** _"Can a Membership projection look like the concept's VLAN hierarchy without becoming containment?"_ Mock the concept's mid-section: core switch, a row of four colored VLAN rectangles (icon tile, name, CIDR), endpoints fanned out below each VLAN with solid colored edges, plus the two cases the concept dodges — a dual-homed device (member of two VLANs) and a VLAN with 20+ members. Decide: how a multi-membership device renders (duplicate edge to both VLAN nodes is fine; the node itself is never _inside_ a VLAN — ADR-0013), and how member fan-out scales (bundle? grid? count chip).

**Implement:**

1. Restyle `NetworkNode` from pill to the concept's rectangle (colored icon tile, name, `VLAN nn · CIDR` line, colored border + glow).
2. Membership edges become **solid** colored edges (color = network color), no interface-name label riding the line (move it to hover/selection).
3. Extend `autoArrangeChangeSet` with a hierarchical mode: `rankdir: TB`, networks participating as layout nodes ranked between core infrastructure and their member endpoints (layout hints written for network positions, Operations for devices — atomically, as today).

**DoD:** demo-scene capture of the VLAN row is a recognizable match for the concept's; dual-homed device renders with two colored edges and no containment; arrange produces internet → firewall → core → VLANs → endpoints top-to-bottom; e2e green (update `networks.test.ts` selectors if the pill markup changes).

### M3 — Edge system (G3)

**`/prototype` gate (small):** _"Orthogonal or rounded-orthogonal?"_ Render the M2 demo scene with React Flow's `smoothstep` vs `step` edge types plus circular endpoint dots (edge `markerStart`/`markerEnd` or a thin custom edge), at 100% and 50%. Decide routing type, corner radius, dot size, and the label policy (nothing inline; kind/label appears on hover and selection).

**Implement:** apply the decision in `graphToFlow.ts` — links neutral solid, memberships solid colored, flows keep dashed+animated amber; port dots on both ends; labels move to hover/selected state.

**DoD:** capture matches concept's line work; link/flow/membership remain visually distinguishable; e2e green.

### M4 — PolicyRule callouts on the canvas (G4)

**`/prototype` gate:** _"How do rule callouts attach without wrecking layout?"_ Mock the concept's two callout cards (firewall RULE card, core-switch allow/deny card) as (a) floating annotation nodes near the subject with a leader line, vs (b) React Flow edge labels on the relevant edge. Include the failure case: a device with 6 rules. Decide attachment model, density cap (e.g. summarize past 3 services), and when they show (always for rules touching selected node? a "Rules" layer toggle?).

**Implement:** project PolicyRules into callout annotation elements per the accepted model, colored allow-green/deny-red text per concept, behind a layer toggle consistent with the existing layer system.

**DoD:** demo scene shows the firewall and core-switch callouts in concept style; 6-rule device stays readable; toggling the layer hides them; e2e green.

### M5 — Shell chrome: bars, library, canvas furniture (G5, G6, G7)

**`/prototype` gate:** _"One bar's worth of controls, two strips, no text buttons — does everything fit?"_ Static mock of the full chrome: project bar (brand tile + tagline, project name ▾, "Saved · 2 min ago ✓", Share/Export, avatar) + canvas toolbar (undo/redo, connect, layer toggles as icon buttons with tooltips, AS-IS/TO-BE/Diff segmented control, Auto Arrange ▾, zoom − % +, fullscreen) + library (search field, 3-column icon-tile grid per category, custom-icon dropzone). Verify at 1280px width — the current bar's overflow is the bug being fixed.

**Implement:**

1. Split `CommandBar` into project bar + canvas toolbar (toolbar may live as an overlay strip at the top of `.canvas-region`); icon buttons with tooltips replace text toggles; keep every existing action and testid.
2. Rework `LibraryPanel`: brand block, search filter over catalog items, tile grid, dropzone that opens the existing custom-icon flow.
3. Canvas furniture: `Background` `variant={BackgroundVariant.Lines}` (fine grid), styled `MiniMap` (dark, `nodeColor` from role/network colors, bottom-left), slimmed `Controls`.

**DoD:** at 1280px nothing clips or wraps; library search filters tiles; minimap bottom-left showing colored nodes; e2e green (`shell.test.ts` updated alongside any moved testids).

### M6 — Inspector redesign (G8)

**`/prototype` gate:** _"Read-view with inline edit, or the current always-edit form?"_ Mock the concept's right panel for the demo firewall: header block (role-colored icon tile, name, IP, status), Properties tab with calm key-value rows that become inputs on click/focus, INTERFACES list (colored dot, name, IP, ghost "Add Interface" row), RULES rows with toggle switches, TAGS chips. Answer: does inline-edit cost acceptable clicks for the QA/edit loop the app actually has? (If the answer is no, keep always-edit but restyle to the concept's density.)

**Implement:** rebuild `DeviceInspector` presentation per the accepted prototype: header block; sectioned Properties (Type/Vendor/Model/OS/Location…); interface list per concept with the existing editor behind expand; device-scoped PolicyRule rows with a real toggle-switch control (reuse `enabled`/logging semantics from `RulesPanel`); tags chips if the model already carries tags — otherwise omit. Tabs (Properties / Connections / Notes) only for content that exists: Connections = the device's links/flows (data exists), Notes only if a notes field exists.

**DoD:** selecting the demo firewall reproduces the concept's right panel (allowing for missing data sections); all edit capabilities of the current inspector still reachable; e2e green (`inspector.test.ts` updated deliberately).

### M7 — Link Info form + final parity sweep (G9, close G10)

1. Rework `LinkDetails`/`ConnectForm` into the concept's layout: Protocol/Service, Direction, Source/Destination endpoint cards (colored dot, name, IP) joined by ⟷, Action select, Log toggle switch. No prototype needed — the concept is explicit and the data all exists.
2. Remove the legacy color-token aliases from M0; sweep components for stray hex literals.
3. **Final side-by-side:** run the M0 capture, place each crop against the concept image, and file one issue per residual, deliberately-accepted divergence (so "close as possible" is an auditable statement, not a vibe).

**DoD:** capture set archived in the PR description with the concept for comparison; divergence list filed as issues; full e2e + unit suites green.

---

## 3. Out of scope (do not do under this plan)

- New nav destinations or pages (Overview, Reports, Settings, a VLANs page, a Rules page) — functional scope.
- Any schema/domain change (tags, notes, per-device users, persisted network colors). If a milestone needs one, stop and surface it.
- Multi-user chrome shown in the concept (avatar stack, Share semantics beyond the existing export) — ADR-0001 is single-operator; render a single neutral avatar only.
- Light mode.
