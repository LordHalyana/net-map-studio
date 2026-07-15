import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deviceStateJsonSchema } from './device-state.js';

/**
 * Emit the JSON-Schema artifact from the Zod source (ADR-0017/0018). Run via
 * `pnpm generate:schema`; the test suite proves the checked-in artifact is
 * current.
 */
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema');
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'device-state.schema.json'),
  `${JSON.stringify(deviceStateJsonSchema(), null, 2)}\n`,
  'utf8',
);
console.log('wrote schema/device-state.schema.json');
