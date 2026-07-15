---
template_id: design-document
template_name: Design Document
type: design_doc
---

# NetPlan Studio — Network Planning, Mapping and Risk Analysis Tool

> Project: NetPlan Studio
> Created: 2026-07-14
> Status: Concept / engineering handoff
> Visual reference: `concept_design_netplanner.png`

## 1. Purpose

NetPlan Studio is a local-first network planning and mapping application for small and medium-sized business environments. It provides a structured visual canvas where an operator can model network hardware, endpoints, VLANs, users, operating-system roles, protocols, access rules and observed communication paths.

The tool is intended to solve three related problems:

1. **Designing a planned network:** Build a clear TO-BE topology before equipment is installed or reconfigured.
2. **Reconstructing an existing network:** Import scan reports and extraction-script output, correlate the evidence and generate an editable AS-IS map.
3. **Highlighting security concerns:** Analyse device-state reports and observed network connections for suspicious filenames, unexpected software, unwanted internet communication and patterns that may indicate partial or network-wide compromise.

The central output is not only a diagram. It is a structured network model in which every node, connection, rule and warning has properties, evidence and an audit trail.

The visual concept supplied with this document is the intended interaction model: dark-mode workspace, component library on the left, topology canvas in the centre, contextual properties on the right and connection/rule details in a lower panel.

## 2. Goals & Non-Goals

### Goals

- Provide a fast, structured canvas for adding, moving, editing, grouping and removing network components.
- Support common SMB components, including routers, firewalls, switches, wireless access points, servers, NAS devices, VPN gateways, DNS/DHCP services, workstations, laptops, mobile devices, POS clients, payment terminals, printers, cameras, VoIP devices and custom components.
- Represent physical links, logical links, VLAN membership, routed paths, observed flows and policy relationships as typed connections rather than decorative lines.
- Allow an operator to define protocols, ports, direction, source, destination, action, logging state and rule ownership on a connection.
- Track both application users and modelled infrastructure identities:
  - NetPlan Studio users, permissions and project access.
  - Windows and Linux local/domain users, groups, service accounts, privileges and device-role assignments found in imported reports.
- Import existing network evidence and construct a draft map automatically.
- Preserve provenance: every imported property, inferred relationship and warning must point back to the source file and evidence record that produced it.
- Correlate duplicate observations from Nmap, Wireshark/tshark, Netcat and the client's extraction scripts.
- Flag suspicious filenames, persistence indicators, unexpected processes, abnormal outbound destinations and other compromise indicators without presenting uncertain matches as confirmed malware.
- Provide AS-IS, TO-BE and comparison views so an operator can distinguish observed reality from a proposed design.
- Export a portable project file and human-readable reports suitable for technical review, client delivery and later re-import.
- Operate locally or self-hosted by default because imported network data may contain sensitive client information.
- Use dark mode for the initial release. Light mode is deferred.

### Non-Goals

- NetPlan Studio is not an endpoint detection and response platform, antivirus replacement or security information and event management system.
- It will not claim that a host is infected based only on a filename, domain, IP address or heuristic match.
- The initial release will not exploit devices, perform penetration testing or automatically remediate systems.
- The initial release will not require a continuous live connection to the client network.
- It will not replace authoritative configuration systems such as Active Directory, device controllers, firewall managers or asset-management platforms.
- It will not attempt perfect automatic topology reconstruction from incomplete scans. Uncertain relationships must remain visibly uncertain and reviewable.
- It will not treat freehand drawing as authoritative network data. Decorative annotation may be supported later, but the primary model is node-and-edge based.

## 3. Design

### 3.1 Product principles

1. **Simplicity first:** Common actions must be available directly from the canvas without forcing the operator through multiple configuration pages.
2. **Structured data underneath:** Every visual object maps to a typed data object with validated fields.
3. **Evidence over assumption:** Imported facts, inferred facts and manually entered facts must be visually distinguishable.
4. **Human review remains mandatory:** Automatic mapping and risk detection generate drafts and findings, not unquestionable truth.
5. **Local-first handling:** Raw evidence remains on the operator-controlled deployment unless an external enrichment service is explicitly enabled.
6. **Reversible work:** Undo/redo, project history and import rollback are required for destructive or broad automatic changes.

### 3.2 User experience and workspace layout

The concept design should be implemented as five coordinated regions:

#### A. Project and command bar

- Project selector and project status.
- Save state, undo/redo and version checkpoint controls.
- Import, export, share and report actions.
- Zoom, fit-to-screen, grid and auto-arrange controls.
- Global search for devices, IP addresses, VLANs, users, rules and findings.

