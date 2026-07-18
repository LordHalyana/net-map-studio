import { Box } from 'lucide-react';
import { lifecycleStateSchema, type Device, type ProjectState } from '@netplan/domain';
import { getLog } from '../../api/client';
import { accentStyle } from '../../canvas/colors';
import { networkTintsFor } from '../../canvas/derived';
import { primaryIp } from '../../canvas/primaryIp';
import { nodeAccentColor } from '../../canvas/roleColors';
import { findLibraryItem } from '../../library/catalog';
import { deleteDevicesChangeSet, duplicateDevicesChangeSet } from '../../state/ops';
import { useAppStore } from '../../state/store';
import { Button } from '../../ui';

interface DeviceHeaderProps {
  device: Device;
  graph: ProjectState;
  setField: (field: string, value: unknown, previousValue: unknown) => void;
}

/** Header block (visual-parity M6, gap G8) + the primary device actions. */
export function DeviceHeader({ device, graph, setField }: DeviceHeaderProps) {
  const dispatch = useAppStore((s) => s.dispatch);
  const projectId = graph.project.id;

  const tints = networkTintsFor(graph.networks);
  const memberships = graph.interfaces
    .filter((i) => i.deviceId === device.id && i.networkId)
    .map((i) => ({ color: tints.get(i.networkId ?? '') ?? 'var(--text-dim)' }));
  const accent = nodeAccentColor(device, memberships);
  const HeaderIcon = findLibraryItem(device.deviceType)?.icon ?? Box;
  const headerIp = primaryIp(graph, device.id);

  /**
   * Clearing a removal flag restores what the object was before — a
   * manually-verified trust badge must survive the round trip (ADR-0021).
   * The Operation log knows the previous state; fall back to `observed`.
   */
  async function restoreFromProposal() {
    let previous: unknown = 'observed';
    try {
      const log = await getLog(projectId);
      for (const entry of log) {
        if (
          entry.role === 'do' &&
          entry.payload.kind === 'SetField' &&
          entry.payload.entityId === device.id &&
          entry.payload.field === 'lifecycleState' &&
          entry.payload.value === 'removedInProposal'
        ) {
          previous = entry.payload.previousValue;
        }
      }
    } catch {
      // log unavailable — the observed fallback still clears the flag
    }
    const target = lifecycleStateSchema.safeParse(previous);
    setField(
      'lifecycleState',
      target.success && target.data !== 'removedInProposal' ? target.data : 'observed',
      device.lifecycleState,
    );
  }

  return (
    <>
      <div className="inspector-head">
        <span className="inspector-head__tile" style={accentStyle(accent)}>
          {device.customIconKey ? (
            <img className="device-node__icon" src={device.customIconKey} alt="" />
          ) : (
            <HeaderIcon size={20} aria-hidden />
          )}
        </span>
        <div className="inspector-head__text">
          <span className="inspector-head__name">{device.name}</span>
          <span className="inspector-head__ip">{headerIp ?? device.deviceType}</span>
        </div>
        <span className={`inspector-head__status inspector-head__status--${device.status}`}>
          ●{' '}
          {device.status === 'active'
            ? 'Online'
            : device.status === 'inactive'
              ? 'Offline'
              : 'Unknown'}
        </span>
      </div>
      <div className="inspector-actions">
        <Button
          data-testid="duplicate-device"
          onClick={() => {
            const cs = duplicateDevicesChangeSet(graph, [device.id]);
            if (cs) dispatch(cs);
          }}
        >
          Duplicate
        </Button>
        <Button
          variant="danger"
          data-testid="delete-device"
          onClick={() => {
            const cs = deleteDevicesChangeSet(graph, [device.id]);
            if (cs) dispatch(cs);
          }}
        >
          Delete
        </Button>
        {device.lifecycleState !== 'removedInProposal' ? (
          <Button
            data-testid="remove-in-proposal"
            title="TO-BE proposal (ADR-0009): flag for removal without deleting the AS-IS object"
            onClick={() => setField('lifecycleState', 'removedInProposal', device.lifecycleState)}
          >
            Remove in proposal
          </Button>
        ) : (
          <Button
            data-testid="restore-in-proposal"
            title="Clear the removal flag (restores the previous lifecycle state)"
            onClick={() => void restoreFromProposal()}
          >
            Restore
          </Button>
        )}
      </div>
    </>
  );
}
