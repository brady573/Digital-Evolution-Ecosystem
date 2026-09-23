#!/bin/sh
set -eu
go test ./...
go vet ./...
go build -o /tmp/repo-ai ./cmd/repo-ai
tmp="$(mktemp -d)"
cd "$tmp"
/tmp/repo-ai deploy --non-interactive --format=json
/tmp/repo-ai check --format=json
