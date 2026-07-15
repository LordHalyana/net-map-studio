# Drizzle ORM with a dialect-portable schema

The data access layer is Drizzle ORM, with the schema written to stay dialect-portable so the SQLite-now / Postgres-later move (ADR-0001) is a swap, not a rewrite. Drizzle's schema is TypeScript, so it slots into the shared domain package (ADR-0003) rather than living in a separate DSL, and the same schema targets both SQLite and Postgres. It is also the lightest option for an embedded local app.

## Considered Options

- **Prisma** — best DX but a second schema DSL beside our TS types, a heavier engine, and imperfect SQLite→Postgres portability we'd hit exactly at migration time. Rejected.
- **Kysely** — great control but more hand-written SQL for 18 entities and weaker migrations. Rejected.

## Consequences

- Postgres-specific features (JSONB indexing, full-text search) will require explicit dialect-conditional code when they arrive — accepted, and preferable to hiding the dialect gap.
