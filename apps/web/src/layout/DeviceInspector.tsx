import { useRef, type ChangeEvent } from 'react';
import { ImagePlus, X } from 'lucide-react';
import {
  criticalitySchema,
  deviceTypeSchema,
  zoneIdSchema,
  type Device,
  type ProjectState,
} from '@netplan/domain';
import { useAppStore } from '../state/store';
import {
  buildInterface,
  changeSet,
  opCreateEntity,
  opRestoreAbsolutePosition,
  opSetContainment,
  opSetField,
} from '../state/ops';
import { Button, IconButton, Toggle } from '../ui';
import { FieldSection, SelectField, TextAreaField, TextField } from './fields';
import { ProvenanceSection } from './ProvenanceSection';
import {
  ConnectionsSection,
  DeviceFindingsSection,
  DeviceHeader,
  DeviceRulesSection,
  DeviceServicesSection,
  DeviceUsersRolesSection,
  InterfaceEditor,
  OsConfidenceHint,
} from './inspector';

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
      ops.push(opRestoreAbsolutePosition(projectId, device, graph));
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

  return (
    <div data-testid="inspector-device">
      <DeviceHeader device={device} graph={graph} setField={setField} />

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
