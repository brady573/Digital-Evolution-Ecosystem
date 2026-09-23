# Deployment

Inspect:

    repo-ai inspect --format=json

Preview:

    repo-ai deploy --dry-run --format=json

Deploy:

    repo-ai deploy --non-interactive --format=json

Validate:

    repo-ai check --format=json

Deployment must preserve existing unowned repository instructions.

Remote branch protection and GitHub rulesets remain human-controlled.
