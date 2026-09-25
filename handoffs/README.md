# Handoff queue

The transport between the product design work (ChatGPT) and the coding agents
that implement it.

A ChatGPT project in the chatgpt.com app has no API. It cannot be polled,
pushed to, or called from a script. The only programmatic hooks ChatGPT offers
are Custom GPT Actions (which need a public HTTPS endpoint you host) and the
plain OpenAI API (which cannot see your project chats or files). So the human
copy step is the transport, not a workaround. This queue makes that transport
cheap, versioned, reviewable, and impossible to misread.

## Layout

```text
handoffs/
  TEMPLATE.md   the one format both sides obey
  INDEX.md      ledger: every handoff, both directions
  inbox/        ChatGPT -> agents
  outbox/       agents -> ChatGPT
```

An inbox handoff and its answering outbox deliberately share one id; that
pairing is the protocol. Ids look like `HDE-0001` (three uppercase letters,
hyphen, four digits) and are unique per directory, not globally.

## Direction 1: ChatGPT -> agent

1. In the ChatGPT project, end the design conversation with: *"Write the
   handoff for this work using the format in `handoffs/TEMPLATE.md`."*
2. Drop the result in `handoffs/inbox/`.
3. Add a row to `INDEX.md`.
4. Commit. That commit is the work order.

## Direction 2: agent -> ChatGPT

1. An agent claims the lowest-numbered `inbox` handoff whose `status` is
   `proposed`, sets `status: claimed`, and commits that.
2. It does the work and runs the `gate` command from the frontmatter.
3. It writes the answer in `handoffs/outbox/` under the same id
   (`author: agent:<name>`, `status: done`), setting the inbox file's
   `status` to `done` (or `blocked`, with the reason).
4. The human drags that one outbox file into the ChatGPT chat. That is the
   step that closes the loop — without it, the design side never sees the
   result.

## Status values

| status | meaning |
|---|---|
| `proposed` | written, not yet started |
| `claimed` | an agent reserved it (claim commit) |
| `done` | answered; matching outbox filed |
| `blocked` | cannot proceed; reason in the outbox |

## Enforcement

`pnpm test:handoffs` (inside `pnpm verify`) checks id format,
direction/author agreement, per-directory uniqueness, `responds_to`
resolution, done/blocked pairing, and INDEX/tree agreement. It self-tests
on synthetic fixtures first, so it cannot pass vacuously. No network, no
keys, no daemon — the gate works offline like everything else here.
