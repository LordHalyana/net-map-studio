import { describe, expect, it } from 'vitest';
import { fromPartial } from '@total-typescript/shoehorn';
import {
  defaultEgressSettings,
  egressAuditRecordSchema,
  egressSettingsSchema,
  indicatorTypeSchema,
  newId,
  projectIdSchema,
} from '../src/index.js';
import { makeEgressAuditRecord, makeEgressSettings } from '../src/fixtures.js';

/** M1 (ADR-0027): the egress door's Zod shapes — settings, audit record, graded indicators. */

const projectId = newId(projectIdSchema);
const NOW = '2026-07-15T12:00:00.000Z';

describe('egress settings schema', () => {
  it('defaults to a shut door: disabled, unacknowledged, hash-first', () => {
    const settings = defaultEgressSettings(projectId, NOW);
    expect(settings.enabled).toBe(false);
    expect(settings.disclosureAcknowledgedAt).toBeNull();
    expect(settings.allowedIndicatorTypes).toEqual(['fileHash']);
  });

  it('rejects unknown indicator types', () => {
    const result = egressSettingsSchema.safeParse(
      fromPartial({
        ...makeEgressSettings(projectId),
        allowedIndicatorTypes: ['url'],
      }),
    );
    expect(result.success).toBe(false);
  });

  it('grades indicators as fileHash, ip and domain only', () => {
    expect(indicatorTypeSchema.options).toEqual(['fileHash', 'ip', 'domain']);
  });
});

describe('egress audit record schema', () => {
  it('accepts a complete record and defaults detail to empty', () => {
    const record = makeEgressAuditRecord(projectId);
    expect(record.detail).toBe('');
    expect(record.outcome).toBe('success');
  });

  it('requires the exact query — an empty query is not auditable', () => {
    const result = egressAuditRecordSchema.safeParse(
      fromPartial({ ...makeEgressAuditRecord(projectId), query: '' }),
    );
    expect(result.success).toBe(false);
  });

  it('records blocked attempts with a reason', () => {
    const record = makeEgressAuditRecord(projectId, {
      outcome: 'blocked',
      detail: 'egress is disabled for this project',
    });
    expect(record.outcome).toBe('blocked');
    expect(record.detail).not.toBe('');
  });
});
