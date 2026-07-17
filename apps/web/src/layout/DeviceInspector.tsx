import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ArrowLeftRight, Box, ImagePlus, X } from 'lucide-react';
import {
  addressKindSchema,
  criticalitySchema,
  deviceTypeSchema,
  endpointResolver,
  interfaceKindSchema,
  lifecycleStateSchema,
  networkIdSchema,
  zoneIdSchema,
  type Address,
  type Device,
  type Interface,
  type Link,
  type PolicyRule,
  type ProjectState,
} from '@netplan/domain';
import { getLog } from '../api/client';
import { findLibraryItem } from '../library/catalog';
import { accentStyle } from '../canvas/colors';
import { networkColorMap } from '../canvas/networkColor';
import { primaryIp } from '../canvas/primaryIp';
import { nodeAccentColor } from '../canvas/roleColors';
import { useAppStore } from '../state/store';
import {
  buildAddress,
  buildInterface,
  changeSet,
  deleteDevicesChangeSet,
  duplicateDevicesChangeSet,
  opCreateEntity,
  opDeleteEntity,
  opSetContainment,
  opSetField,
  opSetMembership,
} from '../state/ops';
import { Button, IconButton, Toggle } from '../ui';
import { FieldSection, SelectField, TextAreaField, TextField } from './fields';
import { ProvenanceSection } from './ProvenanceSection';

function enumOptions(values: readonly string[]) {
  return values.map((value) => ({ value, label: value }));
}

