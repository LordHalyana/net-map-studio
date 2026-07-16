import { useAppStore } from '../state/store';
import { Tabs } from '../ui';
import { ConnectForm } from './ConnectForm';
import { FlowDetails } from './FlowDetails';
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
  } else if (graph && selection?.entityType === 'flow') {
    detailsTitle = 'Flow details';
    details = <FlowDetails flowIds={selection.ids} graph={graph} />;
  }

  const tabs = [
    { id: 'details', label: detailsTitle },
    { id: 'rules', label: 'Rules' },
    { id: 'activity', label: 'Activity' },
    { id: 'conflicts', label: conflictCount > 0 ? `Conflicts (${conflictCount})` : 'Conflicts' },
    { id: 'diff', label: 'Diff' },
  ];

  return (
    <section className="context-panel" data-testid="context-panel">
      <Tabs
        className="context-panel__tabs"
        tabs={tabs}
        active={connectMode ? null : tab}
        onSelect={(id) => setTab(id as typeof tab)}
        testIdPrefix="context-tab-"
      />
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
