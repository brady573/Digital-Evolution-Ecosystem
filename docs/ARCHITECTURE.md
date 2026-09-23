# repo-ai Architecture

repo-ai separates repository governance into four concerns:

1. Canonical policy
2. Agent guidance
3. Deterministic enforcement
4. Human governance

The processing lifecycle is:

    discover
       |
       v
    resolve
       |
       v
    compile
       |
       v
    validate
       |
       v
    enforce

Policy precedence:

    baseline
      -> detected stack
      -> repository standards
      -> explicit overrides
      -> resolved policy

Enforcement levels:

- guidance: instructions only
- check: diagnostic, non-blocking
- enforce: diagnostic and failing validation

Agent instructions are not considered a security boundary.

Deterministic CI is the merge enforcement boundary.
