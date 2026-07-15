# NetPlan Studio

A local-first tool for planning networks, reconstructing existing ones from
imported evidence, and surfacing security concerns. See [`CONTEXT.md`](CONTEXT.md)
for the domain language and [`docs/adr/`](docs/adr) for the binding decisions.

This repo is a pnpm-workspaces monorepo:

- `packages/domain` — Zod schemas + types, the single source of truth (ADR-0017)
- `apps/server` — Fastify API over the Operation-log engine + embedded SQLite
- `apps/web` — React + React Flow SPA

## Prerequisites

- Node.js ≥ 22
- pnpm (`corepack enable pnpm`, or `npm i -g pnpm`)

```sh
pnpm install
```

## Running the stack

**Development** — two hot-reloading processes (Vite on `:5173` proxying `/api`
to the API on `:3001`):

```sh
pnpm dev
```

Open http://127.0.0.1:5173.

**Production-style single process** — builds everything, then runs one local
web-server process that serves the built SPA _and_ the API from one origin
(ADR-0002):

```sh
pnpm start
```

Open http://127.0.0.1:3001. Configure with env vars:

- `PORT` — listen port (default `3001`)
- `NETPLAN_DB` — SQLite file path (default `netplan.db` in the server's cwd)

## Other scripts

| Command          | What it does                                        |
| ---------------- | --------------------------------------------------- |
| `pnpm build`     | Build every package                                 |
| `pnpm typecheck` | `tsc --noEmit` across the workspace                 |
| `pnpm test`      | Unit + integration tests (Vitest)                   |
| `pnpm test:e2e`  | Playwright end-to-end tests (boots its own servers) |
| `pnpm lint`      | ESLint                                              |
| `pnpm format`    | Prettier write                                      |

Dark mode only for this release.
