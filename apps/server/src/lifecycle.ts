import type { FastifyInstance } from 'fastify';

/**
 * Wire SIGTERM/SIGINT to a one-shot graceful shutdown (#93). The app runs as a
 * long-lived process — `pnpm start` in production and the Playwright e2e
 * `webServer` (`tsx watch src/index.ts`) in CI — so it must release the
 * listening socket when signalled. Without it, 127.0.0.1:3001 can outlive the
 * run and the next `playwright test` aborts (`webServer` has
 * `reuseExistingServer: false`). `app.close()` runs the onClose hook that
 * drains in-flight parse work (see app.ts) before releasing the socket.
 *
 * Registered once per signal so a second Ctrl-C doesn't re-enter mid-close.
 * POSIX (CI Linux) delivers these to the handler, which frees the port before
 * exit. On Windows a *programmatic* SIGTERM/SIGINT terminates without running
 * handlers — there orchestrators (Playwright) tree-kill the process — but
 * interactive Ctrl-C and `pnpm start` still shut down cleanly through here.
 *
 * `exit` is injectable so the wiring is unit-testable without terminating the
 * test runner.
 */
export function installShutdownHandlers(
  app: FastifyInstance,
  exit: (code: number) => void = process.exit,
): void {
  let shuttingDown = false;
  const handle = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`Received ${signal}, shutting down gracefully`);
    void app
      .close()
      .then(() => exit(0))
      .catch((error: unknown) => {
        app.log.error(error, 'Graceful shutdown failed');
        exit(1);
      });
  };
  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
  for (const signal of signals) {
    process.once(signal, handle);
  }
}
