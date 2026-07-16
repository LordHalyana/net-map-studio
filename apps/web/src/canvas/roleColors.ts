import type { Device } from '@netplan/domain';
import type { Membership } from './graphToFlow';

/**
 * Role accent per node (visual-parity M1, gap G1). Infrastructure gets a
 * fixed role color (concept: firewall red, core blue, internet green, VPN
 * gray); endpoints inherit their first Membership's network color so the
 * bottom row reads as VLAN-tinted, falling back to the neutral endpoint tone.
 * Values must stay in sync with the --role-* tokens in styles.css.
 */
const ROLE_COLORS = {
  internet: '#3ddc97',
  firewall: '#e05252',
  vpn: '#aab4c4',
  core: '#4da3ff',
  server: '#d7dde8',
  endpoint: '#8b94a7',
} as const;

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

export function nodeAccentColor(device: Device, memberships: readonly Membership[]): string {
  if (device.deviceType === 'custom' && /internet/i.test(device.customTypeLabel)) {
    return ROLE_COLORS.internet;
  }
  const role = infraRole[device.deviceType];
  if (role) return ROLE_COLORS[role];
  return memberships[0]?.color ?? ROLE_COLORS.endpoint;
}
