import type { Device, ProjectState } from '@netplan/domain';
import { useAppStore } from '../../state/store';
import { FieldSection } from '../fields';

/** The device's listening Services with provenance chips (§3.2D, M9 #66). */
export function DeviceServicesSection({ device, graph }: { device: Device; graph: ProjectState }) {
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
