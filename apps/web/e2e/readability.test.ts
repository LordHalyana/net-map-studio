import { test, expect, type Page } from './fixtures';
import {
  changeSetIdSchema,
  deviceIdSchema,
  deviceSchema,
  interfaceIdSchema,
  interfaceSchema,
  networkIdSchema,
  networkSchema,
  newId,
  operationIdSchema,
  projectIdSchema,
  type Operation,
} from '@netplan/domain';

/**
 * Improvements M4 (#61): canvas layout & readability — compact leaf
 * endpoints, non-overlapping fan-out after auto-arrange, collapsing minimap.
 */

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

async function waitSaved(page: Page) {
  await expect(page.getByTestId('sync-status')).toHaveText('Saved');
}

/** One VLAN, one server, ten leaf workstations — a dense endpoint fan. */
async function seedEndpointFan(page: Page) {
  const [project] = await (await page.request.get('/api/projects')).json();
  const projectId = projectIdSchema.parse(project.id);
  const ops: Operation[] = [];
  const opBase = () => ({ id: newId(operationIdSchema), projectId });

  const network = networkSchema.parse({
    id: newId(networkIdSchema),
    projectId,
    name: 'FAN-VLAN',
    kind: 'vlan',
    vlanId: 400,
    layoutHints: { main: { x: 400, y: -140 } },
  });
  ops.push({
    ...opBase(),
    kind: 'CreateEntity',
    payload: { entityType: 'network', entity: network },
  });

  const addDevice = (name: string, deviceType: 'server' | 'workstation', x: number) => {
    const device = deviceSchema.parse({
      id: newId(deviceIdSchema),
      projectId,
      name,
      deviceType,
      position: { x, y: 200 },
    });
    ops.push({
      ...opBase(),
      kind: 'CreateEntity',
      payload: { entityType: 'device', entity: device },
    });
    const iface = interfaceSchema.parse({
      id: newId(interfaceIdSchema),
      projectId,
      deviceId: device.id,
      name: 'eth0',
      networkId: network.id,
    });
    ops.push({
      ...opBase(),
      kind: 'CreateEntity',
      payload: { entityType: 'interface', entity: iface },
    });
  };

  addDevice('fan-server', 'server', 0);
  for (let i = 0; i < 10; i++) addDevice(`fan-ws-${i}`, 'workstation', 200 + i * 60);

  const response = await page.request.post(`/api/projects/${projectId}/operations`, {
    data: {
      id: newId(changeSetIdSchema),
      projectId,
      label: 'Seed endpoint fan',
      operations: ops,
    },
  });
  expect(response.ok()).toBe(true);
}

test.describe('Canvas layout & readability (improvements M4, #61)', () => {
  test('leaf endpoints render compact; a selected leaf returns to the full card', async ({
    page,
  }) => {
    await openApp(page);
    await seedEndpointFan(page);
    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await page.locator('.react-flow__controls-fitview').click();

    // degree-1 endpoint → compact; the server (same degree, non-endpoint type) stays full
    const leaf = page.getByTestId('device-node-fan-ws-0');
    await expect(leaf).toHaveClass(/device-node--compact/);
    await expect(page.getByTestId('device-node-fan-server')).not.toHaveClass(
      /device-node--compact/,
    );

    // selection restores the full card with the visible name
    await leaf.click();
    await expect(page.getByTestId('device-node-fan-ws-0')).not.toHaveClass(/device-node--compact/);
    await expect(
      page.getByTestId('device-node-fan-ws-0').locator('.device-node__name'),
    ).toBeVisible();
  });

  test('auto-arrange leaves zero overlapping device nodes at 100% zoom', async ({ page }) => {
    await openApp(page);
    await seedEndpointFan(page);
    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await page.getByTestId('auto-arrange').click();
    await waitSaved(page);
    await page.getByTestId('zoom-100').click();
    await page.waitForTimeout(400);

    const boxes = [];
    for (const node of await page.locator('.device-node').all()) {
      const box = await node.boundingBox();
      if (box) boxes.push(box);
    }
    expect(boxes.length).toBeGreaterThan(5);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (!a || !b) continue;
        const overlaps =
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height;
        expect(overlaps, `nodes ${i} and ${j} overlap`).toBe(false);
      }
    }
  });

  test('the minimap collapses until hovered so it never permanently covers nodes', async ({
    page,
  }) => {
    await openApp(page);
    const minimap = page.locator('.react-flow__minimap');
    await expect(minimap).toBeVisible();

    const collapsed = await minimap.boundingBox();
    if (!collapsed) throw new Error('minimap not measurable');
    await minimap.hover();
    await page.waitForTimeout(300);
    const expanded = await minimap.boundingBox();
    if (!expanded) throw new Error('minimap not measurable after hover');

    expect(collapsed.width).toBeLessThan(expanded.width * 0.5);
    // move away: it collapses again
    await page.mouse.move(10, 10);
    await page.waitForTimeout(300);
    const recollapsed = await minimap.boundingBox();
    expect((recollapsed?.width ?? 0) < expanded.width * 0.5).toBe(true);
  });
});
