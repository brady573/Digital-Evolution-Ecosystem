/**
 * Handoff queue validation.
 *
 * The queue is the transport between the ChatGPT design work and the coding
 * agents. A ChatGPT project has no API, so the human copy step is the
 * transport. That makes the file format the only thing standing between a
 * vague pasted prompt and a reproducible work order, so the format is gated
 * here rather than trusted.
 *
 * Proves: frontmatter parsing, id format, direction/author agreement, id
 * uniqueness, inbox->outbox pairing, responds_to resolution, completion
 * pairing, and ledger agreement. The rule checks run against synthetic
 * fixtures first, so the gate cannot pass by being vacuously true, then against
 * the real handoffs/ directory.
 *
 * Offline: no network, no API keys. Filesystem only.
 *
 * Run: pnpm test:handoffs
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HANDOFF_ROOT = resolve(import.meta.dirname, "../../handoffs");
const LEDGER = "INDEX.md";

/** The restricted frontmatter grammar both sides are allowed to use. */
const ID_PATTERN = /^HNN-\d{4}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FILENAME_PATTERN = /^(HNN-\d{4})(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?\.md$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const STATUSES = ["proposed", "claimed", "blocked", "done"] as const;
type Status = (typeof STATUSES)[number];

/** Statuses that promise the author will (or did) answer with an outbox file. */
const ANSWERED: ReadonlySet<string> = new Set(["done", "blocked"]);

const REQUIRED_FIELDS = [
  "id",
  "title",
  "direction",
  "status",
  "created",
  "author",
  "responds_to",
  "scope",
  "gate",
] as const;

type Fields = Record<string, string>;

interface Handoff {
  file: string;
  dir: "inbox" | "outbox";
  fields: Fields;
  body: string;
}

export interface ParseResult {
  fields: Fields;
  body: string;
  error?: string;
}

/**
 * Parses `---` delimited frontmatter. Intentionally not YAML: no nesting, no
 * lists, no multiline values. A handoff that needs those is a document, not a
 * work order, and belongs in the body.
 */
export function parseFrontmatter(raw: string): ParseResult {
  const text = raw.replace(/^﻿/, "");
  if (!text.startsWith("---\n")) return { fields: {}, body: text, error: "missing opening --- frontmatter fence" };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { fields: {}, body: text, error: "missing closing --- frontmatter fence" };

  const fields: Fields = {};
  const lines = text.slice(4, end).split("\n");
  for (const line of lines) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const sep = line.indexOf(":");
    if (sep === -1) return { fields, body: text, error: `frontmatter line is not "key: value": ${JSON.stringify(line)}` };
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim().replace(/^["'](.*)["']$/, "$1");
    if (key === "") return { fields, body: text, error: `frontmatter line has an empty key: ${JSON.stringify(line)}` };
    if (key in fields) return { fields, body: text, error: `duplicate frontmatter key: ${key}` };
    fields[key] = value;
  }
  return { fields, body: text.slice(end + 4).trim(), };
}

/** Reads every handoff file in a directory, sorted by filename for determinism. */
function readDir(dir: "inbox" | "outbox", root: string): Handoff[] {
  const entries = readdirSync(join(root, dir)).filter((name) => name.endsWith(".md")).sort();
  return entries.map((file) => {
    const parsed = parseFrontmatter(readFileSync(join(root, dir, file), "utf8"));
    assert.equal(parsed.error, undefined, `handoffs/${dir}/${file}: ${parsed.error}`);
    return { file, dir, fields: parsed.fields, body: parsed.body };
  });
}

/** Validates one handoff file in isolation. Throws with a path-qualified message. */
export function checkHandoffShape(handoff: Handoff): void {
  const where = `handoffs/${handoff.dir}/${handoff.file}`;

  for (const key of REQUIRED_FIELDS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(handoff.fields, key),
      `${where}: missing required frontmatter field "${key}"`,
    );
    assert.notEqual(handoff.fields[key], "", `${where}: frontmatter field "${key}" is empty`);
  }

  const f = handoff.fields;
  assert.ok(f["id"] && ID_PATTERN.test(f["id"]), `${where}: id must match HNN-0000 (got ${JSON.stringify(f["id"])})`);
  assert.ok(f["direction"] === handoff.dir, `${where}: direction "${f["direction"]}" does not match its directory`);
  assert.ok(
    (STATUSES as readonly string[]).includes(f["status"] as Status),
    `${where}: status must be one of ${STATUSES.join(", ")} (got ${JSON.stringify(f["status"])})`,
  );
  assert.ok(f["created"] && DATE_PATTERN.test(f["created"]), `${where}: created must be YYYY-MM-DD (got ${JSON.stringify(f["created"])})`);
  assert.ok(f["gate"] && f["gate"].trim().length > 0, `${where}: gate must name a command to run`);
  assert.ok(f["scope"] && f["scope"].trim().length > 0, `${where}: scope must name the area under change`);

  // Filename must agree with the id, so a renamed file cannot smuggle a new identity.
  const match = FILENAME_PATTERN.exec(handoff.file);
  assert.ok(match, `${where}: filename must be HNN-0000[-slug].md with a lowercase kebab-case slug`);
  assert.equal(match?.[1], f["id"], `${where}: filename id does not match frontmatter id`);
  assert.ok(match?.[2] === undefined || SLUG_PATTERN.test(match[2]), `${where}: filename slug must be lowercase kebab-case`);

  // Author is direction-locked: ChatGPT speaks into the queue, agents answer out of it.
  if (handoff.dir === "inbox") {
    assert.equal(f["author"], "chatgpt", `${where}: an inbox handoff must be authored by "chatgpt"`);
  } else {
    assert.ok(
      f["author"] !== undefined && /^agent:[a-z0-9-]+$/.test(f["author"]),
      `${where}: an outbox handoff must be authored by "agent:<lowercase-name>"`,
    );
    assert.equal(
      f["responds_to"],
      f["id"],
      `${where}: an outbox handoff must answer its own id (expected responds_to: ${f["id"]})`,
    );
  }

  assert.notEqual(handoff.body.trim(), "", `${where}: body is empty; a handoff with no request is not a handoff`);
}

export interface Queue {
  inbox: Handoff[];
  outbox: Handoff[];
}

/** Cross-file rules: pairing, completion, and ledger agreement. */
export function checkQueue(queue: Queue, ledger: string): void {
  const all = [...queue.inbox, ...queue.outbox];

  // An inbox and its answering outbox deliberately share one id — that pairing
  // IS the protocol. Uniqueness is therefore per directory, not global.
  const seen = new Map<string, Handoff>();
  for (const handoff of all) {
    const key = `${handoff.dir}/${handoff.fields["id"]}`;
    const prior = seen.get(key);
    assert.equal(
      prior,
      undefined,
      `duplicate handoff id ${handoff.fields["id"]} in handoffs/${handoff.dir}/: both ${prior?.file} and ${handoff.file}`,
    );
    seen.set(key, handoff);
  }

  const inboxIds = new Set(queue.inbox.map((h) => h.fields["id"] as string));
  const outboxIds = new Set(queue.outbox.map((h) => h.fields["id"] as string));

  for (const out of queue.outbox) {
    const target = out.fields["responds_to"] as string;
    assert.ok(
      inboxIds.has(target),
      `handoffs/outbox/${out.file}: responds_to "${target}" does not name an existing inbox handoff`,
    );
  }

  for (const handoff of queue.inbox) {
    if (ANSWERED.has(handoff.fields["status"] as string)) {
      assert.ok(
        outboxIds.has(handoff.fields["id"] as string),
        `handoffs/inbox/${handoff.file}: status "${handoff.fields["status"]}" requires an outbox handoff answering ${handoff.fields["id"]}`,
      );
    }
  }

  // The ledger is how a human finds work, so it must not drift from the tree.
  const knownIds = new Set(all.map((h) => h.fields["id"] as string));
  for (const handoff of all) {
    const id = handoff.fields["id"] as string;
    assert.ok(ledger.includes(id), `INDEX.md: missing a row for ${id} (handoffs/${handoff.dir}/${handoff.file})`);
  }
  // matchAll yields match arrays; [0] is the full id, [1] would be the capture
  // group (absent here, and silently undefined if the pattern gains one).
  for (const match of ledger.matchAll(/\bHNN-\d{4}\b/g)) {
    assert.ok(knownIds.has(match[0]), `INDEX.md: references ${match[0]}, which does not exist in inbox/ or outbox/`);
  }
}

function checkTemplate(root: string): void {
  const template = parseFrontmatter(readFileSync(join(root, "TEMPLATE.md"), "utf8"));
  assert.equal(template.error, undefined, `handoffs/TEMPLATE.md: ${template.error}`);
  for (const key of REQUIRED_FIELDS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(template.fields, key),
      `handoffs/TEMPLATE.md: template must document the "${key}" field`,
    );
  }
  assert.ok(template.body.includes("## Request"), "handoffs/TEMPLATE.md: template must have a ## Request section");
  assert.ok(template.body.includes("## Done when"), "handoffs/TEMPLATE.md: template must have a ## Done when section");
}

