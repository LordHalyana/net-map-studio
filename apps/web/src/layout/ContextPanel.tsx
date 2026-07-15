import { useAppStore } from '../state/store';
import { ConnectForm } from './ConnectForm';
import { LinkDetails } from './LinkDetails';

export function ContextPanel() {
  const connectMode = useAppStore((s) => s.connectMode);
  const selection = useAppStore((s) => s.selection);
  const graph = useAppStore((s) => s.graph);

  let content = <p className="panel-empty">Select a connection or rule to edit it here.</p>;
  let title = 'Details';

  if (connectMode) {
    title = 'Connect';
    content = <ConnectForm />;
  } else if (graph && selection?.entityType === 'link') {
    title = 'Link info';
    content = <LinkDetails linkIds={selection.ids} graph={graph} />;
  }

  return (
    <section className="context-panel" data-testid="context-panel">
      <h2 className="panel-title">{title}</h2>
      {content}
    </section>
  );
}
