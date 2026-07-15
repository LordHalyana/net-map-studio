# Single-operator local for the first release

The first release targets a single operator on one machine, not shared/multi-user deployment. Imported network data is sensitive (inventories, captures, usernames, findings), so keeping it on an operator-controlled deployment is a product principle, and every multi-user concern (concurrent editing, locking, enforced RBAC, IdP integration, Postgres operations) is overhead that doesn't advance the manual-planner goal. Multi-user shared deployment remains a supported *future* direction — see ADR-0007 (portable data layer) which exists specifically to make that a swap rather than a rewrite.

## Consequences

- Phase 1 has no enforced authentication; NetPlan **Access Roles** exist as data but are not enforced until multi-user lands.
