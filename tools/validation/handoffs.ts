import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Handoff-queue gate (issue #33): the file-based work-order channel between
 * design (ChatGPT) and coding agents must stay well-formed, or no agent can
 * trust what it claims.
 *
 * Enforced rules:
 * - id format HNN-0000 (three uppercase letters, hyphen, four digits);
 * - direction/author agreement (chatgpt writes inbox, agent:<name> writes outbox);
 * - per-directory id uniqueness (not global: an inbox/outbox pair shares one id);
 * - outbox responds_to resolves to an inbox id;
 * - a done/blocked inbox requires a matching outbox;
 * - INDEX.md agrees with the tree in both directions (ids, direction, status, title).
 *
 * The gate self-tests these rules against synthetic in-memory fixtures
 * FIRST, so it cannot pass by being vacuously true.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../handoffs");
const ID_RE = /^[A-Z]{3}-\d{4}$/;
const AGENT_RE = /^agent:[A-Za-z0-9_-]+$/;

interface Handoff {
  path: string;
  id: string;
  direction: "inbox" | "outbox";
  author: string;
  status: string;
  respondsTo: string | null;
  title: string;
}

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function parseFrontmatter(path: string, content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) fail(path, "missing frontmatter block");
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const colon = line.indexOf(":");
    if (colon < 0) fail(path, `malformed frontmatter line ${JSON.stringify(line)}`);
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim().replace(/^"(.*)"$/, "$1");
    fields[key] = value;
  }
  return fields;
}

function parseTitle(path: string, content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  if (!match) fail(path, "missing H1 title");
  return match[1].trim();
}

function parseHandoff(path: string, direction: "inbox" | "outbox", content: string): Handoff {
  const fields = parseFrontmatter(path, content);
  for (const key of ["id", "direction", "author", "status"]) {
    if (!fields[key]) fail(path, `missing frontmatter field ${key}`);
  }
  const id = fields["id"]!;
  if (!ID_RE.test(id)) fail(path, `id must match HNN-0000 (got ${JSON.stringify(id)})`);
  if (fields["direction"] !== direction) {
    fail(path, `direction field ${JSON.stringify(fields["direction"])} disagrees with directory ${direction}`);
  }
  if (direction === "inbox" && fields["author"] !== "chatgpt") {
    fail(path, `inbox author must be chatgpt (got ${JSON.stringify(fields["author"])})`);
  }
  if (direction === "outbox" && !AGENT_RE.test(fields["author"]!)) {
    fail(path, `outbox author must match agent:<name> (got ${JSON.stringify(fields["author"])})`);
  }
  if (!["proposed", "claimed", "done", "blocked"].includes(fields["status"]!)) {
    fail(path, `unknown status ${JSON.stringify(fields["status"])}`);
  }
  if (direction === "outbox" && fields["status"] !== "done") {
    fail(path, `outbox status must be done (got ${JSON.stringify(fields["status"])})`);
  }
  const respondsTo = fields["responds_to"] && fields["responds_to"] !== "null" ? fields["responds_to"] : null;
  if (direction === "outbox" && !respondsTo) fail(path, "outbox must set responds_to to an inbox id");
  if (respondsTo && !ID_RE.test(respondsTo)) fail(path, `responds_to must match HNN-0000 (got ${JSON.stringify(respondsTo)})`);
  return {
    path, id, direction, author: fields["author"]!, status: fields["status"]!,
    respondsTo, title: parseTitle(path, content),
  };
}

interface IndexRow {
  id: string;
  direction: string;
  title: string;
  status: string;
  counterpart: string;
}

function parseIndex(content: string): IndexRow[] {
  const rows: IndexRow[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 5 || /^id$/i.test(cells[0]!) || /^-+$/.test(cells[0]!)) continue;
    rows.push({ id: cells[0]!, direction: cells[1]!, title: cells[2]!, status: cells[3]!, counterpart: cells[4]! });
  }
  return rows;
}

function checkTree(handoffs: Handoff[], indexRows: IndexRow[]): void {
  const byDir = new Map<string, number>();
  for (const h of handoffs) {
    const key = `${h.direction}/${h.id}`;
    byDir.set(key, (byDir.get(key) ?? 0) + 1);
  }
  for (const [key, count] of byDir) {
    if (count > 1) fail(key, `duplicate id in ${key.split("/")[0]} (ids are unique per directory)`);
  }
  const inboxIds = new Set(handoffs.filter((h) => h.direction === "inbox").map((h) => h.id));
  for (const h of handoffs) {
    if (h.direction === "outbox" && h.respondsTo && !inboxIds.has(h.respondsTo)) {
      fail(h.path, `responds_to ${h.respondsTo} resolves to no inbox handoff`);
    }
  }
  const answered = new Set(
    handoffs.filter((h) => h.direction === "outbox" && h.respondsTo).map((h) => h.respondsTo!),
  );
  for (const h of handoffs) {
    if (h.direction === "inbox" && (h.status === "done" || h.status === "blocked") && !answered.has(h.id)) {
      fail(h.path, `${h.status} inbox requires a matching outbox`);
    }
  }
  // INDEX.md agrees with the tree in both directions.
  const indexByKey = new Map(indexRows.map((r) => [`${r.direction}/${r.id}`, r]));
  for (const h of handoffs) {
    const row = indexByKey.get(`${h.direction}/${h.id}`);
    if (!row) fail(h.path, "present in tree but missing from INDEX.md");
    if (row.status !== h.status) {
      fail(h.path, `INDEX.md status ${JSON.stringify(row.status)} disagrees with file ${JSON.stringify(h.status)}`);
    }
    if (row.title !== h.title) {
      fail(h.path, `INDEX.md title ${JSON.stringify(row.title)} disagrees with file ${JSON.stringify(h.title)}`);
    }
  }
  const treeKeys = new Set(handoffs.map((h) => `${h.direction}/${h.id}`));
  for (const row of indexRows) {
    if (!treeKeys.has(`${row.direction}/${row.id}`)) {
      fail("handoffs/INDEX.md", `row ${row.direction}/${row.id} has no matching file`);
    }
  }
}

