# repo-ai Phase 2

`repo-ai` is a vendor-neutral local policy checker. It recognizes a strictly defined policy YAML subset: `schema: repo-ai/v1`, `rules:`, and each rule's `id`, `level`, and `requirement`. Unsupported fields and duplicate rule IDs are errors. Rule IDs are lowercase dotted identifiers. Levels are `guidance` (reported, nonblocking), `check` (blocking), and `enforce` (blocking). Findings are sorted by rule ID, path, and message for stable JSON output.

The local core pack lives at `.repo-ai/packs/core/policy.yaml`. Its lock file stores SHA-256 of the canonical JSON representation of its parsed contents. `check` compares the local pack with the compiled core, validates the lock, then evaluates every rule. Changes to the core pack require a corresponding source and lock update. The core checks prohibit `permissions: write-all` in GitHub Actions workflows, require a repo-ai workflow, and advise agents to run `repo-ai check`.

## Build and check

```sh
go build -o repo-ai ./cmd/repo-ai
./repo-ai check --format=json
./scripts/verify.sh
```

## Deploy into a target repository

The source for `cmd/repo-ai` and `internal/policy` must accompany this bootstrap for the generated GitHub Actions workflow to run it from source. From the target root with `repo-ai` on PATH:

```sh
repo-ai deploy --dry-run --format=json
repo-ai deploy --non-interactive --format=json
repo-ai check --format=json
```

Deployment creates only missing policy and workflow files and preserves existing files; inspect every warning and review the diff. The workflow calls `go run ./cmd/repo-ai`, so copy the Go source and `go.mod` into target repositories that do not already contain them. Do not overwrite a target repository's existing Go module or governance files automatically.

The local core is currently fixed to the compiled version. OCI distribution, vendor adapters, semantic architecture checks, signed releases, and GitHub ruleset administration are future phases.
