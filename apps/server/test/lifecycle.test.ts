import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { installShutdownHandlers } from '../src/lifecycle.js';

/**
 * Graceful shutdown (#93): the app runs as a long-lived process in production
 * and as the Playwright e2e `webServer`. A SIGTERM/SIGINT must release the
 * listening socket so the next run's `webServer` (reuseExistingServer: false)
 * can bind 127.0.0.1:3001 instead of aborting with "already used".
 */

/** Resolve true if a TCP connection to the port is accepted, false if refused. */
function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function listeningPort(app: FastifyInstance): number {
  const address = app.server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

/** Capture the handlers installShutdownHandlers registers, without arming the
 *  real process (so the test runner keeps its own signal behaviour). */
function captureSignalHandlers(
  app: FastifyInstance,
  exit: (code: number) => void,
): Map<NodeJS.Signals, (signal: NodeJS.Signals) => void> {
  const handlers = new Map<NodeJS.Signals, (signal: NodeJS.Signals) => void>();
  const spy = vi
    .spyOn(process, 'once')
    .mockImplementation((event: string | symbol, handler: (...args: unknown[]) => void) => {
      handlers.set(event as NodeJS.Signals, handler as (signal: NodeJS.Signals) => void);
      return process;
    });
  installShutdownHandlers(app, exit);
  spy.mockRestore();
  return handlers;
}

describe('graceful shutdown (#93)', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    // the handler already closed it on the happy path; guard a failed run
    try {
      await app?.close();
    } catch {
      // already closed
    }
    app = undefined;
  });

  it('releases the listening socket and exits 0 on SIGTERM', async () => {
    app = await buildApp({ dbFile: ':memory:', logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = listeningPort(app);
    expect(port).toBeGreaterThan(0);
    expect(await canConnect(port)).toBe(true);

    const exit = vi.fn();
    const handlers = captureSignalHandlers(app, exit);
    expect(handlers.has('SIGTERM')).toBe(true);
    expect(handlers.has('SIGINT')).toBe(true);

    handlers.get('SIGTERM')!('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

    expect(await canConnect(port)).toBe(false);
    app = undefined; // closed by the handler
  });

  it('is idempotent — a second signal does not re-close or double-exit', async () => {
    app = await buildApp({ dbFile: ':memory:', logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });

    const exit = vi.fn();
    const handlers = captureSignalHandlers(app, exit);
    handlers.get('SIGTERM')!('SIGTERM');
    handlers.get('SIGINT')!('SIGINT'); // second signal while shutting down

    await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(1));
    app = undefined;
  });
});
