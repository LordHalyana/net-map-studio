import type { Operation } from './operations.js';
import type { OperationId } from './ids.js';

/**
 * Invert contract (ADR-0010, defined in M1, implemented in M2):
 *
 * For any Operation `op` applied to state S producing S', `invert(op, newOpId)`
 * yields an Operation that, applied to S', restores S exactly. Every Operation
 * variant carries its prior data inline (snapshots, previous values), so
 * inversion is a pure function of the Operation — no state lookup is needed.
 *
 * The inverse is itself a first-class Operation: it gets a fresh id (supplied
 * by the caller, since minting is a side effect) and is appended to the
 * operation log like any other mutation — undo is audited too.
 */
export type InvertOperation = (op: Operation, inverseOpId: OperationId) => Operation;
