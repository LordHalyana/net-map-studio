import { useAppStore } from '../state/store';
import { ConnectForm } from './ConnectForm';
import { LinkDetails } from './LinkDetails';
import { RulesPanel } from './RulesPanel';
import { ActivityLog } from './ActivityLog';

export function ContextPanel() {
  const connectMode = useAppStore((s) => s.connectMode);
  const selection = useAppStore((s) => s.selection);
  const graph = useAppStore((s) => s.graph);
  const tab = useAppStore((s) => s.contextTab);
  const setTab = useAppStore((s) => s.setContextTab);

  let detailsTitle = 'Details';
  let details = <p className="panel-empty">Select a connection or rule to edit it here.</p>;
  if (connectMode) {
    detailsTitle = 'Connect';
    details = <ConnectForm />;
  } else if (graph && selection?.entityType === 'link') {
    detailsTitle = 'Link info';
    details = <LinkDetails linkIds={selection.ids} graph={graph} />;
  }

  return (
    <section className="context-panel" data-testid="context-panel">
      <div className="context-panel__tabs">
        <button
          type="button"
          className={tab === 'details' ? 'toggle--on' : ''}
          data-testid="context-tab-details"
          onClick={() => setTab('details')}
        >
          {detailsTitle}
        </button>
        <button
          type="button"
          className={tab === 'rules' ? 'toggle--on' : ''}
          data-testid="context-tab-rules"
          onClick={() => setTab('rules')}
        >
          Rules
        </button>
        <button
          type="button"
          className={tab === 'activity' ? 'toggle--on' : ''}
          data-testid="context-tab-activity"
          onClick={() => setTab('activity')}
        >
          Activity
        </button>
      </div>
      {connectMode || tab === 'details' ? (
        details
      ) : tab === 'rules' ? (
        <RulesPanel />
      ) : (
        <ActivityLog />
      )}
    </section>
  );
}
