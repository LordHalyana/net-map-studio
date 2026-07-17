# NetPlan Studio — Import Format Helpers & UI Polish Implementation Plan

> Audience: the implementing model executing this build.
> Scope: two independent tracks. **Track A** — in-app helper information describing exactly what data structure each import adapter expects, so an operator can shape their data before uploading. **Track B** — a general professionalism pass across the page-level UI. **The canvas is out of scope**: nothing in `apps/web/src/canvas/` changes behaviour or appearance (`Canvas.tsx`, `DeviceNode.tsx`, `graphToFlow.ts`, edges, minimap, toolbar interactions stay as they are).
> Status: ready for execution.

---

## 0. How to use this plan

1. **Read first:** `CONTEXT.md` (especially Adapter / Import Contract / Observation / ImportJob), ADR-0017 (Zod single source), ADR-0018 (owned canonical import contract), ADR-0020 (canonical observation pipeline).
2. **Keep the tests green.** All `data-testid` attributes are load-bearing for the e2e suite (`apps/web/e2e/`) — in particular `import-adapter-select`, `import-upload-button`, `import-evidence-file-input`. Restyle freely; rename/remove testids only together with the tests that use them. The e2e suite shares one DB (`workers: 1`) — tests must clean up entities they create and must not leave a device contained in a zone.
3. **Use what exists.** Design tokens live in `styles.css:1-102` (`--space-*`, `--text-*`, `--radius-*`, semantic colors); shared primitives in `apps/web/src/ui/` (Button, IconButton, Dialog, ConfirmDialog, Toggle, Tabs, Menu) plus `layout/Toasts.tsx`. New UI composes these — no hand-rolled buttons, dialogs, or toggles, no hex literals outside tokens.
4. **Never define an entity shape twice** (ADR-0017/0018). Track A's format descriptions must derive from or live beside the schemas that enforce them — a hand-maintained copy of a field list in a React component is a defect.
5. **Commit granularly** on a feature branch — one coherent, DoD-passing milestone step per commit. Tracks A and B are independent; within each track the milestones are ordered.
6. **Verify visually.** After UI milestones, use the `/verify` flow (Playwright screenshots of the running app) rather than trusting the diff.

---

## Track A — Import format helpers

### Current state (audit 2026-07-17)

The import wizard (`apps/web/src/layout/ImportsPanel.tsx`) exposes 5 adapters via a hard-coded `ADAPTERS` list (lines 8–14): `device-state`, `nmap-xml`, `tshark-flows`, `ldif`, `zeek-conn`. The **only** format guidance a user ever sees is the dropdown label (e.g. "tshark flow summary (JSON/CSV)"). There is no in-app description of required fields, no example payload, and no pre-upload validation — a malformed file round-trips through upload → background parse worker → `failed` job → inline error. Concretely:

| Adapter        | Expected input                                                                                                                                                                                           | Where the real schema lives                                                                                             | What a user is never told                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `device-state` | JSON, strict versioned contract (`schemaVersion: "1.0.0"`, `hosts[]` with required deviceId/hostname/os/interfaces/routes/arp/connections/listeningPorts/users/groups/administrators/sudoers/collection) | `packages/import-contract/src/device-state.ts` (Zod, + `deviceStateJsonSchema()` JSON-Schema generator + validator CLI) | The entire contract; that a validator CLI exists             |
| `nmap-xml`     | Nmap `<nmaprun>` XML; only `status=up` hosts and `state=open` ports are used                                                                                                                             | `apps/server/src/imports/adapters/nmap-xml.ts:15-60`                                                                    | That non-nmap XML is rejected outright                       |
| `tshark-flows` | JSON array/object **or** CSV; rows need `source`, `destination`; optional `protocol`, `port`, `frames`, `firstSeen`/`lastSeen` (ISO or epoch)                                                            | `apps/server/src/imports/adapters/tshark-flows.ts:15-23`                                                                | The required CSV header columns                              |
| `zeek-conn`    | Zeek conn.log — classic TSV with `#fields` header **or** JSON-lines; needs `id.orig_h`, `id.resp_h`                                                                                                      | `apps/server/src/imports/adapters/zeek-conn.ts:50-63`                                                                   | That TSV without `#fields` fails; the field names used       |
| `ldif`         | RFC 2849 LDIF; uses `dn`, `objectclass`, `samaccountname`/`uid`/`cn`                                                                                                                                     | `apps/server/src/imports/adapters/ldif.ts`                                                                              | Which attributes matter; that `computer` entries are skipped |

