import type { Endpoint } from './endpoints.js';
import type { Flow, Network, PolicyRule, Service } from './entities.js';
import type { ProjectState } from './state.js';
import { buildResolutionIndex, type ResolutionIndex } from './resolution.js';

/**
 * Rule-validation set (design §3.11). These are inline warnings, not Findings
 * — the Finding entity belongs to Phase 3 (ADR-0014). Includes the two
 * intent-vs-observation checks (improvements M8, #65): observed-without-rule
 * and planned-never-observed.
 */
export interface RuleWarning {
  /** Null for flow-side warnings (observed traffic with no governing rule). */
  ruleId: PolicyRule['id'] | null;
  /** Set on observed-without-rule warnings — the unmatched aggregated Flow. */
  flowId?: Flow['id'];
  category:
    | 'anyToAny'
    | 'orphaned'
    | 'contradictory'
    | 'overlapping'
    | 'shadowedByBroader'
    | 'observedWithoutRule'
    | 'plannedNeverObserved';
  message: string;
}

/**
 * Does a rule's service scope cover this flow's protocol/port? A rule without
 * a Service governs any traffic on its pair; a specific range never matches a
 * flow whose port is unknown (we cannot prove coverage).
 */
function ruleServiceMatchesFlow(state: ProjectState, rule: PolicyRule, flow: Flow): boolean {
  if (!rule.serviceId) return true;
  const service = state.services.find((s) => s.id === rule.serviceId);
  if (!service) return false;
  if (
    service.protocol !== 'any' &&
    flow.protocol !== 'other' &&
    service.protocol !== flow.protocol
  ) {
    return false;
  }
  if (service.portStart == null) return true;
  if (flow.port == null) return false;
  return service.portStart <= flow.port && flow.port <= (service.portEnd ?? service.portStart);
}

/**
 * The shared intent↔observation matcher (M8, #65): does this PolicyRule
 * address this aggregated Flow? Polymorphic rule endpoints (Device / Network /
 * Zone / Interface, ADR-0012) resolve through `endpointCoversDevice`; flow
 * endpoints resolve to known Devices only — external peers never match, so
 * they neither satisfy a rule nor silently pass one.
 */
export function ruleMatchesFlow(
  index: ResolutionIndex,
  state: ProjectState,
  rule: PolicyRule,
  flow: Flow,
): boolean {
  const src = index.flowEndpointDevice(flow.source);
  const dst = index.flowEndpointDevice(flow.destination);
  if (!src || !dst) return false;
  if (!ruleServiceMatchesFlow(state, rule, flow)) return false;
  const forward =
    index.endpointCoversDevice(rule.source, src) &&
    index.endpointCoversDevice(rule.destination, dst);
  const reverse =
    rule.direction === 'bidirectional' &&
    index.endpointCoversDevice(rule.source, dst) &&
    index.endpointCoversDevice(rule.destination, src);
  return forward || reverse;
}

/** A Network reading as "anything": 0.0.0.0/0, ::/0 or literally named any. */
function isAnyNetwork(network: Network): boolean {
  return (
    network.cidr === '0.0.0.0/0' || network.cidr === '::/0' || network.name.toLowerCase() === 'any'
  );
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
  // One resolution index per validation pass (#110 B1) — the same single home
  // for (kind, id) resolution the findings engine uses.
  const index = buildResolutionIndex(state);

  for (const rule of rules) {
    // orphaned: references to deleted objects
    for (const [label, endpoint] of [
      ['source', rule.source],
      ['destination', rule.destination],
    ] as const) {
      if (!index.endpointExists(endpoint)) {
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

  // --- intent vs observation (§3.11; improvements M8, #65) ---

  // observed-without-rule: aggregated traffic between known devices that no
  // PolicyRule addresses. The cross-zone Finding remains the security-severity
  // slice; this is the general visibility warning.
  const deviceName = (flow: Flow, side: 'source' | 'destination') =>
    index.flowEndpointDevice(flow[side])?.name ?? '?';
  for (const flow of state.flows) {
    const src = index.flowEndpointDevice(flow.source);
    const dst = index.flowEndpointDevice(flow.destination);
    if (!src || !dst) continue; // external peers are the external-connection rule's turf
    if (rules.some((rule) => ruleMatchesFlow(index, state, rule, flow))) continue;
    warnings.push({
      ruleId: null,
      flowId: flow.id,
      category: 'observedWithoutRule',
      message: `Observed ${flow.protocol}${flow.port != null ? `/${flow.port}` : ''} traffic ${deviceName(flow, 'source')} → ${deviceName(flow, 'destination')} matches no PolicyRule`,
    });
  }

  // planned-never-observed: a rule matched by zero observed Flows. Worded per
  // §3.11 "without assuming they are unnecessary" — and only once observed
  // traffic exists at all, so a pure planning project stays quiet.
  if (state.flows.length > 0) {
    for (const rule of rules) {
      if (state.flows.some((flow) => ruleMatchesFlow(index, state, rule, flow))) continue;
      warnings.push({
        ruleId: rule.id,
        category: 'plannedNeverObserved',
        message:
          'No observed traffic matches this rule yet — it may cover future or unmeasured traffic, not necessarily unnecessary',
      });
    }
  }

  return warnings;
}
