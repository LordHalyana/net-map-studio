import { useAppStore } from '../state/store';

/**
 * "Users and Roles" (design §3.9, plan M10): modelled Identities and their
 * RoleAssignments — who is admin where. Never NetPlan Studio's own users
 * (those are Access Roles, a separate concept).
 */
export function UsersRolesPanel() {
  const graph = useAppStore((s) => s.graph);
  const select = useAppStore((s) => s.select);
  const selection = useAppStore((s) => s.selection);

  if (!graph) return null;
  const deviceName = (id: string | null) =>
    id ? (graph.devices.find((d) => d.id === id)?.name ?? '?') : '—';

  const sorted = [...graph.identities].sort((a, b) =>
    `${a.scope}${a.domain}${a.name}`.localeCompare(`${b.scope}${b.domain}${b.name}`),
  );

  return (
    <section className="identities-panel" data-testid="identities-panel">
      <h2 className="panel-title">Users and Roles</h2>
      {sorted.length === 0 ? (
        <p className="panel-empty">
          No modelled identities yet — import a device-state report to reconstruct who is admin
          where.
        </p>
      ) : (
        <table className="identities-table" data-testid="identities-table">
          <thead>
            <tr>
              <th>Principal</th>
              <th>Scope</th>
              <th>Kind</th>
              <th>Host</th>
              <th>Role assignments</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((identity) => {
              const assignments = graph.roleAssignments.filter((r) => r.identityId === identity.id);
              return (
                <tr
                  key={identity.id}
                  className={
                    selection?.entityType === 'identity' && selection.ids.includes(identity.id)
                      ? 'identities-table__row--selected'
                      : ''
                  }
                  data-testid={`identity-row-${identity.scope}-${identity.name}`}
                  onClick={() => select({ entityType: 'identity', ids: [identity.id] })}
                >
                  <td>
                    {identity.scope === 'domain'
                      ? `${identity.domain}\\${identity.name}`
                      : identity.name}
                  </td>
                  <td>
                    <span className={`identity-scope identity-scope--${identity.scope}`}>
                      {identity.scope}
                    </span>
                  </td>
                  <td>{identity.kind}</td>
                  <td>{deviceName(identity.deviceId)}</td>
                  <td data-testid="identity-assignments">
                    {assignments.length === 0
                      ? '—'
                      : assignments
                          .map(
                            (a) =>
                              `${a.privilege}${a.detail ? ` (${a.detail})` : ''} @ ${deviceName(a.deviceId)}`,
                          )
                          .join('; ')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Inspector view for one Identity (M10). */
export function IdentityInspector({ identityId }: { identityId: string }) {
  const graph = useAppStore((s) => s.graph);
  if (!graph) return null;
  const identity = graph.identities.find((i) => i.id === identityId);
  if (!identity) return <p className="panel-empty">Identity not found.</p>;
  const assignments = graph.roleAssignments.filter((r) => r.identityId === identity.id);
  const deviceName = (id: string | null) =>
    id ? (graph.devices.find((d) => d.id === id)?.name ?? '?') : 'all hosts';

  return (
    <div className="identity-inspector" data-testid="identity-inspector">
      <h3>
        {identity.scope === 'domain' ? `${identity.domain}\\${identity.name}` : identity.name}
      </h3>
      <dl>
        <dt>Scope</dt>
        <dd data-testid="identity-scope">{identity.scope}</dd>
        <dt>Kind</dt>
        <dd>{identity.kind}</dd>
        <dt>Lifecycle</dt>
        <dd>{identity.lifecycleState}</dd>
        {identity.deviceId && (
          <>
            <dt>Host</dt>
            <dd>{deviceName(identity.deviceId)}</dd>
          </>
        )}
      </dl>
      <h4>Role assignments ({assignments.length})</h4>
      <ul data-testid="identity-inspector-assignments">
        {assignments.map((a) => (
          <li key={a.id}>
            {a.privilege}
            {a.detail ? ` (${a.detail})` : ''} on {deviceName(a.deviceId)}
          </li>
        ))}
      </ul>
    </div>
  );
}