Also relevant: `netcat-text` exists server-side but is not in the dropdown because it needs an `ImportProfile` (`packages/domain/src/entities.ts:360-383`) and there is **no profile-authoring UI**. Parse limits (64 MB, 30 s budget, 50 k observations, 16-job queue) live in `apps/server/src/imports/guards.ts:34-42` and are only discovered by hitting them.

### A0 — Format descriptor: one shared source of truth

Create a **format descriptor** per adapter, in a place both the server registry and the web app import — `packages/domain/src/import-formats.ts` (exported from the domain barrel):

```ts
export type ImportFormatField = {
  name: string; // dotted path, e.g. "hosts[].interfaces[].mac"
  type: string; // human-readable: "string", "int 0–65535", "'tcp' | 'udp' | …"
  required: boolean;
  description: string;
};

export type ImportFormatSpec = {
  adapter: string; // registry key, e.g. "tshark-flows"
  label: string; // dropdown label (moves here from ImportsPanel)
  fileKinds: string[]; // ["JSON", "CSV"]
  extensions: string[]; // drives guessAdapter, e.g. [".csv"]
  summary: string; // 1–2 sentences: what this format is and what it produces
  fields: ImportFormatField[]; // the shape table shown to the user
  example: string; // minimal valid payload, copy-paste ready
  notes: string[]; // encodings, skipped rows, rejection rules, size limits
};

export const IMPORT_FORMAT_SPECS: Record<string, ImportFormatSpec>;
```

Rules:

1. **`device-state` does not restate its contract.** Its `fields` table is _generated_ from the Zod schema — add a small walker in `packages/import-contract` (it already walks the schema for `deviceStateJsonSchema()`) that emits `ImportFormatField[]`, and have the descriptor call it. The four third-party formats get hand-authored descriptors, but each lives in the same file as a `satisfies ImportFormatSpec` block **with a unit test in the server package that parses `spec.example` through the real adapter and asserts it produces ≥ 1 observation with no errors.** That test is the guard that keeps the docs honest — if an adapter's expectations change, the example breaks in CI.
2. **The wizard's `ADAPTERS` list and `guessAdapter()` derive from the descriptors** (label, extensions). Delete the hard-coded list in `ImportsPanel.tsx:8-23`. `netcat-text` gets a descriptor too but stays flagged `requiresProfile: true` and out of the dropdown until A4.
3. Server-side, the adapter registry (`apps/server/src/imports/adapters/registry.ts`) gains a test asserting every non-fixture adapter has a descriptor and vice-versa.

**DoD:** descriptors exist for all 6 real adapters; example-round-trip test passes per adapter; wizard dropdown and extension guessing behave identically to before (e2e green); no field list is defined twice.

### A1 — "Expected format" helper panel in the import wizard

Extend `ImportWizard` in `ImportsPanel.tsx`: below the adapter select, render a collapsible **Expected format** section (collapsed by default, expanded state per adapter remembered in component state) driven entirely by the selected adapter's `ImportFormatSpec`:

- **Summary line** + accepted file kinds/extensions as small chips.
- **Field table** — Name / Type / Required / Description. Required fields visually distinct (accent dot or weight, not color alone). Uses the consolidated `.data-table` style from B3 if it has landed, else the existing panel-table pattern.
- **Minimal example** in a `<pre class="format-example">` with a copy button (IconButton + clipboard, success toast) and a **Download example** button that saves `example` as `example.<ext>` — so "adjust your data to match" starts from a working file.
- **Notes** as a compact list (rejection rules, skipped rows, the relevant parse limits — surface 64 MB / 50 k observations here instead of letting users find them the hard way).

Styling: new CSS uses `--space-*`/`--text-*` tokens; monospace via `--font-mono`. Add `data-testid="import-format-help"` and an e2e test: select each adapter, expand help, assert the field table names match the descriptor.

**DoD:** every dropdown adapter shows its full expected structure, example, and notes in-app; copy + download work; e2e green.

### A2 — Device-state extras: pre-upload validation and JSON Schema