function loadTree(root: string): { handoffs: Handoff[]; indexRows: IndexRow[] } {
  const handoffs: Handoff[] = [];
  for (const direction of ["inbox", "outbox"] as const) {
    let files: string[] = [];
    try {
      files = readdirSync(join(root, direction)).filter((f) => f.endsWith(".md")).sort();
    } catch {
      fail(join(root, direction), "directory is missing");
    }
    for (const file of files) {
      const path = join(direction, file);
      handoffs.push(parseHandoff(path, direction, readFileSync(join(root, path), "utf8")));
    }
  }
  return { handoffs, indexRows: parseIndex(readFileSync(join(root, "INDEX.md"), "utf8")) };
}

// --- Self-tests: synthetic fixtures prove each rule can actually fail ------

function expectReject(label: string, fn: () => void, fragment: string): void {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(message.includes(fragment), `${label}: rejection must mention ${JSON.stringify(fragment)} (got ${JSON.stringify(message)})`);
    return;
  }
  throw new Error(`self-test failed: ${label} was accepted but must be rejected`);
}

function makeFile(overrides: Partial<Handoff> & { body?: string }): { path: string; direction: "inbox" | "outbox"; content: string } {
  const base = {
    id: "HDE-0001", direction: "inbox" as const, author: "chatgpt",
    status: "proposed", respondsTo: null as string | null, title: "Demo work",
  };
  const h = { ...base, ...overrides };
  const frontmatter = [
    "---",
    `id: ${h.id}`,
    `direction: ${h.direction}`,
    `author: ${h.author}`,
    `status: ${h.status}`,
    `responds_to: ${h.respondsTo ?? "null"}`,
    "gate: pnpm verify",
    "---",
    "",
    `# ${h.title}`,
    "",
    h.body ?? "Body.",
  ].join("\n");
  return { path: `${h.direction}/demo.md`, direction: h.direction, content: frontmatter };
}

function checkSynthetic(handoffs: Handoff[], indexText: string): void {
  checkTree(handoffs, parseIndex(indexText));
}

function selfTest(): void {
  const goodInbox = makeFile({ status: "done" });
  const goodOutbox = makeFile({ direction: "outbox", author: "agent:opencode", status: "done", respondsTo: "HDE-0001" });
  const index = [
    "| id | direction | title | status | counterpart |",
    "| HDE-0001 | inbox | Demo work | done | HDE-0001 |",
    "| HDE-0001 | outbox | Demo work | done | HDE-0001 |",
  ].join("\n");
  const parse = (f: ReturnType<typeof makeFile>) => parseHandoff(f.path, f.direction, f.content);
  // A legitimate completed pair passes, including same id in both directories.
  checkSynthetic([parse(goodInbox), parse(goodOutbox)], index);

  const badId = makeFile({ id: "HNN-1" });
  expectReject("bad id", () => parse(badId), "HNN-0000");
  expectReject("wrong author", () => parse(makeFile({ author: "someone" })), "chatgpt");
  expectReject("direction mismatch", () => parseHandoff("inbox/x.md", "outbox", makeFile({}).content), "disagrees with directory");
  expectReject("bad outbox author", () => parse(makeFile({ direction: "outbox", author: "bob", status: "done", respondsTo: "HDE-0001" })), "agent:<name>");
  expectReject("outbox without responds_to", () => parse(makeFile({ direction: "outbox", author: "agent:x", status: "done" })), "responds_to");
  expectReject("non-done outbox", () => parse(makeFile({ direction: "outbox", author: "agent:x", status: "claimed", respondsTo: "HDE-0001" })), "must be done");
  expectReject("duplicate id", () => checkSynthetic(
    [parse(makeFile({})), parse({ ...makeFile({}), path: "inbox/other.md" })], index), "duplicate id");
  expectReject("dangling responds_to", () => checkSynthetic(
    [parse(goodInbox), parse(makeFile({ direction: "outbox", author: "agent:x", status: "done", respondsTo: "HDE-9999" }))], index),
    "resolves to no inbox");
  const doneAlone = parse(makeFile({ status: "done" }));
  expectReject("done without outbox", () => checkSynthetic([doneAlone], index.replace("done | HDE-0001 |", "done | HDE-0001 |")), "requires a matching outbox");
  expectReject("missing index row", () => checkSynthetic(
    [parse(goodInbox), parse(goodOutbox)], "| id | direction | title | status | counterpart |"),
    "missing from INDEX.md");
  expectReject("orphan index row", () => checkSynthetic(
    [parse(makeFile({}))], index.replace("inbox | Demo work | done", "inbox | Demo work | proposed")), "has no matching file");
  expectReject("status drift", () => checkSynthetic(
    [parse(goodInbox), parse(goodOutbox)], index.replace("inbox | Demo work | done", "inbox | Demo work | claimed")),
    "disagrees with file");
  console.log("handoffs self-test: PASS (13 rejection rules proven)");
}

selfTest();

const { handoffs, indexRows } = loadTree(ROOT);
checkTree(handoffs, indexRows);
console.log(`handoffs validation: PASS (${handoffs.length} handoff(s), ledger agrees both directions)`);
