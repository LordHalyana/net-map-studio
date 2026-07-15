# Import reconciliation is editing a pending ChangeSet; verified is a badge, not a gate

An ImportJob produces a **proposed ChangeSet** of Operations (Create/SetField, each new object `lifecycleState: observed | inferred`) that is **not yet applied**. Reconciliation (§3.7) _is_ editing that pending ChangeSet: the review UI shows each proposed Operation and its conflicts against the committed graph, and the operator resolves them — **merge** rewrites a Create into a SetField on the existing object, **keep-separate** leaves it, **replace** supersedes, **ignore** drops the Operation. The system never silently merges. **Commit** applies the edited ChangeSet through the existing M2 apply-engine, so imported objects enter the _one_ committed graph; that ChangeSet is the ImportJob's rollback boundary.

Committed AS-IS is the whole graph — Observed, Inferred and Manually-verified alike. **Manual verification is a per-object trust badge** (a SetField flipping `lifecycleState → manuallyVerified`) applied to the subset an operator chooses to certify, **not a gate** on membership. `Confidence` and `lifecycleState` already communicate trust. This sharpens ADR-0009 (AS-IS is committed; TO-BE is an overlay ChangeSet) and ADR-0010 (every mutation is an Operation) for the import case.

## Considered Options

- **Staging graph, promote per-object into AS-IS** — a parallel store fights the single-graph spine (ADR-0010), and per-object promotion makes a 100-host import unusable before the map means anything. Rejected.
- **Auto-commit imports, reconcile conflicts afterward** — violates §3.7 ("never silently merge") and loses the pre-commit review the reconciliation queue exists for. Rejected.

## Consequences

- No new persistence concept: reconciliation reuses ChangeSet + the Operation log; import rollback is ChangeSet inversion, already built and tested in M2.
- Findings and planning operate on the committed graph regardless of verification state; verification is advisory metadata.
- The proposed-but-unapplied ChangeSet is a first-class state the reconciliation UI (plan M7) reads and rewrites before commit.
