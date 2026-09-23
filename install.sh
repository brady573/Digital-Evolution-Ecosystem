#!/bin/sh
set -eu

REPO="brady573/Digital-Evolution-Ecosystem"
TARGET_DIR="$(pwd)"

TMPBASE="${TMPDIR:-}"
if [ -z "$TMPBASE" ] && [ -n "${PREFIX:-}" ]; then
  TMPBASE="$PREFIX/tmp"
fi
TMPBASE="${TMPBASE:-/tmp}"

die() {
  printf 'repo-ai install: %s\n' "$*" >&2
  exit 1
}

command -v git >/dev/null 2>&1 || die "git is required"
command -v go  >/dev/null 2>&1 || die "Go is required"

if [ -n "${PREFIX:-}" ] && [ -d "$PREFIX/bin" ]; then
  BINDIR="$PREFIX/bin"
else
  BINDIR="$HOME/.local/bin"
fi

mkdir -p "$BINDIR" "$TMPBASE"

WORK="$(mktemp -d "$TMPBASE/repo-ai-install.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT INT TERM HUP

printf '==> Installing repo-ai\n'

if [ -f "$TARGET_DIR/go.mod" ] &&
   [ -d "$TARGET_DIR/cmd/repo-ai" ]; then
  SOURCE="$TARGET_DIR"
else
  SOURCE="$WORK/source"
  git clone --depth 1 \
    "https://github.com/$REPO.git" \
    "$SOURCE"
fi

(
  cd "$SOURCE"
  go build -trimpath -o "$WORK/repo-ai" ./cmd/repo-ai
)

install -m 0755 "$WORK/repo-ai" "$BINDIR/repo-ai"
REPO_AI="$BINDIR/repo-ai"

printf '==> Installed %s\n' "$REPO_AI"

if git -C "$TARGET_DIR" rev-parse --show-toplevel >/dev/null 2>&1; then
  ROOT="$(git -C "$TARGET_DIR" rev-parse --show-toplevel)"
  cd "$ROOT"

  printf '==> Bootstrapping %s\n' "$ROOT"

  "$REPO_AI" deploy --non-interactive
  "$REPO_AI" generate

  printf '==> Validating repository\n'
  "$REPO_AI" check --format=json

  printf '\n==> repo-ai ready\n'
else
  printf '==> repo-ai installed; run it from inside a Git repository to bootstrap one.\n'
fi