`packages/import-contract` is a workspace package, so the web app can depend on it directly.

1. When the selected adapter is `device-state` and a file is chosen, run `validateDeviceStateReport(content)` **client-side before upload**. On failure, block the upload and render the `issues` list (`path: message`, capped at ~20 with a "+n more" line) in the wizard — same information the CLI prints, zero server round-trip. On success show "`n` hosts, schema 1.0.0" next to the upload button.
2. Add a **Download JSON Schema** button to the device-state help panel, serving `deviceStateJsonSchema()` as `device-state.schema.json` — the machine-readable spec for the client's own CI.
3. Mention the standalone validator CLI (`netplan-validate <report.json>`) in the device-state notes.

Watch bundle size: import the contract package normally; if the Zod walker pulls weight, lazy-import the validation path (`await import(...)`) on first use.

**DoD:** a malformed device-state report is fully diagnosed in-browser before any upload; valid reports show host count; schema download works; e2e covers one invalid + one valid file.

### A3 — Cheap pre-flight checks for the text formats

Client-side, before upload, run the same trivially-checkable gates the server enforces, so the common failure modes are caught instantly with a helpful message instead of a failed job minutes later:

- `tshark-flows` CSV: header row contains `source` and `destination` — else name the missing columns and point at the help panel.
- `zeek-conn` TSV: starts with `#` headers including `#fields`, or first non-blank line starts with `{` (JSON-lines) — else say which.
- `nmap-xml`: content contains `<nmaprun` — else "not an Nmap XML document".
- Any adapter: file exceeds the 64 MB limit — reject client-side with the limit named.

These are _advisory string checks only_ — no duplicated parsing logic; the server stays the authority. Implement as a `preflight(spec, filename, content): string | null` helper beside the descriptors with unit tests.

**DoD:** each check has a unit test; a bad-header CSV upload is blocked with a message naming the missing columns; a valid file passes through untouched.

### A4 (stretch, separate PR) — netcat-text profile authoring

The `ImportProfile` schema and the `netcat-text` adapter are fully built; only the UI is missing. If taken: a small "Import profiles" section in the Imports page — list, create, edit (name, regex pattern with named groups `host`/`port`/`status`/`banner`, description), delete — writing through the existing Operations (`reducer.ts:70-71`), plus a live regex tester (paste sample lines, see captured groups). Once ≥ 1 profile exists, `netcat-text` appears in the wizard dropdown with a profile select, sending `profileId` in the upload body (`createImportBodySchema` already accepts it). Do not start this until A0–A3 are merged; it is a functional feature, not a helper.

---

## Track B — UI polish (page level, canvas excluded)

### Current state (audit 2026-07-17)

The foundation is done — tokens, primitives, focus rings, themed selects, toasts, ConfirmDialog (no `alert()`/`confirm()` anywhere), broad `.panel-empty` empty-state coverage. The professionalism gap is **partial adoption**: only 8 of 20 layout files use `src/ui/` primitives; ~70 raw `<button>`s ride bespoke CSS classes that reimplement Button (`.finding-action`, `.findings-rerun`, `.import-job__control`, `.proposal-register`, `.egress-list button`, `.reports-panel__buttons`); there is no loading/skeleton primitive (async panels render empty-state while fetching); five near-duplicate table styles; and the pre-polish half of `styles.css` (roughly lines 330–2850) uses raw px instead of the spacing/type tokens.

### B1 — Primitive adoption sweep

File-by-file, migrate raw buttons in the page panels to `Button`/`IconButton` and delete the bespoke CSS they leave behind. Order (worst first): `FindingsPanel.tsx` (retire `.finding-action`, `.findings-rerun`, `styles.css:2575-2587`, `2712-2731`), `ImportsPanel.tsx` (`.import-job__control`, `styles.css:2854`), `EgressPanel.tsx` (`.egress-list button`, `.egress-check`, `styles.css:2777-2823`), `ReportsPanel.tsx` (`.reports-panel__buttons`, `styles.css:1235`), `ProposalSignOff.tsx` (`.proposal-register`, `styles.css:2860`), then `NetworksPanel`/`OverviewPanel` stragglers. Where a bespoke class carried real semantics (active-filter state), map it to `IconButton pressed` or a Button variant — do not grow new variants without need. One commit per panel; screenshot before/after via `/verify`.

