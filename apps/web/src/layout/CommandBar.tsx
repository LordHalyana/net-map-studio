import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Download,
  FileJson,
  FileText,
  Image,
  Table,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { useAppStore } from '../state/store';
import { downloadCsv, downloadNetplanBundle, requestImageExport } from '../export/exports';
import { Menu, type MenuItem } from '../ui';
import { GlobalSearch } from './GlobalSearch';

/** "· just now" / "· N min ago" beside the save state (M6, #63). */
function savedAgo(lastSavedAt: number, now: number): string {
  const minutes = Math.floor((now - lastSavedAt) / 60_000);
  if (minutes < 1) return '· just now';
  if (minutes < 60) return `· ${minutes} min ago`;
  return `· ${Math.floor(minutes / 60)} h ago`;
}

/**
 * Project bar (visual-parity M5, gap G6): the concept's top strip — project
 * identity, save state, search and export. Canvas controls live in the
 * CanvasToolbar; the brand block lives in the library panel.
 */
export function CommandBar() {
  const project = useAppStore((s) => s.project);
  const syncError = useAppStore((s) => s.syncError);
  const pendingOps = useAppStore((s) => s.pendingOps);
  const lastSavedAt = useAppStore((s) => s.lastSavedAt);

  // tick so the relative timestamp stays honest
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="command-bar" data-testid="command-bar">
      <span className="command-bar__label">Project:</span>
      <span className="command-bar__project" data-testid="project-name">
        {project?.name ?? 'Loading…'}
      </span>
      <div
        className={`command-bar__status${!syncError && pendingOps === 0 ? ' command-bar__status--saved' : ''}`}
        data-testid="sync-status"
      >
        {syncError ? (
          <>
            <TriangleAlert size={12} className="inline-icon" aria-hidden /> {syncError}
          </>
        ) : pendingOps > 0 ? (
          'Saving…'
        ) : (
          <>
            <Check size={12} className="inline-icon" aria-hidden strokeWidth={3} />
            Saved
          </>
        )}
      </div>
      {!syncError && pendingOps === 0 && lastSavedAt !== null && (
        <span className="command-bar__saved-ago" data-testid="saved-ago">
          {savedAgo(lastSavedAt, now)}
        </span>
      )}
      <GlobalSearch />
      <ExportMenu />
      <div className="command-bar__avatar" title="Operator (single-operator, ADR-0001)">
        OP
      </div>
    </header>
  );
}

function ExportMenu() {
  const project = useAppStore((s) => s.project);
  const importBundle = useAppStore((s) => s.importBundle);
  const pushToast = useAppStore((s) => s.pushToast);
  const fileInput = useRef<HTMLInputElement>(null);

  if (!project) return null;

  const run = (action: () => Promise<void> | void) => () => {
    void Promise.resolve()
      .then(action)
      .catch((error: unknown) => {
        pushToast(error instanceof Error ? error.message : 'Export failed');
      });
  };

  async function onImportFile(file: File | undefined) {
    if (!file) return;
    try {
      await importBundle(await file.text());
      pushToast('Project bundle imported.', 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Import failed');
    }
  }

  const items: MenuItem[] = [
    {
      label: 'Project bundle (.netplan)',
      icon: FileJson,
      'data-testid': 'export-netplan',
      onSelect: run(() => downloadNetplanBundle(project.id, project.name)),
    },
    'separator',
    {
      label: 'Topology image (PNG)',
      icon: Image,
      'data-testid': 'export-png',
      onSelect: run(() => requestImageExport('png')),
    },
    {
      label: 'Topology image (SVG)',
      icon: Image,
      'data-testid': 'export-svg',
      onSelect: run(() => requestImageExport('svg')),
    },
    'separator',
    {
      label: 'Devices (CSV)',
      icon: Table,
      'data-testid': 'export-csv-devices',
      onSelect: run(() => downloadCsv(project.id, 'devices')),
    },
    {
      label: 'Rules (CSV)',
      icon: Table,
      'data-testid': 'export-csv-rules',
      onSelect: run(() => downloadCsv(project.id, 'policyRules')),
    },
    {
      label: 'Findings (CSV)',
      icon: Table,
      'data-testid': 'export-csv-findings',
      onSelect: run(() => {
        window.open(`/api/projects/${project.id}/export/csv/findings`, '_blank');
      }),
    },
    'separator',
    {
      label: 'Design report (HTML)',
      icon: FileText,
      'data-testid': 'export-report',
      onSelect: run(() => {
        window.open(`/api/projects/${project.id}/report`, '_blank');
      }),
    },
    {
      label: 'Security findings report (HTML)',
      icon: FileText,
      'data-testid': 'export-findings-report',
      onSelect: run(() => {
        window.open(`/api/projects/${project.id}/report/findings`, '_blank');
      }),
    },
    {
      label: 'Security findings — client-safe (HTML)',
      icon: FileText,
      'data-testid': 'export-findings-report-safe',
      onSelect: run(() => {
        window.open(`/api/projects/${project.id}/report/findings?redact=client-safe`, '_blank');
      }),
    },
    'separator',
    {
      label: 'Import bundle…',
      icon: Upload,
      'data-testid': 'import-netplan',
      onSelect: () => fileInput.current?.click(),
    },
  ];

  return (
    <div className="export-menu">
      <Menu
        triggerLabel={
          <>
            <Download size={14} className="inline-icon" aria-hidden /> Export / Import
          </>
        }
        triggerTestId="export-menu-toggle"
        items={items}
        listTestId="export-menu"
      />
      <input
        ref={fileInput}
        type="file"
        accept=".netplan,application/json"
        className="export-menu__file"
        data-testid="import-file-input"
        onChange={(e) => {
          void onImportFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
