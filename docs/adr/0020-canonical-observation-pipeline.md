# Adapters emit neutral Observations that normalize, dedup and score before touching the model

Every Adapter (device-state JSON, Nmap XML, tshark summary) maps its source format into **canonical Observation records** — neutral, per-source _claims_ about a Device, Interface, Address, Service, Flow or Identity, each carrying a confidence contributor and an Evidence reference. Adapters never create entities directly. Observations then flow through a shared pipeline: **normalization** (canonical forms for MACs, IPs, hostnames), **deduplication** (collapse repeat observations; Flows aggregate to one record per `(source, destination, service)` with count/first-seen/last-seen), and **confidence scoring** (§3.7: exact MAC = strong, single Netcat text = low, etc.). The scored, deduped result populates the per-field provenance sidecar (ADR-0008) and becomes the proposed ChangeSet the operator reconciles (ADR-0021).

## Considered Options

- **Adapters produce entities directly** — fewer layers, but each adapter re-implements normalization/dedup/confidence, cross-source correlation has nowhere to live, and provenance is bolted on per-parser. Rejected.
- **Skip the intermediate and reconcile raw parser output** — collapses the neutral seam, so a new source format ripples into the reconciliation and provenance code. Rejected.

## Consequences

- Adding an Adapter (P4 directory sync, extra scanners) is additive: implement format → Observation, reuse the rest of the pipeline.
- The confidence contributors of §3.7 live in one scoring stage, testable in isolation, independent of any parser.
- Flow pre-aggregation (ADR-0019, SMB scale) happens here, so the canvas only ever sees aggregated Flows.
- The sidecar's "current accepted value is denormalized from the winning observation" (ADR-0008) is exactly this pipeline's output written through the Operation log.
