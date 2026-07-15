import { and, asc, eq } from 'drizzle-orm';
import {
  fieldProvenanceSchema,
  type FieldProvenance,
  type SettableEntityType,
} from '@netplan/domain';
import type { Db } from '../db/index.js';
import { fieldProvenance } from '../db/schema.js';

/**
 * The attribute-provenance sidecar (ADR-0008). Rows are only ever written
 * inside the same transaction that writes the entity value through the
 * Operation log (M3 commit, M8 override) — this module has no standalone
 * write path by design.
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function insertProvenanceRows(tx: Tx, rows: readonly FieldProvenance[]): void {
  for (const row of rows) {
    tx.insert(fieldProvenance).values(fieldProvenanceSchema.parse(row)).run();
  }
}

export function createProvenanceStore(db: Db) {
  function listForEntity(
    projectId: string,
    entityType: SettableEntityType,
    entityId: string,
  ): FieldProvenance[] {
    return db
      .select()
      .from(fieldProvenance)
      .where(
        and(
          eq(fieldProvenance.projectId, projectId),
          eq(fieldProvenance.entityType, entityType),
          eq(fieldProvenance.entityId, entityId),
        ),
      )
      .orderBy(asc(fieldProvenance.id))
      .all()
      .map((row) => fieldProvenanceSchema.parse(row));
  }

  function listForProject(projectId: string): FieldProvenance[] {
    return db
      .select()
      .from(fieldProvenance)
      .where(eq(fieldProvenance.projectId, projectId))
      .orderBy(asc(fieldProvenance.id))
      .all()
      .map((row) => fieldProvenanceSchema.parse(row));
  }

  /** The winning row for one field: the accepted/overridden row, if any. */
  function winningRow(
    projectId: string,
    entityType: SettableEntityType,
    entityId: string,
    field: string,
  ): FieldProvenance | null {
    const rows = listForEntity(projectId, entityType, entityId).filter(
      (r) => r.field === field && r.status !== 'rejected',
    );
    return rows[rows.length - 1] ?? null;
  }

  return { listForEntity, listForProject, winningRow };
}

export type ProvenanceStore = ReturnType<typeof createProvenanceStore>;
