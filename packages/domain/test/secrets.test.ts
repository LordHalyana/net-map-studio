import { describe, expect, it } from 'vitest';
import { detectSecrets, maskSecrets, maskValue } from '../src/index.js';

const FAKE_KEY = [
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Q',
  '-----END RSA PRIVATE KEY-----',
].join('\n');

describe('secrets detection & masking (M13, #70)', () => {
  it('detects a PEM private key and masks it out of the text', () => {
    const text = `config:\n${FAKE_KEY}\ndone`;
    const found = detectSecrets(text);
    expect(found.some((m) => m.kind === 'privateKey')).toBe(true);
    const masked = maskSecrets(text);
    expect(masked).not.toContain('MIIBOgIBAAJBAKj');
    expect(masked).toContain('[redacted]');
  });

  it('detects password assignments and connection-string credentials', () => {
    const found = detectSecrets('password=hunter2 db=postgres://user:s3cr3tpw@host/db');
    const kinds = found.map((m) => m.kind);
    expect(kinds).toContain('passwordAssignment');
    expect(kinds).toContain('connectionString');
    expect(found.find((m) => m.kind === 'passwordAssignment')?.value).toBe('hunter2');
    expect(found.find((m) => m.kind === 'connectionString')?.value).toBe('s3cr3tpw');
  });

  it('flags a high-entropy token but not an ordinary long word', () => {
    const random = 'q7Zx2P9vLm4Ke1Rt8Yb3Nc6Wd0Fh5GjZ4';
    const dull = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect(detectSecrets(random).some((m) => m.kind === 'highEntropyToken')).toBe(true);
    expect(detectSecrets(dull).some((m) => m.kind === 'highEntropyToken')).toBe(false);
  });

  it('reports a stable offset/length so a reveal can slice the original back', () => {
    const text = 'x password=topsecret y';
    const [match] = detectSecrets(text).filter((m) => m.kind === 'passwordAssignment');
    expect(match).toBeDefined();
    expect(text.slice(match!.index, match!.index + match!.value.length)).toBe('topsecret');
  });

  it('the mask keeps a shape hint but not the value', () => {
    expect(maskValue('topsecret')).toMatch(/^to/);
    expect(maskValue('topsecret')).toContain('[redacted]');
    expect(maskValue('topsecret')).not.toContain('secret');
  });

  it('is inert when disabled', () => {
    expect(
      detectSecrets('password=hunter2', {
        enabled: false,
        extraPatterns: [],
        minTokenEntropy: 3.5,
      }),
    ).toEqual([]);
  });
});
