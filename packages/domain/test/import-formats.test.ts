import { describe, expect, it } from 'vitest';
import { validateDeviceStateReport } from '@netplan/import-contract';
import {
  guessImportAdapter,
  IMPORT_FORMAT_SPECS,
  previewProfilePattern,
  wizardImportFormats,
} from '../src/import-formats.js';

/**
 * #90 A0: descriptor sanity plus the wizard behaviours that moved here from
 * ImportsPanel — extension guessing must behave exactly as the old
 * hard-coded list did. The example↔adapter round-trip lives in the server
 * package, next to the real adapters.
 */
describe('IMPORT_FORMAT_SPECS', () => {
  it('every descriptor is complete and keyed by its adapter name', () => {
    for (const [key, spec] of Object.entries(IMPORT_FORMAT_SPECS)) {
      expect(spec.adapter).toBe(key);
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.summary.length).toBeGreaterThan(0);
      expect(spec.fields.length).toBeGreaterThan(0);
      expect(spec.example.length).toBeGreaterThan(0);
      expect(spec.notes.length).toBeGreaterThan(0);
      expect(spec.fileKinds.length).toBeGreaterThan(0);
    }
  });

  it('the device-state example validates against the real contract', () => {
    const spec = IMPORT_FORMAT_SPECS['device-state'];
    const result = validateDeviceStateReport(JSON.parse(spec?.example ?? ''));
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.hostCount).toBe(1);
  });

  it('profile-driven adapters carry a tested example pattern and stay out of the wizard', () => {
    const netcat = IMPORT_FORMAT_SPECS['netcat-text'];
    expect(netcat?.requiresProfile).toBe(true);
    expect(() => new RegExp(netcat?.exampleProfilePattern ?? '')).not.toThrow();
    expect(wizardImportFormats().map((s) => s.adapter)).toEqual([
      'device-state',
      'nmap-xml',
      'tshark-flows',
      'ldif',
      'zeek-conn',
    ]);
  });
});

describe('guessImportAdapter', () => {
  it('matches the retired hard-coded guesses exactly', () => {
    expect(guessImportAdapter('scan.XML')).toBe('nmap-xml');
    expect(guessImportAdapter('flows.csv')).toBe('tshark-flows');
    expect(guessImportAdapter('export.ldif')).toBe('ldif');
    expect(guessImportAdapter('site-conn.log')).toBe('zeek-conn');
    expect(guessImportAdapter('capture.zeek')).toBe('zeek-conn');
    expect(guessImportAdapter('report.json')).toBe('device-state');
    expect(guessImportAdapter('anything.bin')).toBe('device-state');
  });

  it('guesses netcat-text for .txt only once a profile unlocks it', () => {
    expect(guessImportAdapter('scan.txt')).toBe('device-state');
    expect(guessImportAdapter('scan.txt', [{ adapter: 'netcat-text' }])).toBe('netcat-text');
  });
});

/** #90 A4: a profile for an adapter puts it in the wizard; none keeps it out. */
describe('wizardImportFormats with profiles', () => {
  it('includes netcat-text once a profile exists for it', () => {
    const adapters = wizardImportFormats([{ adapter: 'netcat-text' }]).map((s) => s.adapter);
    expect(adapters).toContain('netcat-text');
  });

  it('a profile for a different adapter unlocks nothing', () => {
    const adapters = wizardImportFormats([{ adapter: 'other-text' }]).map((s) => s.adapter);
    expect(adapters).not.toContain('netcat-text');
  });
});

/** #90 A4: the live regex tester behind profile authoring. */
describe('previewProfilePattern', () => {
  const netcatPattern = IMPORT_FORMAT_SPECS['netcat-text']?.exampleProfilePattern ?? '';
  const netcatExample = IMPORT_FORMAT_SPECS['netcat-text']?.example ?? '';

  it('reports captured groups per sample line, null for non-matches', () => {
    const result = previewProfilePattern(netcatPattern, netcatExample);
    expect(result.error).toBeNull();
    expect(result.lines).toHaveLength(3);
    expect(result.lines[0]).toEqual({
      line: 'Connection to 10.0.10.21 443 port [tcp/https] succeeded!',
      groups: { host: '10.0.10.21', port: '443', banner: 'https', status: 'succeeded' },
    });
    // the "refused" nc line does not match the example pattern's syntax
    expect(result.lines[2]?.groups).toBeNull();
  });

  it('skips blank lines and surfaces an invalid pattern as an error', () => {
    expect(previewProfilePattern(netcatPattern, '\n\n').lines).toEqual([]);
    const invalid = previewProfilePattern('(?<host>[', 'anything');
    expect(invalid.error).toMatch(/regular expression/i);
    expect(invalid.lines).toEqual([]);
  });

  it('a pattern without named groups still previews, with empty groups', () => {
    const result = previewProfilePattern('^Connection', 'Connection to somewhere\nnope');
    expect(result.error).toBeNull();
    expect(result.lines[0]?.groups).toEqual({});
    expect(result.lines[1]?.groups).toBeNull();
  });
});
