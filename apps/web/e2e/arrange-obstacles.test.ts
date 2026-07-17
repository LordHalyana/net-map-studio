import { test, expect, type Page } from './fixtures';
import {
  deviceIdSchema,
  deviceSchema,
  interfaceIdSchema,
  interfaceSchema,
  networkIdSchema,
  networkSchema,
  newId,
  projectIdSchema,
  siteIdSchema,
  siteSchema,
  zoneIdSchema,
  zoneSchema,
  type Device,
  type Interface,
  type Network,
  type ProjectId,
  type Site,
  type Zone,
} from '@netplan/domain';
import { changeSet, opCreateEntity } from '../src/state/ops';

/**
 * Auto-arrange obstacle avoidance (#75): the acceptance scenario — a Zone
 * holding a device plus a pinned device must never end up under the arranged
 * block, and no arranged node may land inside a container it doesn't belong
 * to. Seeds its own scene onto the freshly reset store.
 */

async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

async function waitSaved(page: Page) {
  await expect(page.getByTestId('sync-status')).toHaveText('Saved');
}

type GraphDevice = {
  id: string;
  name: string;
  zoneId: string | null;
  pinned: boolean;
  position: { x: number; y: number };
};

async function fetchGraph(page: Page) {
  const [project] = await (await page.request.get('/api/projects')).json();
  return (await (await page.request.get(`/api/projects/${project.id}/graph`)).json()) as {
    devices: GraphDevice[];
  };
}

type Seeded = {
  projectId: ProjectId;
  site: Site;
  zone: Zone;
  contained: Device;
  pinned: Device;
  fanDevices: Device[];
  interfaces: Interface[];
  network: Network;
};

/** Site over the layout origin, a device inside its zone, a pinned device,
 *  and a connected endpoint fan — the #75 acceptance scene in one changeset. */
async function seedScenario(page: Page): Promise<Seeded> {
  const [project] = await (await page.request.get('/api/projects')).json();
  const projectId = projectIdSchema.parse(project.id);

  // squarely over the dagre margin corner so the un-fixed layout would land inside
  const site = siteSchema.parse({
    id: newId(siteIdSchema),
    projectId,
    name: 'obst-site',
    position: { x: 0, y: 0 },
  });
  const zone = zoneSchema.parse({
    id: newId(zoneIdSchema),
    projectId,
    siteId: site.id,
    name: 'obst-zone',
    position: { x: 20, y: 44 },
  });
  const contained = deviceSchema.parse({
    id: newId(deviceIdSchema),
    projectId,
    name: 'obst-contained',
    deviceType: 'server',
    zoneId: zone.id,
    position: { x: 12, y: 12 }, // zone-relative
  });
  const pinned = deviceSchema.parse({
    id: newId(deviceIdSchema),
    projectId,
    name: 'obst-pinned',
    deviceType: 'nas',
    pinned: true,
    position: { x: 700, y: 80 }, // clear of the site, inside the fan's x-span
  });
  const network = networkSchema.parse({
    id: newId(networkIdSchema),
    projectId,
    name: 'OBST-VLAN',
    kind: 'vlan',
    vlanId: 750,
  });

  const fanDevices: Device[] = [];
  const interfaces: Interface[] = [];
  const addFanDevice = (name: string, deviceType: 'server' | 'workstation', x: number) => {
    const device = deviceSchema.parse({
      id: newId(deviceIdSchema),
      projectId,
      name,
      deviceType,
      position: { x, y: 400 },
    });
    fanDevices.push(device);
    interfaces.push(
      interfaceSchema.parse({
        id: newId(interfaceIdSchema),
        projectId,
        deviceId: device.id,
        name: 'eth0',
        networkId: network.id,
      }),
    );
  };
  addFanDevice('obst-fan-server', 'server', 0);
  for (let i = 0; i < 6; i++) addFanDevice(`obst-fan-ws-${i}`, 'workstation', 200 + i * 60);

  const ops = [
    opCreateEntity(projectId, { entityType: 'site', entity: site }),
    opCreateEntity(projectId, { entityType: 'zone', entity: zone }),
    opCreateEntity(projectId, { entityType: 'device', entity: contained }),
    opCreateEntity(projectId, { entityType: 'device', entity: pinned }),
    opCreateEntity(projectId, { entityType: 'network', entity: network }),
    ...fanDevices.map((d) => opCreateEntity(projectId, { entityType: 'device', entity: d })),
    ...interfaces.map((i) => opCreateEntity(projectId, { entityType: 'interface', entity: i })),
  ];

  const response = await page.request.post(`/api/projects/${projectId}/operations`, {
    data: changeSet(projectId, 'Seed #75 obstacle scene', ops),
  });
  expect(response.ok()).toBe(true);
  return { projectId, site, zone, contained, pinned, fanDevices, interfaces, network };
}

type Rect = { x: number; y: number; width: number; height: number };

// deliberately independent of the intersects() under test in autoArrange.ts
const boxesIntersect = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test.describe('Auto-arrange obstacle avoidance (#75)', () => {
  test('a populated zone and a pinned device leave zero overlaps and no intrusion', async ({
    page,
  }) => {
    await openApp(page);
    const seeded = await seedScenario(page);
    await page.reload();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByTestId('device-node-obst-contained')).toBeVisible();

    await page.getByTestId('auto-arrange').click();
    await waitSaved(page);
    await page.getByTestId('zoom-100').click();
    await page.waitForTimeout(400);

    // pinned and zone-contained devices never move
    const graph = await fetchGraph(page);
    expect(graph.devices.find((d) => d.id === seeded.contained.id)?.position).toEqual(
      seeded.contained.position,
    );
    expect(graph.devices.find((d) => d.id === seeded.pinned.id)?.position).toEqual(
      seeded.pinned.position,
    );

    // zero overlapping device nodes at 100% zoom — including the contained
    // and pinned cards the layout skipped
    const deviceBoxes: { name: string; box: Rect }[] = [];
    for (const node of await page.locator('.device-node').all()) {
      const box = await node.boundingBox();
      const testId = await node.getAttribute('data-testid');
      if (box && testId) deviceBoxes.push({ name: testId, box });
    }
    expect(deviceBoxes.length).toBeGreaterThan(7);
    for (let i = 0; i < deviceBoxes.length; i++) {
      for (let j = i + 1; j < deviceBoxes.length; j++) {
        const a = deviceBoxes[i];
        const b = deviceBoxes[j];
        if (!a || !b) continue;
        expect(boxesIntersect(a.box, b.box), `${a.name} and ${b.name} overlap after arrange`).toBe(
          false,
        );
      }
    }

    // no arranged (movable) node sits inside a container it doesn't belong to
    const movableNames = new Set(
      graph.devices.filter((d) => !d.zoneId && !d.pinned).map((d) => `device-node-${d.name}`),
    );
    const siteBoxes: Rect[] = [];
    for (const node of await page.locator('[data-testid^="site-node-"]').all()) {
      const box = await node.boundingBox();
      if (box) siteBoxes.push(box);
    }
    expect(siteBoxes.length).toBeGreaterThan(0);
    for (const { name, box } of deviceBoxes) {
      if (!movableNames.has(name)) continue;
      for (const siteBox of siteBoxes) {
        expect(boxesIntersect(box, siteBox), `${name} intrudes into a site container`).toBe(false);
      }
    }
  });
});