export function DeviceInspector({ device, graph }: { device: Device; graph: ProjectState }) {
  const dispatch = useAppStore((s) => s.dispatch);
  const projectId = graph.project.id;
  const iconInput = useRef<HTMLInputElement>(null);

  const setField = (field: string, value: unknown, previousValue: unknown) =>
    dispatch(opSetField(projectId, 'device', device.id, field, value, previousValue));

  const interfaces = graph.interfaces.filter((i) => i.deviceId === device.id);
  const structuredTypeMissing = device.deviceType === 'custom' && !device.customTypeLabel.trim();

  /** Containment (ADR-0013): exactly one physical parent; position converts with it. */
  function commitZone(value: string) {
    const nextZoneId = value ? zoneIdSchema.parse(value) : null;
    if (nextZoneId === device.zoneId) return;
    const ops = [opSetContainment(projectId, device.id, nextZoneId, device.zoneId)];

    if (nextZoneId) {
      const siblings = graph.devices.filter(
        (d) => d.zoneId === nextZoneId && d.id !== device.id,
      ).length;
      const slot = { x: 24 + (siblings % 4) * 40, y: 44 + Math.floor(siblings / 4) * 56 };
      ops.push(opSetField(projectId, 'device', device.id, 'position', slot, device.position));
    } else if (device.zoneId) {
      // back to the open canvas: restore an absolute position
      const zone = graph.zones.find((z) => z.id === device.zoneId);
      const site = zone ? graph.sites.find((s) => s.id === zone.siteId) : undefined;
      const absolute = {
        x: (site?.position.x ?? 0) + (zone?.position.x ?? 0) + device.position.x,
        y: (site?.position.y ?? 0) + (zone?.position.y ?? 0) + device.position.y,
      };
      ops.push(opSetField(projectId, 'device', device.id, 'position', absolute, device.position));
    }
    dispatch(changeSet(projectId, `Move ${device.name} to zone`, ops));
  }

  function onIconUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setField('customIconKey', reader.result, device.customIconKey);
      }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }

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

  function addInterface() {
    const names = new Set(interfaces.map((i) => i.name));
    let index = interfaces.length;
    let name: string;
    do {
      name = `eth${index}`;
      index += 1;
    } while (names.has(name));
    dispatch(
      opCreateEntity(projectId, { entityType: 'interface', entity: buildInterface(device, name) }),
    );
  }

  // header block (visual-parity M6, gap G8)
  const tints = networkColorMap(graph.networks);
  const memberships = interfaces
    .filter((i) => i.networkId)
    .map((i) => ({ color: tints.get(i.networkId ?? '') ?? 'var(--text-dim)' }));
  const accent = nodeAccentColor(device, memberships);
  const HeaderIcon = findLibraryItem(device.deviceType)?.icon ?? Box;
  const headerIp = primaryIp(graph, device.id);

  return (
    <div data-testid="inspector-device">
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

      <FieldSection title="Device">
        <TextField
          label="Name"
          value={device.name}
          testId="device-name-input"
          onCommit={(v) => v.trim() && setField('name', v.trim(), device.name)}
        />
        <SelectField
          label="Type"
          value={device.deviceType}
          testId="device-type-select"
          options={enumOptions(deviceTypeSchema.options)}
          onCommit={(v) => setField('deviceType', v, device.deviceType)}
        />
        {device.deviceType === 'custom' && (
          <TextField
            label="Custom type"
            value={device.customTypeLabel}
            testId="device-custom-type-input"
            placeholder="required for custom components"
            onCommit={(v) => setField('customTypeLabel', v, device.customTypeLabel)}
          />
        )}
        <div className="field">
          <span className="field__label">Icon</span>
          <div className="icon-upload">
            {device.customIconKey && (
              <span className="icon-upload__preview" title="Current custom icon">
                <img src={device.customIconKey} alt="" />
              </span>
            )}
            <Button
              size="sm"
              data-testid="device-icon-button"
              disabled={structuredTypeMissing}
              title={
                structuredTypeMissing
                  ? 'Assign a structured type label before uploading a custom icon'
                  : 'Upload a custom icon (PNG, SVG or JPEG)'
              }
              onClick={() => iconInput.current?.click()}
            >
              <ImagePlus size={13} aria-hidden />
              {device.customIconKey ? 'Replace…' : 'Upload icon…'}
            </Button>
            {device.customIconKey && (
              <IconButton
                icon={X}
                size="sm"
                label="Remove custom icon"
                data-testid="device-icon-clear"
                onClick={() => setField('customIconKey', '', device.customIconKey)}
              />
            )}
            <input
              ref={iconInput}
              type="file"
              accept="image/png,image/svg+xml,image/jpeg"
              className="export-menu__file"
              data-testid="device-icon-upload"
              onChange={onIconUpload}
            />
          </div>
        </div>
        <TextField
          label="Vendor"
          value={device.vendor}
          testId="device-vendor-input"
          onCommit={(v) => setField('vendor', v, device.vendor)}
        />
        <TextField
          label="Model"
          value={device.model}
          onCommit={(v) => setField('model', v, device.model)}
        />
        <TextField
          label="OS"
          value={device.os}
          testId="device-os-input"
          onCommit={(v) => setField('os', v, device.os)}
        />
        <OsConfidenceHint deviceId={device.id} />
        <TextField
          label="Serial"
          value={device.serialNumber}
          onCommit={(v) => setField('serialNumber', v, device.serialNumber)}
        />
        <TextField
          label="Asset tag"
          value={device.assetTag}
          onCommit={(v) => setField('assetTag', v, device.assetTag)}
        />
        <TextField
          label="Location"
          value={device.location}
          onCommit={(v) => setField('location', v, device.location)}
        />
        <SelectField
          label="Zone"
          value={device.zoneId ?? ''}
          testId="device-zone-select"
          options={[
            { value: '', label: '— none —' },
            ...graph.zones.map((zone) => {
              const site = graph.sites.find((s) => s.id === zone.siteId);
              return { value: zone.id, label: `${site?.name ?? '?'} / ${zone.name}` };
            }),
          ]}
          onCommit={commitZone}
        />
        <SelectField
          label="Criticality"
          value={device.criticality}
          testId="device-criticality-select"
          options={enumOptions(criticalitySchema.options)}
          onCommit={(v) => setField('criticality', v, device.criticality)}
        />
        <SelectField
          label="Status"
          value={device.status}
          options={enumOptions(['unknown', 'active', 'inactive'])}
          onCommit={(v) => setField('status', v, device.status)}
        />
        <div className="field" title="Pinned devices are never moved by auto-arrange (§3.2C)">
          <span className="field__label">Pinned</span>
          <Toggle
            checked={device.pinned}
            data-testid="device-pinned-toggle"
            label="Pinned"
            onChange={(checked) => setField('pinned', checked, device.pinned)}
          />
        </div>
      </FieldSection>

      <FieldSection title="Interfaces" testId="inspector-interfaces">
        {interfaces.map((iface) => (
          <InterfaceEditor key={iface.id} iface={iface} graph={graph} />
        ))}
        <button type="button" data-testid="add-interface" onClick={addInterface}>
          + Add interface
        </button>
      </FieldSection>

      <ConnectionsSection device={device} graph={graph} />

      <DeviceServicesSection device={device} graph={graph} />

      <DeviceFindingsSection device={device} />

      <DeviceUsersRolesSection device={device} graph={graph} />

      <DeviceRulesSection device={device} graph={graph} />

      <ProvenanceSection entityType="device" entityId={device.id} />

      <FieldSection title="Tags & notes">
        {device.tags.length > 0 && (
          <div className="tag-chips" data-testid="device-tags">
            {device.tags.map((tag) => (
              <span key={tag} className="tag-chip">
                {tag}
              </span>
            ))}
          </div>
        )}
        <TextField
          label="Tags"
          value={device.tags.join(', ')}
          placeholder="comma, separated"
          onCommit={(v) =>
            setField(
              'tags',
              v
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
              device.tags,
            )
          }
        />
        <TextAreaField
          label="Notes"
          value={device.notes}
          onCommit={(v) => setField('notes', v, device.notes)}
        />
      </FieldSection>
    </div>
  );
}

