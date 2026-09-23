# Digital Evolution Ecosystem

This repository hosts `repo-ai`, a local repository governance bootstrap. The Phase 2 core pack is checked by the [repo-ai workflow](.github/workflows/repo-ai.yml); Go tests, vet, and build run in [ci](.github/workflows/ci.yml).

```sh
go test ./...
go vet ./...
go run ./cmd/repo-ai check --format=json
```

Read the [deployment and policy reference](docs/repo-ai.md) before installing it into another repository.
