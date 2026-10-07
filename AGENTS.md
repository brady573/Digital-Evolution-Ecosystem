Agent Instructions

This file defines the repository-wide working contract for coding agents and human contributors working in Digital Evolution Ecosystem.

It governs implementation practice, architecture boundaries, validation, and submission behavior. It does not define product direction, autonomous agent orchestration, or project-management topology.

Authority and working model

The Project Owner is the product and design decision authority.

Product meaning, simulation semantics, user-visible behavior, and accepted design are established outside this repository workflow and supplied to implementation through a bounded handoff.

The ordinary implementation flow is:

Project Owner / Design Partner
        |
        | accepted design + bounded implementation handoff
        v
    Coding Agent
        |
        | implementation + validation evidence
        v
      Review

The Coding Agent owns implementation strategy, source changes, low-level architecture, tests, and engineering execution within the accepted handoff and the repository constraints in this file.

The Coding Agent must not invent or silently redefine material product behavior, simulation meaning, reproducibility semantics, scientific claims, or evidence semantics.

Implementation activation

Implementation work should begin from a bounded, self-contained handoff on the relevant GitHub issue or equivalent explicitly supplied task context.

A valid implementation handoff should provide enough controlling design context to execute without requiring private or unavailable external sources.

Google Drive is the durable product/design workspace, but Coding Agents must not assume they have Drive access. Drive references may provide provenance; the implementation handoff itself must contain the requirements, invariants, acceptance criteria, stop conditions, and material design semantics required for the task.

Before implementing an issue-based handoff, read the current issue thread, including later comments that may amend or supersede earlier instructions.

If repository prose conflicts with an explicitly supplied newer accepted design handoff, stop and surface the conflict rather than silently choosing one.

Source-of-truth precedence

Use this only when authority or intent actually needs resolving; it is not a step to perform on every task. When sources appear to conflict, weigh them in this order:

1. Owner direction. Explicit direction in the current task controls the current product decision when it is clear.
2. Accepted design. An accepted design, handoff, or explicitly supplied design reference defines required behavior, simulation meaning, protected invariants, and acceptance criteria within its scope.
3. Repository instructions. The applicable AGENTS.md and current repository policy govern engineering workflow, architecture constraints, validation, and repository practices.
4. Current implementation. Source, tests, issues, pull requests, and CI describe what currently exists; they do not silently redefine intended product behavior.
5. Validation evidence. Evidence supports only the claim actually exercised, and never creates a new product requirement.
6. Historical material. Prototypes, superseded plans, and prior behavior are provenance unless a current contract explicitly preserves them as authority.

Classify the conflict first, as product or design intent, implementation fact, validation evidence, or historical provenance. Do not infer intended product behavior from current code or from a historical implementation, and never resolve a product-design conflict by guessing from code. Surface a genuinely unresolved product or design decision instead of inventing one.

What this repository is

Digital Evolution Ecosystem implements the Living Evolution Explorer, an offline-first evolutionary simulation and investigation product.

Users can create evolving worlds, observe autonomous evolution, investigate ecological history and ancestry, intervene transparently, and compare evolutionary outcomes.

apps/explorer           Living Evolution Explorer UI and platform adapters
packages/contracts      Cross-boundary configuration, snapshots, commands,
                        checkpoints, read models, and export contracts
packages/sim-core       Deterministic biological simulation authority
packages/sim-analysis   Read-only ecological interpretation, metrics,
                        clades, history, and explanatory analysis
packages/sim-decisions  Pure observed-event -> decision-opportunity policy
packages/sim-runtime    Worker/session authority, execution, persistence
                        handoff, matched forks, and live read models
packages/phenotype      Presentation-facing phenotype derivation and assets
legacy/prototype        Frozen historical regression sources; never edit
tools/validation        Repository, simulation, presentation, browser,
                        scientific, platform, and evidence validation tooling

Use the current repository implementation rather than historical project documents to determine what code exists today.

