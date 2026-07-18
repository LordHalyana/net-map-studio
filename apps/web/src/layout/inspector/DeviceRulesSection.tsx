import type { Device, PolicyRule, ProjectState } from '@netplan/domain';
import { resolverFor } from '../../canvas/derived';
import { opSetField } from '../../state/ops';
import { useAppStore } from '../../state/store';
import { Toggle } from '../../ui';
import { FieldSection } from '../fields';

/**
 * PolicyRules touching this Device (M6, gap G8): endpoints referencing the
 * device, one of its interfaces, or a network it is a member of. The switch
 * toggles logging — the concept's per-rule toggle, no schema change.
 */
export function DeviceRulesSection({ device, graph }: { device: Device; graph: ProjectState }) {
  const dispatch = useAppStore((s) => s.dispatch);
  const projectId = graph.project.id;
  const endpoints = resolverFor(graph);
  const touches = (endpoint: PolicyRule['source']) =>
    endpoints.touchesDevice(endpoint, device.id, 'membership');
  const rules = graph.policyRules.filter((r) => touches(r.source) || touches(r.destination));
  if (rules.length === 0) return null;

  const serviceById = new Map(graph.services.map((s) => [s.id, s]));
  return (
    <FieldSection title={`Rules (${rules.length})`} testId="inspector-device-rules">
      {rules.map((rule) => {
        const service = rule.serviceId ? serviceById.get(rule.serviceId) : undefined;
        return (
          <div key={rule.id} className="inspector-rule">
            <span className={`inspector-rule__action inspector-rule__action--${rule.action}`}>
              {rule.action}
            </span>
            <span className="inspector-rule__service">
              {service
                ? `${service.name}${service.portStart != null ? ` (${service.portStart}${service.portEnd != null && service.portEnd !== service.portStart ? `-${service.portEnd}` : ''})` : ''}`
                : 'All Other'}
            </span>
            <Toggle
              checked={rule.logging}
              label="Logging"
              onChange={() =>
                dispatch(
                  opSetField(
                    projectId,
                    'policyRule',
                    rule.id,
                    'logging',
                    !rule.logging,
                    rule.logging,
                  ),
                )
              }
            />
          </div>
        );
      })}
    </FieldSection>
  );
}
