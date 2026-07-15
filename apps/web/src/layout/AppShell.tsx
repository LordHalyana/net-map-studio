import { CommandBar } from './CommandBar';
import { LibraryPanel } from './LibraryPanel';
import { InspectorPanel } from './InspectorPanel';
import { ContextPanel } from './ContextPanel';
import { Canvas } from '../canvas/Canvas';

/** The five coordinated regions of the workspace (design §3.2). */
export function AppShell() {
  return (
    <div className="app-shell" data-testid="app-shell">
      <CommandBar />
      <LibraryPanel />
      <Canvas />
      <InspectorPanel />
      <ContextPanel />
    </div>
  );
}
