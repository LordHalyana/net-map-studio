import { ArrowLeftRight } from 'lucide-react';
import type { Device, Link, ProjectState } from '@netplan/domain';
import { resolverFor } from '../../canvas/derived';
import { FieldSection } from '../fields';

/**
 * The device's connections (M6, gap G8): its Links with the peer they reach,
 * plus its observed-Flow count. Rendered as an inspector section rather than
 * the concept's Connections tab — three short sections don't earn tab chrome.
 */
export function ConnectionsSection({ device, graph }: { device: Device; graph: ProjectState }) {
  const endpoints = resolverFor(graph);
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
