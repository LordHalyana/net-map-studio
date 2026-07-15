# Polymorphic connection endpoints with per-type constraints

A connection endpoint is a `(kind, id)` reference where `kind ∈ {interface, device, network, zone, subnet}`, constrained per connection type: a `Link` requires **Interface** endpoints (physical port-level fidelity), while a `PolicyRule` and `Flow` may also target a Device, Network or Zone. Firewall policy is written network-to-network, not port-to-port, so forcing everything onto interfaces (or everything onto devices) would either fabricate fake interfaces or lose which port a cable uses.

## Consequences

- Referential integrity across the polymorphic reference isn't a single DB constraint — it's validated in the domain layer (already on the Operation-log mutation path) and needs an endpoint-deletion cleanup rule (the "orphaned rules referencing deleted objects" check requires this anyway).
