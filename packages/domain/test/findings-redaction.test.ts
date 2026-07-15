import { describe, expect, it } from 'vitest';
import { redactFindings, type FindingView } from '../src/index.js';

function view(): FindingView {
  return {
    fingerprint: 'fp-1',
    status: 'new',
    notes: '',
    stale: false,
    dispositionId: null,
    detection: {
      fingerprint: 'fp-1',
      ruleId: 'rule.x',
      ruleVersion: '1.0.0',
      configHash: 'abcd',
      category: 'unexpected external destination',
      title: 'Unexpected external destination: 203.0.113.66',
      affected: null,
      evidenceRefs: [],
      contributingProvenanceRows: [],
      citedBaselineId: null,
      citedBaselineVersion: null,
      severity: 'high',
      confidence: 0.6,
      explanation:
        'svc-backup on C:\\Users\\alice\\secret.exe contacted 203.0.113.66 (hash aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899).',
      verificationSteps: ['Investigate.'],
    },
  };
}

describe('M12 client-safe findings redaction (§3.12, Q15)', () => {
  it('masks external IPs, hashes and paths while keeping the finding kind and severity', () => {
    const [redacted] = redactFindings([view()], 'client-safe', ['svc-backup', 'alice']);
    const detection = redacted?.detection;
    expect(detection).toBeDefined();
    // Kind + severity intact.
    expect(detection?.title).toContain('Unexpected external destination');
    expect(detection?.severity).toBe('high');
    expect(detection?.confidence).toBe(0.6);
    // Specifics masked.
    expect(detection?.title).not.toContain('203.0.113.66');
    expect(detection?.title).toContain('[ip]');
    expect(detection?.explanation).toContain('[ip]');
    expect(detection?.explanation).toContain('[path]');
    expect(detection?.explanation).toContain('[hash]');
    expect(detection?.explanation).toContain('[user]');
    expect(detection?.explanation).not.toContain('203.0.113.66');
    expect(detection?.explanation).not.toContain('svc-backup');
  });

  it('the `none` profile returns findings unchanged', () => {
    const original = view();
    const [same] = redactFindings([original], 'none');
    expect(same).toEqual(original);
  });

  it('leaves a stale finding (no detection) untouched', () => {
    const stale: FindingView = {
      fingerprint: 'fp-2',
      status: 'acceptedRisk',
      notes: 'reviewed 203.0.113.9',
      stale: true,
      dispositionId: null,
      detection: null,
    };
    const [out] = redactFindings([stale], 'client-safe');
    expect(out?.detection).toBeNull();
  });
});
