import type { IdentityKind, ObservationDraft } from '@netplan/domain';
import type { Adapter, AdapterContext } from './types.js';

/**
 * P4-M3 — the directory-export flagship adapter (ADR-0026): parses an LDIF
 * export (`ldifde`, `ldapsearch -LLL`, …) into host-less, domain-scoped
 * identity Observations. The export file is native-format read-only Evidence —
 * no owned contract (contrast ADR-0018) — and the operator produces it with
 * their own tools: no live directory binding, no egress.
 *
 * Entra CSV / `Get-ADUser` JSON are additive later behind this same shape;
 * do not build them (plan §4).
 */

interface LdifEntry {
  dn: string;
  /** Attribute name (lower-cased) → values, in file order. */
  attributes: Map<string, string[]>;
}

/** Unfold continuation lines (RFC 2849: a leading single space continues the previous line). */
function unfold(content: string): string[] {
  const out: string[] = [];
  for (const raw of content.split(/\r?\n/)) {
    if (raw.startsWith(' ') && out.length > 0) {
      out[out.length - 1] += raw.slice(1);
    } else {
      out.push(raw);
    }
  }
  return out;
}

function parseEntries(content: string, ctx: AdapterContext): LdifEntry[] {
  const entries: LdifEntry[] = [];
  let current: LdifEntry | null = null;

  for (const line of unfold(content)) {
    ctx.budget.check();
    if (line.trim() === '') {
      if (current) entries.push(current);
      current = null;
      continue;
    }
    if (line.startsWith('#') || line.startsWith('version:')) continue;

    const base64 = line.indexOf(':: ');
    const plain = line.indexOf(': ');
    let name: string;
    let value: string;
    if (base64 !== -1 && (plain === -1 || base64 < plain)) {
      name = line.slice(0, base64).toLowerCase();
      value = Buffer.from(line.slice(base64 + 3), 'base64').toString('utf8');
    } else if (plain !== -1) {
      name = line.slice(0, plain).toLowerCase();
      value = line.slice(plain + 2);
    } else {
      // an attribute with an empty value ("attr:") — ignore
      continue;
    }

    if (name === 'dn') {
      if (current) entries.push(current);
      current = { dn: value, attributes: new Map() };
      continue;
    }
    if (!current) throw new Error(`LDIF attribute "${name}" before any dn`);
    const values = current.attributes.get(name) ?? [];
    values.push(value);
    current.attributes.set(name, values);
  }
  if (current) entries.push(current);
  return entries;
}

/**
 * The principal's domain, from the DN's first `dc=` component — the NetBIOS
 * convention (`dc=corp,dc=example,dc=com` → `corp`), so directory principals
 * key identically to `CORP\alice` seen in device-state evidence and correlate
 * across sources (ADR-0022).
 */
function domainFromDn(dn: string): string {
  for (const rdn of dn.split(',')) {
    const [attr, value] = rdn.trim().split('=', 2);
    if (attr?.toLowerCase() === 'dc' && value) return value;
  }
  return '';
}

const USER_CLASSES = new Set([
  'user',
  'person',
  'organizationalperson',
  'inetorgperson',
  'posixaccount',
]);
const GROUP_CLASSES = new Set(['group', 'groupofnames', 'groupofuniquenames', 'posixgroup']);
const SERVICE_ACCOUNT_CLASSES = new Set([
  'msds-managedserviceaccount',
  'msds-groupmanagedserviceaccount',
]);

function kindOf(objectClasses: readonly string[]): IdentityKind | null {
  const classes = objectClasses.map((c) => c.toLowerCase());
  // computer accounts are Devices, not modelled Identities — never fabricate one
  if (classes.includes('computer')) return null;
  if (classes.some((c) => SERVICE_ACCOUNT_CLASSES.has(c))) return 'serviceAccount';
  if (classes.some((c) => GROUP_CLASSES.has(c))) return 'group';
  if (classes.some((c) => USER_CLASSES.has(c))) return 'user';
  return null;
}

function firstValue(entry: LdifEntry, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = entry.attributes.get(name)?.[0];
    if (value) return value;
  }
  return undefined;
}

export const ldifAdapter: Adapter = {
  name: 'ldif',
  version: '1.0.0',
  schemaVersion: '1',
  parse(content: string, ctx: AdapterContext): ObservationDraft[] {
    const drafts: ObservationDraft[] = [];
    for (const entry of parseEntries(content, ctx)) {
      ctx.budget.check();
      const kind = kindOf(entry.attributes.get('objectclass') ?? []);
      if (kind === null) continue;
      const name = firstValue(entry, 'samaccountname', 'uid', 'cn');
      if (!name) continue;
      drafts.push({
        contributor: 'directoryExport',
        observedAt: null,
        claim: {
          targetKind: 'identity',
          device: null,
          identity: { scope: 'domain', name, domain: domainFromDn(entry.dn) },
          fields: { kind },
        },
      });
    }
    return drafts;
  },
};
