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
import {
  CHECKPOINT_MIGRATION_RULES,
  CHECKPOINT_PLAYER_MESSAGES,
  CHECKPOINT_PLAYER_NOTICE,
  MIGRATION_RULE_BY_ID,
} from "../../packages/contracts/src/index.ts";

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
lines.push("## Shapes that will now be refused");
lines.push("");
lines.push("A save that does any of the following will no longer open. This is the intended direction: Decision 2 authorises refusing invalid data, and until now these shapes loaded silently.");
lines.push("");
lines.push("| Reason code | What is refused |");
lines.push("|---|---|");
for (const [reason, text] of Object.entries({
  "wrong-type": "a field holds a value of the wrong kind — a tick that is a string, a gate that is a number, a control that is a bare value",
  "malformed-container": "a field that should hold a list or an object does not",
  "non-finite-numeric": "a number field holds a value that is not finite",
  "unsupported-version": "a save declaring a schema version this build does not know",
  "unsupported-tag": "a part of the saved world carrying a type marker this build does not recognise",
  "structural-contradiction": "a decision record whose parts disagree — no identifier, an unreadable tick, or a source the schema does not know",
})) {
  lines.push(`| \`${reason}\` | ${text} |`);
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
  "- **Strict field requirements apply to the current schema (`0.3`) only.** A `0.1` or `0.2` save is checked for a known version and a usable container, and no further. Holding a legacy save to today's requirements would refuse exactly the saves Decision 2 exists to protect, so the trade is deliberate: a legacy save with corrupt *contents* inside it can still restore.",
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
