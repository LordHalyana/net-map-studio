import { describe, expect, it } from 'vitest';
import type { DeviceStateHost } from '@netplan/import-contract';
import { newId, deviceIdSchema, evidenceIdSchema } from '@netplan/domain';
import { hostInventoryFromReport } from '../src/findings/host-inventory.js';

function host(overrides: Partial<DeviceStateHost>): DeviceStateHost {
  return {
    deviceId: 'machine-guid-1',
    hostname: 'ws-01',
    os: { name: 'Windows 11' },
    collectedAt: '2026-07-15T00:00:00.000Z',
    interfaces: [],
    routes: [],
    arp: [],
    connections: [],
    listeningPorts: [],
    localUsers: [],
    localGroups: [],
    administrators: [],
    sudoers: [],
    collection: { scope: [], errors: [] },
    ...overrides,
  };
}

describe('hostInventoryFromReport (M5/M6 input, ADR-0018)', () => {
  it('maps files, processes, persistence sources and software', () => {
    const deviceId = newId(deviceIdSchema);
    const evidenceId = newId(evidenceIdSchema);
    const inv = hostInventoryFromReport(
      host({
        fileInventory: [{ path: 'C:\\a.exe', sha256: 'a'.repeat(64) }],
        processes: [{ name: 'p.exe', path: 'C:\\p.exe' }],
        startupEntries: [{ name: 'Run', command: 'c:\\run.exe' }],
        scheduledTasks: [{ name: 'Task', path: 'c:\\task.exe' }],
        services: [{ name: 'Svc', binaryPath: 'c:\\svc.exe' }],
        packages: [{ name: 'Excel' }],
        remoteAccess: [{ name: 'AnyDesk' }],
      }),
      deviceId,
      evidenceId,
    );

    expect(inv.deviceId).toBe(deviceId);
    expect(inv.evidenceId).toBe(evidenceId);
    expect(inv.files).toHaveLength(1);
    expect(inv.processes[0]?.name).toBe('p.exe');
    expect(inv.persistence.map((p) => p.kind)).toEqual(['startup', 'scheduledTask', 'service']);
    expect(inv.software.find((s) => s.name === 'AnyDesk')?.remoteAccess).toBe(true);
    expect(inv.software.find((s) => s.name === 'Excel')?.remoteAccess).toBe(false);
  });

  it('records collected classes so a missing class is distinguishable from an empty one', () => {
    const inv = hostInventoryFromReport(
      host({ processes: [], fileInventory: undefined }),
      newId(deviceIdSchema),
      null,
    );
    // processes present-but-empty → collected; fileInventory absent → not collected.
    expect(inv.collectedClasses).toContain('processes');
    expect(inv.collectedClasses).not.toContain('fileInventory');
  });
});
