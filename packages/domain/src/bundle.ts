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
import { evidenceSchema, importJobSchema } from './imports.js';

/**
 * The portable `.netplan` project file (ADR-0016): a versioned JSON bundle
 * carrying every entity with its UUIDv7, fully decoupled from the storage
 * engine. Version 2 brings the evidence subtree + hash manifest online
 * (ADR-0019); version-1 bundles still parse — the subtree defaults empty.
 */
export const NETPLAN_BUNDLE_VERSION = 2;

/**
 * One evidence file in the bundle's evidence subtree. `content` is null when
 * the blob was dropped by retention policy (`retention: 'hashOnly'`) — the
 * record and its manifest hash always travel (ADR-0019).
 */
export const bundleEvidenceFileSchema = z.object({
  record: evidenceSchema,
  encoding: z.enum(['utf8', 'base64']),
  content: z.string().nullable(),
});
export type BundleEvidenceFile = z.infer<typeof bundleEvidenceFileSchema>;

export const bundleManifestSchema = z.object({
  files: z.array(z.object({ path: z.string(), sha256: z.string() })),
});
export type BundleManifest = z.infer<typeof bundleManifestSchema>;

/** Manifest path of an evidence file inside the bundle. */
export function evidenceManifestPath(evidence: { id: string; filename: string }): string {
  return `evidence/${evidence.id}/${evidence.filename}`;
}

export const netplanBundleSchema = z.object({
  format: z.literal('netplan'),
  version: z.number().int().min(1).max(NETPLAN_BUNDLE_VERSION),
  exportedAt: z.iso.datetime(),
  project: projectStateSchema,
  /** The evidence subtree (ADR-0016, ADR-0019). */
  evidence: z.array(bundleEvidenceFileSchema).default([]),
  /** ImportJobs referenced by the evidence records. */
  importJobs: z.array(importJobSchema).default([]),
  /** Hash manifest for evidence files — retained even when a blob is not. */
  manifest: bundleManifestSchema.default({ files: [] }),
});
export type NetplanBundle = z.infer<typeof netplanBundleSchema>;

export interface BundleAttachments {
  evidence?: BundleEvidenceFile[];
  importJobs?: z.infer<typeof importJobSchema>[];
}

export function makeBundle(
  state: ProjectState,
  exportedAt: string,
  attachments: BundleAttachments = {},
): NetplanBundle {
  const evidence = attachments.evidence ?? [];
  return netplanBundleSchema.parse({
    format: 'netplan',
    version: NETPLAN_BUNDLE_VERSION,
    exportedAt,
    project: state,
    evidence,
    importJobs: attachments.importJobs ?? [],
    manifest: {
      files: evidence.map((file) => ({
        path: evidenceManifestPath(file.record),
        sha256: file.record.sha256,
      })),
    },
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
