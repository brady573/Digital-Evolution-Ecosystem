/**
 * Emit the supported-save boundary from the migration table itself.
 *
 * The Owner gate is a product decision about whose existing worlds continue to
 * open, and it is presented in plain language. Hand-transcribing a table into
 * prose is how the two drift: the prose is reviewed, the table is not, and a
 * rule edited after the presentation leaves the document confidently wrong.
 *
 * So this reads `CHECKPOINT_MIGRATION_RULES` and prints it. The output is
 * derived from the same declaration the validator enforces, which means the
 * presentation cannot describe a boundary the code does not have.
 *
 * Run: pnpm exec tsx tools/validation/checkpoint-boundary.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CHECKPOINT_SCHEMA_VERSION } from "../../packages/sim-runtime/src/session.ts";
import {
  CHECKPOINT_MIGRATION_RULES,
  CHECKPOINT_PLAYER_MESSAGES,
  CHECKPOINT_PLAYER_NOTICE,
  MIGRATION_RULE_BY_ID,
  SUPPORTED_SCHEMAS,
} from "../../packages/contracts/src/index.ts";

const CURRENT_SCHEMA = CHECKPOINT_SCHEMA_VERSION;

/**
 * The newest supported schema that is not the current one, derived rather than
 * named. Used as the historical half of the absence/invalidity asymmetry, so a
 * future bump moves both halves instead of leaving one pinned to a literal that
 * has quietly become the current version.
 */
const HISTORICAL_SCHEMAS = SUPPORTED_SCHEMAS.filter((s) => s !== CURRENT_SCHEMA);
const NEWEST_HISTORICAL = HISTORICAL_SCHEMAS[HISTORICAL_SCHEMAS.length - 1];
const OLDEST_SUPPORTED = SUPPORTED_SCHEMAS[0];

/**
 * Self-check: this file may not name a supported schema version in code.
 *
 * A supported-version reference here is rot by definition — it was correct when
 * written and stops being correct at the next bump, while the document still
 * reads as authoritative. A version this build does *not* support is fine and
 * intentional: those are illustrative rejected values, and there is nothing to
 * derive them from.
 *
 * The token is matched anywhere in code, not only as a bare quoted string. A
 * bare-quoted pattern is what this check looked like first, and it was
 * vacuous in the exact way that matters: the real rot read "A valid 0.4 save",
 * with the version embedded in prose, and a bare-quoted scan passed over it.
 * Dot-bounded on both sides so a longer dotted number (`0.22.0`) is not
 * mistaken for a schema version.
 *
 * Comments are excluded. A stale *document* is the hazard; a stale comment
 * produces no output, and a check that fires on harmless prose is a check that
 * eventually gets switched off.
 */
const SOURCE = readFileSync(fileURLToPath(import.meta.url), "utf8");
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/([^:])\/\/[^\n]*/g, "$1");
const CODE = stripComments(SOURCE);
const VERSION_TOKEN = /(?<![\w.])(\d+\.\d+)(?![\w.])/g;
const literals = [...CODE.matchAll(VERSION_TOKEN)]
  .map((m) => m[1])
  .filter((v): v is string => (SUPPORTED_SCHEMAS as readonly string[]).includes(v));
if (literals.length > 0) {
  throw new Error(
    `checkpoint-boundary.ts names supported schema version(s) in code: ${[...new Set(literals)].join(", ")}.\n` +
      "Every supported-version reference in generated prose must come from\n" +
      "CHECKPOINT_SCHEMA_VERSION or the schemas the migration table declares.\n" +
      "A version this build does NOT support is allowed: those are the\n" +
      "illustrative rejected values, and they have nothing to derive from.",
  );
}

const HAZARD: Record<string, string> = {
  inert: "inert — written but never read for a decision",
  "load-bearing-display": "display — affects what the player is told, not what the world does",
  "load-bearing-dynamics": "DYNAMICS — gates whether the simulation may act",
};

const lines: string[] = [];
lines.push("# Supported-save boundary");
lines.push("");
lines.push(
  `Generated from \`CHECKPOINT_MIGRATION_RULES\` (${CHECKPOINT_MIGRATION_RULES.length} rules). Do not edit by hand.`,
);
lines.push("");

for (const [index, rule] of CHECKPOINT_MIGRATION_RULES.entries()) {
  lines.push(`## ${index + 1}. ${rule.id}`);
  lines.push("");
  lines.push(`**Plain language.** ${HAZARD[rule.hazard] ?? rule.hazard}`);
  lines.push("");
  lines.push(`- **Saves affected:** ${rule.appliesToSchemas.join(", ")}`);
  lines.push(`- **Field:** \`${rule.path}\``);
  lines.push(`- **When absent:** ${rule.effectiveDefault}`);
  lines.push(`- **Why that is right:** ${rule.omission}`);
  lines.push(`- **Historical basis:** ${rule.historicalBasis}`);
  if (rule.dynamicsJustification) {
    lines.push(`- **Why the default is safe for a world-changing field:** ${rule.dynamicsJustification}`);
  }
  if (rule.rejects) {
    lines.push(`- **Still refused:** ${rule.rejects}`);
  }
  lines.push("");
}