**DoD (per panel):** zero raw `<button>` except where a primitive genuinely can't express it (document why in the commit message); the retired CSS classes are gone from `styles.css`; e2e green.

### B2 — Loading states

Add a `Spinner` (or `Busy`) primitive to `src/ui/` — token-colored, `role="status"`, `aria-label`, sizes sm/md — plus a `.panel-loading` treatment for panel bodies. Apply to every async surface that currently renders nothing or a misleading empty state while fetching: ImportsPanel job list, EgressPanel, ReportsPanel generation, NetworksPanel, FindingsPanel re-run (replace the bare "Running…" text with spinner + label). Async buttons get `disabled` + inline spinner during the action (Button already composes children — no new prop unless it falls out naturally).

**DoD:** no async panel shows an empty state while its first fetch is in flight; primitive exported from `ui/index.ts`; used in ≥ 5 surfaces.

### B3 — One data table

Consolidate `.networks-table`, `.reports-table`, `.settings-table`, `.egress-table`, and the `.import-review table` body styles into a single `.data-table` class (the M6 header rule at `styles.css:3136-3143` already unified headers). Keep per-table column-width tweaks as thin modifiers. Row hover wash, consistent cell padding from `--space-*`, numeric cells right-aligned with `--font-mono` where they hold counts/ports/addresses.

**DoD:** the five table style blocks collapse to one + modifiers; visual diff of each table shows intentional changes only; e2e green.

### B4 — Token migration of the pre-polish CSS

Work through `styles.css` sections before the ui-polish block (`:2888`), converting raw px spacing/font sizes to `--space-*`/`--text-*` tokens **for the page-level sections only** — command bar, library panel, inspector, context panel, page panels. Skip every canvas-related block (`.canvas-toolbar`, `.device-node`, node/edge/minimap styles) — those are out of scope. Where a raw value has no token neighbour (e.g. 5px), snap to the nearest token; if the snap is visually noticeable, keep the px and move on — this is normalization, not redesign. Also fold in the two known warts: remove the `!important` at `styles.css:2645` by fixing specificity, and dedupe the `.severity--*`/`.status--*` color blocks (`styles.css:2643-2677`) into shared custom properties.

**DoD:** page-level sections use tokens; `git grep -n 'px' apps/web/src/styles.css` count meaningfully down in those sections; screenshots show no unintended layout shifts; e2e green.

### B5 — Primary nav polish

`LibraryPanel.tsx:113-144` renders the 10-item primary nav as raw `<button class="library-item">`. Extract a `NavItem` treatment (either a thin component in `src/ui/` or a disciplined class pair): active-page indication (accent bar/wash, `aria-current="page"`), consistent icon+label alignment, hover/focus states from tokens. Keep the existing view-routing mechanism untouched — this is presentation only.

**DoD:** current page is visually and semantically (`aria-current`) marked; keyboard focus order and activation unchanged; e2e green.

### B6 — Final consistency pass

A short sweep with `/verify` screenshots of every page (overview, canvas _chrome only_, networks, rules, imports, identities, findings, egress, reports, settings) checking: heading hierarchy consistent (`--text-*` scale), `.panel-empty` copy is sentence-case and actionable ("Import evidence to see candidates" beats "No data"), toasts vs inline errors used consistently (validation → inline, operation results → toast), and no stray browser-default control survived. File anything non-trivial as an issue instead of scope-creeping this plan.

**DoD:** screenshot set attached to the PR; remaining findings filed as issues.

---

## Sequencing & delivery

- **Track A**: A0 → A1 → A2 → A3 in one PR-sized arc (A0+A1 can be one PR, A2+A3 a second). A4 is its own later PR, if at all.
- **Track B**: B1–B5 are independent of Track A and mostly of each other; land B3 before A1 if convenient (A1's field table wants `.data-table`), otherwise A1 uses the existing panel-table pattern and B3 sweeps it later. B6 last.
- Every milestone: e2e suite green (`apps/web/e2e/`, one shared DB — clean up test entities), unit tests for new logic (descriptor round-trip tests in A0, preflight tests in A3), `/verify` screenshots for visual changes.
- Branch names: `feat/import-format-helpers`, `refactor/ui-primitive-adoption` (or per-milestone), PRs reference this plan.
