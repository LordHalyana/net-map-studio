# Evidence retention is split by class; import parsing runs as a background worker

Raw Evidence retention is **policy-driven by evidence class**, not uniform. Small structured evidence (Nmap XML, device-state JSON, tshark flow summaries) is **stored inline** in the project's evidence subtree and therefore travels in the `.netplan` bundle (ADR-0016). Large binary captures (PCAP/PCAPNG) default to **summarize-and-drop the blob**: on ingest we hash the file (SHA-256), extract flow summaries, and retain the summary + hash + manifest entry, with the raw capture **opt-in** (operator may embed it in the bundle, keep it by external reference, or discard after extraction). **Provenance always survives** — hash and manifest entry are retained even when the raw blob is not.

Import parsing runs as an **isolated background worker**, never inline in the API request. A malformed or hostile file must not crash the app, and an SMB-scale capture (~100k raw flow observations, multi-GB PCAP) must not block a request. Workers enforce limits on file size, execution time, recursion depth and decompression ratio (§3.6, §3.13).

## Considered Options

- **Everything in the bundle** — maximum fidelity, but one capture makes the project un-shippable; violates the retention-control risk. Rejected.
- **Everything by reference** — lean, but re-importing a bundle on another machine loses the evidence entirely, breaking portability. Rejected.
- **Inline (synchronous) parsing** — simplest, but a multi-GB PCAP or archive bomb takes the API down with it. Rejected.

## Consequences

- The evidence subtree (ADR-0016) exists without being forced to hold multi-GB captures; hash-on-ingest and read-only original evidence (§3.13) hold for every class.
- `ImportJob.status` (`pending → parsing → review → committed | rolledBack | failed`) models the worker lifecycle already present in the seam.
- Retention/quotas/secure-deletion (risk table) operate on blobs independently of the provenance record that references them.
