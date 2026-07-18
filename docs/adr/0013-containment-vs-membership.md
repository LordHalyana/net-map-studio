# Physical Containment vs logical Membership are different mechanisms

Physical grouping (Site › Zone/Rack › Device) is modeled as single-parent **Containment** — collapsible container nodes, one physical parent per Device. Logical grouping (VLAN/subnet/SSID) is modeled as **Membership** — a property on Interface, rendered as network-nodes or overlays, never as containment. The two must be separate because a Device belongs to several groupings at once: one rack but possibly two VLANs (two interfaces). Visual containment can express only one parent, so it cannot carry VLAN membership without breaking on a dual-homed device.

## Considered Options

- **VLANs as containers too (forbidding multi-VLAN devices in the MVP)** — simpler rendering, but contradicts the layer model and boxes us in at the first switch trunk or dual-homed server. Rejected.

## Consequences

- A network-node on the canvas is a _projection_ of a Membership property, not a stored topological node — so per-(network, view) layout positions are persisted as hints without making the Network a real node.