Toolchain

- Node >= 24
- pnpm 12.5.1 via Corepack
- TypeScript monorepo
- React + Vite Explorer
- PixiJS where currently integrated
- Capacitor Android packaging

Install dependencies with:

pnpm install --frozen-lockfile

Do not add another runtime, package manager, backend, database, hosted service, or network dependency without explicit approval.

Validation authority

Validation is defined centrally in:

tools/validation/manifest.ts

The manifest is authoritative for validation units, evidence classes, routing, and blocking behavior.

Primary commands:

pnpm validation:check
pnpm validation:plan

pnpm verify
pnpm verify:fast
pnpm verify:simulation
pnpm verify:presentation
pnpm verify:browser
pnpm verify:evidence
pnpm verify:survey

Single-purpose scripts in "package.json" may be used while iterating on a bounded change.

Completion rule

A handoff's named validation checks are a minimum focused set, not the complete repository contract.

Completion requires:

1. the checks explicitly required by the handoff;
2. every additional blocking validation unit that the manifest routes for the actual diff;
3. any environment-specific evidence required for the claims being made.

Do not infer that one class of evidence proves another.

Examples:

- Node validation does not prove browser behavior.
- Browser success does not prove Android runtime behavior.
- Android packaging does not prove application behavior.
- A single deterministic run does not establish population-level scientific behavior.
- Visual evidence does not establish simulation correctness.
- A successful build does not establish biological validity.

Validation supports only the claim actually tested.

Changing validation

When adding or materially changing a validation check:

1. add or update the corresponding package script;
2. register the validation unit in "tools/validation/manifest.ts";
3. assign its evidence class, enforcement behavior, domains, and claim;
4. place blocking validation in the appropriate groups and CI routing;
5. run "pnpm validation:check".

Do not create independent validation behavior directly in workflow files when it belongs in the manifest.

Do not weaken, remove, bypass, reclassify, or make a validation gate non-blocking merely to make a change pass.

Owner-device execution rule

The Project Owner's device is an authoring and short-diagnostic environment, not a long-running compute environment.

Short, bounded commands needed to inspect or diagnose a change may run locally.

Do not launch or leave sustained workloads running on the Owner's device, including:

- full or exhaustive repository validation;
- scientific surveys or long-horizon simulation characterization;
- browser evidence capture requiring sustained execution;
- performance characterization;
- large production builds;
- Android builds, emulator work, or runtime evidence collection;
- other multi-minute or unattended workloads.

Route sustained validation and evidence generation to GitHub Actions, another remote runner, or another explicitly approved execution environment.

If CI has already proved a claim against the same relevant commit and configuration, reuse that evidence rather than rerunning the same expensive work locally.

Architecture rules

The intended dependency direction is:

apps/explorer -> sim-runtime -> sim-core
apps/explorer -> sim-analysis
apps/explorer -> phenotype

sim-runtime   -> sim-analysis
sim-runtime   -> sim-decisions

sim-decisions -> contracts
sim-analysis  -> contracts
phenotype     -> contracts where cross-boundary data is required

all product packages -> contracts as appropriate

Treat the current repository and its architecture validation as authoritative for exact enforced import boundaries.

Simulation authority

"packages/sim-core" is the biological authority.

It must not depend on:

- React;
- DOM APIs;
- browser workers;
- storage APIs;
- filesystem APIs;
- presentation frame timing;
- "requestAnimationFrame";
- wall-clock time;
- presentation-only state.

Biological outcomes must arise from simulation rules rather than presentation needs.

Analysis authority

"packages/sim-analysis" interprets read-only observations.

Analysis may explain, classify, aggregate, or detect patterns in simulation state.

Analysis output may affect presentation and explicitly designed observation/fast-forward behavior, but it must not mutate biological state or manufacture evidence.

Runtime authority

"packages/sim-runtime" owns the live simulation session and worker execution boundary.

