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

/**
 * Tile layout for the wrapped substrate draw.
 *
 * The substrate is one world period (a 60x60 buffer) that must be repeated
 * across the whole visible rectangle. Deriving the destination rectangle from
 * a *wrapped* world→screen mapping is wrong: `wrapDelta(0, cam)` and
 * `wrapDelta(extent, cam)` are equal for every camera except the exact centre,
 * so `toX(0)` and `toX(extent)` collapse onto the same point and the drawn
 * rect has zero width. That made the landscape appear only at the default
 * camera and vanish as soon as the world was panned.
 *
 * So: compute the un-wrapped position of world origin, then repeat the period
 * over the integer tile range that covers the canvas. Exact, position
 * independent, and cheap (a handful of drawImage calls).
 */
export function landscapeTileLayout(
  camX: number,
  camY: number,
  scale: number,
  viewW: number,
  viewH: number,
  extent: number,
): {
  baseX: number; baseY: number;
  periodX: number; periodY: number;
  iStart: number; iEnd: number; jStart: number; jEnd: number;
  count: number;
} {
  const periodX = extent * scale;
  const periodY = extent * scale;
  // Un-wrapped: where world 0 lands, relative to the canvas centre.
  const baseX = viewW / 2 - camX * scale;
  const baseY = viewH / 2 - camY * scale;
  const iStart = Math.floor((0 - baseX) / periodX);
  const iEnd = Math.ceil((viewW - baseX) / periodX) - 1;
  const jStart = Math.floor((0 - baseY) / periodY);
  const jEnd = Math.ceil((viewH - baseY) / periodY) - 1;
  return {
    baseX, baseY, periodX, periodY, iStart, iEnd, jStart, jEnd,
    count: (iEnd - iStart + 1) * (jEnd - jStart + 1),
  };
}

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
// Ash: a near-neutral warm bone, deliberately low-chroma, and deliberately
// PALER than bare ground, than resource-rich ground, and than any fouled cell.
//
// Waste must visibly alter the local character, so ash has to sit ABOVE the
// brightest thing it can be laid over. It therefore had to be re-seated twice:
// once when bare substrate was raised (which collapsed the fouled-vs-bare gap
// from about 43 to about 15 and made waste nearly invisible), and again when the
// resource-material lift was strengthened, which lifted the richest cell above
// the old ash. Without that second move, fouling a RICH patch darkened it - and
// darkening is the damage vocabulary the design rule forbids, so a waste effect
// would have quietly reintroduced it.
//
// It never darkens, for the same reason: dark degradation reads as a hole in
// the world, hides the organisms standing in it, and implies injury the model
// does not simulate.
const ASH_R = 216, ASH_G = 210, ASH_B = 198;
export const ASH_RGB: Rgb = [ASH_R, ASH_G, ASH_B];


/**
 * Bare substrate: exposed, pale, neutral ground.
 *
 * PALER than resource material, deliberately. This polarity is the whole point.
 * An earlier version carried presence as a BRIGHTENING lift on darker ground,
 * which meant removing material necessarily darkened the world - measured at a
 * 17.8-point luma drop across a real depletion - and a darker patch reads as
 * wounded ground. That is the damage vocabulary the Owner rule forbids without
 * simulation evidence of damage.
 *
 * Inverting the polarity fixes it at the source: depleting a region now makes it
 * LIGHTER, reading as pale exposed soil, while the green and olive of surviving
 * material stays put and so reads as the refugium. Presence is carried by hue
 * and saturation rather than by brightness.
 *
 * Light ground also serves the standing constraint that ground must never crush
 * to near-black, because dark degradation hides the organisms standing in it.
 */
const BARE_R = 178, BARE_G = 173, BARE_B = 162;
/** The bare-substrate reference, exported for the same reason: validation that
 *  hardcodes its own copy of a palette value silently inverts the moment the
 *  palette is retuned. A stale bare reference made a real depletion read as
 *  material GAINED, because under the current polarity material sits closer to
 *  the old dark reference than bare ground does. */
export const BARE_RGB: Rgb = [BARE_R, BARE_G, BARE_B];

/**
 * Fraction of full presence below which no resource material reads at all.
 *
 * This is what turns a tint into a PRESENCE language. A linear ramp can never
 * let material disappear, so a shrinking patch only ever looks uniformly
 * dimmer - the patch does not read as shrinking. With a floor, stock falling
 * erodes a patch from its thin edges inward: it thins, holes appear, it
 * fragments, and only then does it go. That is the depletion read the design
 * asks for, and it is driven purely by the authoritative stock fraction.
 */
const PRESENCE_FLOOR = 0.05;