#### B. Left navigation and component library

Primary navigation:

- Canvas
- Overview
- Networks and VLANs
- Rules
- Users and Roles
- Findings
- Imports and Evidence
- Reports
- Settings

Component library categories:

- Network infrastructure
- Security appliances
- Servers and services
- Endpoints
- POS and payment
- Building systems and IoT
- Custom components

Components can be added by drag-and-drop, double-click or keyboard command. Custom icons may be uploaded, but all custom components must still be assigned a structured type and schema.

#### C. Central canvas

The canvas supports:

- Pan, zoom, snap-to-grid and optional free placement.
- Multi-select, copy, duplicate, group and delete.
- Collapsible containers for sites, floors, rooms, racks, security zones and VLANs.
- Node badges for status, confidence, warnings, operating system, evidence count and change state.
- Layer filters for physical topology, logical topology, observed traffic, planned rules, identities and findings.
- AS-IS, TO-BE and Diff modes.
- Automatic layout with manual pinning so operator-positioned nodes are not rearranged unexpectedly.
- A minimap for large diagrams.

#### D. Right-side inspector

The inspector changes based on the selected object.

For a device, it should show:

- Name, type, vendor, model, serial/asset identifier and location.
- Management state and criticality.
- Interfaces, MAC addresses, IP addresses and VLAN membership.
- Operating system and confidence level.
- Installed or observed services.
- Local/domain users, groups and assigned roles.
- Imported evidence and source files.
- Findings, notes, tags and ownership.

For a connection, it should show:

- Connection type: physical, logical, policy, observed flow, dependency or tunnel.
- Source and destination interfaces.
- Direction.
- Protocol, service and port/range.
- VLAN, subnet or routing context.
- Action: allow, deny, reject, monitor or undefined.
- Logging and alerting state.
- Observation count, first seen, last seen and confidence.
- Rule source, evidence and change status.

#### E. Context panel

The lower panel provides detailed editing without covering the diagram. Depending on selection, it displays:

- Link and rule editor.
- Activity and evidence log.
- Import reconciliation conflicts.
- Finding details and recommended verification steps.
- Before/after comparison for proposed changes.

### 3.3 Connection model: add/connect rather than freehand draw

The recommended implementation is a **connect mode**, not unrestricted line drawing.

The operator selects a source node or interface, selects a destination and completes a compact connection form. The application then renders the line automatically. This produces valid structured data and prevents ambiguous diagrams.

A connection can represent one of the following:

- Physical cable or wireless association.
- Layer-2 relationship.
- Layer-3 routed path.
- VLAN membership.
- Firewall or access-control policy.
- VPN or tunnel.
- Application/service dependency.
- Observed traffic flow.
- Inferred relationship.

Multiple services between the same source and destination should be stored as separate rule/flow records but may be visually bundled into a single expandable edge to reduce clutter.

### 3.4 Core data model

The canonical project model should include the following entities:

| Entity         | Purpose                                                              |
| -------------- | -------------------------------------------------------------------- |
| Project        | Top-level workspace, settings, ownership and history.                |
| Site           | Building, customer location or logical environment.                  |
| Zone           | Floor, room, rack, network zone or trust boundary.                   |
| Device         | Hardware, virtual appliance, endpoint or logical service.            |
| Interface      | Physical or virtual network interface.                               |
| Address        | MAC, IPv4, IPv6, hostname and aliases.                               |
| Network        | Subnet, VLAN, SSID, routing domain or address pool.                  |
| Link           | Physical or logical relationship between interfaces or devices.      |
| Service        | Protocol, port, process and listening/advertised service.            |
| Flow           | Observed source-to-destination communication.                        |
| PolicyRule     | Intended allow/deny/monitor rule.                                    |
| Identity       | Windows/Linux user, group, service account or domain identity.       |
| RoleAssignment | Mapping between an identity, privilege, device and scope.            |
| Evidence       | Source file, line/chunk reference, timestamp and parser metadata.    |
| Finding        | Security, quality, conflict or design warning.                       |
| ImportJob      | Import status, parser version, mapping result and rollback boundary. |
| ChangeSet      | Manual or automatic project changes grouped for review.              |
| Report         | Generated summary, diagram or export package.                        |

Every imported or inferred field should store:

- Value.
- Source type.
- Evidence reference.
- Import timestamp.
- Confidence score.
- Parser or rule version.
- Whether the value was accepted, rejected or manually overridden.

