/**
 * Living Evolution Explorer — phenotype presentation adapter (Lane 2 M4B).
 *
 * Bridges the pure phenotype engine (@digital-evolution/phenotype) and the
 * production Pixi World:
 * - descendant-chained family resolution over a snapshot (generation order,
 *   orphan lineages fall back to founder resolution);
 * - per-organism memoization across snapshots, scoped to the displayed
 *   world identity (worldId): switching universes clears the cache so ids
 *   recurring across worlds never inherit a prior resolution. A living
 *   organism's traits and ancestry are fixed at birth and engine ids are
 *   never reused within one world, so a cached resolution stays valid while
 *   the id is alive; entries for departed ids are pruned per snapshot and
 *   the cache is hard-capped (eviction only costs a re-resolve, never
 *   correctness);
 * - save/restore continuity via staged anchors: resolutions saved alongside
 *   a checkpoint preload into a restored world, so orphans whose parents
 *   are dead keep their pre-save family instead of founder-flipping;
 * - zoom-tier mapping and per-tier morphology footprint sizing for renderer use.
 *
 * Presentation only: positions, hit testing, lenses, minimap, selection, and
 * all simulation behavior remain outside phenotype authority. Analytical
 * lenses retain their exact encodings; phenotype geometry is resolved here and
 * consumed by the production Pixi renderer.
 */
import type { RenderOrganism, WorldId } from "@digital-evolution/contracts";
import {
  FAMILY_ORDER,
  lodTierForZoom,
  renderPhenotypeGrid,
  resolvePhenotype,
  type LodTier,
  type PhenotypeFamily,
  type PhenotypeGrid,
  type ResolvedPhenotype,
} from "@digital-evolution/phenotype";

/** Max cached organisms; eviction only costs a re-resolve. */
const CACHE_CAP = 20000;

/**
 * Grid cell size per tier as a fraction of the legacy voxel unit, so organism
 * footprints stay comparable to the pre-phenotype renderer at every zoom.
 * Presentation tuning, not biology.
 */
export const PHENOTYPE_CELL_FRACTION: Record<LodTier, number> = {
  ecosystem: 0.8,
  population: 0.5,
  inspection: 0.35,
};

export function tierForZoom(zoom: number): LodTier {
  return lodTierForZoom(zoom);
}

interface CacheEntry {
  res: ResolvedPhenotype;
  grids: Map<string, PhenotypeGrid>;
}

/**
 * Presentation-side family anchors: resolved phenotypes saved alongside a
 * checkpoint so a restored world reconstructs identical families even when a
 * living organism's parent is dead/absent. Biology never reads this map —
 * it travels with the save record, not the biological checkpoint.
 */
export type PhenotypeAnchors = Record<number, ResolvedPhenotype>;

/** Validate + sanitize an anchor map from storage. Invalid entries are dropped, never fatal. */
export function sanitizeAnchors(raw: unknown): PhenotypeAnchors {
  const out: PhenotypeAnchors = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = Number(key);
    if (!Number.isInteger(id) || id < 0) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const v = value as Record<string, unknown>;
    if (typeof v.family !== "string" || !(FAMILY_ORDER as readonly string[]).includes(v.family)) continue;
    if (!v.quantized || typeof v.quantized !== "object") continue;
    out[id] = v as unknown as ResolvedPhenotype;
  }
  return out;
}

export class PhenotypeCache {
  private byId = new Map<number, CacheEntry>();
  private worldId: number | null | undefined;
  private staged: PhenotypeAnchors = {};

  /** Number of cached organisms (for tests and diagnostics). */
  get size(): number {
    return this.byId.size;
  }

  /**
   * Stage anchors loaded from a save record. Consumed once, on the next
   * snapshot whose world identity differs — so a resume-then-create sequence
   * can never leak one universe's anchors into another.
   */
  stageAnchors(map: PhenotypeAnchors): void {
    this.staged = { ...map };
  }

  /** Discard staged anchors without adopting them (e.g. creating a fresh universe). */
  clearStaged(): void {
    this.staged = {};
  }

