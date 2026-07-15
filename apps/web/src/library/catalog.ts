import type { DeviceType } from '@netplan/domain';

export interface LibraryItem {
  deviceType: DeviceType;
  label: string;
  glyph: string;
}

export interface LibraryCategory {
  key: string;
  label: string;
  items: LibraryItem[];
}

/** Component library categories (design §3.2B). */
export const libraryCatalog: LibraryCategory[] = [
  {
    key: 'network',
    label: 'Network infrastructure',
    items: [
      { deviceType: 'router', label: 'Router', glyph: '⇄' },
      { deviceType: 'switch', label: 'Switch', glyph: '⋔' },
      { deviceType: 'accessPoint', label: 'Access Point', glyph: '📶' },
      { deviceType: 'dnsServer', label: 'DNS Server', glyph: '🌐' },
      { deviceType: 'dhcpServer', label: 'DHCP Server', glyph: '🏷' },
    ],
  },
  {
    key: 'security',
    label: 'Security appliances',
    items: [
      { deviceType: 'firewall', label: 'Firewall', glyph: '🛡' },
      { deviceType: 'vpnGateway', label: 'VPN Gateway', glyph: '🔒' },
    ],
  },
  {
    key: 'servers',
    label: 'Servers & services',
    items: [
      { deviceType: 'server', label: 'Server', glyph: '🖥' },
      { deviceType: 'nas', label: 'NAS', glyph: '🗄' },
    ],
  },
  {
    key: 'endpoints',
    label: 'Endpoints',
    items: [
      { deviceType: 'workstation', label: 'Workstation', glyph: '💻' },
      { deviceType: 'laptop', label: 'Laptop', glyph: '💼' },
      { deviceType: 'mobileDevice', label: 'Mobile Device', glyph: '📱' },
      { deviceType: 'printer', label: 'Printer', glyph: '🖨' },
    ],
  },
  {
    key: 'pos',
    label: 'POS & payment',
    items: [
      { deviceType: 'posClient', label: 'POS Client', glyph: '🧾' },
      { deviceType: 'paymentTerminal', label: 'Payment Terminal', glyph: '💳' },
    ],
  },
  {
    key: 'building',
    label: 'Building systems & IoT',
    items: [
      { deviceType: 'camera', label: 'Camera', glyph: '📷' },
      { deviceType: 'voipDevice', label: 'VoIP Device', glyph: '☎' },
      { deviceType: 'iotDevice', label: 'IoT Device', glyph: '🌡' },
    ],
  },
  {
    key: 'custom',
    label: 'Custom components',
    items: [{ deviceType: 'custom', label: 'Custom Component', glyph: '✦' }],
  },
];

export function findLibraryItem(deviceType: DeviceType): LibraryItem | undefined {
  for (const category of libraryCatalog) {
    const item = category.items.find((i) => i.deviceType === deviceType);
    if (item) return item;
  }
  return undefined;
}
