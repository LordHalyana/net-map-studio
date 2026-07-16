/**
 * Single source for every hex the canvas injects as an inline style
 * (ui-polish M1). React Flow takes inline values, not CSS custom properties,
 * so each constant mirrors the like-named token in styles.css :root — change
 * both together. Everything outside the canvas must use the CSS tokens.
 */
export const BG = '#0b0e13'; // --bg
export const BG_PANEL = '#10151d'; // --bg-panel
export const TEXT = '#d7dde8'; // --text
export const TEXT_DIM = '#8b94a7'; // --text-dim
export const ACCENT = '#3ddc97'; // --accent
export const WARN = '#e5b455'; // --warn
export const DANGER = '#e05252'; // --danger
export const GRID_LINE = '#131926'; // --grid-line
export const MINIMAP_NEUTRAL = '#2c3547'; // --minimap-neutral
export const MINIMAP_MASK = 'rgb(11 14 19 / 65%)'; // --bg at 65%

/** Role accents, one per --role-* token (visual-parity M1, gap G1). */
export const ROLE_COLORS = {
  internet: ACCENT,
  firewall: DANGER,
  vpn: '#aab4c4',
  core: '#4da3ff',
  server: '#7ea8dc', // steel blue, distinct from --text (M6, #63)
  endpoint: TEXT_DIM,
} as const;

/** Fallback tint when a network id resolves to no palette slot. */
export const NETWORK_FALLBACK = ROLE_COLORS.core;

/** Network tints, one per --vlan-1…8 token (visual-parity M0, gap G2). */
export const VLAN_PALETTE = [
  '#ff8a3d', // staff orange
  ACCENT, // guest green
  '#a06bff', // pos purple
  '#ffc44d', // cctv amber
  ROLE_COLORS.core, // blue
  '#5bd0d0', // teal
  '#e06c6c', // red
  '#9fd05b', // lime
];
