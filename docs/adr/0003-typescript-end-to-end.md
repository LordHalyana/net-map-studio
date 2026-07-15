# TypeScript end-to-end, monorepo, shared domain package

The whole stack is TypeScript in a single monorepo with a shared `packages/domain` package, so the ~18 entities and their rich provenance metadata are defined once and consumed by API, parsers and canvas alike. This app is dominated by an evolving typed model that both sides manipulate constantly — the textbook case where a single shared type layer pays off daily, and a split stack would tax every entity change with a codegen/sync step.

## Consequences

- If Phase-2 PCAP/flow parsing ever needs heavy non-JS tooling, those parsers run as out-of-process sidecar workers (already anticipated by the isolated-import-job design), not by splitting the core app.
