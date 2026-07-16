import { test, expect, type Page } from '@playwright/test';
import { flowIdSchema, identityIdSchema, newId, operationIdSchema } from '@netplan/domain';

/**
 * Improvements M3 (#60): flow & rule interactivity — flow edges are
 * inspectable, rule callouts land on the focused rule, global search covers
 * identities and findings, Link Info lists governing rules.
 */

const DEVICE_STATE_REPORT = JSON.stringify({
  schemaVersion: '1.0.0',
  hosts: [
    {
      deviceId: 'guid-ws-m3-01',
      hostname: 'ws-m3-01',
      os: { name: 'Windows 11' },
      collectedAt: '2026-07-15T00:00:00.000Z',
      interfaces: [{ name: 'eth0', addresses: [{ value: '10.9.3.10', kind: 'ipv4' }] }],
      routes: [],
      arp: [],
      connections: [],
      listeningPorts: [{ protocol: 'tcp', port: 3389, process: 'TermService' }],
      localUsers: [{ name: 'mallory' }],
      localGroups: [],
      administrators: [],
      sudoers: [],
      collection: { scope: ['interfaces', 'listeningPorts'], errors: [] },
      remoteAccess: [{ name: 'AnyDesk' }],
      fileInventory: [],
    },
  ],
});

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

async function waitSaved(page: Page) {
  await expect(page.getByTestId('sync-status')).toHaveText('Saved');
}

async function fitCanvas(page: Page) {
  await page.locator('.react-flow__controls-fitview').click();
}

async function project(page: Page) {
  const [p] = await (await page.request.get('/api/projects')).json();
  return p as { id: string };
}

async function graphOf(page: Page, projectId: string) {
  return (await (await page.request.get(`/api/projects/${projectId}/graph`)).json()) as {
    devices: { id: string; name: string; position: { x: number; y: number } }[];
    policyRules: { id: string }[];
  };
}

async function postOp(page: Page, projectId: string, op: Record<string, unknown>) {
  const res = await page.request.post(`/api/projects/${projectId}/operations`, {
    data: { id: newId(operationIdSchema), projectId, ...op },
  });
  if (!res.ok()) throw new Error(`operation failed: ${res.status()} ${await res.text()}`);
}

async function addDeviceViaLibrary(page: Page, deviceType: string): Promise<string> {
  const nodes = page.locator('.react-flow__node');
  const before = await nodes.count();
  const namesBefore = await page.locator('.device-node__name').allTextContents();
  await page.getByTestId(`library-item-${deviceType}`).click();
  await expect(nodes).toHaveCount(before + 1);
  let added: string[] = [];
  await expect
    .poll(async () => {
      const namesNow = await page.locator('.device-node__name').allTextContents();
      added = namesNow.filter((n) => n && !namesBefore.includes(n));
      return added.length;
    })
    .toBe(1);
  await waitSaved(page);
  const name = added[0];
  if (!name) throw new Error('no new device name found');
  return name;
}

async function moveDeviceViaApi(page: Page, deviceName: string, x: number, y: number) {
  const p = await project(page);
  const graph = await graphOf(page, p.id);
  const device = graph.devices.find((d) => d.name === deviceName);
  if (!device) throw new Error(`device ${deviceName} not found`);
  await postOp(page, p.id, {
    kind: 'SetField',
    entityType: 'device',
    entityId: device.id,
    field: 'position',
    value: { x, y },
    previousValue: device.position,
  });
}