The Explorer must not independently own mutable biological state.

Runtime commands must preserve the defined simulation authority, request settlement, persistence, and deterministic continuation contracts.

Decision policy

"packages/sim-decisions" is pure read-only policy.

It may map observed events to decision opportunities.

It must not:

- mutate simulation state;
- advance simulation time;
- create comparison worlds;
- own worker/session state;
- manufacture predicted outcomes.

A pending decision opportunity is a hard simulation pause wherever the accepted runtime contract requires it.

Presentation and phenotype

Presentation systems and "packages/phenotype" may derive visual state from resolved simulation/read-model state.

They must not become biological authority.

Story, explanation, salience, visualization, and the rest of the presentation layer may explain or expose observed simulation state, but must never rewrite biological or simulation-authoritative state to produce a desired presentation.

Rendering constraints must not introduce population caps, alter abundance, rewrite ecology, or change simulation behavior merely to make presentation easier or faster.

Reproducibility

The supported reproducibility contract must remain:

engine version
+ resolved configuration
+ seed
+ command sequence
= reproducible supported run

Do not introduce hidden state, wall-clock dependence, nondeterministic mutation order, presentation-owned RNG, or other behavior that violates that contract.

Emergence

Population abundance and ecological structure are simulation outcomes.

Do not introduce target-population rules, scripted ecosystem composition, artificial abundance control, or presentation-driven biological limits unless an explicit accepted design changes this principle.

Matched comparisons

Matched-control or matched-branch comparisons must preserve whatever exact state and RNG continuity the relevant comparison contract requires.

Do not approximate matched state when exact cloning is part of the supported behavior.

Checkpoints and evidence

Resumable checkpoints and evidence exports are different contracts.

Do not merge their authority or semantics merely because they contain overlapping data.

A checkpoint exists to preserve supported resumable state.

An evidence export exists to support inspection, analysis, provenance, or scientific review.

A contract that crosses a package or system boundary changes as a whole: update every materially affected producer, consumer, shared type, serialization and round-trip path, and the validation that protects it.

Working conventions

1. Inspect before abstracting. Read the implementation that owns a behavior before introducing a new abstraction.

2. Respect authority boundaries. Put biology in simulation authority, interpretation in analysis, session execution in runtime, and presentation behavior in presentation systems.

3. Keep diffs bounded. Prefer focused changes with a clear relationship to one accepted handoff.

4. Separate unrelated domains. Do not combine biological, presentation, runtime, persistence, and infrastructure changes in one change unless the handoff genuinely requires them to move together.

5. Test behavioral claims. Determinism, migration, parity, persistence, recovery, presentation, and biological claims require appropriate validation rather than comments or assumptions.

6. Preserve offline-first behavior. Simulation, saves, history, experiments, inspection, and supported evidence workflows must remain usable without a network connection unless an explicit accepted product decision changes that guarantee.

7. Prefer existing contracts. Extend current architecture where appropriate rather than inventing parallel state models or duplicate authority.

8. Preserve implementation freedom. Accepted design constrains observable behavior and product meaning. Low-level structure, naming, internal algorithms, batching, caching, test organization, and similar engineering choices belong to the Coding Agent unless explicitly constrained.

9. Do not optimize by changing meaning. Performance work may change representation and execution strategy, but must not silently change simulation semantics, evidence semantics, or supported user behavior.

10. Keep historical evidence historical. Completed experiments, superseded handoffs, prototypes, and old validation results remain provenance. They do not automatically define current product behavior.

Frozen sources

Do not edit:

legacy/prototype/

These files are historical regression evidence.

This is enforced by the runtime, not only by this prose: ".opencode/opencode.json" adds a project-level edit deny for "legacy/prototype/**", so the refusal happens before anything is written.

That file also names the default OpenCode agent, but no agent definition is versioned here; the agent team is a local prerequisite described in ".opencode/ADOPTED-SETTINGS.md". A session that cannot see that agent falls back to a different one silently, so confirm it with "opencode debug agents" rather than assuming it.

