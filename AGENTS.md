# repo-ai deployment contract

## Mission
Install repo-ai governance into the repository requested by the user. Never weaken or delete existing controls merely to make repo-ai pass.

## Deployment
1. Inspect the target repository and existing governance.
2. Run `repo-ai deploy --dry-run --format=json`.
3. If status is ready, run `repo-ai deploy --non-interactive --format=json`.
4. Review the diff. Preserve unowned files.
5. Run `repo-ai check --format=json` (or `go run ./cmd/repo-ai check --format=json` when using source).
6. Run the repository's existing affected tests, lint, and build.
7. Do not commit, push, open a PR, change remote settings, or request elevated credentials unless explicitly authorized.

## Stop conditions
Stop for human input if an enforce-level policy conflicts with existing policy, an unowned file must be overwritten, architecture cannot be safely classified, elevated permissions are required, or a security control would be weakened.

## Completion
Report detected stack, created and preserved files, checks executed, warnings, and required human actions.
