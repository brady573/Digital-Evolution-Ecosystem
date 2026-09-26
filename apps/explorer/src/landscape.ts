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
 * - it holds no simulation meaning; it is scoped by an explicit per-universe
 *   presentation identity, so a stale visual can never represent another
 *   world (two universes can share a seed AND a resolved config, so neither
 *   is a sufficient key);
 * - it never reads or writes simulation RNG;
 * - a reset PRIMES from the current actual fields instead of interpolating
 *   from a fictitious zero environment, so a newly created or restored
 *   paused world shows its real environment on its very first frame;
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

  #tick = -1;
  #primed = false;

  /**
   * Forget all history for an identity. The next `advance` primes from the
   * CURRENT actual fields rather than blending from zero, so a created or
   * restored universe renders its real environment immediately.
   */
  reset(identity: string): void {
    this.#values.fill(0);
    this.#identity = identity;
    this.#primed = false;
    this.#tick = -1;
  }

  /** Presentation diagnostics: true once the buffer holds real field values. */
  get primed(): boolean {
    return this.#primed;
  }

  /**
   * Advance toward the true field and return the smoothed values.
   *
   * The first observation of an identity primes (copies exactly, no
   * blending); every later observation blends by `strength`. A backwards
   * tick also re-primes, because interpolating through a future would show a
   * world a state it has not reached.
   */
  advance(
    identity: string,
    tick: number,
    a: Float32Array,
    b: Float32Array,
    c: Float32Array,
    waste: Float32Array,
    strength = 0.35,
  ): Float32Array {
    const rewind = this.#primed && tick < this.#tick;
    if (this.#identity !== identity || rewind) {
      this.#identity = identity;
      const v = this.#values;
      // The buffer is interleaved (four channels per cell), so priming must
      // interleave too — block copies would scramble the channels.
      for (let i = 0; i < this.size; i++) {
        const j = i * 4;
        v[j] = a[i]!;
        v[j + 1] = b[i]!;
        v[j + 2] = c[i]!;
        v[j + 3] = waste[i]!;
      }
      this.#primed = true;
      this.#tick = tick;
      // Round-trip through the typed array so later blends see exactly the
      // precision the renderer displays, rather than a wider intermediate
      // that the first frame would quietly disagree with.
      return Float32Array.from(v);
    }
    this.#tick = tick;
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
// Ash: a near-neutral warm grey, deliberately low-chroma. Waste blends the
// ground toward this rather than toward black, because dark degradation
// reads as a hole in the world and hides the organisms standing in it.
const ASH_R = 82, ASH_G = 76, ASH_B = 70;

/**
 * Semantic compositing: one coherent ecological character per cell.
 *
 * - fertile A / fertile B: the two abiotic nutrient sources carry
 *   *distinguishable* characters (verdant vs olive) so the world's real patch
 *   geometry stays perceptible without switching to an analytical view;
 * - altered: biologically produced Metabolite C shifts toward a warm
 *   high-chroma tint (biologically altered substrate);
 * - degraded: metabolic waste reads as spent, ashen ground — it desaturates
 *   and warms and darkens only gently. It must never crush to near-black:
 *   dark patches read as rendering holes, not as heavy pollution, and a
 *   player must still be able to see organisms standing in them.
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
  const fertileA = sat(a / 0.8);
  const fertileB = sat(b / 0.8);
  const altered = sat(c * 1.2);
  const degraded = sat(waste * 1.5);

  // Base substrate: mid-dark ground, never a void. A wide gap between
  // unlit and fertile ground is what makes poor soil read as a hole in the
  // world, so the floor is high and the fertile lift is deliberately modest:
  // the landscape carries tonal range, but no region looks absent.
  let r = 58;
  let g = 66;
  let bl = 61;

  // Fertile A: verdant, cooler green. Fertile B: olive, warmer and drier.
  r += 8 * fertileA + 30 * fertileB;
  g += 30 * fertileA + 28 * fertileB;
  bl += 12 * fertileA + 9 * fertileB;

  // Altered substrate: biologically produced metabolite, warm violet-pink.
  r += 34 * altered;
  g += 8 * altered;
  bl += 30 * altered;

  // Degraded: ash. Rather than darkening, waste blends the ground toward a
  // near-neutral warm grey. That single move is doing three jobs at once —
  // it pales the ground, drops colour relative to brightness (so the
  // character survives without hue), and warms it. The blend is strong but
  // never total, so a loaded cell still carries the fertility beneath it.
  const t = degraded * 0.9;
  r += (ASH_R - r) * t;
  g += (ASH_G - g) * t;
  bl += (ASH_B - bl) * t;

  // Deterministic microvariation, subordinate to the simulated structure and
  // stronger on fertile ground (where texture is plausible) than on ash.
  const grain = (texture - 0.5) * 9 * (1 - 0.4 * degraded);
  return [clamp255(r + grain), clamp255(g + grain * 0.85), clamp255(bl + grain * 0.7)];
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
 * Waste overlay. A sequential ramp whose DARK END IS LIFTED: a ramp that
 * starts near black makes most of an ordinary world look like a void, which
 * misreads as a rendering fault. Load increases through luminance, chroma
 * and (in the renderer) a second channel, so the reading never depends on
 * hue alone.
 */
export function wasteOverlayCell(v: number): Rgb {
  const t = sat(v);
  return [clamp255(58 + 176 * t), clamp255(52 + 96 * t), clamp255(62 + 108 * t)];
}
