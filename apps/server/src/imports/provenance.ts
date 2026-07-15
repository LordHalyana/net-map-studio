import { and, asc, eq } from 'drizzle-orm';
import {
  changeSetIdSchema,
  fieldProvenanceIdSchema,
  fieldProvenanceSchema,
  fieldValueSchema,
  newId,
  operationIdSchema,
  projectIdSchema,
  settableEntityTypeSchema,
  type FieldProvenance,
  type SettableEntityType,
} from '@netplan/domain';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { fieldProvenance } from '../db/schema.js';
import type { ApplyResult, Engine } from '../engine/store.js';

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

/** Wire input of POST /projects/:id/provenance/override (M8). */
export const overrideFieldBodySchema = z.object({
  entityType: settableEntityTypeSchema,
  entityId: z.uuidv7(),
  field: z.string().min(1),
  value: fieldValueSchema,
});
export type OverrideFieldBody = z.infer<typeof overrideFieldBodySchema>;

export function createProvenanceStore(db: Db, engine: Engine) {
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

  /**
   * Manual override (M8, acceptance #6): one SetField Operation — undoable
   * like any other — plus a manual provenance row in the same transaction.
   * The previously accepted imported rows flip to `overridden`.
   */
  function overrideField(projectId: string, body: OverrideFieldBody): ApplyResult {
    const now = new Date().toISOString();
    return engine.applyChangeSetWith(
      {
        id: newId(changeSetIdSchema),
        projectId: projectIdSchema.parse(projectId),
        label: `Override ${body.entityType}.${body.field}`,
        operations: [
          {
            id: newId(operationIdSchema),
            projectId: projectIdSchema.parse(projectId),
            kind: 'SetField',
            entityType: body.entityType,
            entityId: body.entityId,
            field: body.field,
            value: body.value,
            previousValue: null,
          },
        ],
      },
      (tx) => {
        tx.update(fieldProvenance)
          .set({ status: 'overridden' })
          .where(
            and(
              eq(fieldProvenance.projectId, projectId),
              eq(fieldProvenance.entityType, body.entityType),
              eq(fieldProvenance.entityId, body.entityId),
              eq(fieldProvenance.field, body.field),
              eq(fieldProvenance.status, 'accepted'),
            ),
          )
          .run();
        tx.insert(fieldProvenance)
          .values(
            fieldProvenanceSchema.parse({
              id: newId(fieldProvenanceIdSchema),
              projectId,
              entityType: body.entityType,
              entityId: body.entityId,
              field: body.field,
              sourceType: 'manual',
              evidenceId: null,
              importJobId: null,
              observationId: null,
              confidence: 1,
              parserVersion: 'manual',
              status: 'accepted',
              observedValue: body.value,
              observedAt: now,
            }),
          )
          .run();
      },
    );
  }

  return { listForEntity, listForProject, winningRow, overrideField };
}

export type ProvenanceStore = ReturnType<typeof createProvenanceStore>;
