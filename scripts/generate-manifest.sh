#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

mkdir -p .repo-ai/generated

TMP="${TMPDIR:-/tmp}/repo-ai-manifest.$$"

{
    printf '{\n'
    printf '  "schema": "repo-ai/manifest/v1",\n'
    printf '  "files": [\n'

    first=1

    for file in \
        CLAUDE.md \
        .github/copilot-instructions.md \
        .cursor/rules/repo-ai.mdc
    do
        [[ -f "$file" ]] || continue

        hash="$(sha256sum "$file" | awk '{print $1}')"

        if [[ $first -eq 0 ]]; then
            printf ',\n'
        fi

        first=0

        printf '    {"path":"%s","sha256":"%s"}' \
            "$file" "$hash"
    done

    printf '\n  ]\n'
    printf '}\n'
} > "$TMP"

mv "$TMP" .repo-ai/generated/manifest.json