// --- self-tests: the rules must fail on bad input, or the gate is theatre ---

/** Builds a throwaway queue directory from `files: [relativePath, contents][]`. */
function fixture(files: Array<[string, string]>): { root: string; ledger: string } {
  const root = mkdtempSync(join(tmpdir(), "dee-handoffs-"));
  // Both queues always exist in the real tree; a case may leave one empty.
  mkdirSync(join(root, "inbox"), { recursive: true });
  mkdirSync(join(root, "outbox"), { recursive: true });
  for (const [rel, contents] of files) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents, "utf8");
  }
  const ledger = readFileSync(join(root, LEDGER), "utf8");
  return { root, ledger };
}

const GOOD_INBOX = `---
id: HNN-0001
title: Bound the analysis fast-forward stop
direction: inbox
status: proposed
created: 2026-09-25
author: chatgpt
responds_to: none
scope: packages/sim-analysis
gate: pnpm test:ecology
---

## Request

Clamp the stop condition.
`;

const GOOD_OUTBOX = `---
id: HNN-0001
title: Bound the analysis fast-forward stop - result
direction: outbox
status: done
created: 2026-09-25
author: agent:scout
responds_to: HNN-0001
scope: packages/sim-analysis
gate: pnpm test:ecology
---

## Result

Clamped in \`packages/sim-analysis\`.
`;

