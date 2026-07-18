import type { Device, ProjectState } from '@netplan/domain';
import { FieldSection } from '../fields';

/** Identities and RoleAssignments scoped to this device (§3.2D, M9 #66). */
export function DeviceUsersRolesSection({
  device,
  graph,
}: {
  device: Device;
  graph: ProjectState;
}) {
  const identities = graph.identities.filter((i) => i.deviceId === device.id);
  const assignments = graph.roleAssignments.filter((r) => r.deviceId === device.id);
  if (identities.length === 0 && assignments.length === 0) return null;
  const identityName = (identityId: string) => {
    const identity = graph.identities.find((i) => i.id === identityId);
    if (!identity) return '(deleted)';
    return identity.scope === 'domain' ? `${identity.domain}\\${identity.name}` : identity.name;
  };
  return (
    <FieldSection title="Users & Roles" testId="inspector-device-identities">
      <ul className="inspector-list">
        {identities.map((identity) => (
          <li key={identity.id} className="inspector-list__row">
            <span className="inspector-list__primary">{identity.name}</span>
            <span className="inspector-list__meta">
              {identity.scope} · {identity.kind}
            </span>
          </li>
        ))}
        {assignments.map((assignment) => (
          <li key={assignment.id} className="inspector-list__row">
            <span className="inspector-list__primary">{identityName(assignment.identityId)}</span>
            <span className="inspector-list__meta">
              {assignment.privilege}
              {assignment.detail ? ` · ${assignment.detail}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </FieldSection>
  );
}
