import { z } from 'zod';
import {
  addressSchema,
  deviceSchema,
  interfaceSchema,
  linkSchema,
  networkSchema,
  policyRuleSchema,
  serviceSchema,
  siteSchema,
  zoneSchema,
} from './entities.js';
import { projectStateSchema, type ProjectState } from './state.js';

/**
 * The portable `.netplan` project file (ADR-0016): a versioned JSON bundle
 * carrying every entity with its UUIDv7, fully decoupled from the storage
 * engine. The evidence subtree and hash manifest are Phase-2 seams — the
 * envelope is designed for them now, they stay empty in Phase 1.
 */
export const NETPLAN_BUNDLE_VERSION = 1;

export const netplanBundleSchema = z.object({
  format: z.literal('netplan'),
  version: z.number().int().min(1),
  exportedAt: z.iso.datetime(),
  project: projectStateSchema,
  /** Phase-2 seam: evidence blobs (ADR-0016). */
  evidence: z.array(z.unknown()).default([]),
  /** Phase-2 seam: hash manifest for evidence files. */
  manifest: z
    .object({ files: z.array(z.object({ path: z.string(), sha256: z.string() })) })
    .default({
      files: [],
    }),
});
export type NetplanBundle = z.infer<typeof netplanBundleSchema>;

export function makeBundle(state: ProjectState, exportedAt: string): NetplanBundle {
  return netplanBundleSchema.parse({
    format: 'netplan',
    version: NETPLAN_BUNDLE_VERSION,
    exportedAt,
    project: state,
  });
}

/** A serialize-time field filter (design §3.12): `entityType.field` entries. */
export const redactionProfileSchema = z.object({
  name: z.string(),
  fields: z.array(z.string()),
});
export type RedactionProfile = z.infer<typeof redactionProfileSchema>;

interface RedactTarget {
  key: Exclude<keyof ProjectState, 'project'>;
  schema: {
    parse(value: unknown): Record<string, unknown>;
    safeParse(value: unknown): { success: boolean };
  };
}

const redactableCollections: Record<string, RedactTarget> = {
  site: { key: 'sites', schema: siteSchema },
  zone: { key: 'zones', schema: zoneSchema },
  device: { key: 'devices', schema: deviceSchema },
  interface: { key: 'interfaces', schema: interfaceSchema },
  address: { key: 'addresses', schema: addressSchema },
  network: { key: 'networks', schema: networkSchema },
  link: { key: 'links', schema: linkSchema },
  service: { key: 'services', schema: serviceSchema },
  policyRule: { key: 'policyRules', schema: policyRuleSchema },
};

/**
 * Blank the configured string fields without touching identifiers or
 * relationships. Fields whose schema forbids an empty string are replaced
 * with "[redacted]" so the result stays valid.
 */
export function applyRedaction(state: ProjectState, profile: RedactionProfile): ProjectState {
  const byEntity = new Map<string, string[]>();
  for (const entry of profile.fields) {
    const [entityType, field] = entry.split('.');
    if (!entityType || !field) continue;
    const fields = byEntity.get(entityType) ?? [];
    fields.push(field);
    byEntity.set(entityType, fields);
  }

  const next = projectStateSchema.parse(JSON.parse(JSON.stringify(state)));

  for (const [entityType, fields] of byEntity) {
    const target = redactableCollections[entityType];
    if (!target) continue;
    const { key, schema } = target;
    const collection = next[key].map((entity) => {
      let candidate: Record<string, unknown> = { ...entity };
      for (const field of fields) {
        if (!(field in candidate) || typeof candidate[field] !== 'string') continue;
        const blanked = { ...candidate, [field]: '' };
        candidate = schema.safeParse(blanked).success
          ? blanked
          : { ...candidate, [field]: '[redacted]' };
      }
      return schema.parse(candidate);
    });
    // each branch is monomorphic at runtime; parse guarantees shape
    Object.assign(next, { [key]: collection });
  }

  return projectStateSchema.parse(next);
}
