# NetPlan Studio

A local-first tool for planning networks, reconstructing existing ones from imported evidence, and surfacing security concerns. Every visual object on the canvas maps to a typed, validated domain object with an audit trail. This glossary is the ubiquitous language: use these terms exactly, in code, issues, tests and UI.

## Language

### Structure

**Project**:
The top-level workspace holding one modelled environment, its settings, ownership and history. The unit of export and import.

**Site**:
A building, customer location or logical environment within a Project. A physical grouping.
_Avoid_: Location, campus, tenant.

**Zone**:
A floor, room, rack, network segment or trust boundary inside a Site. The finest physical grouping; a Device lives in exactly one Zone.
_Avoid_: Segment, area, group.

### Devices & addressing

**Device**:
Any modelled node — hardware, virtual appliance, endpoint or logical service — that owns interfaces and appears on the canvas.
_Avoid_: Host, node, asset, machine.

**Interface**:
A physical or virtual network interface belonging to a Device. Interfaces — not Devices — are what physical connections attach to, and what carries Network membership.
_Avoid_: Port, NIC, adapter.

**Address**:
A MAC, IPv4, IPv6, hostname or alias assigned to an Interface.

**Network**:
A subnet, VLAN, SSID, routing domain or address pool. A _logical_ grouping expressed as membership on an Interface, never as physical containment.
_Avoid_: Subnet (when a VLAN/SSID is also meant), segment.

### Connections

**Connection**:
The render-time umbrella for anything drawn as an edge on the canvas. It is _only_ a visual/authoring concept — there is no single Connection object. Every connection is really a Link, a Flow or a PolicyRule.
_Avoid_: Edge (in domain talk), line, wire.

**Link**:
A structural relationship between two Interfaces — a physical cable, wireless association, or layer-2/3 adjacency. Low-cardinality, manually or physically defined. Endpoints are always Interfaces.

**Flow**:
An _observed_ communication from a source to a destination, derived from evidence and carrying first-seen, last-seen, count and confidence. High-cardinality.
_Avoid_: Traffic, connection (in the TCP sense), conversation.

**PolicyRule**:
An _intended_ allow / deny / reject / monitor rule with direction, action, logging, owner and justification. Validated for conflicts, shadowing and segmentation bypass.
_Avoid_: ACL entry, firewall rule (when the abstract intent is meant), policy.

**Endpoint**:
One end of a connection, expressed as a `(kind, id)` reference. A Link's endpoints must be Interfaces; a PolicyRule's or Flow's endpoints may also be a Device, Network or Zone.

**Service**:
A protocol, port and process — a listening or advertised capability on a Device, and the object a PolicyRule or Flow references for "what traffic."
_Avoid_: Port (alone), app.

### Identity & access

**Identity**:
A _modelled_ Windows or Linux user, group, service account or domain principal found in (or entered about) the environment being mapped. Describes the network, not who may use NetPlan Studio.
_Avoid_: User (unqualified), account.

**RoleAssignment**:
A mapping between an Identity, a privilege, a Device and a scope (e.g. local administrator on host X).

**Access Role**:
A NetPlan Studio _application_ permission set (Administrator, Network Engineer, Security Analyst, Operator, Reviewer, Viewer) governing who may do what in the tool. Kept strictly separate from a modelled Identity.
_Avoid_: Role (unqualified — always say Access Role or RoleAssignment), permission.

### Evidence & analysis

**Evidence**:
An imported source artifact — file, line/chunk reference, timestamp and parser metadata — that a fact can be traced back to. Stored read-only after ingestion.
_Avoid_: Source, data, import (the file).

**Adapter**:
A parser that maps one evidence format (Nmap XML, tshark flow summary, device-state JSON) into canonical Observations. Adapters never create entities directly; they only emit Observations.
_Avoid_: Parser (when the format→Observation mapping is meant), importer, connector.

**Import Contract** (the **Device-State Report**):
The versioned, NetPlan-Studio-authored JSON schema the client's extraction scripts must emit, validated by the standalone validator CLI. The one input format NetPlan Studio owns rather than adapts to.
_Avoid_: Export format, script output.

**Observation**:
A neutral, per-source _claim_ an Adapter emits about a Device, Interface, Address, Service, Flow or Identity — carrying a confidence contributor and an Evidence reference, before normalization, deduplication and scoring. Distinct from the committed entity it may become.
_Avoid_: Record (unqualified), reading, sample.

**Aggregation**:
Collapsing many raw observations of the same communication into a single Flow keyed by `(source, destination, service)` with count, first-seen and last-seen. Why the canvas renders one edge, not thousands.
_Avoid_: Rollup, summarization (when Flow aggregation is meant).

**Provenance**:
The record, per _field_, of where a value came from: source type, Evidence reference, confidence, parser version, and whether it was accepted, rejected or manually overridden. The reason "trace every property to its evidence" is possible.

**Confidence**:
How _certain_ a value or correlation is (e.g. exact MAC match = strong, single Netcat result = low). Always a distinct value from Severity.

**Severity**:
How _serious_ a Finding is if true. Deliberately independent of Confidence — a high-severity finding can be low-confidence.

**Reconciliation**:
The review step where conflicting or duplicate observations of the same real thing are resolved by an operator: merge, keep separate, replace or ignore. The system never silently merges.

**ImportJob**:
One run of the import pipeline: its status, parser/schema version, produced observations and rollback boundary.

**Finding**:
An advisory security, quality, conflict or design warning with category, affected object, Severity, Confidence, Evidence references, explanation and verification steps. Never a confirmed-compromise verdict.
_Avoid_: Alert, detection, incident, threat.

### Change & state

**Operation**:
A single reversible unit of change to the model — the atom of undo/redo, audit and rollback. Every mutation is expressed as an Operation.
_Avoid_: Edit, mutation, action, event.

**ChangeSet**:
A named group of Operations reviewed together — the vehicle for a proposal, an import's changes, or a batch edit.

**Lifecycle State**:
The stance of an object toward reality: Observed, Inferred, Manually verified, Planned, Deprecated or Removed-in-proposal. Every object carries one.
_Avoid_: Status (reserve "status" for Finding workflow states).

**AS-IS**:
The committed model of the environment as it actually is — imported and manually verified.

**TO-BE**:
A proposed future model, expressed as AS-IS plus a proposal ChangeSet (additions, removals, and field-deltas on existing objects). Not a separate copy of the graph.
_Avoid_: Target, future state (as a separate branch).

**Diff**:
The rendered difference between AS-IS and a TO-BE proposal — additions, removals and modifications.

### Grouping (a cross-cutting distinction)

**Containment**:
Single-parent _physical_ nesting (Site › Zone › Device). Rendered as collapsible container nodes. A Device has exactly one physical parent.

**Membership**:
Many-valued _logical_ belonging (a Device's Interface in a Network). Rendered as network-nodes or overlays — never as Containment, so a dual-homed Device in two VLANs is expressible.

### Output

**Report**:
A generated, possibly redacted summary, diagram or export package produced from the model (topology image, design report, CSV/JSON export, findings report).