const LEDGER_ROW = "| HNN-0001 | inbox | proposed | Bound the analysis fast-forward stop |";

function expectThrow(fn: () => void, includes: string): void {
  assert.throws(fn, (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    return message.includes(includes);
  }, `expected a throw containing ${JSON.stringify(includes)}`);
}

function testFrontmatterParsing(): void {
  const ok = parseFrontmatter("---\nid: HNN-0001\ntitle: \"Quoted: title\"\n---\n\n# Body\n");
  assert.deepEqual(ok.fields, { id: "HNN-0001", title: "Quoted: title" });
  assert.equal(ok.error, undefined);
  assert.equal(ok.body, "# Body");

  const quotedColon = parseFrontmatter("---\ntitle: 'a: b'\n---\nbody");
  assert.equal(quotedColon.fields["title"], "a: b");

  for (const [raw, why] of [
    ["no frontmatter at all", "missing opening"],
    ["---\nid: HNN-0001\nnever closed", "missing closing"],
    ["---\nid HNN-0001\n---\n", "not \"key: value\""],
    ["---\nid: A\nid: B\n---\n", "duplicate frontmatter key"],
    ["---\n: value\n---\n", "empty key"],
  ] as const) {
    assert.notEqual(parseFrontmatter(raw).error, undefined, `expected a parse error for ${why}`);
  }
}