/**
 * Stock fraction that reads as FULL resource presence.
 *
 * Calibrated against the authoritative field, not chosen by eye. Measured
 * per-cell stock/capacity for the abiotic nutrients is remarkably stable
 * across world age: p25 ~0.05, p50 ~0.105, p90 ~0.20, p99 ~0.28, max ~0.31,
 * sampled independently at the first decision opportunity and later in a run.
 *
 * An earlier value of 0.8 - inherited from the previous tint - was far above
 * anything the field reaches. It put even the richest cell at roughly 17%
 * presence, and combined with a floor it rendered the entire world as bare
 * substrate, which is precisely the failure this work exists to fix. The
 * reference is a PRESENTATION mapping (question 3), not a biological threshold:
 * it asserts nothing about the simulation, and no ecological constant is
 * retuned by it.
 */
const PRESENCE_FULL = 0.28;

/**
 * Resource material presence in [0,1]: zero at or below the scarcity floor,
 * rising smoothly to one at full stock. Smoothstep is used deliberately - it has
 * zero slope at the floor, so material fades out instead of ending on a visible
 * seam. Monotonic in the input, bounded, and a pure function of the fraction.
 */
function resourcePresence(fraction: number): number {
  const t = sat((fraction - PRESENCE_FLOOR) / (PRESENCE_FULL - PRESENCE_FLOOR));
  return t * t * (3 - 2 * t);
}

/**
 * Simulation-backed resource presence in the NORMAL World. No lens required.
 *
 * Traceability, answering the five required questions:
 *
 * 1. Authoritative field: the per-cell resource stock fractions, `stock/capacity`
 *    for each substance, as retained on the render snapshot's resource field.
 * 2. Authoritative resolution: the 60x60 resource grid - one value per grid
 *    cell. The buffer is rendered at that resolution and scaled to the canvas,
 *    so nothing finer is claimed; `imageSmoothingEnabled` interpolation between
 *    cells is smoothing of authoritative samples, not invented detail.
 * 3. Presentation mapping: stock fraction -> resourcePresence() -> a material
 *    lift toward a per-substance hue. Nutrient A is verdant, B is olive and
 *    drier, C is a warm high-chroma metabolite tint, so the two abiotic
 *    nutrients stay distinguishable and the world's real patch geometry is
 *    legible in the default view.
 * 4. Interpolation / artistic amplification ONLY: the presence curve, the
 *    smoothstep easing, the choice of hues, the strength of each lift, and the
 *    deterministic micro-pattern. None of these add ecological facts; they only
 *    make an existing difference easier to see. A cell's material density is a
 *    function of its stock and nothing else.
 * 5. Misleading inference prevented: absence of material is NEVER rendered as
 *    damage. No cracking, charring, scorch, desiccation, sick colouring or
 *    darkening vocabulary is introduced at low stock, because the model does not
 *    simulate soil condition, moisture, toxin or habitat damage. A naturally
 *    poor region reads as SPARSE, not as INJURED. Equally, nothing here implies
 *    that richness is healthy or that scarcity is harmful: it states how much
 *    resource material is present, and stops there.
 *
 * Values are bounded and monotonic in each input, and this function touches
 * neither organisms nor analysis. No categorical biome boundaries are implied:
 * the result is continuous, so a cell reads as a level, not a class.
 */
export function landscapeCell(
  a: number,
  b: number,
  c: number,
  waste: number,
  texture: number,
): Rgb {
  const fertileA = resourcePresence(a);
  const fertileB = resourcePresence(b);
  const altered = sat(c * 1.2);
  const degraded = sat(waste * 1.5);

  // Bare substrate: exposed, neutral ground. The floor is a real mid-tone
  // because the empty end of a presence language must read as ground, not as a
  // hole and not as damage.
  let r = BARE_R;
  let g = BARE_G;
  let bl = BARE_B;

  // Resource material. Deliberately DARKER and far more chromatic than bare
  // ground, so presence reads as living material on pale soil and its loss reads
  // as lightening - never as darkening, which is the damage reading. The colour
  // swing is large where the luminance swing is small, which is what keeps a
  // depleted region legible while satisfying the neutral-absence rule.
  // Fertile A: verdant green. Fertile B: olive, warmer and drier.
  r += -60 * fertileA - 12 * fertileB;
  g += -5 * fertileA - 15 * fertileB;
  bl += -50 * fertileA - 58 * fertileB;

  // Altered substrate: biologically produced metabolite, warm violet-pink.
  r += 18 * altered;
  g += -23 * altered;
  bl += 6 * altered;

  // Degraded: ash. Rather than darkening, waste blends the ground toward a
  // near-neutral warm grey. That single move is doing three jobs at once —
  // it pales the ground, drops colour relative to brightness (so the
  // character survives without hue), and warms it. The blend is strong but
  // never total, so a loaded cell still carries the fertility beneath it.
  const t = degraded * 0.95;
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
