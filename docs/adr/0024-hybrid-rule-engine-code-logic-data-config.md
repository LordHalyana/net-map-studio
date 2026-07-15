# The rule engine is hybrid: code detection logic + versioned data config

A **Rule** in the Phase-3 findings engine is **typed TypeScript detection logic** (`(ctx) => detected findings`) paired with an **operator-tunable, Zod-validated config** (thresholds, per-rule severity override, enable/disable, and references to allow/deny string lists and Baselines). The genuinely expressive detections — beacon periodicity, cross-host correlation, masquerading patterns — live in code where they can be typed and TDD'd; the operator-facing knobs live in versioned data. Every Finding stamps **both** a `ruleVersion` (code-logic version, bumped when logic changes) and a **config version/hash**, so a finding is reproducible against the exact logic and tuning that produced it.

Operator-maintained **allow/deny lists of opaque strings** (suspicious filenames, file hashes, approved-software names, local indicator IoCs, external IPs) are **rule config**, not model objects. The **Baseline** — expected services/traffic that references real model objects by id — is a first-class entity instead (ADR-0025).

## Considered Options

- **Pure code rules** — simplest and fully type-safe, but every threshold tweak or allowlist change (which §3.8 explicitly makes operator-maintained) requires shipping new code. Rejected: the operator must tune without a release.
- **Fully data-driven rules (a rule DSL/interpreter)** — operators author arbitrary rules as data, but expressive detections (beacon, correlation) do not fit a simple condition language, and building a Turing-complete rule DSL is a large, error-prone surface the design does not call for. Rejected for Phase 3; the config seam leaves it open for Phase 4.

## Consequences

- Detection logic stays in `packages/domain` (next to `rule-validation.ts`), pure and unit-testable; the server's background worker only invokes the engine and persists disposition.
- Rule config is Zod-first (ADR-0017); the config schema is the single source of truth for what is tunable, and its version/hash is part of a finding's reproducibility record.
- §3.8's "operator-maintained allowlists, denylists and expected-service baselines" is served without inventing a rule language: string lists are config, Baselines are entities (ADR-0025).
- Phase 4 can add fully data-defined custom rules on top of the same config seam — additive, not a reshape.
- The optional classification-framework mapping (design Q9) is a non-load-bearing `frameworkRefs?` field on a Rule; §3.8 categories remain the primary taxonomy.