/**
 * The device's connections (M6, gap G8): its Links with the peer they reach,
 * plus its observed-Flow count. Rendered as an inspector section rather than
 * the concept's Connections tab — three short sections don't earn tab chrome.
 */
/** §3.2D "operating system and confidence level" (M9, #66). */
function OsConfidenceHint({ deviceId }: { deviceId: string }) {
  const provenance = useAppStore((s) => s.provenance);
  const rows = provenance.filter(
    (r) =>
      r.entityType === 'device' &&
      r.entityId === deviceId &&
      r.field === 'os' &&
      r.status === 'accepted',
  );
  if (rows.length === 0) return null;
  const confidence = Math.max(...rows.map((r) => r.confidence));
  return (
    <div className="field field--meta">
      <span className="field__label" />
      <span className="field__hint" data-testid="device-os-confidence">
        confidence {Math.round(confidence * 100)}% · {rows[0]?.sourceType}
      </span>
    </div>
  );
}

/** The device's listening Services with provenance chips (§3.2D, M9 #66). */
function DeviceServicesSection({ device, graph }: { device: Device; graph: ProjectState }) {
  const provenance = useAppStore((s) => s.provenance);
  const services = graph.services.filter((s) => s.deviceId === device.id);
  if (services.length === 0) return null;
  return (
    <FieldSection title={`Services (${services.length})`} testId="inspector-device-services">
      <ul className="inspector-list">
        {services.map((service) => {
          const rows = provenance.filter(
            (r) =>
              r.entityType === 'service' && r.entityId === service.id && r.status === 'accepted',
          );
          const confidence = rows.length > 0 ? Math.max(...rows.map((r) => r.confidence)) : null;
          const port =
            service.portStart != null
              ? service.portEnd != null && service.portEnd !== service.portStart
                ? `${service.portStart}–${service.portEnd}`
                : `${service.portStart}`
              : '';
          return (
            <li key={service.id} className="inspector-list__row">
              <span className="inspector-list__primary">{service.name}</span>
              <span className="inspector-list__meta">
                {service.protocol}
                {port ? `/${port}` : ''}
              </span>
              {service.process && <span className="inspector-list__meta">{service.process}</span>}
              {confidence !== null && (
                <span
                  className="inspector-list__chip"
                  title={`Winning provenance confidence: ${Math.round(confidence * 100)}%`}
                >
                  {Math.round(confidence * 100)}%
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </FieldSection>
  );
}

/** Open findings affecting this device, linking into the Findings view (M9, #66). */
function DeviceFindingsSection({ device }: { device: Device }) {
  const project = useAppStore((s) => s.project);
  const findings = useAppStore((s) => s.findings);
  const refreshFindings = useAppStore((s) => s.refreshFindings);
  const focusFinding = useAppStore((s) => s.focusFinding);
  useEffect(() => {
    if (project && !findings) void refreshFindings();
  }, [project, findings, refreshFindings]);

  const mine = (findings?.findings ?? []).filter(
    (f) =>
      f.status === 'new' &&
      !f.stale &&
      f.detection?.affected?.kind === 'device' &&
      f.detection.affected.id === device.id,
  );
  if (mine.length === 0) return null;
  return (
    <FieldSection title={`Findings (${mine.length})`} testId="inspector-device-findings">
      <ul className="inspector-list">
        {mine.map((finding) => (
          <li key={finding.fingerprint} className="inspector-list__row">
            <button
              type="button"
              className="inspector-list__link"
              data-testid={`device-finding-${finding.fingerprint}`}
              title="Open in the Findings view"
              onClick={() => focusFinding(finding.fingerprint)}
            >
              <span className={`finding-badge severity--${finding.detection?.severity ?? 'info'}`}>
                {finding.detection?.severity ?? '—'}
              </span>
              <span className="inspector-list__primary">{finding.detection?.title}</span>
              <span className={`finding-status status--${finding.status}`}>{finding.status}</span>
            </button>
          </li>
        ))}
      </ul>
    </FieldSection>
  );
}

/** Identities and RoleAssignments scoped to this device (§3.2D, M9 #66). */
function DeviceUsersRolesSection({ device, graph }: { device: Device; graph: ProjectState }) {
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

function ConnectionsSection({ device, graph }: { device: Device; graph: ProjectState }) {
  const endpoints = endpointResolver(graph);
  const interfaceIds = new Set(
    graph.interfaces.filter((i) => i.deviceId === device.id).map((i) => i.id),
  );
  const describe = (interfaceId: Link['source']['id']) =>
    endpoints.label({ kind: 'interface', id: interfaceId });
  const links = graph.links.filter(
    (l) => interfaceIds.has(l.source.id) || interfaceIds.has(l.target.id),
  );
  const flowCount = graph.flows.filter(
    (f) =>
      endpoints.touchesDevice(f.source, device.id, 'direct') ||
      endpoints.touchesDevice(f.destination, device.id, 'direct'),
  ).length;
  if (links.length === 0 && flowCount === 0) return null;

  return (
    <FieldSection title={`Connections (${links.length})`} testId="inspector-device-connections">
      {links.map((link) => {
        const outbound = interfaceIds.has(link.source.id);
        const near = outbound ? link.source.id : link.target.id;
        const far = outbound ? link.target.id : link.source.id;
        return (
          <div key={link.id} className="inspector-connection">
            <span className="inspector-connection__kind">{link.kind}</span>
            <span className="inspector-connection__path">
              {describe(near)} <ArrowLeftRight size={12} className="inline-icon" aria-hidden />{' '}
              {describe(far)}
            </span>
          </div>
        );
      })}
      {flowCount > 0 && (
        <div className="inspector-connection">
          <span className="inspector-connection__kind">flows</span>
          <span className="inspector-connection__path">
            {flowCount} observed flow{flowCount === 1 ? '' : 's'}
          </span>
        </div>
      )}
    </FieldSection>
  );
}

/**
 * PolicyRules touching this Device (M6, gap G8): endpoints referencing the
 * device, one of its interfaces, or a network it is a member of. The switch
 * toggles logging — the concept's per-rule toggle, no schema change.
 */
function DeviceRulesSection({ device, graph }: { device: Device; graph: ProjectState }) {
  const dispatch = useAppStore((s) => s.dispatch);
  const projectId = graph.project.id;
  const endpoints = endpointResolver(graph);
  const touches = (endpoint: PolicyRule['source']) =>
    endpoints.touchesDevice(endpoint, device.id, 'membership');
  const rules = graph.policyRules.filter((r) => touches(r.source) || touches(r.destination));
  if (rules.length === 0) return null;

  const serviceById = new Map(graph.services.map((s) => [s.id, s]));
  return (
    <FieldSection title={`Rules (${rules.length})`} testId="inspector-device-rules">
      {rules.map((rule) => {
        const service = rule.serviceId ? serviceById.get(rule.serviceId) : undefined;
        return (
          <div key={rule.id} className="inspector-rule">
            <span className={`inspector-rule__action inspector-rule__action--${rule.action}`}>
              {rule.action}
            </span>
            <span className="inspector-rule__service">
              {service
                ? `${service.name}${service.portStart != null ? ` (${service.portStart}${service.portEnd != null && service.portEnd !== service.portStart ? `-${service.portEnd}` : ''})` : ''}`
                : 'All Other'}
            </span>
            <Toggle
              checked={rule.logging}
              label="Logging"
              onChange={() =>
                dispatch(
                  opSetField(
                    projectId,
                    'policyRule',
                    rule.id,
                    'logging',
                    !rule.logging,
                    rule.logging,
                  ),
                )
              }
            />
          </div>
        );
      })}
    </FieldSection>
  );
}

function InterfaceEditor({ iface, graph }: { iface: Interface; graph: ProjectState }) {
  const dispatch = useAppStore((s) => s.dispatch);
  const projectId = graph.project.id;
  const addresses = graph.addresses.filter((a) => a.interfaceId === iface.id);
  const [newAddress, setNewAddress] = useState('');
  const [newAddressKind, setNewAddressKind] = useState<Address['kind']>('ipv4');

  function removeInterface() {
    const ops = [
      ...addresses.map((address) =>
        opDeleteEntity(projectId, { entityType: 'address', entity: address }),
      ),
      opDeleteEntity(projectId, { entityType: 'interface', entity: iface }),
    ];
    dispatch(changeSet(projectId, `Remove interface ${iface.name}`, ops));
  }

  function addAddress() {
    const value = newAddress.trim();
    if (!value) return;
    const parsedKind = addressKindSchema.safeParse(newAddressKind);
    if (!parsedKind.success) return;
    dispatch(
      opCreateEntity(projectId, {
        entityType: 'address',
        entity: buildAddress(iface, parsedKind.data, value),
      }),
    );
    setNewAddress('');
  }

  const membershipColor = iface.networkId
    ? networkColorMap(graph.networks).get(iface.networkId)
    : undefined;

  return (
    <div className="interface-editor" data-testid={`interface-${iface.name}`}>
      <div className="interface-editor__summary">
        <span
          className="interface-editor__dot"
          style={{ background: membershipColor ?? 'var(--text-dim)' }}
          title={
            membershipColor
              ? (graph.networks.find((n) => n.id === iface.networkId)?.name ?? '')
              : 'No network membership'
          }
        />
        <span className="interface-editor__name">{iface.name}</span>
        {addresses[0] && <span className="interface-editor__ip">{addresses[0].value}</span>}
      </div>
      <div className="interface-editor__header">
        <TextField
          label="Interface"
          value={iface.name}
          testId={`interface-name-${iface.name}`}
          onCommit={(v) =>
            v.trim() &&
            dispatch(opSetField(projectId, 'interface', iface.id, 'name', v.trim(), iface.name))
          }
        />
        <button
          type="button"
          className="interface-editor__remove"
          title="Remove interface"
          aria-label="Remove interface"
          onClick={removeInterface}
        >
          <X size={12} aria-hidden />
        </button>
      </div>
      <SelectField
        label="Kind"
        value={iface.kind}
        options={interfaceKindSchema.options.map((value) => ({ value, label: value }))}
        onCommit={(v) =>
          dispatch(opSetField(projectId, 'interface', iface.id, 'kind', v, iface.kind))
        }
      />
      <SelectField
        label="Network"
        value={iface.networkId ?? ''}
        testId={`interface-network-${iface.name}`}
        options={[
          { value: '', label: '— none —' },
          ...graph.networks.map((n) => ({ value: n.id, label: n.name })),
        ]}
        onCommit={(v) => {
          const next = v ? networkIdSchema.parse(v) : null;
          dispatch(opSetMembership(projectId, iface.id, next, iface.networkId));
        }}
      />
      <ul className="address-list">
        {addresses.map((address) => (
          <li key={address.id} data-testid={`address-${address.value}`}>
            <span className="address-list__kind">{address.kind}</span>
            <span className="address-list__value">{address.value}</span>
            <button
              type="button"
              title="Remove address"
              aria-label="Remove address"
              onClick={() =>
                dispatch(opDeleteEntity(projectId, { entityType: 'address', entity: address }))
              }
            >
              <X size={12} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <div className="address-add">
        <select
          value={newAddressKind}
          data-testid={`address-kind-${iface.name}`}
          onChange={(e) => {
            const parsed = addressKindSchema.safeParse(e.target.value);
            if (parsed.success) setNewAddressKind(parsed.data);
          }}
        >
          {addressKindSchema.options.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
        <input
          value={newAddress}
          placeholder="10.0.0.1 / 00:11:22…"
          data-testid={`address-input-${iface.name}`}
          onChange={(e) => setNewAddress(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addAddress()}
        />
        <button type="button" data-testid={`address-add-${iface.name}`} onClick={addAddress}>
          Add
        </button>
      </div>
    </div>
  );
}
