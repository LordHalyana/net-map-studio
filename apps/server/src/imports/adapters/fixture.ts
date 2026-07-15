import { z } from 'zod';
import { deviceTypeSchema, type ObservationDraft } from '@netplan/domain';
import { guardedJsonParse } from '../guards.js';
import type { Adapter, AdapterContext } from './types.js';

/**
 * The trivial adapter that hardens the M1–M3 spine before any real format is
 * parsed (plan §0.5): a canned JSON shape emitting Device and Address
 * observations. Also the test vehicle for the worker limits.
 */
export const fixtureFileSchema = z.object({
  fixture: z.literal(true),
  devices: z
    .array(
      z.object({
        name: z.string().min(1),
        deviceType: deviceTypeSchema.optional(),
        os: z.string().optional(),
        stableId: z.string().optional(),
        mac: z.string().optional(),
        ip: z.string().optional(),
        hostname: z.string().optional(),
        observedAt: z.iso.datetime().optional(),
      }),
    )
    .default([]),
});
export type FixtureFile = z.infer<typeof fixtureFileSchema>;

export const fixtureAdapter: Adapter = {
  name: 'fixture',
  version: '1.0.0',
  schemaVersion: '1',
  parse(content: string, ctx: AdapterContext): ObservationDraft[] {
    const file = fixtureFileSchema.parse(guardedJsonParse(content, ctx.limits));
    const drafts: ObservationDraft[] = [];
    for (const device of file.devices) {
      ctx.budget.check();
      const hints = {
        stableId: device.stableId,
        mac: device.mac,
        ip: device.ip,
        hostname: device.hostname,
      };
      const contributor = device.stableId
        ? ('stableDeviceId' as const)
        : device.mac
          ? ('exactMacMatch' as const)
          : device.ip
            ? ('ipSameScanWindow' as const)
            : ('hostnameMatch' as const);
      const observedAt = device.observedAt ?? null;
      drafts.push({
        contributor,
        observedAt,
        claim: {
          targetKind: 'device',
          device: hints,
          fields: {
            name: device.name,
            ...(device.deviceType ? { deviceType: device.deviceType } : {}),
            ...(device.os ? { os: device.os } : {}),
          },
        },
      });
      if (device.mac) {
        drafts.push({
          contributor,
          observedAt,
          claim: {
            targetKind: 'address',
            device: hints,
            interfaceName: null,
            kind: 'mac',
            value: device.mac,
          },
        });
      }
      if (device.ip) {
        drafts.push({
          contributor,
          observedAt,
          claim: {
            targetKind: 'address',
            device: hints,
            interfaceName: null,
            kind: 'ipv4',
            value: device.ip,
          },
        });
      }
    }
    return drafts;
  },
};
