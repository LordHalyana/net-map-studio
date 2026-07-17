import {
  deviceStateFormatFields,
  DEVICE_STATE_SCHEMA_VERSION,
  type DeviceStateReport,
  type ImportFormatField,
} from '@netplan/import-contract';

/**
 * Import format descriptors (#90 A0): the one shared source of truth for what
 * each adapter expects, consumed by the web wizard (dropdown, extension
 * guessing, the "Expected format" helper) and round-trip-tested in the server
 * package — every `example` is parsed through the real adapter in CI, so a
 * descriptor that drifts from its adapter breaks the build, not the user.
 *
 * The device-state descriptor never restates its contract: its field table is
 * generated from the Zod schema (ADR-0017/0018). The third-party formats
 * (nmap, tshark, zeek, ldif) have no owned contract — their descriptors are
 * hand-authored here, kept honest by the round-trip test.
 */
export type { ImportFormatField };

export interface ImportFormatSpec {
  /** Adapter registry key, e.g. "tshark-flows". */
  adapter: string;
  /** Wizard dropdown label. */
  label: string;
  /** Accepted file kinds, for display chips: ["JSON", "CSV"]. */
  fileKinds: string[];
  /** Filename suffixes that select this adapter in `guessImportAdapter`. */
  extensions: string[];
  /** 1–2 sentences: what this format is and what importing it produces. */
  summary: string;
  /** The shape table shown to the user. */
  fields: ImportFormatField[];
  /** Minimal valid payload — copy-paste ready, round-trip tested in CI. */
  example: string;
  /** Rejection rules, skipped rows, parse limits — the sharp edges. */
  notes: string[];
  /** Needs an operator ImportProfile — hidden from the wizard until one exists (A4). */
  requiresProfile?: boolean;
  /** A profile pattern that parses `example` — round-trip tested with it. */
  exampleProfilePattern?: string;
}

/** Parse limits every adapter shares (apps/server/src/imports/guards.ts). */
export const IMPORT_MAX_FILE_BYTES = 64 * 1024 * 1024;
const SHARED_LIMIT_NOTES = [
  'Files over 64 MB are rejected; one import may yield at most 50,000 observations.',
];

const deviceStateExample = {
  schemaVersion: DEVICE_STATE_SCHEMA_VERSION,
  generatedAt: '2026-07-15T12:00:00Z',
  hosts: [
    {
      deviceId: '4c4c4544-004d-3510-8054-b4c04f595131',
      hostname: 'app-server-01',
      os: { name: 'Windows Server 2022', version: '10.0.20348' },
      collectedAt: '2026-07-15T12:00:00Z',
      interfaces: [
        {
          name: 'Ethernet0',
          kind: 'ethernet',
          mac: '00:50:56:aa:bb:cc',
          addresses: [{ value: '10.0.10.21', kind: 'ipv4', prefixLength: 24 }],
        },
      ],
      routes: [{ destination: '0.0.0.0/0', gateway: '10.0.10.1', interface: 'Ethernet0' }],
      arp: [{ ip: '10.0.10.1', mac: '00:50:56:11:22:33' }],
      connections: [
        {
          protocol: 'tcp',
          localAddress: '10.0.10.21',
          localPort: 49712,
          remoteAddress: '10.0.10.40',
          remotePort: 1433,
          state: 'ESTABLISHED',
          process: 'app.exe',
        },
      ],
      listeningPorts: [{ protocol: 'tcp', address: '0.0.0.0', port: 443, process: 'nginx' }],
      localUsers: [{ name: 'alice' }, { name: 'CORP\\svc-app', serviceAccount: true }],
      localGroups: [{ name: 'Administrators', members: ['alice'] }],
      administrators: ['alice'],
      sudoers: [],
      collection: {
        scope: ['interfaces', 'routes', 'arp', 'connections', 'listeningPorts', 'users', 'groups'],
        errors: [],
      },
    },
  ],
} satisfies DeviceStateReport;