  /** Copies of current resolutions for the save path (presentation only). */
  snapshotAnchors(): PhenotypeAnchors {
    const out: PhenotypeAnchors = {};
    for (const [id, entry] of this.byId) out[id] = entry.res;
    return out;
  }

  /**
   * Resolve every organism in the snapshot with descendant chaining:
   * generation order guarantees a parent's visual family is known before its
   * children resolve. Missing parents (dead, culled, or restored without
   * ancestry) fall back to founder resolution — deterministic, never a crash —
   * unless a staged save anchor names the organism's own prior resolution.
   *
   * Lane 3 F2b consumer cutover: the input is the presentation store's joined
   * organism rows (RenderOrganism-shaped catalog+live entries), not a legacy
   * RenderSnapshot. Only worldId (cache scoping) and the organism rows are
   * read; family resolution, cache scoping, pruning, cap, and anchor
   * semantics are untouched. A full RenderSnapshot remains assignable, so
   * existing detail paths keep compiling.
   *
   * Cross-universe isolation (review blocker 1): the cache is keyed to the
   * displayed world's identity. A new worldId clears all entries and adopts
   * staged anchors; ids recurring across universes can never inherit a prior
   * universe's resolution.
   */
  resolveSnapshot(input: { readonly worldId: WorldId; readonly organisms: readonly RenderOrganism[] }): Map<number, ResolvedPhenotype> {
    const snapshot = input;
    if (snapshot.worldId !== this.worldId) {
      this.byId.clear();
      this.worldId = snapshot.worldId;
      const adopted = sanitizeAnchors(this.staged);
      for (const [id, res] of Object.entries(adopted)) {
        this.byId.set(Number(id), { res, grids: new Map() });
      }
      this.staged = {};
    }
    const out = new Map<number, ResolvedPhenotype>();
    const alive = new Set<number>();
    const sorted = [...snapshot.organisms].sort((a, b) => a.generation - b.generation || a.id - b.id);
    for (const o of sorted) {
      alive.add(o.id);
      const cached = this.byId.get(o.id);
      if (cached) {
        out.set(o.id, cached.res);
        continue;
      }
      const parentFamily = o.parent == null ? null : (out.get(o.parent)?.family ?? null);
      const res = resolvePhenotype(
        {
          speed: o.speed,
          sensing: o.sensing,
          metabolism: o.metabolism,
          reproduction: o.reproduction,
          diet: o.diet,
          habitat: o.habitat,
          byproductUse: o.byproductUse,
          dormancyResponse: o.dormancyResponse,
        },
        { parentFamily, organismId: o.id, lineageId: o.lineageId },
      );
      this.byId.set(o.id, { res, grids: new Map() });
      out.set(o.id, res);
    }
    // Prune the departed and enforce the cap (oldest first; Map is ordered).
    for (const id of this.byId.keys()) {
      if (!alive.has(id)) this.byId.delete(id);
    }
    while (this.byId.size > CACHE_CAP) {
      const oldest = this.byId.keys().next();
      if (oldest.done) break;
      this.byId.delete(oldest.value);
    }
    return out;
  }

  /**
   * Direct family lookup for an already-resolved organism (review fix):
   * reads the live cache populated by the normal snapshot-resolution
   * pass — no copy, no sort, no re-resolution. Returns null when the
   * organism has no live entry (e.g. world changed since the last pass).
   */
  familyOf(id: number): PhenotypeFamily | null {
    return this.byId.get(id)?.res.family ?? null;
  }

  /** Cached grid for one organism at a tier/activity (renders once). */
  grid(o: RenderOrganism, res: ResolvedPhenotype, tier: LodTier): PhenotypeGrid {
    const entry = this.byId.get(o.id);
    const key = `${tier}/${o.activity}`;
    if (entry && entry.res === res) {
      const hit = entry.grids.get(key);
      if (hit) return hit;
    }
    const fresh = renderPhenotypeGrid(res, tier, o.activity);
    if (entry && entry.res === res) entry.grids.set(key, fresh);
    return fresh;
  }
}

/** Shared live-world cache (module lifetime = session lifetime). */
export const phenotypeCache = new PhenotypeCache();
