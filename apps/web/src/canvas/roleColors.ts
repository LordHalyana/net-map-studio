import type { Device } from '@netplan/domain';
import { ROLE_COLORS } from './palette';

/**
 * Role accent per node (visual-parity M1, gap G1). Infrastructure gets a
 * fixed role color (concept: firewall red, core blue, internet green, VPN
 * gray); endpoints inherit their first Membership's network color so the
 * bottom row reads as VLAN-tinted, falling back to the neutral endpoint tone.
 * Hexes live in palette.ts, mirroring the --role-* tokens in styles.css.
 * Callers pass only what is read: the membership tints, in interface order.
 */

const infraRole: Partial<Record<Device['deviceType'], keyof typeof ROLE_COLORS>> = {
  firewall: 'firewall',
  vpnGateway: 'vpn',
  switch: 'core',
  router: 'core',
  accessPoint: 'core',
  server: 'server',
  nas: 'server',
  dnsServer: 'server',
  dhcpServer: 'server',
};

export function nodeAccentColor(
  device: Device,
  memberships: readonly { color: string; networkId?: string }[],
): string {
  if (device.deviceType === 'custom' && /internet/i.test(device.customTypeLabel)) {
    return ROLE_COLORS.internet;
  }
  const role = infraRole[device.deviceType];
  if (role) return ROLE_COLORS[role];
  // deterministic accent (M6, #63): sort so the tint never depends on
  // interface order — dual-homed devices keep one stable color
  const sorted = [...memberships].sort((a, b) =>
    (a.networkId ?? a.color).localeCompare(b.networkId ?? b.color),
  );
  return sorted[0]?.color ?? ROLE_COLORS.endpoint;
}
