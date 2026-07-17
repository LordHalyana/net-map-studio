---
name: verify
description: Build, launch and drive NetPlan Studio (web + server) to verify a change end-to-end with Playwright screenshots.
---

# Verifying NetPlan Studio changes

## Launch the dev stack

Two background processes (server on 3001, Vite on 5173, `/api` proxied):

```powershell
$env:NETPLAN_DB = "<scratch-dir>\verify.db"   # fresh DB — the app always loads projects[0]
pnpm --filter @netplan/server dev
pnpm --filter @netplan/web dev
```

Poll `http://127.0.0.1:3001/health` and `http://127.0.0.1:5173` until both return 200 (~10s).

## Drive it

Playwright (chromium) is a devDependency of `@netplan/web`. Write a throwaway
`apps/web/e2e/<name>.ts` script modeled on `apps/web/e2e/visual-capture.ts` and run it with:

```powershell
pnpm --filter @netplan/web exec tsx e2e/<name>.ts
```

Recipe that works:

- `import { seedDemoScene } from './demo-scene'` and call `seedDemoScene('http://127.0.0.1:3001')`
  to get the "Hotel Network Plan" demo project (devices, VLANs, rules — and 17 findings after a re-run).
- `page.goto('http://127.0.0.1:5173')`, wait for `[data-testid="app-shell"]` then `.react-flow__node`.
- Views are reached via the left nav: `[data-testid="nav-<view>"]` where view ∈ overview, canvas,
  networks, rules, imports, identities, findings, reports, egress, settings.
- Everything has `data-testid` attributes — grep the component in `apps/web/src/layout/`.
- Viewport 1448×1086 matches the concept mock proportions.
- Layout checks: `locator.boundingBox()` against the shell grid (240px library | canvas | 300px
  inspector; 44px command bar on top, 200px context panel on the bottom).

Delete the throwaway script when done.

## Gotchas

- The app always opens `projects[0]` — point `NETPLAN_DB` at a fresh file or seeding asserts and fails.
- Vite hot-reloads CSS instantly; no restart needed between CSS edits and re-captures.
