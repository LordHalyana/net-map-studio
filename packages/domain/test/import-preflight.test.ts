import { describe, expect, it } from 'vitest';
import {
  IMPORT_FORMAT_SPECS,
  IMPORT_MAX_FILE_BYTES,
  preflightImport,
} from '../src/import-formats.js';

/**
 * #90 A3: advisory pre-upload gates — each check catches its failure mode
 * with a message naming the problem, and every descriptor's own example must
 * sail through (a preflight that rejects the documented example would be
 * lying about the format).
 */

function spec(adapter: string) {
  const found = IMPORT_FORMAT_SPECS[adapter];
  if (!found) throw new Error(`no descriptor for ${adapter}`);
  return found;
}

describe('preflightImport', () => {
  it('rejects any file over the 64 MB limit, naming the limit', () => {
    const oversize = 'x'.repeat(IMPORT_MAX_FILE_BYTES + 1);
    expect(preflightImport(spec('ldif'), 'huge.ldif', oversize)).toContain('64 MB');
  });

  it('nmap-xml: rejects XML without an <nmaprun> root', () => {
    expect(
      preflightImport(spec('nmap-xml'), 'scan.xml', '<?xml version="1.0"?><report/>'),
    ).toContain('nmaprun');
  });

  it('tshark-flows: names the missing CSV columns', () => {
    const message = preflightImport(
      spec('tshark-flows'),
      'flows.csv',
      'src,dst\n10.0.0.1,10.0.0.2',
    );
    expect(message).toContain('source');
    expect(message).toContain('destination');
    const partial = preflightImport(
      spec('tshark-flows'),
      'flows.csv',
      'source,dst\n10.0.0.1,10.0.0.2',
    );
    expect(partial).toContain('destination');
    expect(partial).not.toContain('source and');
  });

  it('tshark-flows: JSON input is waved through — the server parses it', () => {
    expect(preflightImport(spec('tshark-flows'), 'flows.json', '[{"source":"a"}]')).toBeNull();
  });

  it('zeek-conn: says which of the two accepted shapes is missing', () => {
    expect(preflightImport(spec('zeek-conn'), 'conn.log', 'ts\tuid\n1\tC1')).toContain(
      '# header lines',
    );
    expect(
      preflightImport(spec('zeek-conn'), 'conn.log', '#separator \\x09\n1752\tC1\t10.0.0.1'),
    ).toContain('#fields');
    expect(preflightImport(spec('zeek-conn'), 'conn.json', '{"id.orig_h":"10.0.0.1"}')).toBeNull();
  });

  it('every descriptor example passes its own preflight', () => {
    for (const s of Object.values(IMPORT_FORMAT_SPECS)) {
      expect(preflightImport(s, `example${s.extensions[0] ?? ''}`, s.example)).toBeNull();
    }
  });
});
