import { CommandBar } from './CommandBar';
import { LibraryPanel } from './LibraryPanel';
import { InspectorPanel } from './InspectorPanel';
import { ContextPanel } from './ContextPanel';
import { ImportsPanel } from './ImportsPanel';
import { UsersRolesPanel } from './UsersRolesPanel';
import { FindingsPanel } from './FindingsPanel';
import { EgressPanel } from './EgressPanel';
import { Canvas } from '../canvas/Canvas';
import { useAppStore } from '../state/store';

/** The five coordinated regions of the workspace (design §3.2). */
export function AppShell() {
  const view = useAppStore((s) => s.view);
  return (
    <div className="app-shell" data-testid="app-shell">
      <CommandBar />
      <LibraryPanel />
      {view === 'imports' ? (
        <ImportsPanel />
      ) : view === 'identities' ? (
        <UsersRolesPanel />
      ) : view === 'findings' ? (
        <FindingsPanel />
      ) : view === 'egress' ? (
        <EgressPanel />
      ) : (
        <Canvas />
      )}
      <InspectorPanel />
      <ContextPanel />
    </div>
  );
}
