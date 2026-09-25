# Handoff queue

The transport between the product design work (ChatGPT) and the coding agents
that implement it.

A ChatGPT project in the chatgpt.com app has no API. It cannot be polled, pushed
to, or called from a script. The only programmatic hooks ChatGPT offers are
Custom GPT Actions (which need a public HTTPS endpoint you host) and the plain
OpenAI API (which cannot see your project chats or files). So the human copy
step is the transport, not a workaround. This queue makes that transport cheap,
versioned, reviewable, and impossible to misread.

## Layout

```text
handoffs/
  TEMPLATE.md   the one format both sides obey
  INDEX.md      ledger: every handoff, both directions
  inbox/        ChatGPT -> agents
  outbox/       agents -> ChatGPT
```

Both directories are committed. A handoff that only exists in a terminal
scrollback is lost; a handoff that is a file is re-readable by any agent, in any
session, forever.

## Direction 1: ChatGPT -> agent

1. In the ChatGPT project, end the design conversation with: *"Write the
   handoff for this work using the format in `handoffs/TEMPLATE.md`."* Attach
   the template if the project does not already have it.
2. Copy the block into `handoffs/inbox/HNN-000N-slug.md`, filling in `created`.
3. Add a row to `INDEX.md`.
4. Commit. That commit is the work order.

## Direction 2: agent -> ChatGPT

1. An agent claims the lowest-numbered `inbox` handoff whose `status` is
   `proposed`, sets `status: claimed`, and commits that.
2. It does the work and runs the `gate` command from the frontmatter.
3. It writes `handoffs/outbox/HNN-000N-result.md` with `responds_to: HNN-000N`,
   setting the inbox file's `status` to `done`.
4. The human drags that one outbox file into the ChatGPT chat. That is the step
   that closes the loop — without it, the design side never sees the result.

## Status values

| status | meaning |
|---|---|
| `proposed` | written by ChatGPT, not yet started |
| `claimed` | an agent has taken it and is working |
| `blocked` | an agent cannot proceed; the outbox says why |
| `done` | gate passed, outbox written |

## Rules

- `id` is unique, `HNN-` plus four digits, and never reused.
- An `inbox` file is authored by `chatgpt`. An `outbox` file is authored by
  `agent:<name>`.
- Every `outbox` file sets `responds_to` to an existing `inbox` id.
- Every `inbox` file with `status: done` or `blocked` has a matching `outbox`.
- `INDEX.md` mentions every id and no id that does not exist.

`pnpm test:handoffs` enforces all of the above. It runs inside `pnpm verify`, so
a malformed handoff fails the build like any other gate.

## Deliberate non-goals

No API keys, no network calls, no webhooks, no daemon. This must keep working on
a plane and in `proot` with no connectivity. If automation is ever wanted, the
hook goes in at the edge of this directory, not inside it.
