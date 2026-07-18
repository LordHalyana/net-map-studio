# React Flow (xyflow) as the canvas foundation

The canvas — the heart of the product — is built on React Flow. Its nodes are React components (so status/OS/confidence/evidence badges come naturally), its sub-flows give us the collapsible physical containers (ADR-0013), and its built-in minimap/zoom/pan map directly onto the design's toolbar. The 100-device Phase-1 target is well within its comfort zone.

## Considered Options

- **Cytoscape.js / Konva / WebGL** — scale to thousands of nodes but fight rich React-component nodes and inspector binding, or require building edges/selection/grouping/minimap by hand. Rejected for the editor.

## Consequences

- The design deliberately never renders raw observations on the canvas (Flows are bundled/aggregated/filtered), so React Flow's DOM-rendering ceiling is not hit by the core editor.
- If a future analytic view genuinely needs graph-scale rendering, it becomes a _separate, specialized, read-only view_ — it does not change the editor's foundation.
