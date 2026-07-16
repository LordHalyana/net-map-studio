import { useState } from 'react';
import { CommandBar } from './CommandBar';
import { LibraryPanel } from './LibraryPanel';
import { InspectorPanel } from './InspectorPanel';
import { ContextPanel } from './ContextPanel';
import { ImportsPanel } from './ImportsPanel';
import { UsersRolesPanel } from './UsersRolesPanel';
import { FindingsPanel } from './FindingsPanel';
import { EgressPanel } from './EgressPanel';
import { OverviewPanel } from './OverviewPanel';
import { NetworksPanel } from './NetworksPanel';
import { RulesPanel } from './RulesPanel';
import { ShortcutHelp } from './ShortcutHelp';
import { Toasts } from './Toasts';
import { useGlobalShortcuts } from './useGlobalShortcuts';
import { Canvas } from '../canvas/Canvas';
import { useAppStore } from '../state/store';

/** The five coordinated regions of the workspace (design §3.2). */
export function AppShell() {
  const view = useAppStore((s) => s.view);
  const [helpOpen, setHelpOpen] = useState(false);
  useGlobalShortcuts(helpOpen, setHelpOpen);
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
      ) : view === 'overview' ? (
        <OverviewPanel />
      ) : view === 'networks' ? (
        <NetworksPanel />
      ) : view === 'rules' ? (
        <section className="rules-page" data-testid="rules-page">
          <RulesPanel page />
        </section>
      ) : (
        <Canvas />
      )}
      <InspectorPanel />
      <ContextPanel />
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      <Toasts />
    </div>
  );
}
