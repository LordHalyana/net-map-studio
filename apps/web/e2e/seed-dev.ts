/**
 * Local-dev seed: populate the running dev server with the demo scene (the
 * concept image's hotel topology) plus Site/Zone structure, through the real
 * Operation log.
 *
 *   pnpm dev                                # in one terminal
 *   pnpm --filter @netplan/web seed         # in another
 *
 * Flags:
 *   --reset    delete every existing project first (the app loads the first
 *              project, so an old scratch project would otherwise win)
 *   --stress   also seed the 20-member IoT VLAN + dual-homed printer
 *   --api URL  server base (default http://127.0.0.1:3001)
 */
import { DEMO_PROJECT_NAME, seedDemoScene } from './demo-scene';

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string) => argv.includes(name);
  const apiIndex = argv.indexOf('--api');
  const API = apiIndex >= 0 ? (argv[apiIndex + 1] ?? '') : 'http://127.0.0.1:3001';

  const health = await fetch(`${API}/health`).catch(() => null);
  if (!health?.ok) {
    throw new Error(`No server at ${API}. Start the dev stack first (pnpm dev).`);
  }

  if (flag('--reset')) {
    const projects: { id: string; name: string }[] = await (await fetch(`${API}/projects`)).json();
    for (const project of projects) {
      const del = await fetch(`${API}/projects/${project.id}`, { method: 'DELETE' });
      if (!del.ok) throw new Error(`Could not delete project ${project.name}: ${del.status}`);
      console.log(`deleted: ${project.name}`);
    }
  }

  const project = await seedDemoScene(API, { stress: flag('--stress'), structure: true });

  const graph = await (await fetch(`${API}/projects/${project.id}/graph`)).json();
  console.log(
    `seeded "${project.name}": ${graph.devices.length} devices, ` +
      `${graph.networks.length} networks, ${graph.links.length} links, ` +
      `${graph.policyRules.length} rules, ${graph.sites.length} site(s)`,
  );

  const projects: { id: string }[] = await (await fetch(`${API}/projects`)).json();
  if (projects[0]?.id !== project.id) {
    console.warn(
      `note: "${DEMO_PROJECT_NAME}" is not the first project — the app loads the first one. ` +
        'Re-run with --reset to make it the project the app opens.',
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
