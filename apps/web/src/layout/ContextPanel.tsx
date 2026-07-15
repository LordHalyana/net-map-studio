import { useAppStore } from '../state/store';
import { ConnectForm } from './ConnectForm';
import { LinkDetails } from './LinkDetails';
import { RulesPanel } from './RulesPanel';
import { ActivityLog } from './ActivityLog';
import { ConflictList } from './ConflictList';
import { DiffPanel } from './DiffPanel';

export function ContextPanel() {
  const connectMode = useAppStore((s) => s.connectMode);
  const selection = useAppStore((s) => s.selection);
  const graph = useAppStore((s) => s.graph);
  const tab = useAppStore((s) => s.contextTab);
  const setTab = useAppStore((s) => s.setContextTab);
  const selectedImport = useAppStore((s) => s.selectedImport);
  const conflictCount =
    selectedImport?.proposal?.conflicts.filter((c) => c.resolution === 'pending').length ?? 0;

  let detailsTitle = 'Details';
  let details = <p className="panel-empty">Select a connection or rule to edit it here.</p>;
  if (connectMode) {
    detailsTitle = 'Connect';
    details = <ConnectForm />;
  } else if (graph && selection?.entityType === 'link') {
    detailsTitle = 'Link info';
    details = <LinkDetails linkIds={selection.ids} graph={graph} />;
  }

  const tabs = [
    ['details', detailsTitle],
    ['rules', 'Rules'],
    ['activity', 'Activity'],
    ['conflicts', conflictCount > 0 ? `Conflicts (${conflictCount})` : 'Conflicts'],
    ['diff', 'Diff'],
  ] as const;

  return (
    <section className="context-panel" data-testid="context-panel">
      <div className="context-panel__tabs">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key && !connectMode ? 'toggle--on' : ''}
            data-testid={`context-tab-${key}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {connectMode || tab === 'details' ? (
        details
      ) : tab === 'rules' ? (
        <RulesPanel />
      ) : tab === 'activity' ? (
        <ActivityLog />
      ) : tab === 'conflicts' ? (
        <ConflictList />
      ) : (
        <DiffPanel />
      )}
    </section>
  );
}