### 3.5 System architecture

A practical deployment is a browser-based application with a local/self-hosted service layer.

```text
Operator browser
      │
      ▼
Web application / Canvas UI
      │
      ▼
Application API
 ┌──────────────┬─────────────────┬──────────────────┐
 │ Project core │ Import pipeline │ Analysis engine  │
 └──────────────┴─────────────────┴──────────────────┘
      │                 │                  │
      ├──────────────┬──┴──────────────┬───┤
      ▼              ▼                 ▼   ▼
Structured DB   Evidence storage   Rule packs  Optional enrichment
```

#### Frontend

- Component library and project navigation.
- Graph/canvas renderer.
- Inspector and rule editor.
- Import review and conflict resolution.
- Findings dashboard and reporting.

#### Application API

- Project CRUD and access control.
- Canvas object validation.
- Import job orchestration.
- Search and filtering.
- Versioning, audit and export.

#### Import workers

Parsers should run as isolated jobs. A malformed or hostile input file must not crash the main application. Worker limits should include file size, execution time, recursion depth and decompression limits.

#### Storage

- Relational database for projects, typed entities, findings and audit history.
- File/object storage for original evidence and generated reports.
- Optional local embedded mode for a single operator.
- PostgreSQL-class deployment for shared/multi-user operation.

A dedicated graph database is not required for the initial version. A relational model with indexed relationship tables is simpler to operate and adequate for SMB-scale projects. A graph database can be revisited if path analysis becomes a measured bottleneck.

### 3.6 Import and topology reconstruction pipeline

The import pipeline should be adapter-based so the client's workflow can change without redesigning the application.

```text
Raw reports and extraction output
        │
        ▼
File identification and safety checks
        │
        ▼
Format-specific parser adapters
        │
        ▼
Canonical observation records
        │
        ▼
Normalization and deduplication
        │
        ▼
Correlation and confidence scoring
        │
        ▼
Draft devices, links, services, identities and findings
        │
        ▼
Operator review and commit to project
```

#### Supported evidence classes

**Nmap output**

Preferred structured input: XML. Expected observations include hosts, addresses, MAC/vendor data, open ports, service identification, OS guesses, scripts and scan timestamps.

**Wireshark/tshark output**

Preferred inputs: PCAP/PCAPNG retained as evidence, with parsed flow summaries in JSON or CSV. Expected observations include protocols, endpoints, DNS requests, service ports, conversations, timestamps and traffic direction.

**Netcat output**

Netcat evidence is treated as supplemental text because output structure depends on how the command was used. Import profiles should allow the client to define known command formats. Results may confirm reachability, banner data or service response, but should not independently create high-confidence topology.

**Client extraction scripts**

The client scripts should emit a stable, versioned schema. JSON is preferred for nested device-state data, with CSV accepted for tabular exports. A complete device state report may include:

- Device identifier, hostname, operating system and timestamps.
- Interfaces, routes, DNS, ARP/neighbour cache and active connections.
- Listening ports and owning processes.
- Running processes and executable paths.
- Installed applications/packages.
- Local users, groups, administrators/sudoers and service accounts.
- Scheduled tasks, services, startup entries and persistence locations.
- Shared folders, remote-access tools and exposed management services.
- Selected file inventory entries, hashes where available and collection scope.
- Collection errors and permissions that prevented inspection.

The application should publish a machine-readable import contract and validation tool so the client's extraction scripts can be changed without guesswork.

#### Optional workflow improvements

The architecture should leave room for additional adapters that produce structured host, flow, asset or alert data. Selection of specific tools belongs in implementation planning, but the preferred direction is to ingest their exported results rather than tightly coupling NetPlan Studio to a scanner.

### 3.7 Correlation and confidence

Automatic reconstruction requires explicit confidence handling.

Example confidence contributors:

- Exact MAC address match: strong.
- Exact stable device identifier from the client's script: strong.
- IP address match inside the same scan window: medium to strong.
- Hostname match: medium, depending on uniqueness.
- Vendor/model inference from banner data: medium or low.
- Traffic observation without endpoint identity: low to medium.
- Single Netcat text result: low unless corroborated.

The system must not silently merge conflicting devices. Conflicts should enter a reconciliation queue showing:

- Candidate records.
- Matching evidence.
- Conflicting values.
- Proposed action: merge, keep separate, replace or ignore.

### 3.8 Security analysis and compromise warnings

The analysis engine is advisory. It produces findings with severity, confidence, evidence and verification guidance.

#### Detection inputs

