import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { Device } from '@netplan/domain';
import { findLibraryItem } from '../library/catalog';
import type { DeviceNodeData } from './graphToFlow';

export type DeviceFlowNode = Node<DeviceNodeData, 'device'>;

const lifecycleShort: Record<Device['lifecycleState'], string> = {
  observed: 'OBS',
  inferred: 'INF',
  manuallyVerified: 'VER',
  planned: 'PLN',
  deprecated: 'DEP',
  removedInProposal: 'REM',
};

/**
 * Canvas representation of a Device: type icon, status dot, lifecycleState
 * badge, Membership tint chips, and placeholders for confidence /
 * evidence-count (wired but empty until Phase 2 — design §3.2C).
 */
export const DeviceNode = memo(function DeviceNode({ data, selected }: NodeProps<DeviceFlowNode>) {
  const { device, memberships, showTint } = data;
  const glyph = findLibraryItem(device.deviceType)?.glyph ?? '▢';
  const typeLabel =
    device.deviceType === 'custom' && device.customTypeLabel
      ? device.customTypeLabel
      : device.deviceType;

  return (
    <div
      className={`device-node${selected ? ' device-node--selected' : ''}`}
      data-testid={`device-node-${device.name}`}
    >
      <Handle type="source" position={Position.Top} id="membership" className="hidden-handle" />
      <Handle type="source" position={Position.Right} id="link-out" className="hidden-handle" />
      <Handle type="target" position={Position.Left} id="link-in" className="hidden-handle" />
      <span className="device-node__glyph">
        {device.customIconKey ? (
          <img className="device-node__icon" src={device.customIconKey} alt={typeLabel} />
        ) : (
          glyph
        )}
      </span>
      <div className="device-node__body">
        <span className="device-node__name">{device.name}</span>
        <span className="device-node__meta">{typeLabel}</span>
        {showTint && memberships.length > 0 && (
          <span className="device-node__memberships" data-testid="device-memberships">
            {memberships.map((m) => (
              <span
                key={`${m.networkId}-${m.interfaceName}`}
                className="device-node__membership-chip"
                style={{ background: m.color }}
                title={`${m.interfaceName} ∈ ${m.name}`}
                data-testid={`membership-chip-${m.name}`}
              />
            ))}
          </span>
        )}
      </div>
      <div className="device-node__badges">
        <span
          className={`device-node__status device-node__status--${device.status}`}
          title={`Status: ${device.status}`}
        />
        <span
          className={`device-node__lifecycle device-node__lifecycle--${device.lifecycleState}`}
          title={`Lifecycle: ${device.lifecycleState}`}
        >
          {lifecycleShort[device.lifecycleState]}
        </span>
        {/* Phase-2 seams: populated once provenance/evidence exist (ADR-0008) */}
        <span className="device-node__confidence" data-testid="badge-confidence" />
        <span className="device-node__evidence" data-testid="badge-evidence" />
      </div>
    </div>
  );
});
