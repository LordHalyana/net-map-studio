import { readFileSync } from 'node:fs';
import {
  DEVICE_STATE_SCHEMA_VERSION,
  validateDeviceStateReport,
  type ValidationResult,
} from './device-state.js';

/**
 * The standalone validator (ADR-0018): the client runs this offline or in
 * their own CI to prove an extraction script's output conforms *before*
 * importing — no NetPlan Studio app required.
 *
 *   netplan-validate <report.json>
 *
 * Exit codes: 0 valid, 1 invalid, 2 usage/IO error.
 */

export interface CliResult {
  exitCode: 0 | 1 | 2;
  lines: string[];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : (JSON.stringify(error) ?? 'unknown error');
}

export function runValidator(argv: string[]): CliResult {
  const [file] = argv;
  if (!file || argv.length !== 1) {
    return {
      exitCode: 2,
      lines: [
        'Usage: netplan-validate <report.json>',
        `Validates a device-state report against contract v${DEVICE_STATE_SCHEMA_VERSION}.`,
      ],
    };
  }

  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    return {
      exitCode: 2,
      lines: [`error: cannot read ${file}: ${describeError(error)}`],
    };
  }

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    return {
      exitCode: 1,
      lines: [`invalid: not JSON — ${describeError(error)}`],
    };
  }

  const result: ValidationResult = validateDeviceStateReport(document);
  if (result.ok) {
    return {
      exitCode: 0,
      lines: [`valid: device-state report v${result.schemaVersion}, ${result.hostCount} host(s)`],
    };
  }
  return {
    exitCode: 1,
    lines: [
      `invalid: ${result.issues.length} issue(s) against contract v${DEVICE_STATE_SCHEMA_VERSION}`,
      ...result.issues.map((issue) => `  ${issue.path}: ${issue.message}`),
    ],
  };
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() ?? '');

if (invokedAsScript) {
  const { exitCode, lines } = runValidator(process.argv.slice(2));
  for (const line of lines) console.log(line);
  process.exit(exitCode);
}
