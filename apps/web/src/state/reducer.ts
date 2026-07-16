import type { EntityPayload, Operation, ProjectState, SettableEntityType } from '@netplan/domain';

/**
 * Optimistic client-side application of an Operation to the mirrored graph.
 * The server engine stays authoritative (ADR-0010) — every response replaces
 * this mirror; the reducer only keeps the canvas instant.
 */
export function applyOperationOptimistic(state: ProjectState, op: Operation): ProjectState {
  switch (op.kind) {
    case 'CreateEntity':
      return addEntity(state, op.payload);
    case 'DeleteEntity':
      return removeEntity(state, op.payload);
    case 'SetField':
      return setField(state, op.entityType, op.entityId, op.field, op.value);
    case 'CreateLink':
      return { ...state, links: [...state.links, op.link] };
    case 'DeleteLink':
      return { ...state, links: state.links.filter((l) => l.id !== op.linkId) };
    case 'CreatePolicyRule':
      return { ...state, policyRules: [...state.policyRules, op.rule] };
    case 'DeletePolicyRule':
      return { ...state, policyRules: state.policyRules.filter((r) => r.id !== op.ruleId) };
    case 'SetMembership':
      return {
        ...state,
        interfaces: state.interfaces.map((i) =>
          i.id === op.interfaceId ? { ...i, networkId: op.networkId } : i,
        ),
      };
    case 'SetContainment':
      return {
        ...state,
        devices: state.devices.map((d) => (d.id === op.deviceId ? { ...d, zoneId: op.zoneId } : d)),
      };
    case 'SetFindingStatus':
    case 'SetFindingNote':
      // Finding disposition is not canvas state (ADR-0023): the findings view
      // refetches after the authoritative response, so nothing to mirror here.
      return state;
    case 'SetChangeSetReviewStatus':
      // Proposal review status (P4-M6) is not canvas state either — the
      // proposal views read it from the server after the response lands.
      return state;
  }
}

function addEntity(state: ProjectState, payload: EntityPayload): ProjectState {
  switch (payload.entityType) {
    case 'site':
      return { ...state, sites: [...state.sites, payload.entity] };
    case 'zone':
      return { ...state, zones: [...state.zones, payload.entity] };
    case 'device':
      return { ...state, devices: [...state.devices, payload.entity] };
    case 'interface':
      return { ...state, interfaces: [...state.interfaces, payload.entity] };
    case 'address':
      return { ...state, addresses: [...state.addresses, payload.entity] };
    case 'network':
      return { ...state, networks: [...state.networks, payload.entity] };
    case 'service':
      return { ...state, services: [...state.services, payload.entity] };
    case 'flow':
      return { ...state, flows: [...state.flows, payload.entity] };
    case 'hostArtifact':
      return { ...state, hostArtifacts: [...state.hostArtifacts, payload.entity] };
    case 'report':
      return { ...state, reports: [...state.reports, payload.entity] };
    case 'identity':
      return { ...state, identities: [...state.identities, payload.entity] };
    case 'roleAssignment':
      return { ...state, roleAssignments: [...state.roleAssignments, payload.entity] };
    case 'baseline':
      return { ...state, baselines: [...state.baselines, payload.entity] };
  }
}

function removeEntity(state: ProjectState, payload: EntityPayload): ProjectState {
  const id = payload.entity.id;
  switch (payload.entityType) {
    case 'site':
      return { ...state, sites: state.sites.filter((e) => e.id !== id) };
    case 'zone':
      return { ...state, zones: state.zones.filter((e) => e.id !== id) };
    case 'device':
      return { ...state, devices: state.devices.filter((e) => e.id !== id) };
    case 'interface':
      return { ...state, interfaces: state.interfaces.filter((e) => e.id !== id) };
    case 'address':
      return { ...state, addresses: state.addresses.filter((e) => e.id !== id) };
    case 'network':
      return { ...state, networks: state.networks.filter((e) => e.id !== id) };
    case 'service':
      return { ...state, services: state.services.filter((e) => e.id !== id) };
    case 'flow':
      return { ...state, flows: state.flows.filter((e) => e.id !== id) };
    case 'hostArtifact':
      return { ...state, hostArtifacts: state.hostArtifacts.filter((e) => e.id !== id) };
    case 'report':
      return { ...state, reports: state.reports.filter((e) => e.id !== id) };
    case 'identity':
      return { ...state, identities: state.identities.filter((e) => e.id !== id) };
    case 'roleAssignment':
      return { ...state, roleAssignments: state.roleAssignments.filter((e) => e.id !== id) };
    case 'baseline':
      return { ...state, baselines: state.baselines.filter((e) => e.id !== id) };
  }
}

function setField(
  state: ProjectState,
  entityType: SettableEntityType,
  entityId: string,
  field: string,
  value: unknown,
): ProjectState {
  const patch = <T extends { id: string }>(items: T[]): T[] =>
    items.map((item) => (item.id === entityId ? { ...item, [field]: value } : item));

  switch (entityType) {
    case 'project':
      return state.project.id === entityId
        ? { ...state, project: { ...state.project, [field]: value } }
        : state;
    case 'site':
      return { ...state, sites: patch(state.sites) };
    case 'zone':
      return { ...state, zones: patch(state.zones) };
    case 'device':
      return { ...state, devices: patch(state.devices) };
    case 'interface':
      return { ...state, interfaces: patch(state.interfaces) };
    case 'address':
      return { ...state, addresses: patch(state.addresses) };
    case 'network':
      return { ...state, networks: patch(state.networks) };
    case 'link':
      return { ...state, links: patch(state.links) };
    case 'service':
      return { ...state, services: patch(state.services) };
    case 'policyRule':
      return { ...state, policyRules: patch(state.policyRules) };
    case 'flow':
      return { ...state, flows: patch(state.flows) };
    case 'hostArtifact':
      return { ...state, hostArtifacts: patch(state.hostArtifacts) };
    case 'report':
      return { ...state, reports: patch(state.reports) };
    case 'identity':
      return { ...state, identities: patch(state.identities) };
    case 'roleAssignment':
      return { ...state, roleAssignments: patch(state.roleAssignments) };
    default:
      return state;
  }
}