lines.push("## Everything not listed here is refused");
lines.push("");
lines.push(
  "A field with no rule above gets no default. A wrong type, a malformed container, a non-finite required number, an unsupported schema or checkpoint tag, and a record that contradicts itself are all refused with the field named, before the payload becomes live state.",
);
lines.push("");
lines.push(`## A valid ${CURRENT_SCHEMA} save never depends on a migration rule`);
lines.push("");
lines.push(
  "This is the property the version split exists to guarantee, and it is checked rather than asserted:",
);
lines.push("");
const crossing = CHECKPOINT_MIGRATION_RULES.filter((r) => r.appliesToSchemas.includes(CURRENT_SCHEMA));
lines.push(
  `1. **No rule tolerates an omission in ${CURRENT_SCHEMA}.** Checked at print time: ${crossing.length === 0 ? "no rule names it" : `**${crossing.length} RULE(S) VIOLATE THIS — ${crossing.map((r) => r.id).join(", ")}**`}. The rule table also refuses such a rule as a blocking assertion, with ${CURRENT_SCHEMA} deliberately left a valid schema value in the whitelist so the property is proved rather than obtained by accident from an outdated list.`,
);
lines.push(
  `2. **Migration absorbs absences that older builds wrote, and ${CURRENT_SCHEMA} is written by the build that requires those fields.** Every rule above names the change that introduced its field, and that change predates ${CURRENT_SCHEMA} — the current version is the first to *require* fields that older supported builds already wrote. That is what makes the tolerance historical rather than permissive: each one describes a build that really existed and really omitted the field, not a gap in the current contract.`,
);
lines.push(
  `3. **The asymmetry is proved on one payload, twice.** \`analysis.dep\` is removed from an otherwise valid save: as "${CURRENT_SCHEMA}" it is refused (\`analysis.dep\`, malformed-container); as "${NEWEST_HISTORICAL}" the identical payload is accepted. If loadability leaked across the version boundary, that pair could not disagree. The subject is the C-use sub-state rather than a long-standing one deliberately: \`analysis.records\` has been written since ${OLDEST_SUPPORTED}, so a save omitting it is refused at *every* schema and cannot demonstrate a version-scoped absence.`,
);
lines.push("");
lines.push(
  "So a save written by the current build opens on its own terms. Migration is what keeps *older* worlds open; it is never what lets a current one through.",
);
lines.push("");

lines.push("## Shapes that will now be refused");
lines.push("");
lines.push("A save that does any of the following will no longer open. This is the intended direction: Decision 2 authorises refusing invalid data, and until now these shapes loaded silently.");
lines.push("");
const REFUSED: Readonly<Record<string, { what: string; examples: readonly string[] }>> = {
  "wrong-type": {
    what: "a field holds a value of the wrong kind",
    examples: [
      '`decisions.lastMajorCatalystTick: "not a tick"`',
      "`decisions.lastDecisionTick: \"soon\"`",
      '`decisions.pending: "gate"`',
      "`control: 42`",
    ],
  },
  "malformed-container": {
    what: "a field that should hold a list or an object does not",
    examples: [
      "`decisions.resolutions: {}`",
      "`analysis.records: {}`",
      "`decisions: \"not an object\"`",
      "`experiment: null`",
    ],
  },
  "non-finite-numeric": {
    what: "a number field holds a value that is not finite",
    examples: [
      "`decisions.lastMajorCatalystTick: NaN`",
      "`decisions.lastMajorCatalystTick: Infinity`",
      "`decisions.lastMajorCatalystTick: -Infinity`",
    ],
  },
  "unsupported-version": {
    what: "a save declares a schema version this build does not know",
    examples: [
      '`checkpointSchemaVersion: "0.5"`',
      '`checkpointSchemaVersion: "1.0"`',
      '`checkpointSchemaVersion: ""`',
      "`checkpointSchemaVersion: null`",
      "`checkpointSchemaVersion: 3`",
    ],
  },
  "unsupported-tag": {
    what: "part of the saved world carries a type marker this build does not recognise",
    examples: ['`experiment.__digital_evolution_type: "not-a-real-tag"`'],
  },
  "structural-contradiction": {
    what: "a decision record's parts disagree with each other",
    examples: [
      "`resolutions[0].opportunityId: 1` (not a string)",
      "`resolutions[0].commandId: null` (no command named)",
      '`resolutions[0].tick: "later"` (a tick that is not a tick)',
      '`resolutions[0].source: "from_the_future"` (a source the schema does not know)',
    ],
  },
};
for (const [reason, entry] of Object.entries(REFUSED)) {
  lines.push(`**\`${reason}\`** — ${entry.what}`);
  lines.push("");
  for (const example of entry.examples) lines.push(`- ${example}`);
  lines.push("");
}

lines.push("");
lines.push("## Player-facing wording — DRAFT, Owner wording not yet accepted");
lines.push("");
lines.push("**These are drafts.** The mechanism is settled — a stable reason code, developer detail retained for logs, and copy that must never be parsed to decide behaviour. The wording below has not been accepted and is **not** part of the compatibility decision above.");
lines.push("");
lines.push(`Appended to every refusal: _"${CHECKPOINT_PLAYER_NOTICE}"_`);
lines.push("");
for (const [reason, text] of Object.entries(CHECKPOINT_PLAYER_MESSAGES)) {
  lines.push(`- \`${reason}\` — "${text}"`);
}

lines.push("");
lines.push("## Known limits of this boundary");
lines.push("");
lines.push(
  `- **Whether a field may be absent is version-scoped; whether a present value is valid is not.** A save declaring an older supported version may omit the fields listed above, because a supported build really did write it without them. But once a value *is* present, it is held to the same checks at every schema: a wrong type, a malformed container, a non-finite required number, or a decision record whose parts disagree is refused wherever it appears. **Migration widens compatibility for known historical absence; it does not widen validity.**`,
);
lines.push(
  "- **Migration runs before validation.** A save that migrates cleanly is never caught by a pre-migration check.",
);
lines.push(
  "- **Refusal happens before any simulation call**, so a rejected save cannot become live state.",
);

if (MIGRATION_RULE_BY_ID.size !== CHECKPOINT_MIGRATION_RULES.length) {
  throw new Error("the by-id index and the rule list have drifted; the list above would be untrustworthy");
}

process.stdout.write(lines.join("\n") + "\n");
