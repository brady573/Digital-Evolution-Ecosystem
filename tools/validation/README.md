# Migration validation

This directory contains repository-native parity and ecological validation tooling.

The protected sources live under `legacy/prototype/`. Validation must compare extracted modules against those exact artifacts rather than against an intermediate refactor.

Migration gates:

- deterministic same-seed state fixtures;
- exact clone continuation;
- UI/analysis non-interference;
- worker/direct parity;
- matched-fork integrity;
- substance mass accounting;
- checkpoint round trip;
- v0.29 cross-feeding/dormancy multi-seed validation.

v0.28.2 remains the validated regression baseline. v0.29 is the latest implemented source and must be revalidated before promotion.
