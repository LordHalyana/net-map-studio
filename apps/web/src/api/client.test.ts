import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, apiFetch } from './client';

/**
 * #110 D1: the one fetch path. Error propagation is the contract — every
 * caller sees an ApiError carrying the HTTP status and the server's message.
 */

function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fn = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve({}),
    ...response,
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('apiFetch', () => {
  it('parses a successful response through the given schema', async () => {
    stubFetch({ json: () => Promise.resolve({ value: 'ok' }) });
    await expect(apiFetch('/x', z.object({ value: z.string() }))).resolves.toEqual({ value: 'ok' });
  });

  it('throws ApiError carrying status and the server error message', async () => {
    stubFetch({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: () => Promise.resolve({ error: 'Nothing to undo' }),
    });
    const failure = apiFetch('/x', z.unknown());
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ status: 409, message: 'Nothing to undo' });
  });

  it('falls back to status text when the error body is not JSON', async () => {
    stubFetch({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: () => Promise.reject(new Error('not json')),
    });
    await expect(apiFetch('/x', z.unknown())).rejects.toMatchObject({
      status: 502,
      message: '502 Bad Gateway',
    });
  });

  it('rejects when the payload does not match the schema', async () => {
    stubFetch({ json: () => Promise.resolve({ wrong: true }) });
    await expect(apiFetch('/x', z.object({ value: z.string() }))).rejects.toThrow();
  });

  it('prefixes paths with /api', async () => {
    const fn = stubFetch({ json: () => Promise.resolve({}) });
    await apiFetch('/projects/p1/graph', z.unknown());
    expect(fn).toHaveBeenCalledWith('/api/projects/p1/graph', expect.anything());
  });
});
