import { z } from 'zod';

/**
 * The Device-State Report (ADR-0018): the one input format NetPlan Studio
 * owns. The client's extraction scripts emit this JSON; the standalone
 * validator CLI and the in-app adapter both consume this single Zod
 * definition, and the JSON-Schema artifact is generated from it.
 *
 * Validation strictness is split (ADR-0018):
 * - Phase-2 reconstruction fields are REQUIRED and STRICT (unknown keys
 *   rejected) — device identity/OS, interfaces, addresses, routes,
 *   ARP/neighbour, active connections, listening ports + owning process,
 *   local users/groups/administrators/sudoers, collection scope/errors.
 * - Phase-3 security fields are OPTIONAL and LOOSE — accepted, hashed and
 *   stored as Evidence now, parsed when Phase 3 lands.
 */

export const DEVICE_STATE_SCHEMA_VERSION = '1.0.0';

const nonEmpty = z.string().min(1);

/** ISO 8601 with timezone, e.g. 2026-07-15T12:00:00Z. */
const timestamp = z.iso.datetime().describe('ISO 8601 UTC timestamp, e.g. 2026-07-15T12:00:00Z');

export const addressEntrySchema = z.strictObject({
  /** The literal address value: MAC, IPv4, IPv6 or DNS name. */
  value: nonEmpty.describe('The literal address value: MAC, IPv4, IPv6 or DNS name'),
  /** Omit to let the importer infer the kind from the value's shape. */
  kind: z
    .enum(['mac', 'ipv4', 'ipv6', 'hostname'])
    .optional()
    .describe("Omit to let the importer infer the kind from the value's shape"),
  prefixLength: z.number().int().min(0).max(128).optional(),
});

export const interfaceEntrySchema = z.strictObject({
  name: nonEmpty,
  kind: z.enum(['ethernet', 'wifi', 'virtual', 'loopback', 'other']).optional(),
  mac: z.string().optional(),
  addresses: z.array(addressEntrySchema),
});

export const routeEntrySchema = z.strictObject({
  destination: nonEmpty,
  gateway: z.string().optional(),
  interface: z.string().optional(),
  metric: z.number().int().optional(),
});

export const arpEntrySchema = z.strictObject({
  ip: nonEmpty,
  mac: nonEmpty,
  interface: z.string().optional(),
});

const protocol = z.enum(['tcp', 'udp', 'icmp', 'other']);

export const connectionEntrySchema = z.strictObject({
  protocol,
  localAddress: nonEmpty,
  localPort: z.number().int().min(0).max(65535),
  remoteAddress: nonEmpty,
  remotePort: z.number().int().min(0).max(65535),
  state: z.string().optional(),
  process: z.string().optional(),
  pid: z.number().int().optional(),
});

export const listeningPortEntrySchema = z.strictObject({
  protocol,
  address: z.string().optional(),
  port: z.number().int().min(0).max(65535),
  /** The owning process name — required for service reconstruction. */
  process: nonEmpty.describe('The owning process name — required for service reconstruction'),
  pid: z.number().int().optional(),
});

/**
 * Principal names may be plain (`alice`) or domain-qualified
 * (`CORP\alice`, `alice@corp.example`). Domain-qualified principals become
 * domain-scoped Identities (ADR-0022).
 */
export const localUserEntrySchema = z
  .strictObject({
    name: nonEmpty.describe(
      'Plain (alice) or domain-qualified (CORP\\alice, alice@corp.example); domain-qualified principals become domain-scoped Identities',
    ),
    disabled: z.boolean().optional(),
    serviceAccount: z.boolean().optional(),
  })
  .describe('Local user accounts present on the host');

export const localGroupEntrySchema = z.strictObject({
  name: nonEmpty,
  members: z.array(nonEmpty),
});

/**
 * Phase-3 security fields (ADR-0018). Typed but tolerant (`z.object`, not
 * strict): collectors vary and may add keys, but the fields NetPlan Studio's
 * findings engine reads (M5/M6) have real shapes. All are optional at the host
 * level — a collector that could not gather a class omits it, which the
 * findings engine treats as un-collected coverage, never as a clean result.
 */
export const processEntrySchema = z.object({
  name: nonEmpty,
  path: z.string().optional(),
  pid: z.number().int().optional(),
  parentPid: z.number().int().optional(),
  commandLine: z.string().optional(),
  user: z.string().optional(),
});

export const startupEntrySchema = z.object({
  name: nonEmpty,
  command: z.string().optional(),
  path: z.string().optional(),
});

