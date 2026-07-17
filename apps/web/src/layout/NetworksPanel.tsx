import { X } from 'lucide-react';
import { useAppStore } from '../state/store';
import { buildNetwork, opCreateEntity, opDeleteEntity } from '../state/ops';
import { Button, IconButton } from '../ui';

/**
 * NETWORKS & VLANS destination (design §3.2B; improvements M10, #67): the
 * table view of every Network — until now networks were only editable via
 * canvas selection. Rows select the network, so the inspector opens with the
 * full edit surface; create/delete go through the existing Operations.
 */
export function NetworksPanel() {
  const project = useAppStore((s) => s.project);
  const graph = useAppStore((s) => s.graph);
  const selection = useAppStore((s) => s.selection);
  const select = useAppStore((s) => s.select);
  const dispatch = useAppStore((s) => s.dispatch);
  if (!project || !graph) return null;

  const memberCount = (networkId: string) =>
    graph.interfaces.filter((i) => i.networkId === networkId).length;

  function addNetwork() {
    if (!project || !graph) return;
    const network = buildNetwork(project.id, 'vlan', new Set(graph.networks.map((n) => n.name)), {
      x: 80 + graph.networks.length * 220,
      y: -140,
    });
    dispatch(opCreateEntity(project.id, { entityType: 'network', entity: network }));
    select({ entityType: 'network', ids: [network.id] });
  }

  return (
    <section className="networks-panel" data-testid="networks-panel">
      <div className="networks-panel__head">
        <h2 className="panel-title">Networks &amp; VLANs</h2>
        <Button data-testid="networks-add" onClick={addNetwork}>
          + Add network
        </Button>
      </div>
      {graph.networks.length === 0 ? (
        <p className="panel-empty">No networks yet — add one, or import evidence.</p>
      ) : (
        <table className="data-table networks-table" data-testid="networks-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>VLAN</th>
              <th>CIDR</th>
              <th>Members</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {graph.networks.map((network) => {
              const members = memberCount(network.id);
              const selected =
                selection?.entityType === 'network' && selection.ids.includes(network.id);
              return (
                <tr
                  key={network.id}
                  className={selected ? 'networks-table__row--selected' : ''}
                  data-testid={`network-row-${network.name}`}
                  onClick={() => select({ entityType: 'network', ids: [network.id] })}
                >
                  <td>{network.name}</td>
                  <td>{network.kind}</td>
                  <td>{network.vlanId ?? '—'}</td>
                  <td className="mono">{network.cidr || '—'}</td>
                  <td className="data-table__num">{members}</td>
                  <td>
                    <IconButton
                      icon={X}
                      size="sm"
                      variant="danger"
                      label={
                        members > 0
                          ? 'Remove the interface memberships first'
                          : 'Delete this network'
                      }
                      disabled={members > 0}
                      data-testid={`network-delete-${network.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        dispatch(
                          opDeleteEntity(project.id, { entityType: 'network', entity: network }),
                        );
                      }}
                    />
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
