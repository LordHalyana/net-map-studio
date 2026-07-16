import type { DeviceType } from '@netplan/domain';
import {
  BrickWall,
  Cctv,
  Cpu,
  CreditCard,
  Globe,
  HardDrive,
  Laptop,
  Lock,
  Monitor,
  Network,
  Phone,
  Printer,
  ReceiptText,
  Router,
  Server,
  Shapes,
  Smartphone,
  Tags,
  Wifi,
  type LucideIcon,
} from 'lucide-react';

export interface LibraryItem {
  deviceType: DeviceType;
  label: string;
  icon: LucideIcon;
}

export interface LibraryCategory {
  key: string;
  label: string;
  items: LibraryItem[];
}

/** Component library categories (design §3.2B); lucide line icons per M0 (gap G1/G5). */
export const libraryCatalog: LibraryCategory[] = [
  {
    key: 'network',
    label: 'Network infrastructure',
    items: [
      { deviceType: 'router', label: 'Router', icon: Router },
      { deviceType: 'switch', label: 'Switch', icon: Network },
      { deviceType: 'accessPoint', label: 'Access Point', icon: Wifi },
      { deviceType: 'dnsServer', label: 'DNS Server', icon: Globe },
      { deviceType: 'dhcpServer', label: 'DHCP Server', icon: Tags },
    ],
  },
  {
    key: 'security',
    label: 'Security appliances',
    items: [
      { deviceType: 'firewall', label: 'Firewall', icon: BrickWall },
      { deviceType: 'vpnGateway', label: 'VPN Gateway', icon: Lock },
    ],
  },
  {
    key: 'servers',
    label: 'Servers & services',
    items: [
      { deviceType: 'server', label: 'Server', icon: Server },
      { deviceType: 'nas', label: 'NAS', icon: HardDrive },
    ],
  },
  {
    key: 'endpoints',
    label: 'Endpoints',
    items: [
      { deviceType: 'workstation', label: 'Workstation', icon: Monitor },
      { deviceType: 'laptop', label: 'Laptop', icon: Laptop },
      { deviceType: 'mobileDevice', label: 'Mobile Device', icon: Smartphone },
      { deviceType: 'printer', label: 'Printer', icon: Printer },
    ],
  },
  {
    key: 'pos',
    label: 'POS & payment',
    items: [
      { deviceType: 'posClient', label: 'POS Client', icon: ReceiptText },
      { deviceType: 'paymentTerminal', label: 'Payment Terminal', icon: CreditCard },
    ],
  },
  {
    key: 'building',
    label: 'Building systems & IoT',
    items: [
      { deviceType: 'camera', label: 'Camera', icon: Cctv },
      { deviceType: 'voipDevice', label: 'VoIP Device', icon: Phone },
      { deviceType: 'iotDevice', label: 'IoT Device', icon: Cpu },
    ],
  },
  {
    key: 'custom',
    label: 'Custom components',
    items: [{ deviceType: 'custom', label: 'Custom Component', icon: Shapes }],
  },
];

export function findLibraryItem(deviceType: DeviceType): LibraryItem | undefined {
  for (const category of libraryCatalog) {
    const item = category.items.find((i) => i.deviceType === deviceType);
    if (item) return item;
  }
  return undefined;
}