export const scheduledTaskEntrySchema = z.object({
  name: nonEmpty,
  command: z.string().optional(),
  path: z.string().optional(),
  schedule: z.string().optional(),
});

export const serviceEntrySchema = z.object({
  name: nonEmpty,
  displayName: z.string().optional(),
  binaryPath: z.string().optional(),
  startMode: z.string().optional(),
});

export const persistenceEntrySchema = z.object({
  /** e.g. "registryRun", "cron", "launchd", "wmi". */
  type: nonEmpty.describe('e.g. "registryRun", "cron", "launchd", "wmi"'),
  name: nonEmpty,
  command: z.string().optional(),
  path: z.string().optional(),
});

export const packageEntrySchema = z.object({
  name: nonEmpty,
  version: z.string().optional(),
  publisher: z.string().optional(),
});

export const remoteAccessEntrySchema = z.object({
  name: nonEmpty,
  version: z.string().optional(),
  publisher: z.string().optional(),
});

export const fileInventoryEntrySchema = z.object({
  path: nonEmpty,
  sha256: z.string().optional(),
  sizeBytes: z.number().int().optional(),
});

export const collectionSchema = z.strictObject({
  /** What the script attempted to collect, e.g. ["interfaces", "users"]. */
  scope: z
    .array(nonEmpty)
    .describe('What the script attempted to collect, e.g. ["interfaces", "users"]'),
  errors: z.array(
    z.strictObject({
      context: nonEmpty,
      message: nonEmpty,
    }),
  ),
});

export const deviceStateHostSchema = z.strictObject({
  // --- Phase-2 required, strict ---
  /** A stable machine identifier (machine GUID, DMI UUID, /etc/machine-id). */
  deviceId: nonEmpty.describe(
    'A stable machine identifier (machine GUID, DMI UUID, /etc/machine-id)',
  ),
  hostname: nonEmpty,
  os: z.strictObject({
    name: nonEmpty,
    version: z.string().optional(),
    kernel: z.string().optional(),
  }),
  collectedAt: timestamp,
  interfaces: z.array(interfaceEntrySchema),
  routes: z.array(routeEntrySchema),
  arp: z.array(arpEntrySchema),
  connections: z.array(connectionEntrySchema),
  listeningPorts: z.array(listeningPortEntrySchema),
  localUsers: z.array(localUserEntrySchema),
  localGroups: z.array(localGroupEntrySchema),
  administrators: z.array(nonEmpty),
  sudoers: z.array(nonEmpty),
  collection: collectionSchema,

  // --- Phase-3 optional, typed but tolerant (ADR-0018) ---
  processes: z.array(processEntrySchema).optional(),
  packages: z.array(packageEntrySchema).optional(),
  persistence: z.array(persistenceEntrySchema).optional(),
  scheduledTasks: z.array(scheduledTaskEntrySchema).optional(),
  services: z.array(serviceEntrySchema).optional(),
  startupEntries: z.array(startupEntrySchema).optional(),
  shares: z.array(z.looseObject({})).optional(),
  remoteAccess: z.array(remoteAccessEntrySchema).optional(),
  fileInventory: z.array(fileInventoryEntrySchema).optional(),
  dns: z.looseObject({}).optional(),
});

export const deviceStateReportSchema = z.strictObject({
  schemaVersion: z.literal(DEVICE_STATE_SCHEMA_VERSION),
  generatedAt: timestamp.optional(),
  hosts: z.array(deviceStateHostSchema).min(1),
});

export type DeviceStateReport = z.infer<typeof deviceStateReportSchema>;
export type DeviceStateHost = z.infer<typeof deviceStateHostSchema>;

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  schemaVersion: string;
  hostCount: number;
  issues: ValidationIssue[];
}

/** Validate a parsed JSON document against the contract. */
export function validateDeviceStateReport(document: unknown): ValidationResult {
  const result = deviceStateReportSchema.safeParse(document);
  if (result.success) {
    return {
      ok: true,
      schemaVersion: result.data.schemaVersion,
      hostCount: result.data.hosts.length,
      issues: [],
    };
  }
  return {
    ok: false,
    schemaVersion: DEVICE_STATE_SCHEMA_VERSION,
    hostCount: 0,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)',
      message: issue.message,
    })),
  };
}

/** The language-agnostic JSON-Schema artifact, generated — never hand-written. */
export function deviceStateJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(deviceStateReportSchema, { target: 'draft-2020-12' });
}
