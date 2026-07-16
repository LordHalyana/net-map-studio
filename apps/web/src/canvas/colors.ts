/**
 * Canvas color constants (M7 cleanup, gap G10). React Flow takes inline
 * style values, not CSS custom properties, so each constant mirrors the
 * like-named token in styles.css :root — change both together.
 */
export const CANVAS_BG = '#0b0e13'; // --bg
export const EDGE_NEUTRAL = '#8b94a7'; // --text-dim
export const EDGE_LABEL_TEXT = '#d7dde8'; // --text
export const EDGE_LABEL_BG = '#10151d'; // --bg-panel
export const FLOW_AMBER = '#e5b455'; // --warn
export const GRID_LINE = '#131926'; // --grid-line
export const MINIMAP_NEUTRAL = '#2c3547'; // --minimap-neutral

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
