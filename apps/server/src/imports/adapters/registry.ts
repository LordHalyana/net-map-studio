import type { Adapter } from './types.js';
import { fixtureAdapter } from './fixture.js';
import { deviceStateAdapter } from './device-state.js';
import { nmapXmlAdapter } from './nmap-xml.js';
import { tsharkFlowsAdapter } from './tshark-flows.js';
import { ldifAdapter } from './ldif.js';
import { zeekConnAdapter } from './zeek-conn.js';
import { netcatTextAdapter } from './netcat-text.js';

/**
 * The built-in Adapter registry (ADR-0020), shared by the import store (name
 * validation, schema-version stamping) and the parse worker (execution) —
 * one list, both sides of the thread boundary (M12, #69).
 */
export const builtInAdapters: ReadonlyMap<string, Adapter> = new Map(
  [
    fixtureAdapter,
    deviceStateAdapter,
    nmapXmlAdapter,
    tsharkFlowsAdapter,
    ldifAdapter,
    zeekConnAdapter,
    netcatTextAdapter,
  ].map((a) => [a.name, a]),
);
