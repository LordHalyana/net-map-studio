import type { Endpoint } from './endpoints.js';
import type { Network, PolicyRule, Service } from './entities.js';
import type { ProjectState } from './state.js';

/**
 * Starter rule-validation set (design §3.11, Phase 1). These are inline
 * warnings, not Findings — the Finding entity belongs to Phase 3 (ADR-0014).
 */
export interface RuleWarning {
  ruleId: PolicyRule['id'];
  category: 'anyToAny' | 'orphaned' | 'contradictory' | 'overlapping' | 'shadowedByBroader';
  message: string;
}

/** A Network reading as "anything": 0.0.0.0/0, ::/0 or literally named any. */
function isAnyNetwork(network: Network): boolean {
  return (
    network.cidr === '0.0.0.0/0' || network.cidr === '::/0' || network.name.toLowerCase() === 'any'
  );
}

function endpointExists(state: ProjectState, endpoint: Endpoint): boolean {
  switch (endpoint.kind) {
    case 'interface':
      return state.interfaces.some((i) => i.id === endpoint.id);
    case 'device':
      return state.devices.some((d) => d.id === endpoint.id);
    case 'network':
    case 'subnet':
      return state.networks.some((n) => n.id === endpoint.id);
    case 'zone':
      return state.zones.some((z) => z.id === endpoint.id);
  }
}

function sameEndpoint(a: Endpoint, b: Endpoint): boolean {
  const kindOf = (e: Endpoint) => (e.kind === 'subnet' ? 'network' : e.kind);
  return kindOf(a) === kindOf(b) && a.id === b.id;
}

/** Do two rules address the same traffic pair (either direction counts)? */
function samePair(a: PolicyRule, b: PolicyRule): boolean {
  return (
    (sameEndpoint(a.source, b.source) && sameEndpoint(a.destination, b.destination)) ||
    (sameEndpoint(a.source, b.destination) && sameEndpoint(a.destination, b.source))
  );
}

interface PortRange {
  start: number;
  end: number;
}

function serviceRange(service: Service | undefined): PortRange | 'any' {
  if (!service) return 'any';
  if (service.protocol === 'any') return 'any';
  if (service.portStart == null) return 'any';
  return { start: service.portStart, end: service.portEnd ?? service.portStart };
}

function serviceOf(state: ProjectState, rule: PolicyRule): Service | undefined {
  return rule.serviceId ? state.services.find((s) => s.id === rule.serviceId) : undefined;
}

/** Does traffic scope `broad` fully cover `narrow`? */
function covers(state: ProjectState, broad: PolicyRule, narrow: PolicyRule): boolean {
  const broadService = serviceOf(state, broad);
  const narrowService = serviceOf(state, narrow);
  const broadRange = serviceRange(broadService);
  if (broadRange === 'any') {
    // any-service covers everything on the same pair; protocols must not conflict
    if (broadService && narrowService && broadService.protocol !== narrowService.protocol) {
      return false;
    }
    return true;
  }
  const narrowRange = serviceRange(narrowService);
  if (narrowRange === 'any') return false;
  if (broadService && narrowService && broadService.protocol !== narrowService.protocol) {
    return false;
  }
  return broadRange.start <= narrowRange.start && narrowRange.end <= broadRange.end;
}

/** Do the two rules' services overlap at all? */
function overlaps(state: ProjectState, a: PolicyRule, b: PolicyRule): boolean {
  const rangeA = serviceRange(serviceOf(state, a));
  const rangeB = serviceRange(serviceOf(state, b));
  if (rangeA === 'any' || rangeB === 'any') return true;
  const serviceA = serviceOf(state, a);
  const serviceB = serviceOf(state, b);
  if (serviceA && serviceB && serviceA.protocol !== serviceB.protocol) return false;
  return rangeA.start <= rangeB.end && rangeB.start <= rangeA.end;
}

export function validatePolicyRules(state: ProjectState): RuleWarning[] {
  const warnings: RuleWarning[] = [];
  const rules = state.policyRules;

  for (const rule of rules) {
    // orphaned: references to deleted objects
    for (const [label, endpoint] of [
      ['source', rule.source],
      ['destination', rule.destination],
    ] as const) {
      if (!endpointExists(state, endpoint)) {
        warnings.push({
          ruleId: rule.id,
          category: 'orphaned',
          message: `Rule ${label} references a deleted ${endpoint.kind}`,
        });
      }
    }
    if (rule.serviceId && !state.services.some((s) => s.id === rule.serviceId)) {
      warnings.push({
        ruleId: rule.id,
        category: 'orphaned',
        message: 'Rule references a deleted Service',
      });
    }

    // any-to-any: a permissive rule over "anything to anything"
    if (rule.action === 'allow' || rule.action === 'monitor') {
      const anyEnd = (endpoint: Endpoint) => {
        if (endpoint.kind !== 'network' && endpoint.kind !== 'subnet') return false;
        const network = state.networks.find((n) => n.id === endpoint.id);
        return network ? isAnyNetwork(network) : false;
      };
      if (anyEnd(rule.source) && anyEnd(rule.destination) && !rule.serviceId) {
        warnings.push({
          ruleId: rule.id,
          category: 'anyToAny',
          message: `${rule.action} rule permits any source to any destination on any service`,
        });
      }
    }
  }

  // pairwise checks
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i];
      const b = rules[j];
      if (!a || !b || !samePair(a, b)) continue;
      if (!overlaps(state, a, b)) continue;

      if (a.action !== b.action) {
        const ordered: [PolicyRule, PolicyRule][] = [
          [a, b],
          [b, a],
        ];
        let shadowFound = false;
        for (const [broad, narrow] of ordered) {
          if (covers(state, broad, narrow) && !covers(state, narrow, broad)) {
            warnings.push({
              ruleId: narrow.id,
              category: 'shadowedByBroader',
              message: `Shadowed by broader ${broad.action} rule "${broad.name || broad.id}"`,
            });
            shadowFound = true;
            break;
          }
        }
        if (!shadowFound) {
          for (const rule of [a, b]) {
            warnings.push({
              ruleId: rule.id,
              category: 'contradictory',
              message: 'Conflicts with another rule on the same traffic (different action)',
            });
          }
        }
      } else {
        for (const rule of [a, b]) {
          warnings.push({
            ruleId: rule.id,
            category: 'overlapping',
            message: 'Overlaps another rule with the same action on the same traffic',
          });
        }
      }
    }
  }

  return warnings;
}
