import { describe, expect, it } from 'vitest';
import { deviceIdSchema, newId, projectIdSchema } from '../src/index.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  it('mints valid UUIDv7 identifiers', () => {
    const id = newId(deviceIdSchema);
    expect(id).toMatch(UUID_V7);
    expect(deviceIdSchema.safeParse(id).success).toBe(true);
  });

  it('mints sortable ids: lexical order matches creation order', () => {
    const ids = Array.from({ length: 1000 }, () => newId(projectIdSchema));
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it('rejects non-v7 UUIDs', () => {
    expect(deviceIdSchema.safeParse('7f2b6c3a-1111-4111-8111-111111111111').success).toBe(false);
    expect(deviceIdSchema.safeParse('not-a-uuid').success).toBe(false);
  });
});
