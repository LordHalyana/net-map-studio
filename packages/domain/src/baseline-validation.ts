import type { Baseline, BaselineScope } from './entities.js';
import type { ProjectState } from './state.js';

/**
 * Baseline reference validation (ADR-0025, §3.11). A Baseline references a
 * Zone, Network or Device by id; when that object is deleted the Baseline is
 * retained but its reference dangles. This surfaces the orphan the same way
 * `validatePolicyRules` surfaces an orphaned PolicyRule — an advisory warning,
 * not a hard delete-time block.
 */
export interface BaselineWarning {
  baselineId: Baseline['id'];
  category: 'orphaned';
  message: string;
}

function scopeExists(state: ProjectState, scope: BaselineScope): boolean {
  switch (scope.kind) {
    case 'zone':
      return state.zones.some((z) => z.id === scope.id);
    case 'network':
      return state.networks.some((n) => n.id === scope.id);
    case 'device':
      return state.devices.some((d) => d.id === scope.id);
  }
}

export function validateBaselines(state: ProjectState): BaselineWarning[] {
  const warnings: BaselineWarning[] = [];
  for (const baseline of state.baselines) {
    if (!scopeExists(state, baseline.scope)) {
      warnings.push({
        baselineId: baseline.id,
        category: 'orphaned',
        message: `Baseline "${baseline.name}" references a deleted ${baseline.scope.kind}`,
      });
    }
  }
  return warnings;
}
