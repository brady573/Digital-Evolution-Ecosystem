# repo-ai v1 bootstrap

A vendor-neutral, agent-deployable repository governance bootstrap.

## Build
```sh
go build -o repo-ai ./cmd/repo-ai
```

## Agent deployment
From the target repository, place `repo-ai` on PATH, then:
```sh
repo-ai deploy --dry-run --format=json
repo-ai deploy --non-interactive --format=json
repo-ai check --format=json
```

The bootstrap implements deterministic stack discovery, safe preservation of existing files, repository-local policy configuration, a basic CI workflow, JSON output, and deterministic validation.

## Important v1 bootstrap boundary
This package is intentionally deployable and compilable, but it is a bootstrap rather than the entire future policy ecosystem. OCI registry resolution, semantic architecture checks, full vendor adapter compilation, signed releases, and GitHub ruleset administration are extension points. The generated Actions checkout reference contains a TODO: pin it to a full immutable SHA before using enforce mode in production.
