/**
 * Pixi spike — deterministic phenotype texture cache (DOM-free, Node-safe).
 *
 * Consumes PR 29 phenotype semantics WITHOUT duplicating them:
 *   resolvePhenotype() -> renderPhenotypeGrid() -> grid bits -> cache key.
 * The Pixi layer (view.ts) starts at grid bits; everything here is pure.
 *
 * Two keys:
 * - exact:   fnv1a(grid bits) + tier + activity. Exact by construction.
 * - relaxed: family + quantized ladder + diet/habitat sign + tier + activity
 *            (drops the per-identity cosmetic pixel). validate.ts measures the
 *            drift: expected 0 cells at eco/pop (no cosmetic pixels there),
 *            <=2 at inspection (documented bound in renderer.ts).
 *
 * No sim-core / sim-runtime imports anywhere in this directory (validate.ts
 * asserts that). No simulation RNG: only mulberry32 presentation fixtures.
 */
import {
  FAMILY_CENTERS,
  FAMILY_ORDER,
  LOD_GRID_SIZE,
  PROTOTYPE_BASELINE,
  renderPhenotypeGrid,
  resolvePhenotype,
  type LodTier,
  type PhenotypeFamily,
  type PhenotypeGrid,
  type ResolvedPhenotype,
  type TraitSample,
} from "../../packages/phenotype/src/index.ts";
import { signedDirection } from "../../packages/phenotype/src/model.ts";

export const SPIKE_BASELINE = PROTOTYPE_BASELINE;

export function fnv1a(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function gridBits(g: PhenotypeGrid): string {
  return g.cells.map((b) => (b ? "1" : "0")).join("");
}

export function gridDifference(a: PhenotypeGrid, b: PhenotypeGrid): number {
  if (a.size !== b.size) throw new Error("tier mismatch in gridDifference");
  let d = 0;
  for (let i = 0; i < a.cells.length; i++) if (a.cells[i] !== b.cells[i]) d++;
  return d;
}

/** Exact render key: phenotype grid identity + tier + activity. */
export function renderKeyExact(res: ResolvedPhenotype, tier: LodTier, activity: "active" | "dormant"): string {
  const g = renderPhenotypeGrid(res, tier, activity);
  return `${tier}/${activity}/${g.size}/${fnv1a(gridBits(g))}`;
}

/** Relaxed key: drops per-identity cosmetic variation.
 *
 * First version (family + quantized ladder + diet/habitat sign) FAILED at
 * population (drift 6, bound 0): the renderer also reads raw axes —
 * `axes.sensing` sets radial arm length continuously and `axes.mobility >=
 * 0.6` gates sprawl suppression (renderer.ts). Fixed sensing bins CANNOT work:
 * the arm-length round() boundary (e.g. sensing=0.75 at population) falls
 * mid-bin no matter how fine the bins are. The key therefore carries the
 * tier-specific derived arm length itself — 1+round(sensing*(R-1)) with R from
 * LOD_GRID_SIZE and the bulk adjust, mirroring radialArmLength/coreRadius.
 * Drift is measured, not assumed, in validate.ts.
 */
export function renderKeyRelaxed(res: ResolvedPhenotype, tier: LodTier, activity: "active" | "dormant"): string {
  const q = res.quantized;
  const n = LOD_GRID_SIZE[tier];
  const half = Math.floor(n / 2);
  const adj = q.bulk >= 0.75 ? 1 : q.bulk <= 0.25 ? -1 : 0;
  const R = Math.min(half, Math.max(1, half + adj)); // mirrors coreRadius()
  const armLen = Math.max(1, 1 + Math.round(res.axes.sensing * (R - 1)));
  return [
    res.family, q.elongation, q.projection, q.density, q.asymmetry, q.secondary, q.bulk,
    signedDirection(res.dietSigned) || 0, signedDirection(res.habitatSigned) || 0,
    res.axes.mobility >= 0.6 ? 1 : 0, armLen,
    tier, activity,
  ].join("|");
}

export interface CacheEntry {
  readonly key: string;
  readonly tier: LodTier;
  readonly activity: "active" | "dormant";
  readonly size: number;
  readonly bits: string;
  users: number;
  /** Ever-created serial number (proves identity stability across steps). */
  readonly serial: number;
}

/**
 * CPU-side mirror of the GPU texture cache: one entry per exact render key,
 * reference-counted. Production-shaped lifecycle:
 * - acquire() on first use / phenotype change (users++);
 * - release() when a sprite stops using a key (users--);
 * - prune() drops zero-user entries (the view destroys the GPU texture).
 * Movement never touches this (positions are not key inputs); LOD switches
 * and evolution (phenotype changes) re-map sprite -> key.
 */
export class TextureCache {
  private entries = new Map<string, CacheEntry>();
  private nextSerial = 0;
  creations = 0;
  cumulative = 0;
  lookups = 0;
  hits = 0;
  pruned = 0;

  acquire(res: ResolvedPhenotype, tier: LodTier, activity: "active" | "dormant"): CacheEntry {
    this.lookups++;
    // NOTE: key derivation re-renders the grid; production would key on
    // resolved state directly (see relaxed key). The spike measures reuse,
    // not lookup speed — lookup cost is reported separately in validate.ts.
    const key = renderKeyExact(res, tier, activity);
    const hit = this.entries.get(key);
    if (hit) {
      // Collision guard (review fix): a 32-bit FNV-1a hit must carry the
      // identical bitmap. A mismatch means two phenotypes share one key
      // and rendering either would show the other's morphology — fail
      // loudly, never silently swap organisms.
      const bits = gridBits(renderPhenotypeGrid(res, tier, activity));
      if (bits !== hit.bits) {
        throw new Error(`render-key collision for ${key}: same hash, different bitmaps`);
      }
      this.hits++;
      hit.users++;
      return hit;
    }
    const g = renderPhenotypeGrid(res, tier, activity);
    const entry: CacheEntry = {
      key, tier, activity, size: g.size, bits: gridBits(g), users: 1,
      serial: this.nextSerial++,
    };
    this.entries.set(key, entry);
    this.creations++;
    this.cumulative++;
    return entry;
  }

  /** Backwards-compatible alias used by the reuse census (one acquire per organism). */
  forOrganism(res: ResolvedPhenotype, tier: LodTier, activity: "active" | "dormant"): CacheEntry {
    return this.acquire(res, tier, activity);
  }

  release(key: string): void {
    const e = this.entries.get(key);
    if (e && e.users > 0) e.users--;
  }

  /** Drop zero-user entries; returns their keys so the view can destroy GPU textures. */
  prune(): string[] {
    const dead: string[] = [];
    for (const [key, e] of this.entries) {
      if (e.users <= 0) {
        dead.push(key);
        this.entries.delete(key);
        this.pruned++;
      }
    }
    return dead;
  }

  live(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.users > 0) n++;
    return n;
  }

  get size(): number {
    return this.entries.size;
  }

  entriesList(): CacheEntry[] {
    return [...this.entries.values()];
  }
}

