import { useState, type ChangeEvent } from 'react';
import {
  addressKindSchema,
  criticalitySchema,
  deviceTypeSchema,
  interfaceKindSchema,
  networkIdSchema,
  type Address,
  type Device,
  type Interface,
  type ProjectState,
} from '@netplan/domain';
import { useAppStore } from '../state/store';
import {
  buildAddress,
  buildInterface,
  changeSet,
  deleteDevicesChangeSet,
  duplicateDevicesChangeSet,
  opCreateEntity,
  opDeleteEntity,
  opSetField,
  opSetMembership,
} from '../state/ops';
import { FieldSection, SelectField, TextAreaField, TextField } from './fields';

function enumOptions(values: readonly string[]) {
  return values.map((value) => ({ value, label: value }));
}

export function DeviceInspector({ device, graph }: { device: Device; graph: ProjectState }) {
  const dispatch = useAppStore((s) => s.dispatch);
  const projectId = graph.project.id;

  const setField = (field: string, value: unknown, previousValue: unknown) =>
    dispatch(opSetField(projectId, 'device', device.id, field, value, previousValue));

  const interfaces = graph.interfaces.filter((i) => i.deviceId === device.id);
  const structuredTypeMissing = device.deviceType === 'custom' && !device.customTypeLabel.trim();

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
      <div className="inspector-actions">
        <button
          type="button"
          data-testid="duplicate-device"
          onClick={() => {
            const cs = duplicateDevicesChangeSet(graph, [device.id]);
            if (cs) dispatch(cs);
          }}
        >
          Duplicate
        </button>
        <button
          type="button"
          data-testid="delete-device"
          onClick={() => {
            const cs = deleteDevicesChangeSet(graph, [device.id]);
            if (cs) dispatch(cs);
          }}
        >
          Delete
        </button>
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
        <label className="field">
          <span className="field__label">Icon</span>
          <input
            type="file"
            accept="image/png,image/svg+xml,image/jpeg"
            data-testid="device-icon-upload"
            disabled={structuredTypeMissing}
            title={
              structuredTypeMissing
                ? 'Assign a structured type label before uploading a custom icon'
                : 'Upload a custom icon'
            }
            onChange={onIconUpload}
          />
        </label>
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
      </FieldSection>

      <FieldSection title="Interfaces" testId="inspector-interfaces">
        {interfaces.map((iface) => (
          <InterfaceEditor key={iface.id} iface={iface} graph={graph} />
        ))}
        <button type="button" data-testid="add-interface" onClick={addInterface}>
          + Add interface
        </button>
      </FieldSection>

      <FieldSection title="Tags & notes">
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

  return (
    <div className="interface-editor" data-testid={`interface-${iface.name}`}>
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
          onClick={removeInterface}
        >
          ✕
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
              onClick={() =>
                dispatch(opDeleteEntity(projectId, { entityType: 'address', entity: address }))
              }
            >
              ✕
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
