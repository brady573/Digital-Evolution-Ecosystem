# repo-ai Phase 3

`repo-ai` inspects repository files, resolves local policy sources, and evaluates the effective rules. It is vendor neutral and does not execute repository commands or make network requests during inspection or `check`.

## RepositoryFacts and detection evidence

`repo-ai inspect --format=json` prints a stable JSON `RepositoryFacts` object with sorted arrays: `languages`, `packageManagers`, `frameworks`, `testRunners`, `linters`, `formatters`, `ciSystems`, `monorepo`, and `workspacePaths`. Empty categories are empty arrays. Workspace paths are repository relative with `/` separators.

Detection uses file and manifest evidence only:

- Go: `go.mod`, `go.work`, root `*_test.go`, and `.golangci.yml`, `.golangci.yaml`, or `.golangci.toml`.
- JavaScript and TypeScript: `package.json`, TypeScript dependency, `tsconfig.json`, or root TypeScript source files. npm, pnpm, and Yarn lockfiles identify the corresponding manager.
- Python: `pyproject.toml` or `requirements.txt`; `uv.lock` and `poetry.lock` identify those managers. Requirements and named `pyproject.toml` tool sections can identify pytest, Ruff, and Black.
- Frameworks are detected from declared package dependencies: React, Next.js, Vue, Angular, and Svelte.
- Jest, Vitest, Mocha, ESLint, and Prettier are detected from dependencies or their named configuration files. GitHub Actions, GitLab CI, CircleCI, and Azure Pipelines are detected from their conventional workflow files.
- Workspace paths come from npm/pnpm workspace declarations or `go.work`. Only declared, matching directories with supported manifests are included. Symlinked workspace directories are not followed.

Detection is intentionally conservative. It does not inspect source syntax or infer a framework from file names; unsupported manifests, nested undeclared projects, and custom workspace formats may remain unknown. If multiple lockfiles are present, all evidenced managers are reported without choosing a preferred manager. A malformed `package.json` or workspace pattern is an inspection error.

## Configuration and policy sources

`.repo-ai/config.yaml` accepts the strict `repo-ai/config/v1` schema with `policy: core`. Key order, ordinary whitespace, single or double quoted scalar values, and comments do not change its meaning. Unknown fields, unsupported schema versions, non-scalar values, and unknown policy references fail with CLI exit 2.

Policy files use the same `repo-ai/v1` rule schema: a stable dotted rule `id`, one of `guidance`, `check`, or `enforce`, and a checker `requirement`. Local repository standards are loaded from `.repo-ai/standards/*.yaml` and `*.yml`. Duplicate IDs inside one file are invalid.

Sources resolve in this order:

1. Locked baseline core pack.
2. Built-in Go, JavaScript/TypeScript, and Python packs selected only when inspection finds that language.
3. Repository standards in `.repo-ai/standards/`.
4. Explicit rules in `.repo-ai/overrides.yaml`.

Rules merge by ID. A higher layer replaces the lower layer's effective definition; each resolved rule retains ordered source provenance. Incompatible definitions for the same ID within one layer are a configuration error. Identical definitions at equal precedence retain all contributing provenance. A repository standard that lowers a rule's severity or changes its checker requirement must include a `reason` in that rule. An override must target an existing rule and can change only its level or requirement; it cannot delete or introduce a rule. Lowering severity or changing the checker requirement requires a human-readable `reason` in the override.

Example override:

```yaml
schema: repo-ai/overrides/v1
overrides:
  - id: security.github.permissions
    level: check
    reason: "Approved temporary exception tracked by the repository owner"
```

## Digests, checks, and CLI results

`.repo-ai/policy.lock` continues to pin the canonical JSON digest of the compiled baseline core pack. The effective resolved policy has a separate SHA-256 digest over canonical JSON containing only its schema and sorted effective rule definitions. Provenance, filesystem paths, timestamps, and environment details are excluded. `check` returns the resolved policy, provenance, and digest in JSON, then evaluates those resolved rules.

Exit codes remain stable:

- `0`: compliant, or findings at guidance/check levels. Findings remain in JSON.
- `1`: at least one enforce finding.
- `2`: invalid configuration, policy or lock, resolver conflict, digest failure, inspection failure, or internal evaluation error.

The core policy rejects GitHub Actions `permissions: write-all`, reports a missing repo-ai workflow at check level, and reports missing `repo-ai check` instructions at guidance level. Detected stack policies currently check for the corresponding language manifest.

## Build and verify

```sh
go test ./...
go vet ./...
go run ./cmd/repo-ai inspect --format=json
go run ./cmd/repo-ai check --format=json
./scripts/verify.sh
```

OCI distribution, remote registries, agent-specific instructions, GitHub administration, source-code analysis, and broader framework detection are not implemented in this phase.
