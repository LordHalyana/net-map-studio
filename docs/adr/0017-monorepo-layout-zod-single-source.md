# Monorepo layout with Zod as the single schema source

The repo is a pnpm-workspaces monorepo: `packages/domain` (entities, Zod schemas, shared types) + `apps/web` (React + React Flow via Vite) + `apps/server` (Fastify + Drizzle + migrations). **Zod schemas in `packages/domain` are the single source of truth** — TS types are inferred from them, and Fastify request validation, React inspector-form validation and Drizzle's table types all consume/align to them, so the model has one definition and cannot drift. Tooling: Vite, Vitest, Playwright (canvas e2e), ESLint + Prettier + husky + lint-staged. Turborepo is deferred — three workspaces don't justify it yet.

## Consequences

- Drizzle's schema is the persistence mapping, kept consistent with the Zod source via type checks / `drizzle-zod` rather than being an independent second source.