- Filenames and executable paths.
- File hashes supplied by extraction scripts.
- Running processes and parent/child relationships when available.
- Listening ports and process ownership.
- Startup entries, scheduled tasks and services.
- Installed remote-access or administration software.
- DNS queries, external IP connections and destination ports.
- Repeated failed or denied communication.
- Unexpected communication between security zones.
- Devices contacting destinations inconsistent with their declared role.
- Known operator-maintained allowlists, denylists and expected-service baselines.

#### Finding categories

- Suspicious filename or path.
- Known indicator match.
- Potential masquerading or double-extension pattern.
- Unexpected executable location.
- Unapproved remote-access software.
- Unusual persistence entry.
- Unexpected external destination.
- Beacon-like periodic communication.
- Clear-text or obsolete protocol use.
- High-risk exposed management service.
- Unexpected cross-VLAN communication.
- Privileged user or service-account anomaly.
- Evidence conflict or incomplete collection.

#### Finding structure

Each finding must include:

- Title and category.
- Affected device, identity, service or connection.
- Severity and confidence as separate values.
- Exact evidence references.
- Detection rule and rule version.
- Explanation written for an operator.
- Verification steps.
- Status: new, acknowledged, under review, false positive, accepted risk or resolved.
- Analyst notes and audit history.

#### Network-wide compromise assessment

A network-wide warning should only be raised when multiple correlated indicators meet a defined threshold, for example:

- The same suspicious destination is contacted by several unrelated devices.
- Similar persistence or executable indicators appear across hosts.
- A device with elevated privileges communicates with multiple internal systems in an unusual pattern.
- Observed lateral communication conflicts with the intended segmentation model.

The warning must state that the network **may be compromised**, identify the correlation logic and show the evidence chain. It must never state confirmed compromise unless the operator explicitly records an externally validated incident conclusion.

#### External enrichment

External reputation or threat-intelligence lookup should be optional and disabled by default. Enabling it may disclose client IP addresses, domains, filenames or hashes to third parties. The UI must explain this before activation and allow privacy-preserving configurations, such as hash-only or operator-managed feeds.

### 3.9 Identity and role modelling

Two role systems must remain separate in the data model.

#### NetPlan Studio access roles

Initial roles:

- **Administrator:** system configuration, user management and full project access.
- **Network Engineer:** create/edit projects, import evidence and approve topology changes.
- **Security Analyst:** review evidence and findings, manage rules and risk status.
- **Operator:** update assigned projects and run approved imports.
- **Reviewer:** comment and approve/reject change sets.
- **Viewer:** read-only access.

Permissions should be capability-based so deployments can define custom roles later.

#### Modelled Windows and Linux roles

Imported identities may include:

- Windows local users and groups.
- Active Directory users, groups and service accounts when supplied.
- Local administrators, Remote Desktop users and service-logon assignments.
- Linux users and groups.
- sudo/wheel membership and explicit sudo rules.
- Service accounts, system users and SSH-authorized identities when supplied.

The canvas should not display every identity by default. Identity overlays and inspector views prevent the main topology from becoming unreadable.

### 3.10 Planning workflow: AS-IS, TO-BE and Diff

A project may contain parallel states:

1. **AS-IS:** imported and manually verified current environment.
2. **TO-BE:** proposed future topology and policy.
3. **Diff:** additions, removals and modifications required to move from AS-IS to TO-BE.

Objects should use state markers:

- Observed.
- Inferred.
- Manually verified.
- Planned.
- Deprecated.
- Removed in proposal.

This separation prevents planned rules from being mistaken for existing protections.

### 3.11 Rules and policy validation

The rule editor should support:

- Source and destination device, group, zone, VLAN or subnet.
- Protocol and port/service object.
- Direction and action.
- Logging requirement.
- Business justification and owner.
- Effective status and optional review date.

Validation checks should identify:

- Overlapping or contradictory rules.
- Any-to-any rules.
- Rules that bypass intended segmentation.
- Orphaned rules referencing deleted objects.
- Observed traffic with no matching planned rule.
- Planned rules that have never been observed, without assuming they are unnecessary.
- Rules shadowed by broader rules.

### 3.12 Reporting and export

Required outputs:

- Editable project export with schema version.
- PNG/SVG topology image.
- PDF or HTML design report.
- CSV export of devices, interfaces, services, flows, identities, rules and findings.
- Machine-readable JSON export.
- Evidence manifest with hashes.
- Change report between AS-IS and TO-BE.
- Security findings report with severity, confidence and evidence.

