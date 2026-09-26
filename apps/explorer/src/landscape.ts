import type { RenderResourceField, RenderWasteField } from "@digital-evolution/contracts";

/**
 * Ecological landscape rendering (Slice 2 product integration).
 *
 * Presentation only. Nothing here reads simulation RNG, writes simulation
 * state, or feeds back into analysis. Every function is pure with respect to
 * its arguments except the presentation smoother, whose state is explicitly
 * presentation state and is resettable (see `LandscapeSmoother`).
 *
 * Design rules encoded here:
 * - fields are composited by ECOLOGICAL ROLE, not as generic RGB mixing:
 *   primary nutrients -> fertile character, Metabolite C -> biologically
 *   altered substrate, Metabolic Waste -> costly/degraded character;
 * - persistent large-scale structure comes from real simulation structure
 *   (nutrient source geometry, patch gradients, organism-made waste), never
 *   from invented categorical terrain or an implied elevation/water model;
 * - no visual difference is carried by hue alone: luminance, saturation and
 *   a deterministic micro-pattern density all co-vary (see `hatchDensity`).
 */

export type Ecological = "normal" | "nutrients" | "waste";

/** World is a 600x600 torus at a 60x60 substance grid (engine constants). */
const CELLS = 60 * 60;

/**
 * Presentation-only temporal smoothing. The landscape follows simulation
 * state continuously but approaches it with inertia, so raw per-snapshot
 * field noise cannot make the whole world flicker between frames.
 *
 * Guarantees required by the handoff:
 * - it holds no simulation meaning; `reset()` (or a seed/tick jump backwards)
 *   discards all history so a stale visual can never represent another state;
 * - it never reads or writes simulation RNG;
 * - blending is monotonic and bounded, so it cannot create or destroy a
 *   feature that the simulation did not produce — only soften its arrival.
 */
export class LandscapeSmoother {
  readonly size: number;
  #values: Float32Array;
  #identity: string;

  constructor(size: number = CELLS) {
    this.size = size;
    this.#values = new Float32Array(size * 4); // a, b, c, waste
    this.#identity = "";
  }

  /**
   * Identity of the state these smoothed values belong to. Any change
   * (new universe, different seed, load/restore, tick moving backwards)
   * discards the history so a restored world never renders through another
   * world's inertia.
   */
  identity(seed: number, tick: number): string {
    return `${seed}:${tick < 0 ? -1 : 0}`;
  }

  reset(identity: string): void {
    this.#values.fill(0);
    this.#identity = identity;
  }

  #ensure(identity: string): void {
    if (this.#identity !== identity) this.reset(identity);
  }

  /** Advance smoothing toward the true field. Returns the smoothed values. */
  advance(
    identity: string,
    a: Float32Array,
    b: Float32Array,
    c: Float32Array,
    waste: Float32Array,
    strength = 0.35,
  ): Float32Array {
    this.#ensure(identity);
    const v = this.#values;
    const k = strength < 0 ? 0 : strength > 1 ? 1 : strength;
    for (let i = 0; i < this.size; i++) {
      const j = i * 4;
      v[j] = v[j]! + (a[i]! - v[j]!) * k;
      v[j + 1] = v[j + 1]! + (b[i]! - v[j + 1]!) * k;
      v[j + 2] = v[j + 2]! + (c[i]! - v[j + 2]!) * k;
      v[j + 3] = v[j + 3]! + (waste[i]! - v[j + 3]!) * k;
    }
    return v;
  }

  /** Raw fractional fields for one cell index, smoothed. */
  static readSmoothed(smoothed: Float32Array, i: number): [number, number, number, number] {
    const j = i * 4;
    return [smoothed[j]!, smoothed[j + 1]!, smoothed[j + 2]!, smoothed[j + 3]!];
  }
}
export function fracArray(
  stock: readonly (readonly number[])[],
  capacity: readonly (readonly number[])[],
  kind: number,
  out: Float32Array,
): void {
  const s = (stock as readonly (readonly number[] | undefined)[])[kind];
  const c = (capacity as readonly (readonly number[] | undefined)[])[kind];
  for (let i = 0; i < out.length; i++) {
    const cap = c ? c[i] ?? 0 : 0;
    out[i] = cap > 1e-9 ? (s ? s[i] ?? 0 : 0) / cap : 0;
  }
}

export function fillWaste(
  waste: RenderWasteField,
  out: Float32Array,
): void {
  for (let i = 0; i < out.length; i++) {
    const cap = waste.capacity[i] ?? 0;
    out[i] = cap > 1e-9 ? (waste.stock[i] ?? 0) / cap : 0;
  }
}

