import { describe, expect, it } from 'vitest';
import { deviceStateFormatFields } from '../src/format-fields.js';

/**
 * #90 A0: the device-state field table is generated from the contract's
 * JSON-Schema artifact — these tests pin the walker's rendering rules so the
 * in-app "Expected format" table stays truthful as the contract evolves.
 */
describe('deviceStateFormatFields', () => {
  const fields = deviceStateFormatFields();
  const byName = new Map(fields.map((f) => [f.name, f]));

  it('emits every level of the contract as dotted paths', () => {
    expect(byName.has('schemaVersion')).toBe(true);
    expect(byName.has('hosts[]')).toBe(true);
    expect(byName.has('hosts[].deviceId')).toBe(true);
    expect(byName.has('hosts[].interfaces[].addresses[].value')).toBe(true);
    expect(byName.has('hosts[].collection.scope[]')).toBe(true);
  });

  it('marks requiredness from the schema, not by hand', () => {
    expect(byName.get('hosts[].deviceId')?.required).toBe(true);
    expect(byName.get('hosts[].interfaces[].mac')?.required).toBe(false);
    expect(byName.get('generatedAt')?.required).toBe(false);
    // Phase-3 arrays are optional at the host level (ADR-0018)
    expect(byName.get('hosts[].processes[]')?.required).toBe(false);
    // …but their entries still have required members relative to the entry
    expect(byName.get('hosts[].processes[].name')?.required).toBe(true);
  });

  it('renders human-readable types: literals, enums, bounded ints, timestamps', () => {
    expect(byName.get('schemaVersion')?.type).toBe('"1.0.0" (exactly)');
    expect(byName.get('hosts[].listeningPorts[].port')?.type).toBe('int 0–65535');
    expect(byName.get('hosts[].listeningPorts[].protocol')?.type).toBe(
      "'tcp' | 'udp' | 'icmp' | 'other'",
    );
    expect(byName.get('hosts[].collectedAt')?.type).toBe('ISO 8601 timestamp');
    expect(byName.get('hosts[].localUsers[].disabled')?.type).toBe('boolean');
    // unbounded int sentinels don't leak into the label
    expect(byName.get('hosts[].connections[].pid')?.type).toBe('int');
    // scalar arrays render as the element type under a [] path
    expect(byName.get('hosts[].administrators[]')?.type).toBe('string');
  });

  it('carries descriptions from the Zod schema through the JSON Schema', () => {
    expect(byName.get('hosts[].deviceId')?.description).toContain('stable machine identifier');
    expect(byName.get('hosts[].interfaces[].addresses[].value')?.description).toContain(
      'MAC, IPv4, IPv6 or DNS name',
    );
  });

  it('emits no duplicate paths', () => {
    expect(byName.size).toBe(fields.length);
  });
});
