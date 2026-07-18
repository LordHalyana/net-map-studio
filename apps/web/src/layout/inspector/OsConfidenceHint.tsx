import { useAppStore } from '../../state/store';

/** §3.2D "operating system and confidence level" (M9, #66). */
export function OsConfidenceHint({ deviceId }: { deviceId: string }) {
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
