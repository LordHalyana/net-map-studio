import { linkKindSchema, type Link, type ProjectState } from '@netplan/domain';
import { useAppStore } from '../state/store';
import { opDeleteLink, opSetField } from '../state/ops';
import { SelectField, TextField } from './fields';

function endpointLabel(graph: ProjectState, link: Link, which: 'source' | 'target'): string {
  const endpoint = which === 'source' ? link.source : link.target;
  const iface = graph.interfaces.find((i) => i.id === endpoint.id);
  const device = iface ? graph.devices.find((d) => d.id === iface.deviceId) : undefined;
  return `${device?.name ?? '?'} · ${iface?.name ?? '?'}`;
}

/** LINK INFO view of the context panel; a bundle expands into its records (§3.3). */
export function LinkDetails({ linkIds, graph }: { linkIds: string[]; graph: ProjectState }) {
  const dispatch = useAppStore((s) => s.dispatch);
  const links = graph.links.filter((l) => linkIds.includes(l.id));
  if (links.length === 0) return null;
  const projectId = graph.project.id;

  return (
    <div data-testid="link-details">
      {links.length > 1 && (
        <p data-testid="link-bundle-summary">
          Bundled edge — {links.length} links between this device pair:
        </p>
      )}
      <ul className="link-list">
        {links.map((link) => (
          <li key={link.id} className="link-list__item" data-testid={`link-item-${link.id}`}>
            <span className="link-list__endpoints">
              {endpointLabel(graph, link, 'source')} ⟷ {endpointLabel(graph, link, 'target')}
            </span>
            <SelectField
              label="Kind"
              value={link.kind}
              options={linkKindSchema.options.map((value) => ({ value, label: value }))}
              onCommit={(v) =>
                dispatch(opSetField(projectId, 'link', link.id, 'kind', v, link.kind))
              }
            />
            <TextField
              label="Label"
              value={link.label}
              onCommit={(v) =>
                dispatch(opSetField(projectId, 'link', link.id, 'label', v, link.label))
              }
            />
            <button
              type="button"
              title="Delete link"
              data-testid={`link-delete-${link.id}`}
              onClick={() => dispatch(opDeleteLink(projectId, link))}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
