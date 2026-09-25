# Handoff ledger

Every handoff in `inbox/` and `outbox/`, both directions. An inbox handoff
and its answering outbox share one id; ids are unique per directory, not
globally. The `test:handoffs` gate enforces that this table agrees with the
tree in both directions (no missing rows, no orphan rows, statuses match).

| id | direction | title | status | counterpart |
|----|-----------|-------|--------|-------------|
<!-- no handoffs yet -->
