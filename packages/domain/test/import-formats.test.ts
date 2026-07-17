import { describe, expect, it } from 'vitest';
import { validateDeviceStateReport } from '@netplan/import-contract';
import {
  guessImportAdapter,
  IMPORT_FORMAT_SPECS,
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
});