If a task appears to require modifying them, stop and surface the conflict.

Do not modify generated output such as:

dist/
node_modules/

Do not commit machine-specific toolchain repairs or temporary generated evidence unless the repository explicitly defines that artifact as versioned source.

Repository and Git safety

Unless explicitly authorized for the current task, do not:

- commit;
- push;
- merge;
- open or modify pull requests;
- rewrite branch history;
- force-push;
- reset or clean away user work;
- change remotes;
- change repository permissions;
- request elevated credentials.

Do not destroy or overwrite unrelated working-tree changes.

Do not use destructive Git operations as a troubleshooting shortcut.

Security and product boundaries

Do not:

- weaken security controls to make a task pass;
- add analytics or telemetry without explicit approval;
- add runtime network dependencies without explicit approval;
- add external services solely for implementation convenience;
- expose secrets or credentials;
- commit local secrets, tokens, private keys, or environment-specific credentials.

The product is offline-first by design. Repository tooling may use networked development infrastructure such as GitHub Actions, but that does not grant permission to introduce runtime network requirements into the product.

Product delivery domains

Current product work is commonly organized into three durable domains:

Game & Evolution
Experience & World
Foundation & Trust

These describe product ownership and dependency reasoning. They are not mandatory coding-agent identities or an autonomous implementation topology.

A task may affect more than one domain, but it should have one clear primary purpose and name concrete cross-domain dependencies rather than blocking on an entire domain.

Evidence & Validation is cross-cutting and is part of the definition of done for every relevant change. It is not a separate implementation authority.

Do not encode old global sequencing gates into implementation unless a current handoff explicitly requires the named dependency.

Handoff interpretation

When implementing a bounded handoff:

1. identify the requested observable outcome;
2. identify the controlling architecture and simulation constraints;
3. inspect the current implementation;
4. identify the smallest implementation scope that satisfies the handoff;
5. identify concrete dependencies rather than assuming broad project gates;
6. implement within the accepted design;
7. validate the actual claims introduced by the diff;
8. report deviations, unsupported assumptions, and remaining evidence gaps.

Distinguish:

- implementation freedom — an engineering choice that does not change accepted product meaning;
- design-significant drift — implementation would materially change accepted behavior or semantics;
- evidence gap — implementation exists but the required claim has not been demonstrated;
- Owner decision — more than one materially different product/simulation meaning remains possible.

Do not silently convert the last three categories into implementation freedom.

When to stop and return for design input

Stop implementation and surface the issue when:

- the requested work conflicts with an accepted architecture or simulation invariant;
- multiple materially different product or simulation meanings are possible and the handoff does not choose between them;
- the change would alter reproducibility semantics;
- the change would alter checkpoint or evidence authority;
- a presentation optimization would require changing biological behavior;
- a migration would accept state whose meaning is ambiguous;
- a security control or validation gate would need to be weakened;
- "legacy/prototype/" appears to require modification;
- elevated permissions or credentials are required;
- a required dependency or accepted design contract is missing;
- current implementation contradicts the controlling handoff in a way that cannot be resolved as ordinary implementation freedom.

Do not stop for ordinary engineering choices such as internal naming, local file organization, DTO names, cache implementation, serialization-library details within existing constraints, batching strategy, or test-file organization.

Definition of complete

A Coding Agent task is complete only when:

- the bounded requested behavior is implemented;
- architecture and authority boundaries remain intact;
- the handoff's focused acceptance checks pass;
- all blocking validation required by the actual diff is satisfied in the appropriate environment;
- relevant evidence is reported truthfully and only for the claims it supports;
- no design-significant deviation is hidden as an implementation detail;
- residual gaps or unsupported claims are explicitly identified;
- no unrelated user work was destroyed or rewritten.

Merged code, passing tests, scientific evidence, and design acceptance are distinct facts. Report them as such.
