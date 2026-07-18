import { useState } from 'react';
import { X } from 'lucide-react';
import {
  addressKindSchema,
  interfaceKindSchema,
  networkIdSchema,
  type Address,
  type Interface,
  type ProjectState,
} from '@netplan/domain';
import { networkTintsFor } from '../../canvas/derived';
import {
  buildAddress,
  changeSet,
  opCreateEntity,
  opDeleteEntity,
  opSetField,
  opSetMembership,
} from '../../state/ops';
import { useAppStore } from '../../state/store';
import { IconButton } from '../../ui';
import { SelectField, TextField } from '../fields';

export function InterfaceEditor({ iface, graph }: { iface: Interface; graph: ProjectState }) {
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
    ? networkTintsFor(graph.networks).get(iface.networkId)
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
        <IconButton
          icon={X}
          iconSize={12}
          bare
          className="interface-editor__remove"
          label="Remove interface"
          onClick={removeInterface}
        />
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
            <IconButton
              icon={X}
              iconSize={12}
              bare
              label="Remove address"
              onClick={() =>
                dispatch(opDeleteEntity(projectId, { entityType: 'address', entity: address }))
              }
            />
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