// ---------------------------------------------------------------- fixtures

export interface FixtureOrg {
  x: number;
  y: number;
  activity: "active" | "dormant";
  res: ResolvedPhenotype;
  /** Absolute traits (kept so churn can derive mutated descendants). */
  traits: TraitSample;
  id: number;
  lineageId: number;
}

export interface Fixture {
  name: string;
  source: "design-fixture" | "engine-like";
  organisms: FixtureOrg[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Family-center traits (same mapping as tools/phenotype-evidence.ts traitsAt). */
function traitsAtFamily(family: PhenotypeFamily): TraitSample {
  const c = FAMILY_CENTERS[family];
  return {
    speed: 0.25 + c[0] * 3.75,
    sensing: 10 + c[1] * 170,
    metabolism: 0.04 + c[2] * 0.46,
    reproduction: 100,
    diet: Math.min(1, c[3] / 0.75) * 1.5,
    habitat: Math.min(1, c[3] / 0.75) * 1.5,
    byproductUse: Math.max(0, Math.min(1, (c[3] - 0.75 * Math.min(1, c[3] / 0.75)) / 0.25)) * 1.5,
    dormancyResponse: 1.0,
  };
}

/** Diverse design fixture: round-robin families, held by lineage anchoring. */
export function designFixture(name: string, count: number, seed: number): Fixture {
  const rng = mulberry32(seed);
  const organisms: FixtureOrg[] = [];
  for (let i = 0; i < count; i++) {
    const fam = FAMILY_ORDER[i % FAMILY_ORDER.length]!;
    const base = traitsAtFamily(fam);
    const j = (): number => (rng() * 2 - 1) * 0.08;
    const traits: TraitSample = {
      speed: base.speed * (1 + j()),
      sensing: base.sensing * (1 + j()),
      metabolism: base.metabolism * (1 + j()),
      reproduction: base.reproduction,
      diet: base.diet * (1 + j()),
      habitat: base.habitat * (1 + j()),
      byproductUse: Math.max(0, base.byproductUse * (1 + j())),
      dormancyResponse: 1.0,
    };
    const res = resolvePhenotype(traits, { parentFamily: fam, organismId: 1000 + i, lineageId: 900 + (i % 6) });
    if (res.family !== fam) throw new Error(`fixture drift: wanted ${fam}, got ${res.family} at ${name}#${i}`);
    organisms.push({
      x: 20 + rng() * 560, y: 20 + rng() * 560,
      activity: rng() < 0.15 ? "dormant" : "active",
      res, traits, id: 1000 + i, lineageId: 900 + (i % 6),
    });
  }
  return { name, source: "design-fixture", organisms };
}

/**
 * Engine-like fixture: blob-basin traits mirroring the evolved manifold
 * (narrow ranges around the blob center, per evidence tuning §10).
 * Labels say engine-like, never engine-derived.
 */
export function engineLikeFixture(name: string, count: number, seed: number): Fixture {
  const rng = mulberry32(seed);
  const organisms: FixtureOrg[] = [];
  let parent: PhenotypeFamily | null = null;
  for (let i = 0; i < count; i++) {
    const traits: TraitSample = {
      speed: 0.68 + rng() * 1.01,
      sensing: 31.96 + rng() * 47.59,
      metabolism: 0.1 + rng() * 0.12,
      reproduction: 100,
      diet: -0.45 + rng() * 0.82,
      habitat: -0.44 + rng() * 1.0,
      byproductUse: rng() * 0.46,
      dormancyResponse: rng() * 0.87,
    };
    const id = 5000 + i;
    const lineageId = 50 + (i % 7);
    const res = resolvePhenotype(traits, { parentFamily: parent, organismId: id, lineageId });
    parent = res.family;
    organisms.push({
      x: 20 + rng() * 560, y: 20 + rng() * 560,
      activity: rng() < 0.15 ? "dormant" : "active",
      res, traits, id, lineageId,
    });
  }
  return { name, source: "engine-like", organisms };
}

/** Simulate movement: new positions, same organisms. Keys must be unchanged. */
export function moveFixture(f: Fixture, seed: number): Fixture {
  const rng = mulberry32(seed);
  return {
    ...f,
    organisms: f.organisms.map((o) => ({
      ...o,
      x: (o.x + (rng() * 2 - 1) * 30 + 600) % 600,
      y: (o.y + (rng() * 2 - 1) * 30 + 600) % 600,
    })),
  };
}

export interface ChurnState {
  nextId: number;
  rng: () => number;
}

export function churnState(seed: number, startId: number): ChurnState {
  return { nextId: startId, rng: mulberry32(seed) };
}

/**
 * Synthetic evolution churn: replace `turnover` fraction of organisms with
 * mutated descendants (perturbed traits, lineage-anchored resolution, fresh
 * identity), plus a small activity-flip rate. Population stays constant.
 * Presentation-side model of birth/mutation/death — never simulation biology.
 */
export function evolveFixture(f: Fixture, st: ChurnState, turnover: number): { replaced: number; flipped: number } {
  const rng = st.rng;
  let replaced = 0;
  let flipped = 0;
  for (const o of f.organisms) {
    if (rng() < turnover) {
      const t = o.traits;
      const child: TraitSample = {
        speed: t.speed * (1 + (rng() * 2 - 1) * 0.06),
        sensing: t.sensing * (1 + (rng() * 2 - 1) * 0.06),
        metabolism: t.metabolism * (1 + (rng() * 2 - 1) * 0.06),
        reproduction: t.reproduction,
        diet: t.diet + (rng() * 2 - 1) * 0.12,
        habitat: t.habitat + (rng() * 2 - 1) * 0.12,
        byproductUse: Math.max(0, t.byproductUse + (rng() * 2 - 1) * 0.06),
        dormancyResponse: Math.max(0, Math.min(1.5, t.dormancyResponse + (rng() * 2 - 1) * 0.1)),
      };
      const id = st.nextId++;
      o.traits = child;
      o.id = id;
      o.res = resolvePhenotype(child, { parentFamily: o.res.family, organismId: id, lineageId: o.lineageId });
      replaced++;
    } else if (rng() < 0.02) {
      o.activity = o.activity === "active" ? "dormant" : "active";
      flipped++;
    }
  }
  return { replaced, flipped };
}
