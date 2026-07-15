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

export const invertOperation: InvertOperation = (op, inverseOpId) => {
  const base = { id: inverseOpId, projectId: op.projectId };
  switch (op.kind) {
    case 'CreateEntity':
      return { ...base, kind: 'DeleteEntity', payload: op.payload };
    case 'DeleteEntity':
      return { ...base, kind: 'CreateEntity', payload: op.payload };
    case 'SetField':
      return {
        ...base,
        kind: 'SetField',
        entityType: op.entityType,
        entityId: op.entityId,
        field: op.field,
        value: op.previousValue,
        previousValue: op.value,
      };
    case 'CreateLink':
      return { ...base, kind: 'DeleteLink', linkId: op.link.id, snapshot: op.link };
    case 'DeleteLink':
      return { ...base, kind: 'CreateLink', link: op.snapshot };
    case 'CreatePolicyRule':
      return { ...base, kind: 'DeletePolicyRule', ruleId: op.rule.id, snapshot: op.rule };
    case 'DeletePolicyRule':
      return { ...base, kind: 'CreatePolicyRule', rule: op.snapshot };
    case 'SetMembership':
      return {
        ...base,
        kind: 'SetMembership',
        interfaceId: op.interfaceId,
        networkId: op.previousNetworkId,
        previousNetworkId: op.networkId,
      };
    case 'SetContainment':
      return {
        ...base,
        kind: 'SetContainment',
        deviceId: op.deviceId,
        zoneId: op.previousZoneId,
        previousZoneId: op.zoneId,
      };
    case 'SetFindingStatus':
      return {
        ...base,
        kind: 'SetFindingStatus',
        fingerprint: op.fingerprint,
        status: op.previousStatus,
        previousStatus: op.status,
      };
    case 'SetFindingNote':
      return {
        ...base,
        kind: 'SetFindingNote',
        fingerprint: op.fingerprint,
        note: op.previousNote,
        previousNote: op.note,
      };
  }
};
