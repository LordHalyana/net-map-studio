import { memo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import type { Device } from '@netplan/domain';
import { findLibraryItem } from '../library/catalog';

export type DeviceFlowNode = Node<{ device: Device }, 'device'>;

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
 * badge, and placeholders for confidence / evidence-count (wired but empty
 * until Phase 2 fills them — design §3.2C).
 */
export const DeviceNode = memo(function DeviceNode({ data, selected }: NodeProps<DeviceFlowNode>) {
  const { device } = data;
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
