# The import contract is owned and canonical, not adapted per-client

The client's extraction scripts must emit a **NetPlan-Studio-authored, versioned device-state JSON schema**. The schema is defined once as a Zod schema in `packages/import-contract` (ADR-0017: Zod is the single source), from which we generate a language-agnostic **JSON Schema** artifact and ship a **standalone validator CLI** the client runs offline or in their own CI. Third-party tool outputs we do _not_ control (Nmap XML, tshark flow summaries) get dedicated **Adapters** that map their format into canonical Observations (ADR-0020); only the client's own scripts are held to our schema.

The v1 contract publishes the **full** §3.6 device-state report so the client instruments their fleet **once**, but validation strictness is split: fields the P2 reconstruction needs (device id/OS, interfaces, addresses, routes, ARP/neighbour, active connections, listening ports + owning process, local users/groups/admins/sudoers, collection scope/errors) are **required and strictly typed**; the P3 security fields (processes, packages, persistence, file inventory/hashes, shares/remote-access) are **optional and loosely typed** — accepted, hashed and stored as Evidence, parsed when P3 lands.

## Considered Options

- **Adapt to whatever the client's scripts already emit** — meets clients where they are, but every client becomes a bespoke parser, and `ImportJob.schemaVersion`/provenance versioning lose meaning. Rejected.
- **Publish only the P2 subset now, extend the schema in P3** — smaller surface, but forces a second, disruptive fleet-reinstrumentation pass. Rejected in favour of full-contract-now / P2-required-P3-optional.
- **In-app validation only** — no separate package, but useless for the "fix your scripts before importing" and CI workflows §3.6 requires. Rejected.

## Consequences

- One Zod schema feeds the CLI, the in-app P2 parser (plan M4) and the emitted JSON Schema — an entity shape is never defined twice.
- `ImportJob.schemaVersion` (seam already present) gains a real owner; old bundles migrate by version.
- Adapters and the client contract share the canonical Observation target (ADR-0020), so adding an adapter never reshapes entities.