Exports must support redaction profiles, for example hiding usernames, public IP addresses, serial numbers or evidence paths in client-facing reports.

### 3.13 Security, privacy and audit requirements

- Local authentication for standalone mode and support for external identity integration in shared deployments.
- Role-based project authorization.
- Encryption in transit and encrypted storage where supported by the deployment.
- Original evidence stored read-only after import.
- File hashing on ingestion to preserve evidence identity.
- Full audit trail for imports, merges, manual overrides, finding decisions and exports.
- No raw evidence included in application telemetry.
- Configurable retention and secure deletion of imported files.
- Parser sandboxing and archive-bomb protections.
- Project backup and restore testing.
- Secrets, credentials and private keys detected in imports should be masked in the UI and excluded from default reports.

### 3.14 Delivery phases

#### Phase 1 — Manual planner MVP

- Dark-mode canvas and component library.
- Typed nodes and connections.
- VLANs, networks, interfaces, protocols and rules.
- Project save/load, undo/redo and basic exports.
- NetPlan Studio users and access roles.

#### Phase 2 — Import and AS-IS reconstruction

- Import job framework and evidence store.
- Nmap XML adapter.
- Wireshark/tshark flow-summary adapter.
- Client extraction-script JSON schema and validator.
- Deduplication, confidence and reconciliation UI.
- AS-IS/TO-BE/Diff model.

#### Phase 3 — Security findings

- Versioned local rule engine.
- Filename, process, persistence, exposed-service and external-connection findings.
- Finding workflow and evidence views.
- Network-wide correlation with conservative thresholds.
- Redacted reporting.

#### Phase 4 — Advanced integrations

- Additional importer adapters.
- Optional threat-intelligence enrichment.
- External identity provider integration.
- Collaborative review and approval workflow.
- Scalable background workers for large evidence sets.

### 3.15 Acceptance criteria for the first usable release

The first usable release is complete when an operator can:

1. Create a project and manually build a network with at least 100 devices without the canvas becoming impractical.
2. Create typed links and rules with protocols, ports, direction and action.
3. Model VLANs, networks, interfaces and Windows/Linux identities.
4. Import an Nmap XML file and a client device-state JSON file.
5. Review, merge or reject automatically proposed devices and relationships.
6. Trace every imported property back to its source evidence.
7. Separate observed and planned objects.
8. Receive clearly labelled, evidence-backed security findings.
9. Export the project, topology image and a structured report.
10. Restore the project from its exported package without losing object identifiers or evidence links.

## 4. Alternatives Considered

### Freehand diagram editor

**Rejected as the primary model.** It is quick for sketches but produces lines and icons with no reliable semantics. A typed connection workflow provides better validation, imports, reporting and future automation. Limited annotation tools may be added later.

### Built-in active network scanner

**Deferred.** Direct scanning would simplify collection but increases deployment complexity, permissions, safety concerns and client-network risk. Import-first architecture works with the client's current tools and keeps collection separate from analysis. A controlled scanner orchestrator can be considered later.

### Cloud-only SaaS

**Rejected for the initial product.** Network inventories, packet captures, usernames and security findings are sensitive. A local/self-hosted deployment gives the client control over storage and disclosure. Cloud collaboration may be offered later as an explicit deployment choice.

### Graph database from the first release

**Deferred.** Graph queries are attractive for topology analysis, but a relational model is easier to deploy, back up and audit. Graph technology should only be introduced after real performance measurements justify it.

### Automatic malware verdicts

**Rejected.** Filename and connection analysis is probabilistic. The product should generate risk findings and evidence, not unsupported infection verdicts.

### One fixed report format

**Rejected.** The client already has editable extraction scripts and multiple collection tools. A versioned canonical schema plus adapters is more maintainable than forcing all collection into one command or one tool.

### Rendering every observation directly on the canvas

**Rejected.** Packet and flow data can create thousands of edges. Aggregation, filters, layers and drill-down are required to keep the topology usable.

## 5. Risks & Mitigations

