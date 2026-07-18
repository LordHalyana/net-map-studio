import { useEffect } from 'react';
import type { Device } from '@netplan/domain';
import { useAppStore } from '../../state/store';
import { FieldSection } from '../fields';

/** Open findings affecting this device, linking into the Findings view (M9, #66). */
export function DeviceFindingsSection({ device }: { device: Device }) {
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