const NMAP_EXAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<nmaprun scanner="nmap" args="nmap -sV -oX scan.xml 10.0.10.0/24" start="1752580800" version="7.95">
  <host starttime="1752580800" endtime="1752580860">
    <status state="up" reason="arp-response"/>
    <address addr="10.0.10.21" addrtype="ipv4"/>
    <address addr="00:50:56:AA:BB:CC" addrtype="mac" vendor="VMware"/>
    <hostnames>
      <hostname name="app-server-01.corp.example" type="PTR"/>
    </hostnames>
    <ports>
      <port protocol="tcp" portid="443">
        <state state="open" reason="syn-ack"/>
        <service name="https" product="nginx" version="1.24.0"/>
      </port>
    </ports>
  </host>
</nmaprun>
`;

const TSHARK_EXAMPLE = [
  'source,destination,protocol,port,frames,firstSeen,lastSeen',
  '10.0.10.21,10.0.10.40,tcp,1433,42,2026-07-15T11:58:00Z,2026-07-15T12:04:10Z',
  '10.0.10.30,fileserver.corp.example,tcp,445,7,1752580700,1752580760',
].join('\n');

const ZEEK_FIELDS = [
  'ts',
  'uid',
  'id.orig_h',
  'id.orig_p',
  'id.resp_h',
  'id.resp_p',
  'proto',
  'service',
  'duration',
];
const ZEEK_EXAMPLE = [
  '#separator \\x09',
  '#set_separator\t,',
  '#empty_field\t(empty)',
  '#unset_field\t-',
  '#path\tconn',
  `#fields\t${ZEEK_FIELDS.join('\t')}`,
  '#types\ttime\tstring\taddr\tport\taddr\tport\tenum\tstring\tinterval',
  [
    '1752580800.000000',
    'C1a2b3',
    '10.0.10.21',
    '51515',
    '10.0.10.40',
    '1433',
    'tcp',
    '-',
    '1.5',
  ].join('\t'),
  ['1752580860.000000', 'C4d5e6', '10.0.10.30', '52820', '10.0.10.9', '53', 'udp', 'dns', '-'].join(
    '\t',
  ),
].join('\n');

const LDIF_EXAMPLE = `dn: CN=Alice Meyer,OU=Staff,DC=corp,DC=example,DC=com
objectClass: top
objectClass: person
objectClass: organizationalPerson
objectClass: user
cn: Alice Meyer
sAMAccountName: alice

dn: CN=App Operators,OU=Groups,DC=corp,DC=example,DC=com
objectClass: top
objectClass: group
cn: App Operators
sAMAccountName: app-operators
member: CN=Alice Meyer,OU=Staff,DC=corp,DC=example,DC=com
`;

const NETCAT_EXAMPLE = `Connection to 10.0.10.21 443 port [tcp/https] succeeded!
Connection to 10.0.10.21 22 port [tcp/ssh] succeeded!
nc: connect to 10.0.10.40 port 1433 (tcp) failed: Connection refused
`;

