# Digital Evolution Ecosystem

This repository hosts `repo-ai`, a local repository inspector and deterministic policy resolver. Phase 3 adds structured repository facts, local Go/JavaScript/TypeScript/Python policy selection, standards, overrides, provenance, and effective policy digests.

```sh
go test ./...
go vet ./...
go run ./cmd/repo-ai inspect --format=json
go run ./cmd/repo-ai check --format=json
```

See the [repo-ai Phase 3 reference](docs/repo-ai.md) for supported evidence, precedence, and limitations.
