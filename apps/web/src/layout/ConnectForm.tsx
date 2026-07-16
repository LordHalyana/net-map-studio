import { useState } from 'react';
import { interfaceIdSchema, linkKindSchema, type Link, type ProjectState } from '@netplan/domain';
import { useAppStore } from '../state/store';
import { buildInterface, buildLink, opCreateEntity, opCreateLink } from '../state/ops';

function InterfacePicker({
  side,
  deviceId,
  interfaceId,
  graph,
}: {
  side: 'source' | 'target';
  deviceId: string | null;
  interfaceId: string | null;
  graph: ProjectState;
}) {
  const setConnectInterface = useAppStore((s) => s.setConnectInterface);
  const dispatch = useAppStore((s) => s.dispatch);

  const device = graph.devices.find((d) => d.id === deviceId);
  if (!device) {
    return (
      <div className="connect-form__side">
        <span className="field__label">{side === 'source' ? 'Source' : 'Destination'}</span>
        <span className="panel-empty" data-testid={`connect-${side}-empty`}>
          Click a device on the canvas…
        </span>
      </div>
    );
  }

  const interfaces = graph.interfaces.filter((i) => i.deviceId === device.id);

  function addInterface() {
    if (!device) return;
    const names = new Set(interfaces.map((i) => i.name));
    let index = interfaces.length;
    let name: string;
    do {
      name = `eth${index}`;
      index += 1;
    } while (names.has(name));
    const iface = buildInterface(device, name);
    dispatch(opCreateEntity(device.projectId, { entityType: 'interface', entity: iface }));
    setConnectInterface(side, iface.id);
  }

  return (
    <div className="connect-form__side">
      <span className="field__label">
        {side === 'source' ? 'Source' : 'Destination'}: <strong>{device.name}</strong>
      </span>
      {interfaces.length > 0 ? (
        <select
          value={interfaceId ?? ''}
          data-testid={`connect-${side}-interface`}
          onChange={(e) => setConnectInterface(side, e.target.value || null)}
        >
          <option value="">— pick interface —</option>
          {interfaces.map((iface) => (
            <option key={iface.id} value={iface.id}>
              {iface.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="panel-empty">No interfaces yet.</span>
      )}
      <button type="button" data-testid={`connect-${side}-add-interface`} onClick={addInterface}>
        + interface
      </button>
    </div>
  );
}

/** The compact connection form of connect mode (design §3.3). */
export function ConnectForm() {
  const graph = useAppStore((s) => s.graph);
  const draft = useAppStore((s) => s.connectDraft);
  const dispatch = useAppStore((s) => s.dispatch);
  const resetConnectDraft = useAppStore((s) => s.resetConnectDraft);
  const [kind, setKind] = useState<Link['kind']>('cable');
  const [label, setLabel] = useState('');

  if (!graph) return null;

  const canCreate = Boolean(draft.sourceInterfaceId && draft.targetInterfaceId);

  function createLink() {
    if (!graph || !draft.sourceInterfaceId || !draft.targetInterfaceId) return;
    const link = buildLink(
      graph.project.id,
      interfaceIdSchema.parse(draft.sourceInterfaceId),
      interfaceIdSchema.parse(draft.targetInterfaceId),
      kind,
      label.trim(),
    );
    dispatch(opCreateLink(graph.project.id, link));
    setLabel('');
    resetConnectDraft();
  }

  return (
    <div className="connect-form" data-testid="connect-form">
      <p className="connect-form__hint">
        Connect mode: click a source device, then a destination device. Links terminate on
        Interfaces (ADR-0012).
      </p>
      <div className="connect-form__row">
        <InterfacePicker
          side="source"
          deviceId={draft.sourceDeviceId}
          interfaceId={draft.sourceInterfaceId}
          graph={graph}
        />
        <InterfacePicker
          side="target"
          deviceId={draft.targetDeviceId}
          interfaceId={draft.targetInterfaceId}
          graph={graph}
        />
        <label className="connect-form__field">
          <span className="field__label">Kind</span>
          <select
            value={kind}
            data-testid="connect-kind"
            onChange={(e) => {
              const parsed = linkKindSchema.safeParse(e.target.value);
              if (parsed.success) setKind(parsed.data);
            }}
          >
            {linkKindSchema.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="connect-form__field">
          <span className="field__label">Label</span>
          <input
            value={label}
            data-testid="connect-label"
            placeholder="uplink…"
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <button
          type="button"
          data-testid="connect-create"
          disabled={!canCreate}
          onClick={createLink}
        >
          Create link
        </button>
        <button type="button" data-testid="connect-reset" onClick={resetConnectDraft}>
          Reset
        </button>
      </div>
    </div>
  );
}