export const IMPORT_FORMAT_SPECS: Record<string, ImportFormatSpec> = {
  'device-state': {
    adapter: 'device-state',
    label: 'Device-state report (JSON)',
    fileKinds: ['JSON'],
    extensions: ['.json'],
    summary:
      'The canonical NetPlan Studio collection report (schema 1.0.0): one JSON document with a hosts[] array, each host carrying interfaces, routes, ARP, connections, listening ports and local principals. Produces high-confidence device, service, flow and identity claims.',
    fields: deviceStateFormatFields(),
    example: `${JSON.stringify(deviceStateExample, null, 2)}\n`,
    notes: [
      'The schema is strict for the required fields above: unknown keys are rejected, so remove fields rather than renaming them.',
      'Optional Phase-3 sections (processes, packages, services, persistence, …) are accepted and stored; omitting one marks that class un-collected, never "clean".',
      'Validate before uploading with the standalone CLI: npx netplan-validate <report.json> — or download the JSON Schema from this panel.',
      ...SHARED_LIMIT_NOTES,
    ],
  },
  'nmap-xml': {
    adapter: 'nmap-xml',
    label: 'Nmap scan (XML)',
    fileKinds: ['XML'],
    extensions: ['.xml'],
    summary:
      'Nmap XML output (nmap -oX). Hosts that are up become device claims with their addresses and hostnames; open ports become service claims; OS matches become weaker fingerprint claims.',
    fields: [
      {
        name: 'nmaprun',
        type: 'element',
        required: true,
        description: 'The document root — anything else is rejected as not Nmap XML',
      },
      {
        name: 'nmaprun.host[]',
        type: 'element',
        required: true,
        description: 'One element per scanned host',
      },
      {
        name: 'host.status@state',
        type: "'up' | 'down' | …",
        required: false,
        description: 'Hosts not marked up are skipped',
      },
      {
        name: 'host.address@addr / @addrtype',
        type: "'ipv4' | 'ipv6' | 'mac'",
        required: true,
        description: 'A host needs at least one address or hostname to count',
      },
      {
        name: 'host.hostnames.hostname@name',
        type: 'string',
        required: false,
        description: 'The first hostname becomes the device name',
      },
      {
        name: 'host.ports.port@protocol / @portid',
        type: "'tcp' | 'udp' | 'sctp' | 'ip', int",
        required: false,
        description: 'Only ports whose <state state="open"> are imported',
      },
      {
        name: 'port.service@name / @product / @version',
        type: 'string',
        required: false,
        description: 'Service identification, imported as banner-level confidence',
      },
      {
        name: 'host.os.osmatch@name',
        type: 'string',
        required: false,
        description: 'The best OS match becomes a low-confidence OS claim',
      },
    ],
    example: NMAP_EXAMPLE,
    notes: [
      'Any XML without an <nmaprun> root is rejected outright ("Not a recognizable Nmap XML document").',
      'Hosts with status other than "up" and ports not in state "open" are skipped silently.',
      'XML entity expansion is disabled — external or malicious entities are inert.',
      ...SHARED_LIMIT_NOTES,
    ],
  },
  'tshark-flows': {
    adapter: 'tshark-flows',
    label: 'tshark flow summary (JSON/CSV)',
    fileKinds: ['JSON', 'CSV'],
    extensions: ['.csv'],
    summary:
      'Conversation summaries exported from tshark/Wireshark, as a JSON array or a CSV with a header row. Rows are aggregated per (source, destination, protocol, port) into flow claims.',
    fields: [
      {
        name: 'source',
        type: 'string',
        required: true,
        description: 'Sending endpoint — IP address or hostname',
      },
      {
        name: 'destination',
        type: 'string',
        required: true,
        description: 'Receiving endpoint — IP address or hostname',
      },
      {
        name: 'protocol',
        type: "'tcp' | 'udp' | 'icmp' | other",
        required: false,
        description: 'Defaults to tcp; unknown values become "other"',
      },
      {
        name: 'port',
        type: 'int 0–65535',
        required: false,
        description: 'Destination port; omit for port-less conversations',
      },
      {
        name: 'frames',
        type: 'int ≥ 1',
        required: false,
        description: 'Frame count for the row; defaults to 1, summed on aggregation',
      },
      {
        name: 'firstSeen / lastSeen',
        type: 'ISO 8601 or epoch seconds',
        required: false,
        description: 'Conversation time bounds; epoch style matches -e frame.time_epoch',
      },
    ],
    example: TSHARK_EXAMPLE,
    notes: [
      'CSV needs a header row containing at least the source and destination columns — the import fails naming any that are missing.',
      'JSON input is either an array of row objects or a single row object, same keys as the CSV columns.',
      'Rows are pre-aggregated per (source, destination, protocol, port), so a 100k-conversation capture arrives as a few thousand flows.',
      ...SHARED_LIMIT_NOTES,
    ],
  },
  ldif: {
    adapter: 'ldif',
    label: 'Directory export (LDIF)',
    fileKinds: ['LDIF'],
    extensions: ['.ldif'],
    summary:
      'An RFC 2849 LDIF directory export (ldifde, ldapsearch -LLL). User, group and managed-service-account entries become domain-scoped identity claims; the domain comes from the first dc= component of each dn.',
    fields: [
      {
        name: 'dn',
        type: 'string',
        required: true,
        description: 'Entry distinguished name; its first dc= component names the domain',
      },
      {
        name: 'objectClass',
        type: 'string (repeated)',
        required: true,
        description:
          'Determines the identity kind: user/person → user, group → group, msDS-*ServiceAccount → service account',
      },
      {
        name: 'sAMAccountName / uid / cn',
        type: 'string',
        required: true,
        description: 'The first attribute present (in this order) becomes the identity name',
      },
    ],
    example: LDIF_EXAMPLE,
    notes: [
      'computer entries are Devices, not Identities — they are skipped, as is any entry without a usable name attribute.',
      'Base64 attributes (name:: value) are decoded; RFC 2849 continuation lines (leading space) are unfolded.',
      'Membership attributes (member, memberOf) are not imported — only the principals themselves.',
      ...SHARED_LIMIT_NOTES,
    ],
  },
  'zeek-conn': {
    adapter: 'zeek-conn',
    label: 'Zeek conn.log (TSV/JSON)',
    fileKinds: ['TSV', 'JSON lines'],
    extensions: ['conn.log', '.zeek'],
    summary:
      'A Zeek conn.log — classic tab-separated format with its #fields header, or JSON-lines (LogAscii::use_json=T). Each connection row aggregates per (source, destination, protocol, port) into flow claims.',
    fields: [
      {
        name: 'id.orig_h',
        type: 'string',
        required: true,
        description: 'Originating host — IP address or hostname',
      },
      {
        name: 'id.resp_h',
        type: 'string',
        required: true,
        description: 'Responding host — IP address or hostname',
      },
      {
        name: 'id.resp_p',
        type: 'int 0–65535',
        required: false,
        description: 'Responder port',
      },
      {
        name: 'proto',
        type: "'tcp' | 'udp' | 'icmp' | other",
        required: false,
        description: 'Unknown values become "other"',
      },
      {
        name: 'ts',
        type: 'epoch seconds',
        required: false,
        description: 'Connection start; becomes firstSeen',
      },
      {
        name: 'duration',
        type: 'seconds (float)',
        required: false,
        description: 'Added to ts to compute lastSeen',
      },
    ],
    example: ZEEK_EXAMPLE,
    notes: [
      'TSV input must carry the #fields header line before any data row — a conn.log stripped of its # headers is rejected.',
      'JSON-lines input is detected by a first non-blank line starting with { — one JSON object per line.',
      'Unset markers ("-", "(empty)") are treated as absent; rows without both id.orig_h and id.resp_h are skipped.',
      ...SHARED_LIMIT_NOTES,
    ],
  },
  'netcat-text': {
    adapter: 'netcat-text',
    label: 'Netcat text log (profile-driven)',
    fileKinds: ['text'],
    extensions: ['.txt'],
    requiresProfile: true,
    exampleProfilePattern:
      '^Connection to (?<host>\\S+) (?<port>\\d+) port \\[tcp/(?<banner>[^\\]]*)\\] (?<status>succeeded|refused|timed out)',
    summary:
      'Free-form scan or banner text parsed line-by-line with an operator-defined Import profile: a regex whose named capture groups map the fields. Matched open ports become low-confidence service claims.',
    fields: [
      {
        name: '(?<host>…)',
        type: 'capture group',
        required: true,
        description: 'The target IP address — a line without it is skipped',
      },
      {
        name: '(?<port>…)',
        type: 'capture group, int 0–65535',
        required: true,
        description: 'The TCP port — a match without a valid port emits nothing',
      },
      {
        name: '(?<status>…)',
        type: 'capture group',
        required: false,
        description:
          'Only lines matching open/succeeded/connected count; omit the group to count every match',
      },
      {
        name: '(?<banner>…)',
        type: 'capture group',
        required: false,
        description: 'Captured banner text lifts the claim to banner-level confidence',
      },
    ],
    example: NETCAT_EXAMPLE,
    notes: [
      'Requires an Import profile (the per-line regex) — the adapter appears in the wizard once a profile exists.',
      'Lines longer than 4096 characters and lines the pattern does not match are skipped.',
      'Emits service claims only; it never fabricates devices — claims corroborate devices seen by other evidence.',
      ...SHARED_LIMIT_NOTES,
    ],
  },
};

