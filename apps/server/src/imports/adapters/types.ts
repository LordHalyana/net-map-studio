import type { ObservationDraft } from '@netplan/domain';
import type { ParseBudget, ParseLimits } from '../guards.js';

/**
 * An Adapter maps one evidence format into canonical Observations
 * (ADR-0020). Adapters never create entities and never see entity ids; the
 * import framework stamps the envelope (project, job, evidence) onto the
 * drafts they return.
 *
 * `parse` may be async and must call `ctx.budget.check()` between units of
 * work so the worker's execution budget is enforceable.
 */
export interface AdapterContext {
  budget: ParseBudget;
  limits: ParseLimits;
  /**
   * The serialized ImportProfile for profile-driven adapters (§3.6, M12 #69)
   * — line-format templates the netcat-text adapter applies. Undefined for
   * adapters that own their format.
   */
  profile?: unknown;
}

export interface Adapter {
  name: string;
  version: string;
  /** Version of the input format this adapter understands, recorded on the ImportJob. */
  schemaVersion: string;
  parse(content: string, ctx: AdapterContext): Promise<ObservationDraft[]> | ObservationDraft[];
}