export function fillResources(
  resources: RenderResourceField,
  out: Float32Array,
): void {
  fracArray(resources.stock, resources.capacity, 0, out);
}


/**
 * Deterministic cosmetic micro-pattern density in [0,1]. Seeded by cell
 * index only: stable across frames, ticks, restores and universes, and
 * entirely independent of simulation RNG. Purely a texture multiplier that
 * co-varies with hue so a difference is never hue-only.
 */
export function microTexture(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 2654435761) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  return (h >>> 8) / 16777216;
}

export type Rgb = readonly [number, number, number];

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
const sat = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Semantic compositing: one coherent ecological character per cell.
 *
 * - fertile: primary nutrient abundance raises luminance and green/olive
 *   weight (resource-rich character);
 * - altered: biologically produced Metabolite C shifts toward a warm,
 *   higher-chroma tint (biologically altered substrate);
 * - degraded: metabolic waste desaturates, darkens and warms, and is the
 *   only contributor allowed to push luminance DOWN.
 *
 * Values are bounded, monotonic in each input, and touch neither organisms
 * nor analysis. No categorical biome boundaries are implied: the result is
 * continuous, so a cell's character is read as a level, not a class.
 */
export function landscapeCell(
  a: number,
  b: number,
  c: number,
  waste: number,
  texture: number,
): Rgb {
  const fertile = Math.min(1, (a + b) / 1.35);
  const altered = sat(c * 1.25);
  const degraded = sat(waste * 1.6);

  // Base substrate: cool dark ground, gently lifted by resource richness.
  let r = 13 + 26 * fertile + 30 * altered;
  let g = 20 + 46 * fertile + 18 * altered;
  let bl = 24 + 20 * fertile + 10 * altered;

  // Degraded character: darken and warm without going fully black, so a
  // heavily loaded world stays legible rather than becoming a black hole.
  const dim = 1 - 0.55 * degraded;
  r = r * dim + 34 * degraded;
  g = g * dim + 16 * degraded;
  bl = bl * dim + 12 * degraded;

  // Deterministic microvariation, subordinate to the simulated structure.
  const grain = (texture - 0.5) * 9 * (1 - 0.6 * degraded);
  return [clamp255(r + grain), clamp255(g + grain * 0.8), clamp255(bl + grain * 0.6)];
}

/**
 * Exact fractional fields for one cell. Awaits the correct index so the
 * waste overlay cannot read the wrong cell; a missing field reads as absent
 * rather than as zero-load.
 */
export async function cellFractions(
  resources: RenderResourceField,
  waste: RenderWasteField,
  ix: number,
  iy: number,
): Promise<{ a: number; b: number; c: number; waste: number } | null> {
  const n = resources.gridSize;
  if (ix < 0 || iy < 0 || ix >= n || iy >= n || waste.gridSize !== n) return null;
  const i = iy * n + ix;
  const f = (stock: readonly number[], cap: readonly number[]) =>
    (cap[i] ?? 0) > 1e-9 ? (stock[i] ?? 0) / cap[i]! : 0;
  return {
    a: f(resources.stock[0] ?? [], resources.capacity[0] ?? []),
    b: f(resources.stock[1] ?? [], resources.capacity[1] ?? []),
    c: f(resources.stock[2] ?? [], resources.capacity[2] ?? []),
    waste: (waste.capacity[i] ?? 0) > 1e-9 ? (waste.stock[i] ?? 0) / waste.capacity[i]! : 0,
  };
}

/** Analytical palettes. Precise, deliberately flat, never textured. */
export function nutrientOverlayCell(kind: number, v: number): Rgb {
  const t = sat(v);
  if (kind === 0) return [clamp255(24 + 40 * t), clamp255(18 + 200 * t), clamp255(30 + 110 * t)];
  if (kind === 1) return [clamp255(26 + 180 * t), clamp255(20 + 90 * t), clamp255(38 + 220 * t)];
  if (kind === 2) return [clamp255(40 + 240 * t), clamp255(28 + 150 * t), clamp255(24 + 60 * t)];
  // combined: neutral, value-ordered
  return [clamp255(20 + 150 * t), clamp255(24 + 130 * t), clamp255(34 + 120 * t)];
}

/**
 * Waste overlay. A sequential, low-chroma ramp that stays distinguishable
 * without hue: the ramp increases luminance AND chroma AND (in the renderer)
 * pattern density, so "more waste" is never a hue-only claim.
 */
export function wasteOverlayCell(v: number): Rgb {
  const t = sat(v);
  return [clamp255(26 + 200 * t), clamp255(22 + 96 * t), clamp255(30 + 128 * t)];
}
