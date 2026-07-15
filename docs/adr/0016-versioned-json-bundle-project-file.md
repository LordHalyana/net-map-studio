# Portable project file is a versioned JSON bundle, not the DB file

The portable project file is a versioned `.netplan` JSON bundle (a `project.json` carrying every entity with its UUIDv7 ID, packaged with evidence blobs and a hash manifest) — fully decoupled from the storage engine. SQLite is only the local working store. This is the one option that satisfies all export requirements at once: schema-versioned (imports can migrate old bundles), JSON-native (it *is* the machine-readable export), redaction-friendly (filter fields at serialize time), evidence-manifest-ready, and storage-agnostic so the SQLite→Postgres move never touches the file format.

## Considered Options

- **The SQLite file is the project file** — dead simple, but couples the interchange format to an implementation detail we've already committed to changing, and makes redaction and schema-version negotiation awkward. Rejected.

## Consequences

- Serialize/deserialize plus a bundle schema-migration path is maintained alongside the DB schema — work the design already requires for reproducibility.
- In Phase 1 the bundle is just `project.json` + a schema version; the evidence subtree and manifest come online in Phase 2, but the envelope is designed for them now.
