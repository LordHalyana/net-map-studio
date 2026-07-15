import { useEffect, useState } from 'react';
import { AppShell } from './layout/AppShell';
import { useAppStore } from './state/store';

export function App() {
  const bootstrap = useAppStore((s) => s.bootstrap);
  const graph = useAppStore((s) => s.graph);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    bootstrap().catch((error: unknown) => {
      setBootError(error instanceof Error ? error.message : 'Failed to load');
    });
  }, [bootstrap]);

  if (bootError) {
    return (
      <main className="boot-error">
        <h1>NetPlan Studio</h1>
        <p>Could not reach the NetPlan server: {bootError}</p>
      </main>
    );
  }

  if (!graph) {
    return (
      <main className="boot-loading">
        <h1>NetPlan Studio</h1>
        <p>Loading project…</p>
      </main>
    );
  }

  return <AppShell />;
}
