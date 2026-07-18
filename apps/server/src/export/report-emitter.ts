import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FastifyReply } from 'fastify';
import {
  maskSecrets,
  newId,
  operationIdSchema,
  projectIdSchema,
  reportIdSchema,
  reportRecordSchema,
  type ReportType,
} from '@netplan/domain';
import type { Engine } from '../engine/store.js';

/**
 * Report emission (#81): the one interface every generated deliverable leaves
 * the server through. The M13 invariant — secrets-masked, SHA-256 hashed, and
 * audited as a §3.4 Report record through the Operation log (ADR-0010) — holds
 * here by construction: callers supply the deliverable type and a builder;
 * masking, the mask-before-hash ordering, the audit Operation and the response
 * headers are owned by this module. A new export route written against it
 * cannot forget the mask step.
 */

interface DeliverableBase {
  type: ReportType;
  /** Recorded verbatim on the Report record; '' when no profile applies. */
  redactionProfile: string;
  parameters?: Record<string, string>;
  contentType: string;
  /** When set, the response is a download with this filename. */
  filename?: string;
}

export interface Deliverable extends DeliverableBase {
  /** Produces the raw output; the emitter masks it before anything else sees it. */
  build: () => string;
}

export interface StreamedDeliverable extends DeliverableBase {
  /**
   * Pre-serialized chunks, hashed as they stream and audited on completion.
   * NOT masked: the only streamed deliverable is the full-fidelity .netplan
   * bundle (ADR-0016), whose evidence blobs are SHA-verified on re-import —
   * masking would corrupt the round trip. Secrets in the committed state are
   * already stored masked (M13); string-built deliverables use `emit`.
   */
  chunks: Iterable<string | Buffer>;
}

/**
 * RFC 6266 content-disposition value (#110 C4): control characters, quotes
 * and backslashes never reach the header — the emitter is the choke-point a
 * future export carrying an operator-derived name "cannot forget". Non-ASCII
 * names keep a plain-ASCII fallback plus the RFC 5987 `filename*` form.
 */
export function contentDispositionValue(filename: string): string {
  const cleaned = [...filename]
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f && ch !== '"' && ch !== '\\';
    })
    .join('')
    .trim();
  const name = cleaned === '' ? 'download' : cleaned;
  const isAscii = [...name].every((ch) => ch.charCodeAt(0) <= 0x7e);
  if (isAscii) return `attachment; filename="${name}"`;
  const fallback = [...name].map((ch) => (ch.charCodeAt(0) <= 0x7e ? ch : '_')).join('');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export interface ReportEmitter {
  /** Build → mask → hash → record → respond, in that order, always. */
  emit(reply: FastifyReply, projectId: string, deliverable: Deliverable): FastifyReply;
  emitStream(
    reply: FastifyReply,
    projectId: string,
    deliverable: StreamedDeliverable,
  ): FastifyReply;
}

export function createReportEmitter(engine: Pick<Engine, 'applyOperation'>): ReportEmitter {
  function recordReport(projectId: string, deliverable: DeliverableBase, outputSha256: string) {
    engine.applyOperation({
      id: newId(operationIdSchema),
      projectId: projectIdSchema.parse(projectId),
      kind: 'CreateEntity',
      payload: {
        entityType: 'report',
        entity: reportRecordSchema.parse({
          id: newId(reportIdSchema),
          projectId,
          type: deliverable.type,
          createdAt: new Date().toISOString(),
          redactionProfile: deliverable.redactionProfile,
          parameters: deliverable.parameters ?? {},
          outputSha256,
        }),
      },
    });
  }

  function setHeaders(reply: FastifyReply, deliverable: DeliverableBase): FastifyReply {
    reply.header('content-type', deliverable.contentType);
    if (deliverable.filename) {
      reply.header('content-disposition', contentDispositionValue(deliverable.filename));
    }
    return reply;
  }

  return {
    emit(reply, projectId, deliverable) {
      const output = maskSecrets(deliverable.build());
      recordReport(projectId, deliverable, createHash('sha256').update(output).digest('hex'));
      return setHeaders(reply, deliverable).send(output);
    },

    emitStream(reply, projectId, deliverable) {
      const hash = createHash('sha256');
      const hashed = (function* () {
        for (const chunk of deliverable.chunks) {
          hash.update(chunk);
          yield chunk;
        }
        recordReport(projectId, deliverable, hash.digest('hex'));
      })();
      return setHeaders(reply, deliverable).send(Readable.from(hashed));
    },
  };
}
