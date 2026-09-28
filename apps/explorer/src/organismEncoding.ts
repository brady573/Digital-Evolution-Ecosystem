/**
 * Presentation-only organism encoding. No simulation or analysis state is read
 * or written here beyond the read-only RenderOrganism fields the product already
 * displays; nothing in this module can reach biology.
 *
 * §21.2 / R1: dormancy previously won the organism colour chain outright, so the
 * lens labelled "Clades" did not encode clades for dormant organisms and
 * "Traits" did not encode the selected trait. Dormancy is now a SEPARATE
 * channel (alpha, hollow glyph, smaller footprint) and never replaces a lens
 * encoding. The Normal world keeps its own dormancy colour, which is governed
 * by the normal-World visual design.
 */

/** Mirrors the explorer's lens union; kept local so this module has no React dependency. */
export type OrganismLens = "normal" | "nutrients" | "waste" | "clades" | "traits";

/** Opacity applied to dormant organisms. Below 1 so the channel is real. */
export const DORMANT_ALPHA = 0.55;

/** True for lenses whose whole purpose is to encode an analytical quantity. */
export const analyticalLens = (lens: OrganismLens): boolean => lens === "clades" || lens === "traits";

/** Golden-angle hue so adjacent clade ids never collide visually. */
export function cladeColor(id: number): string {
  const hue = (id * 137.508) % 360;
  return `hsl(${hue} 58% 63%)`;
}

/** Trait value mapped across a fixed hue ramp, clamped to the trait's range. */
export function traitColor(value: number, [lo, hi]: [number, number]): string {
  const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  const hue = 210 - 170 * t;
  return `hsl(${hue} 68% 62%)`;
}

/**
 * The minimum an organism must expose to be drawn. Structurally smaller than
 * RenderOrganism so this stays a pure presentation contract.
 */
export interface EncodedOrganism {
  readonly cladeId: number;
  readonly byproductUse: number;
  readonly diet: number;
  readonly energy: number;
  readonly activity: "active" | "dormant";
  readonly [trait: string]: unknown;
}

/**
 * The dormancy channel. Independent of the lens colour by construction, so
 * dormancy can stay legible without displacing what an analytical lens shows.
 */
export function dormantChannel(o: Pick<EncodedOrganism, "activity">): {
  dormant: boolean;
  alpha: number;
  hollow: boolean;
} {
  const dormant = o.activity === "dormant";
  return { dormant, alpha: dormant ? DORMANT_ALPHA : 1, hollow: dormant };
}

/**
 * Organism colour for the active lens.
 *
 * In an analytical lens the lens encoding wins, including for dormant
 * organisms. In every other lens, including the Normal world, dormancy keeps
 * its original distinct colour and the decorative diet/byproduct branches are
 * unchanged.
 */
export function organismColor(
  o: EncodedOrganism,
  lens: OrganismLens,
  traitView: string,
  traitRange: [number, number],
): string {
  if (analyticalLens(lens)) {
    return lens === "clades"
      ? cladeColor(o.cladeId)
      : traitColor(o[traitView] as number, traitRange);
  }
  if (o.activity === "dormant") return "#7f9189";
  if (o.byproductUse > 0.55) return "#e7b36a";
  if (o.diet < -0.25) return "#7bd3c4";
  if (o.diet > 0.25) return "#b79de4";
  return "#d8f0df";
}
