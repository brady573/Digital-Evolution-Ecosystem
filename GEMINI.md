# Gemini Instructions

This project uses [VibeCoding](https://www.npmjs.com/package/@srinnov/vibecoding) to keep project context persistent and vendor-neutral. The project's source of truth lives in these files — read them before doing anything, and keep them up to date.

Before making changes:

1. Read `project.md` — the user's requirements in their own words (free-form). This may be a rough paste; that is expected.
2. Read `projectContext.md` — a concise briefing on the current state.
3. Read `projectPlan.md` — the structured plan and open tasks.

Turn requirements into a plan:

4. Convert the raw requirements in `project.md` into structured requirements in `projectPlan.md`. Give each a stable ID (`REQ-<AREA>-<NNN>`, e.g. `REQ-AUTH-001`), a clear title, and acceptance criteria. This is YOUR job — do not ask the user to write IDs. Do not edit their requirements in `project.md` unless they ask.

While working:

5. Reference requirement IDs in code comments (e.g. `// impl: REQ-AUTH-001`) and in `projectTest.md` so work stays traceable.
6. Add or update test cases in `projectTest.md` for anything you implement.

After meaningful work:

7. Update `projectStatus.md` (overall status, completed items, next task, last-updated date).
8. Update `projectContext.md` when architecture, stack, or key decisions change — keep it short.
9. You can run `vibecoding trace` to see which requirements still lack tests or implementation.
