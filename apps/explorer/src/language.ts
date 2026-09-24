/**
 * Presentation language layer (M3).
 *
 * Pairs scientific simulation terms with relatable natural language and
 * converts engine ticks to display years. Presentation-only: the engine,
 * checkpoints, and exports always speak ticks. Every narrative string here
 * must be rendered alongside its source numbers, never instead of them.
 */

export const TICKS_PER_YEAR = 1000;

/** Resonant headline age, e.g. "Year 254". */
export function formatYear(tick: number): string {
  return `Year ${Math.floor(Math.max(0, tick) / TICKS_PER_YEAR)}`;
}

/** Full age reference, e.g. "Year 58 (58,785 ticks)". */
export function formatTickAge(tick: number): string {
  return `${formatYear(tick)} (${Math.max(0, tick).toLocaleString()} ticks)`;
}

const OUTCOME_GLOSS: Record<string, string> = {
  "Persistent dual-niche partitioning": "Two stable ways of life, holding their ground for thousands of ticks.",
  "Transient dual-niche partitioning": "Two ways of life are forming — watch whether they hold.",
  "A-adapted dominance": "Nutrient A specialists run this world for now.",
  "B-adapted dominance": "Nutrient B specialists run this world for now.",
  "Adapted generalist dominance": "Flexible eaters outcompete the specialists here.",
  "Discordant resource use": "What creatures eat and what they inherited disagree — evolution in progress.",
  "Mixed eco-strategies": "Several ways of life share this world, none dominant yet.",
  "Extinction": "Every creature died. The history below is the autopsy.",
};

/** Relatable gloss for a scientific ecological outcome. Falls back to the raw outcome. */
export function glossOutcome(outcome: string): string {
  return OUTCOME_GLOSS[outcome] ?? outcome;
}
