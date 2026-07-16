import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Box } from 'lucide-react';
import type { Device } from '@netplan/domain';
import { findLibraryItem } from '../library/catalog';
import { accentStyle } from './colors';
import { nodeAccentColor } from './roleColors';
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
 * Canvas representation of a Device (visual-parity M1, gap G1): role-colored
 * border + glow, tinted icon tile, uppercase name over the primary IP.
 * Prototype verdict (issue #43, branch proto/m1-device-node): lifecycle /
 * confidence / evidence badges collapse into a strip that appears on hover or
 * selection — always-on badges recreate the clutter the concept avoids. The
 * status dot stays always-visible.
 */
export const DeviceNode = memo(function DeviceNode({ data, selected }: NodeProps<DeviceFlowNode>) {
  const {
    device,
    memberships,
    compact,
    primaryIp,
    showTint,
    confidence,
    evidenceCount,
    identityChips,
    diffState,
  } = data;
  const accent = nodeAccentColor(device, memberships);
  const Icon = findLibraryItem(device.deviceType)?.icon ?? Box;
  const typeLabel =
    device.deviceType === 'custom' && device.customTypeLabel
      ? device.customTypeLabel
      : device.deviceType;
  const diffClass =
    diffState === 'added'
      ? ' device-node--diff-added'
      : diffState === 'removed'
        ? ' device-node--diff-removed'
        : '';

  // Leaf-endpoint mini-node (M4, #61): icon tile + status dot; name/IP appear
  // on hover; the full card returns while selected.
  if (compact && !selected) {
    return (
      <div
        className={`device-node device-node--compact${diffClass}`}
        style={accentStyle(accent)}
        data-testid={`device-node-${device.name}`}
      >
        <Handle type="source" position={Position.Top} id="membership" className="hidden-handle" />
        <Handle type="source" position={Position.Right} id="link-out" className="hidden-handle" />
        <Handle type="target" position={Position.Left} id="link-in" className="hidden-handle" />
        <span className="device-node__tile">
          {device.customIconKey ? (
            <img className="device-node__icon" src={device.customIconKey} alt={typeLabel} />
          ) : (
            <Icon size={15} aria-hidden />
          )}
        </span>
        <span
          className={`device-node__status device-node__status--${device.status}`}
          title={`Status: ${device.status}`}
        />
        <span className="device-node__hover-label">
          <span className="device-node__name">{device.name}</span>
          <span className="device-node__meta">{primaryIp ?? typeLabel}</span>
        </span>
      </div>
    );
  }

  return (
    <div
      className={`device-node${selected ? ' device-node--selected' : ''}${diffClass}`}
      style={accentStyle(accent)}
      data-testid={`device-node-${device.name}`}
    >
      <Handle type="source" position={Position.Top} id="membership" className="hidden-handle" />
      <Handle type="source" position={Position.Right} id="link-out" className="hidden-handle" />
      <Handle type="target" position={Position.Left} id="link-in" className="hidden-handle" />
      <span className="device-node__tile">
        {device.customIconKey ? (
          <img className="device-node__icon" src={device.customIconKey} alt={typeLabel} />
        ) : (
          <Icon size={17} aria-hidden />
        )}
      </span>
      <div className="device-node__body">
        <span className="device-node__name">{device.name}</span>
        <span className="device-node__meta">{primaryIp ?? typeLabel}</span>
        {/* dual-homed devices keep explicit chips; a single Membership is the tint */}
        {showTint && memberships.length > 1 && (
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
      <span
        className={`device-node__status device-node__status--${device.status}`}
        title={`Status: ${device.status}`}
      />
      <div className="device-node__badges">
        <span
          className={`device-node__lifecycle device-node__lifecycle--${device.lifecycleState}`}
          title={`Lifecycle: ${device.lifecycleState}`}
        >
          {lifecycleShort[device.lifecycleState]}
        </span>
        {/* Provenance badges (ADR-0008, plan M8): winning confidence + evidence count */}
        <span
          className="device-node__confidence"
          data-testid="badge-confidence"
          title={confidence !== null ? `Confidence: ${Math.round(confidence * 100)}%` : undefined}
        >
          {confidence !== null ? `${Math.round(confidence * 100)}%` : ''}
        </span>
        <span
          className="device-node__evidence"
          data-testid="badge-evidence"
          title={evidenceCount > 0 ? `${evidenceCount} evidence file(s)` : undefined}
        >
          {evidenceCount > 0 ? `⎘${evidenceCount}` : ''}
        </span>
      </div>
      {identityChips.length > 0 && (
        <div className="device-node__identities" data-testid="device-identities">
          {identityChips.map((chip) => (
            <span
              key={chip.id}
              className={`identity-chip identity-chip--${chip.scope}`}
              title={`${chip.scope} identity: ${chip.label}`}
            >
              {chip.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});
