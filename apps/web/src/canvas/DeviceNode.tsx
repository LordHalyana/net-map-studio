import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Box } from 'lucide-react';
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
  const { device, memberships, showTint, confidence, evidenceCount, identityChips, diffState } =
    data;
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

  return (
    <div
      className={`device-node${selected ? ' device-node--selected' : ''}${diffClass}`}
      data-testid={`device-node-${device.name}`}
    >
      <Handle type="source" position={Position.Top} id="membership" className="hidden-handle" />
      <Handle type="source" position={Position.Right} id="link-out" className="hidden-handle" />
      <Handle type="target" position={Position.Left} id="link-in" className="hidden-handle" />
      <span className="device-node__glyph">
        {device.customIconKey ? (
          <img className="device-node__icon" src={device.customIconKey} alt={typeLabel} />
        ) : (
          <Icon size={16} aria-hidden />
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
