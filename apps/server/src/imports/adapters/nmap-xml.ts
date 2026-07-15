import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import type { DeviceHints, ObservationDraft, Protocol } from '@netplan/domain';
import { ParseLimitError } from '../guards.js';
import type { Adapter, AdapterContext } from './types.js';

/**
 * Nmap XML Adapter (ADR-0020, plan M5): hosts, addresses, MAC/vendor, open
 * ports, service identification, OS guesses, script output and timestamps —
 * each claim carrying its §3.7 confidence contributor: an exact MAC is
 * strong, an in-scan-window IP is medium-strong, service identification is
 * banner inference, an OS match is a fingerprint guess.
 */

const attr = z.string().or(z.number()).transform(String);

const addressSchema = z.looseObject({
  addr: attr,
  addrtype: z.enum(['ipv4', 'ipv6', 'mac']),
  vendor: attr.optional(),
});

const hostnameSchema = z.looseObject({ name: attr });

const serviceSchema = z.looseObject({
  name: attr.optional(),
  product: attr.optional(),
  version: attr.optional(),
});

const scriptSchema = z.looseObject({ id: attr, output: attr.optional() });

const portSchema = z.looseObject({
  protocol: z.enum(['tcp', 'udp', 'sctp', 'ip']),
  portid: z.coerce.number().int(),
  state: z.looseObject({ state: attr }),
  service: serviceSchema.optional(),
  script: z.array(scriptSchema).optional(),
});

const osMatchSchema = z.looseObject({
  name: attr,
  accuracy: z.coerce.number().optional(),
});

const hostSchema = z.looseObject({
  starttime: z.coerce.number().optional(),
  endtime: z.coerce.number().optional(),
  status: z.looseObject({ state: attr }).optional(),
  address: z.array(addressSchema).default([]),
  hostnames: z.looseObject({ hostname: z.array(hostnameSchema).default([]) }).optional(),
  ports: z.looseObject({ port: z.array(portSchema).default([]) }).optional(),
  os: z.looseObject({ osmatch: z.array(osMatchSchema).default([]) }).optional(),
});

const nmapRunSchema = z.looseObject({
  nmaprun: z.looseObject({
    host: z.array(hostSchema).default([]),
  }),
});

const ALWAYS_ARRAY = new Set(['host', 'address', 'hostname', 'port', 'osmatch', 'script']);

function toIso(epochSeconds: number | undefined): string | null {
  if (!epochSeconds) return null;
  return new Date(epochSeconds * 1000).toISOString();
}

function toProtocol(value: 'tcp' | 'udp' | 'sctp' | 'ip'): Protocol {
  return value === 'tcp' || value === 'udp' ? value : 'other';
}

export const nmapXmlAdapter: Adapter = {
  name: 'nmap-xml',
  version: '1.0.0',
  schemaVersion: 'nmap-xml',
  parse(content: string, ctx: AdapterContext): ObservationDraft[] {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      // entity expansion off: the billion-laughs class stays inert (§3.13)
      processEntities: false,
      isArray: (name) => ALWAYS_ARRAY.has(name),
    });
    const parsed: unknown = parser.parse(content);
    const run = nmapRunSchema.safeParse(parsed);
    if (!run.success) {
      throw new ParseLimitError('Not a recognizable Nmap XML document');
    }

    const drafts: ObservationDraft[] = [];
    for (const host of run.data.nmaprun.host) {
      ctx.budget.check();
      if (host.status && host.status.state !== 'up') continue;

      const observedAt = toIso(host.endtime ?? host.starttime);
      const mac = host.address.find((a) => a.addrtype === 'mac');
      const ips = host.address.filter((a) => a.addrtype !== 'mac');
      const hostname = host.hostnames?.hostname[0]?.name;
      if (!mac && ips.length === 0 && !hostname) continue;

      const hints: DeviceHints = {
        ...(mac ? { mac: mac.addr } : {}),
        ...(ips[0] ? { ip: ips[0].addr } : {}),
        ...(hostname ? { hostname } : {}),
      };
      // an exact MAC is a strong contributor; a bare IP is scan-window-bound
      const hostContributor = mac ? ('exactMacMatch' as const) : ('ipSameScanWindow' as const);

      drafts.push({
        contributor: hostContributor,
        observedAt,
        claim: {
          targetKind: 'device',
          device: hints,
          fields: {
            ...(hostname ? { name: hostname } : ips[0] ? { name: ips[0].addr } : {}),
            ...(mac?.vendor ? { vendor: mac.vendor } : {}),
          },
        },
      });

      // OS guesses are their own, weaker claim (§3.7)
      const bestOs = host.os?.osmatch[0];
      if (bestOs) {
        drafts.push({
          contributor: 'osFingerprint',
          observedAt,
          claim: {
            targetKind: 'device',
            device: hints,
            fields: { os: bestOs.name },
          },
        });
      }

      for (const address of host.address) {
        drafts.push({
          contributor: hostContributor,
          observedAt,
          claim: {
            targetKind: 'address',
            device: hints,
            interfaceName: null,
            kind: address.addrtype,
            value: address.addr,
          },
        });
      }
      if (hostname) {
        drafts.push({
          contributor: hostContributor,
          observedAt,
          claim: {
            targetKind: 'address',
            device: hints,
            interfaceName: null,
            kind: 'hostname',
            value: hostname,
          },
        });
      }

      for (const port of host.ports?.port ?? []) {
        if (port.state.state !== 'open') continue;
        const description = [
          port.service?.product,
          port.service?.version,
          ...(port.script ?? []).map((s) => `[${s.id}]`),
        ]
          .filter(Boolean)
          .join(' ');
        drafts.push({
          // service identification comes from banners/probes (§3.7)
          contributor: 'bannerInference',
          observedAt,
          claim: {
            targetKind: 'service',
            device: hints,
            protocol: toProtocol(port.protocol),
            port: port.portid,
            fields: {
              ...(port.service?.name ? { name: port.service.name } : {}),
              ...(description ? { description } : {}),
            },
          },
        });
      }
    }
    return drafts;
  },
};
