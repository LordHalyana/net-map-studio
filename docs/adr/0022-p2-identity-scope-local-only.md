# Phase 2 imports local identities only; directory sync is deferred to Phase 4

The first identity-import version ingests **local identities only** — the users, groups, local administrators and sudoers the device-state extraction script reports per host (already in the P2-required contract, ADR-0018). A domain principal _observed on a host_ (e.g. `DOMAIN\alice` is a local administrator on host X) is recorded as a **domain-scoped Identity** via its RoleAssignment: the `Identity` schema carries a `scope: local | domain` discriminator from day one, so the distinction is honest without importing the directory itself. An **authoritative directory adapter** (Active Directory / Entra ID / LDAP export, plus cross-host principal correlation) is **deferred to Phase 4**, where §3.14 already places external identity-provider integration.

## Considered Options

- **Ingest an authoritative directory export in P2** — richer identity graph, but it is a separate import source with its own adapter and a distinct correlation problem (one principal across N hosts) that would gate AS-IS reconstruction on work orthogonal to it. Rejected for P2.
- **Local-only with no domain scope** — simplest, but loses the ability to say `DOMAIN\alice` is the _same_ principal seen on two hosts, and forces a reshape when P4 adds the directory. Rejected.

## Consequences

- Real identity value (who is admin where) ships from the device-state import already committed to, with no new source.
- Cross-host correlation of domain principals in P2 is best-effort from observations; the authoritative merge waits for the P4 directory adapter — additive, because `Identity.scope` already exists.
- §3.9's two-role-systems separation (modelled Identity vs application Access Role) is unaffected; Access-Role enforcement remains a multi-user concern (ADR-0001).