/** The formats the import wizard offers — profile-driven adapters stay out until a profile exists (A4). */
export function wizardImportFormats(): ImportFormatSpec[] {
  return Object.values(IMPORT_FORMAT_SPECS).filter((spec) => !spec.requiresProfile);
}

/**
 * Guess the adapter from a filename, using each descriptor's extensions.
 * Falls back to device-state — its strict contract diagnoses a wrong guess
 * instantly, so it is the safest default.
 */
export function guessImportAdapter(filename: string): string {
  const lower = filename.toLowerCase();
  for (const spec of wizardImportFormats()) {
    if (spec.extensions.some((suffix) => lower.endsWith(suffix))) return spec.adapter;
  }
  return 'device-state';
}

/** Headers live at the top of a file — pre-flight never scans all 64 MB. */
const PREFLIGHT_SCAN_CHARS = 65_536;

function firstNonBlankLine(content: string): string {
  return (
    content
      .slice(0, PREFLIGHT_SCAN_CHARS)
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0) ?? ''
  );
}

/**
 * Advisory pre-upload checks (#90 A3): the same trivially-checkable gates the
 * server enforces, run in the browser so the common failure modes are caught
 * instantly instead of surfacing as a failed job. These are string checks
 * only — no parsing logic is duplicated, and the server stays the authority
 * (device-state gets FULL client-side validation separately, A2).
 * Returns a human-readable blocker, or null to proceed.
 */
