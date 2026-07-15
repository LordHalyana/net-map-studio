import { memo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import type { Device } from '@netplan/domain';
import { findLibraryItem } from '../library/catalog';

export type DeviceFlowNode = Node<{ device: Device }, 'device'>;

/** Canvas representation of a Device. Badges grow in M5. */
export const DeviceNode = memo(function DeviceNode({ data, selected }: NodeProps<DeviceFlowNode>) {
  const { device } = data;
  const glyph = findLibraryItem(device.deviceType)?.glyph ?? '▢';
  return (
    <div
      className={`device-node${selected ? ' device-node--selected' : ''}`}
      data-testid={`device-node-${device.name}`}
    >
      <span className="device-node__glyph">{glyph}</span>
      <div className="device-node__body">
        <span className="device-node__name">{device.name}</span>
        <span className="device-node__meta">
          {device.deviceType === 'custom' && device.customTypeLabel
            ? device.customTypeLabel
            : device.deviceType}
        </span>
      </div>
      <span
        className={`device-node__lifecycle device-node__lifecycle--${device.lifecycleState}`}
        title={`Lifecycle: ${device.lifecycleState}`}
      />
    </div>
  );
});