test.describe('Flow & rule interactivity (improvements M3, #60)', () => {
  test('clicking a flow edge opens read-only Flow details with provenance', async ({ page }) => {
    await openApp(page);
    const a = await addDeviceViaLibrary(page, 'server');
    const b = await addDeviceViaLibrary(page, 'workstation');

    const p = await project(page);
    const graph = await graphOf(page, p.id);
    const deviceA = graph.devices.find((d) => d.name === a);
    const deviceB = graph.devices.find((d) => d.name === b);
    if (!deviceA || !deviceB) throw new Error('devices not found');

    await postOp(page, p.id, {
      kind: 'CreateEntity',
      payload: {
        entityType: 'flow',
        entity: {
          id: newId(flowIdSchema),
          projectId: p.id,
          source: { kind: 'device', id: deviceB.id },
          destination: { kind: 'device', id: deviceA.id },
          protocol: 'tcp',
          port: 443,
          firstSeen: '2026-07-01T08:00:00.000Z',
          lastSeen: '2026-07-15T17:30:00.000Z',
          observationCount: 12,
          confidence: 0.6,
          lifecycleState: 'observed',
        },
      },
    });

    // isolate the pair so the edge midpoint is clickable
    await moveDeviceViaApi(page, a, -700, 1500);
    await moveDeviceViaApi(page, b, 700, 1500);
    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await fitCanvas(page);

    const boxA = await page.getByTestId(`device-node-${a}`).boundingBox();
    const boxB = await page.getByTestId(`device-node-${b}`).boundingBox();
    if (!boxA || !boxB) throw new Error('device nodes not visible');
    await page.mouse.click(
      (boxA.x + boxA.width / 2 + boxB.x + boxB.width / 2) / 2,
      (boxA.y + boxA.height / 2 + boxB.y + boxB.height / 2) / 2,
    );

    await expect(page.getByTestId('flow-details')).toBeVisible();
    await expect(page.getByTestId('flow-service')).toContainText('TCP/443');
    await expect(page.getByTestId('flow-count')).toContainText('×12');
    await expect(page.getByTestId('flow-confidence')).toContainText('60%');
    await expect(page.getByTestId('flow-endpoints')).toContainText(`${b} → ${a}`);
  });

  test('clicking a rule callout lands on the focused rule in the Rules tab', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('add-network').click();
    await waitSaved(page);
    await page.getByTestId('add-network').click();
    await waitSaved(page);

    await page.getByTestId('context-tab-rules').click();
    const sources = page.getByTestId('rule-source-select');
    await sources.selectOption({ index: 1 });
    await page.getByTestId('rule-destination-select').selectOption({ index: 2 });
    await page.getByTestId('rule-create').click();
    await waitSaved(page);

    // leave the Rules tab so the click has to bring us back
    await page.getByTestId('context-tab-activity').click();
    await fitCanvas(page);

    await page.getByTestId('policy-rule-callout').first().click();
    await expect(page.getByTestId('context-tab-rules')).toHaveClass(/toggle--on/);
    await expect(page.locator('.rule-row--focused')).toHaveCount(1);
  });

  test('global search finds an identity by name', async ({ page }) => {
    await openApp(page);
    const p = await project(page);
    await postOp(page, p.id, {
      kind: 'CreateEntity',
      payload: {
        entityType: 'identity',
        entity: {
          id: newId(identityIdSchema),
          projectId: p.id,
          scope: 'local',
          name: 'svc-backup-m3',
          lifecycleState: 'observed',
        },
      },
    });
    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();

    await page.getByTestId('global-search-input').fill('svc-backup-m3');
    const hit = page.getByTestId('search-result-svc-backup-m3');
    await expect(hit).toBeVisible();
    await expect(hit).toContainText('identity');
    await hit.click();
    await expect(page.getByTestId('identity-inspector')).toBeVisible();
  });

  test('global search finds a finding by title and focuses its card', async ({ page }) => {
    await openApp(page);

    // seed findings through a real device-state import
    await page.getByTestId('nav-imports').click();
    await page.getByTestId('import-adapter-select').selectOption('device-state');
    await page.getByTestId('import-evidence-file-input').setInputFiles({
      name: 'report.json',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(DEVICE_STATE_REPORT, 'utf8'),
    });
    await expect(page.getByTestId('import-review')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('import-commit-button').click();
    await expect(page.getByTestId('import-review')).toContainText('committed');

    // learn a real finding title, then search for it
    await page.getByTestId('nav-findings').click();
    await expect(page.getByTestId('findings-panel')).toBeVisible();
    const title = (await page.locator('.finding-title').first().textContent()) ?? '';
    const probe = title.split(' ').slice(0, 2).join(' ');
    expect(probe.length).toBeGreaterThan(0);

    await page.getByTestId('global-search-input').fill(probe);
    const hit = page.locator('[data-testid="search-results"] button', {
      hasText: 'finding ·',
    });
    await expect(hit.first()).toBeVisible();
    await hit.first().click();

    await expect(page.getByTestId('findings-panel')).toBeVisible();
    await expect(page.locator('.finding-card--focused')).toHaveCount(1);
  });

  test('Link Info lists the PolicyRules governing the selected link', async ({ page }) => {
    await openApp(page);
    const a = await addDeviceViaLibrary(page, 'firewall');
    const b = await addDeviceViaLibrary(page, 'router');

    // link the two devices via connect mode
    await page.getByTestId('toggle-connect-mode').click();
    await fitCanvas(page);
    await page.getByTestId(`device-node-${a}`).click();
    await page.getByTestId('connect-source-add-interface').click();
    await waitSaved(page);
    await page.getByTestId(`device-node-${b}`).click();
    await page.getByTestId('connect-target-add-interface').click();
    await waitSaved(page);
    await page.getByTestId('connect-label').fill('m3-uplink');
    await page.getByTestId('connect-create').click();
    await waitSaved(page);
    await page.getByTestId('toggle-connect-mode').click();

    // a device→device rule governing the link's endpoints
    const p = await project(page);
    const graph = await graphOf(page, p.id);
    const deviceA = graph.devices.find((d) => d.name === a);
    const deviceB = graph.devices.find((d) => d.name === b);
    if (!deviceA || !deviceB) throw new Error('devices not found');
    await page.getByTestId('context-tab-rules').click();
    const ruleSource = page.getByTestId('rule-source-select');
    await ruleSource.selectOption({ label: `▢ ${a}` });
    await page.getByTestId('rule-destination-select').selectOption({ label: `▢ ${b}` });
    await page.getByTestId('rule-create').click();
    await waitSaved(page);

    // select the link edge and check the governing-rule row links back
    await moveDeviceViaApi(page, a, -700, 3200);
    await moveDeviceViaApi(page, b, 700, 3200);
    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await fitCanvas(page);
    const boxA = await page.getByTestId(`device-node-${a}`).boundingBox();
    const boxB = await page.getByTestId(`device-node-${b}`).boundingBox();
    if (!boxA || !boxB) throw new Error('device nodes not visible');
    await page.mouse.click(
      (boxA.x + boxA.width / 2 + boxB.x + boxB.width / 2) / 2,
      (boxA.y + boxA.height / 2 + boxB.y + boxB.height / 2) / 2,
    );

    await expect(page.getByTestId('link-details')).toBeVisible();
    await expect(page.getByTestId('governing-rules')).toBeVisible();
    const row = page.locator('[data-testid^="governing-rule-"]').first();
    await row.click();
    await expect(page.getByTestId('context-tab-rules')).toHaveClass(/toggle--on/);
    await expect(page.locator('.rule-row--focused')).toHaveCount(1);
  });
});
