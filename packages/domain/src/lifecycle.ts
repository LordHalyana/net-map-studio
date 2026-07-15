import { z } from 'zod';

/**
 * The stance of an object toward reality (ADR-0009). Every modellable object
 * carries one; Phase-1 objects default to `planned`.
 */
export const lifecycleStateSchema = z
  .enum(['observed', 'inferred', 'manuallyVerified', 'planned', 'deprecated', 'removedInProposal'])
  .default('planned');

export type LifecycleState = z.infer<typeof lifecycleStateSchema>;
