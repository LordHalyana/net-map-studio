/**
 * Shared SVG marker defs for canvas edges (visual-parity M3, gap G3): the
 * concept's circular "port dots" where an edge meets a node. `context-stroke`
 * makes the dot inherit each edge's stroke color, so membership dots are
 * VLAN-colored and link dots neutral without per-edge markers.
 */
export const PORT_DOT_MARKER = 'netplan-port-dot';

export function EdgeMarkerDefs() {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden>
      <defs>
        <marker
          id={PORT_DOT_MARKER}
          viewBox="0 0 8 8"
          markerWidth={8}
          markerHeight={8}
          refX={4}
          refY={4}
          markerUnits="userSpaceOnUse"
        >
          <circle cx={4} cy={4} r={2.6} fill="context-stroke" />
        </marker>
      </defs>
    </svg>
  );
}
