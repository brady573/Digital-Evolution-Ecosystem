package policy

const CoreYAML = `schema: repo-ai/v1
rules:
  - id: coding.validate-before-completion
    level: guidance
    requirement: agents_run_check
  - id: governance.workflow.present
    level: check
    requirement: repo_ai_workflow_present
  - id: security.github.permissions
    level: enforce
    requirement: github_actions_no_write_all
`
