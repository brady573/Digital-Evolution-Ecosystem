# Canonical product migration

This branch migrates the Digital Evolution prototype into repository-native modules without changing the existing repository-management foundation.

## Protected sources

- `legacy/prototype/digital_evolution_prototype_v0_28_2.html` — validated biological regression baseline.
- `legacy/prototype/digital_evolution_prototype_v0_29_recovered.html` — latest implemented product/biology source, pending repository revalidation.
- `legacy/prototype/manifest.json` — source provenance and content identifiers.

These files are migration evidence. Do not edit them.

## Dependency direction

```text
apps/explorer -> sim-runtime -> sim-core
apps/explorer -> sim-analysis
sim-runtime   -> sim-analysis
all product packages -> contracts
```

`sim-core` is biological authority. It must not depend on React, DOM APIs, workers, storage, filesystem APIs, requestAnimationFrame, or wall-clock time.

`sim-analysis` interprets immutable/read-only simulation observations. Analysis output may affect presentation and fast-forward stopping conditions, never biology.

`sim-runtime` will own the live UniverseSession and real module worker. The application never directly owns mutable Simulation state.

## Migration gates

The migration stays in one PR, but extraction is gated internally:

1. source preservation;
2. deterministic fixtures from the legacy artifacts;
3. sim-core parity;
4. analysis non-interference;
5. module-worker parity;
6. product UI parity;
7. checkpoint round-trip parity;
8. full v0.29 revalidation.

Do not continue past a failed parity gate.

## Persistence contracts

The target distinguishes **UniverseCheckpoint**, **EvidenceExport**, and **UniverseSummary**. The prototype export is not assumed to be an exact save/resume format.
