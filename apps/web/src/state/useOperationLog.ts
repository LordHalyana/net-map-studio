import { useEffect } from 'react';
import type { OperationLogEntry } from '@netplan/domain';
import { useAppStore } from './store';

export interface OperationLogView {
  entries: OperationLogEntry[];
  loading: boolean;
  /** Set when the last fetch failed — panels render a message, never blank. */
  error: string | null;
}

/**
 * The one operation-log read (#110 D2): every consuming panel mounts this
 * hook, and the store fetches the log once per graph version no matter how
 * many panels are open. Errors surface as a toast (store-side, once per
 * failed fetch) plus the `error` field for an in-panel fallback.
 */
export function useOperationLog(): OperationLogView {
  const project = useAppStore((s) => s.project);
  const graph = useAppStore((s) => s.graph);
  const refresh = useAppStore((s) => s.refreshOperationLog);
  const entries = useAppStore((s) => s.operationLog);
  const loading = useAppStore((s) => s.operationLogLoading);
  const error = useAppStore((s) => s.operationLogError);

  useEffect(() => {
    if (project) void refresh();
  }, [project, graph, refresh]);

  return { entries, loading, error };
}
