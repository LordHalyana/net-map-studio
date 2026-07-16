/**
 * Canvas color constants (M7 cleanup, gap G10). All hexes live in palette.ts
 * (ui-polish M1) — this module keeps the consumer-facing names and the
 * accent-style helper.
 */
import { BG, BG_PANEL, TEXT, TEXT_DIM, WARN } from './palette';

export const CANVAS_BG = BG;
export const EDGE_NEUTRAL = TEXT_DIM;
export const EDGE_LABEL_TEXT = TEXT;
export const EDGE_LABEL_BG = BG_PANEL;
export const FLOW_AMBER = WARN;
export { GRID_LINE, MINIMAP_NEUTRAL, MINIMAP_MASK } from './palette';

/**
 * The node-accent custom property set inline by node components and read by
 * the .device-node / .network-node / .inspector-head CSS. Declared here so
 * accent styles need no `as` casts (phase-4 working agreement).
 */
declare module 'react' {
  interface CSSProperties {
    '--node-accent'?: string;
  }
}

export function accentStyle(color: string): React.CSSProperties {
  return { '--node-accent': color };
}