| Risk                                                      | Impact                                        | Mitigation                                                                                                |
| --------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Incomplete or inconsistent scans                          | Incorrect or misleading topology              | Confidence scores, evidence provenance, reconciliation queue and manual verification states.              |
| Dynamic IP addressing causes duplicate devices            | Inflated inventory and wrong links            | Prefer stable identifiers, correlate within time windows and never auto-merge ambiguous records.          |
| Packet captures produce excessive data                    | Slow imports and unreadable diagrams          | Pre-aggregate flows, use import limits, background workers and layer filters.                             |
| Filename heuristics create false positives                | Operator fatigue and loss of trust            | Separate severity from confidence, show exact evidence, support allowlists and require human disposition. |
| Threat-intelligence lookup leaks client data              | Privacy and contractual exposure              | Disable by default, document disclosure, support local feeds and granular lookup controls.                |
| Malicious import file targets the application             | Service compromise                            | Isolated parsers, resource limits, read-only evidence, archive protections and dependency patching.       |
| Planned and observed states are confused                  | Bad implementation decisions                  | Enforce AS-IS/TO-BE separation and visible state badges.                                                  |
| Automatic layout destroys operator work                   | Usability failure                             | Manual node pinning, preview before apply and undoable layout changes.                                    |
| Too many node and edge types overwhelm users              | Slow adoption                                 | Curated defaults, progressive disclosure, templates and role-based views.                                 |
| Sensitive usernames, paths or addresses appear in reports | Data leakage                                  | Redaction profiles, report preview and safe defaults.                                                     |
| User-role model becomes mixed with imported OS identities | Authorization errors and conceptual confusion | Separate application access-control entities from modelled infrastructure identities.                     |
| Broad rule engine is mistaken for EDR/SIEM coverage       | False sense of security                       | Clear product boundaries, evidence-based language and explicit collection limitations.                    |
| Parser changes break old imports                          | Loss of reproducibility                       | Store parser version, schema version and original evidence; maintain migration tests.                     |
| Large projects exceed browser performance                 | Poor operator experience                      | Canvas virtualization, edge aggregation, clustering and tested scale thresholds.                          |
| Evidence retention grows without control                  | Storage and compliance problems               | Retention policies, project quotas, deduplication and secure deletion workflow.                           |

## 6. Open Questions

> Q1–Q6, Q11 and Q13 were resolved during Phase 2 planning (see `docs/plan/phase-2-implementation-plan.md` and the cited ADRs). The remainder stay open for Phase 3/4.

1. ~~Will the first deployment be single-operator local use, shared on-premises use or both?~~ **Resolved (ADR-0001):** single-operator, local-first; multi-user deferred.
2. ~~Should the product be a standalone NetPlan Studio application, or should it remain split into a collection/normalization service and a separate proposal-design frontend?~~ **Resolved (ADR-0002):** single app — local web server + browser SPA.
3. ~~What exact formats do the client's current extraction scripts produce, and can the scripts be changed to a versioned JSON schema?~~ **Resolved (ADR-0018):** NetPlan Studio owns a versioned canonical device-state JSON schema; the client's scripts conform to it.
4. ~~Which fields are collected on Windows and Linux today: users, groups, processes, services, scheduled tasks, packages, hashes and active connections?~~ **Resolved (ADR-0018):** the full §3.6 report is published now; P2-reconstruction fields required/strict, P3 security fields optional/loose.
5. ~~Should raw PCAP/PCAPNG files be stored inside the project, referenced externally or optionally discarded after flow extraction?~~ **Resolved (ADR-0019):** split by class — structured evidence inline, PCAP summarized-by-default with the raw blob opt-in; hash + manifest always retained.
6. ~~What is the expected maximum project size for devices, flows, identities and evidence files?~~ **Resolved (ADR-0019):** SMB tier — ~500 devices, ~100k raw flows aggregated to ≤~5k, ~2k identities; forces background-worker import, flow pre-aggregation and virtualized lists.
7. Does the operator need multi-site and multi-customer tenancy in the first release?
8. Which report formats are contractually required for client delivery?
9. Should findings use an existing classification framework, a product-specific taxonomy or both?
10. Will external threat-intelligence services be permitted under the client's privacy and data-processing requirements?
11. ~~Are Active Directory, Entra ID, LDAP or local-only identities expected in the first identity-import version?~~ **Resolved (ADR-0022):** local identities only in P2; observed-domain principals via `Identity.scope`; directory adapter → P4.
12. Should the application support firewall-vendor configuration export, or only vendor-neutral policy modelling?
13. ~~Which approval steps are required before an inferred device or finding becomes part of the verified AS-IS model?~~ **Resolved (ADR-0021):** reconciliation edits a pending ChangeSet before commit; committed objects are AS-IS as Observed/Inferred; manual verification is a badge, not a gate.
14. Is the visual concept's three-role model sufficient for the MVP, or are separate Engineer, Security Analyst, Reviewer and Operator roles required immediately?
15. What data must be redacted by default when exporting a report outside the engineering team?