function testShapeRejections(): void {
  // A well-formed handoff must pass; a gate that rejects valid work is a bug.
  const acceptedInbox = GOOD_INBOX;
  const acceptedOutbox = GOOD_OUTBOX;
  for (const [contents, file, dir] of [
    [acceptedInbox, "HNN-0001-bound-the-stop.md", "inbox"],
    [acceptedOutbox, "HNN-0001-result.md", "outbox"],
  ] as const) {
    const parsed = parseFrontmatter(contents);
    assert.equal(parsed.error, undefined, `fixture should parse: ${parsed.error}`);
    checkHandoffShape({ file, dir, fields: parsed.fields, body: parsed.body });
  }

  const cases: Array<[string, string, string, string]> = [
    [acceptedInbox, "HNN-0001-bound.md", "inbox", ""],
    [GOOD_INBOX.replace("author: chatgpt", "author: agent:scout"), "HNN-0001-bound.md", "inbox", 'authored by "chatgpt"'],
    [GOOD_INBOX.replace("status: proposed", "status: almost"), "HNN-0001-bound.md", "inbox", "status must be one of"],
    [GOOD_INBOX.replace("created: 2026-09-25", "created: 25/09/2026"), "HNN-0001-bound.md", "inbox", "created must be YYYY-MM-DD"],
    [GOOD_INBOX.replace("id: HNN-0001", "id: HNN-1"), "HNN-0001-bound.md", "inbox", "id must match HNN-0000"],
    [GOOD_INBOX, "HNN-0002-bound.md", "inbox", "filename id does not match"],
    [GOOD_INBOX.replace("direction: inbox", "direction: outbox"), "HNN-0001-bound.md", "inbox", "does not match its directory"],
    [GOOD_INBOX.replace("gate: pnpm test:ecology", "gate:  "), "HNN-0001-bound.md", "inbox", 'field "gate" is empty'],
    [GOOD_INBOX.replace("scope: packages/sim-analysis\n", ""), "HNN-0001-bound.md", "inbox", 'missing required frontmatter field "scope"'],
    [GOOD_INBOX, "HNN-0001-Bound-The-Stop.md", "inbox", "lowercase kebab-case"],
    [GOOD_INBOX, "HNN-0001-bound.md!", "inbox", "filename must be HNN-0000"],
    [GOOD_INBOX.replace(/## Request[\s\S]*$/, ""), "HNN-0001-bound.md", "inbox", "body is empty"],
    [GOOD_OUTBOX.replace("author: agent:scout", "author: Scout"), "HNN-0001-result.md", "outbox", 'authored by "agent:'],
    [GOOD_OUTBOX.replace("responds_to: HNN-0001", "responds_to: HNN-0002"), "HNN-0001-result.md", "outbox", "must answer its own id"],
  ];

  for (const [contents, file, dir, expected] of cases) {
    const parsed = parseFrontmatter(contents);
    assert.equal(parsed.error, undefined, `fixture should parse: ${parsed.error}`);
    const handoff: Handoff = { file, dir, fields: parsed.fields, body: parsed.body };
    if (expected === "") {
      checkHandoffShape(handoff);
      continue;
    }
    expectThrow(() => checkHandoffShape(handoff), expected);
  }
}

function testQueueRules(): void {
  const write = (files: Array<[string, string]>) => {
    const { root, ledger } = fixture(files);
    try {
      const queue: Queue = { inbox: readDir("inbox", root), outbox: readDir("outbox", root) };
      queue.inbox.forEach(checkHandoffShape);
      queue.outbox.forEach(checkHandoffShape);
      checkQueue(queue, ledger);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  // Baseline: a proposed inbox with no answer yet is legal.
  write([[`inbox/${"HNN-0001-bound.md"}`, GOOD_INBOX], [LEDGER, LEDGER_ROW]]);
  // Baseline: a completed pair is legal.
  write([["inbox/HNN-0001-bound.md", GOOD_INBOX], ["outbox/HNN-0001-result.md", GOOD_OUTBOX], [LEDGER, LEDGER_ROW]]);

  expectThrow(
    () => write([["inbox/HNN-0001-bound.md", GOOD_INBOX], [LEDGER, "no rows here"]]),
    "INDEX.md: missing a row for HNN-0001",
  );
  // A ledger row for a handoff that does not exist is drift in the other direction.
  expectThrow(
    () =>
      write([
        ["inbox/HNN-0001-bound.md", GOOD_INBOX],
        [LEDGER, `${LEDGER_ROW}\n| HNN-0007 | inbox | proposed | ghost |`],
      ]),
    "INDEX.md: references HNN-0007",
  );
  expectThrow(
    () => write([["inbox/HNN-0001-bound.md", GOOD_INBOX], ["inbox/HNN-0001-again.md", GOOD_INBOX], [LEDGER, LEDGER_ROW]]),
    "duplicate handoff id HNN-0001",
  );
  // Baseline: a claimed handoff has not finished, so it needs no answer yet.
  write([["inbox/HNN-0001-bound.md", GOOD_INBOX.replace("status: proposed", "status: claimed")], [LEDGER, LEDGER_ROW]]);
  // A done handoff without an outbox is a broken promise.
  expectThrow(
    () => write([["inbox/HNN-0001-bound.md", GOOD_INBOX.replace("status: proposed", "status: done")], [LEDGER, LEDGER_ROW]]),
    "requires an outbox handoff answering HNN-0001",
  );
  expectThrow(
    () => write([["inbox/HNN-0001-bound.md", GOOD_INBOX.replace("status: proposed", "status: blocked")], [LEDGER, LEDGER_ROW]]),
    "requires an outbox handoff",
  );
  // An outbox pointing at a handoff that does not exist is a dangling answer.
  expectThrow(
    () =>
      write([
        ["inbox/HNN-0001-bound.md", GOOD_INBOX],
        ["outbox/HNN-0009-result.md", GOOD_OUTBOX.replaceAll("HNN-0001", "HNN-0009")],
        [LEDGER, LEDGER_ROW],
      ]),
    "does not name an existing inbox handoff",
  );
}

function testTemplate(): void {
  const root = mkdtempSync(join(tmpdir(), "dee-handoffs-tpl-"));
  try {
    mkdirSync(join(root, "inbox"));
    mkdirSync(join(root, "outbox"));
    writeFileSync(join(root, LEDGER), "| id | direction | status | title |", "utf8");
    copyTemplate(root);
    checkTemplate(root);

    const stripped = readFileSync(join(root, "TEMPLATE.md"), "utf8").replace(/## Done when[\s\S]*$/, "");
    writeFileSync(join(root, "TEMPLATE.md"), stripped, "utf8");
    expectThrow(() => checkTemplate(root), "must have a ## Done when section");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function copyTemplate(root: string): void {
  writeFileSync(join(root, "TEMPLATE.md"), readFileSync(join(HANDOFF_ROOT, "TEMPLATE.md"), "utf8"), "utf8");
}

function testRealQueue(): void {
  checkTemplate(HANDOFF_ROOT);
  const ledger = readFileSync(join(HANDOFF_ROOT, LEDGER), "utf8");
  const queue: Queue = { inbox: readDir("inbox", HANDOFF_ROOT), outbox: readDir("outbox", HANDOFF_ROOT) };
  // An empty queue is a valid state: the gate checks shape and pairing, never
  // that work exists. Enforcing that would fail CI on a fresh clone.
  queue.inbox.forEach(checkHandoffShape);
  queue.outbox.forEach(checkHandoffShape);
  checkQueue(queue, ledger);
}

testFrontmatterParsing();
testShapeRejections();
testQueueRules();
testTemplate();
testRealQueue();
console.log("handoff validation: PASS");