export function preflightImport(
  spec: ImportFormatSpec,
  filename: string,
  content: string,
): string | null {
  if (content.length > IMPORT_MAX_FILE_BYTES) {
    return `${filename} exceeds the 64 MB import limit — split the evidence and upload the parts.`;
  }
  switch (spec.adapter) {
    case 'nmap-xml':
      return content.includes('<nmaprun')
        ? null
        : 'Not an Nmap XML document (no <nmaprun> root) — export the scan with nmap -oX.';
    case 'tshark-flows': {
      const trimmed = content.trimStart();
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) return null; // JSON — server parses it
      const header = firstNonBlankLine(content)
        .split(',')
        .map((column) => column.trim());
      const missing = ['source', 'destination'].filter((column) => !header.includes(column));
      if (missing.length === 0) return null;
      return `CSV header is missing the ${missing.join(' and ')} column${
        missing.length === 1 ? '' : 's'
      } — see the expected format panel for the shape.`;
    }
    case 'zeek-conn': {
      const firstLine = firstNonBlankLine(content).trimStart();
      if (firstLine.startsWith('{')) return null; // JSON-lines
      if (!firstLine.startsWith('#')) {
        return 'Not a Zeek conn.log: expected # header lines (TSV) or JSON-lines starting with { — see the expected format panel.';
      }
      const hasFields = content
        .slice(0, PREFLIGHT_SCAN_CHARS)
        .split(/\r?\n/)
        .some((line) => line.startsWith('#fields'));
      return hasFields
        ? null
        : 'Zeek TSV conn.log is missing its #fields header — the adapter cannot map columns without it.';
    }
    default:
      return null;
  }
}
