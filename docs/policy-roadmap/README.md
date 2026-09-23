# Planned repository standards

These files preserve the repository-governance standards designed for
later repo-ai phases.

They are examples rather than active `.repo-ai/standards/*.yaml`
because the Phase 3 deterministic evaluator does not yet implement
checkers for these requirements.

A standard must not be promoted into `.repo-ai/standards/` until:

1. its requirement is supported by the deterministic policy evaluator;
2. tests cover compliant and violating repositories;
3. `repo-ai check` evaluates it deterministically; and
4. the canonical policy schema accepts its representation.

This prevents declarative policy from claiming enforcement that the
runtime does not actually provide.
