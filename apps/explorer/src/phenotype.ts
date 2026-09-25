/**
 * Living Evolution Explorer — phenotype presentation adapter (Lane 2 M4B).
 *
 * Bridges the pure phenotype engine (@digital-evolution/phenotype) and the
 * live WorldCanvas:
 * - descendant-chained family resolution over a snapshot (generation order,
 *   orphan lineages fall back to founder resolution);
 * - per-organism memoization across snapshots. A living organism's traits and
 *   ancestry are fixed at birth and engine ids are never reused, so a cached
 *   resolution stays valid while the id is alive; entries for departed ids
 *   are pruned per snapshot and the cache is hard-capped (eviction only
 *   costs a re-resolve, never correctness);
 * - zoom-tier mapping and per-tier cell sizing for canvas drawing.
 *
 * Presentation only: positions, hit testing, lenses (except normal), minimap,
 * selection, and all simulation behavior are untouched. Non-normal lenses
 * keep the legacy voxel rendering path exactly, so analytical meaning always
 * outranks decorative morphology.
 */
import type { RenderOrganism, RenderSnapshot } from "@digital-evolution/contracts";
import {
  drawGridToCanvas,
  lodTierForZoom,
  renderPhenotypeGrid,
  resolvePhenotype,
  type LodTier,
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

export class PhenotypeCache {
  private byId = new Map<number, CacheEntry>();

  /** Number of cached organisms (for tests and diagnostics). */
  get size(): number {
    return this.byId.size;
  }

  /**
   * Resolve every organism in the snapshot with descendant chaining:
   * generation order guarantees a parent's visual family is known before its
   * children resolve. Missing parents (dead, culled, or restored without
   * ancestry) fall back to founder resolution — deterministic, never a crash.
   */
  resolveSnapshot(snapshot: RenderSnapshot): Map<number, ResolvedPhenotype> {
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

/** Minimal Canvas2D surface; the caller owns fillStyle and alpha. */
export interface PhenotypeSurface {
  fillRect(x: number, y: number, w: number, h: number): void;
}

/**
 * Draw one organism's phenotype grid centered on (px, py). `unit` is the
 * legacy voxel unit for the current zoom; per-tier fractions keep footprints
 * comparable. Color and dormancy dimming stay caller-owned (lens behavior).
 */
export function drawPhenotypeOrganism(
  ctx: PhenotypeSurface,
  o: RenderOrganism,
  res: ResolvedPhenotype,
  cache: PhenotypeCache,
  tier: LodTier,
  px: number,
  py: number,
  unit: number,
): void {
  const grid = cache.grid(o, res, tier);
  const cu = unit * PHENOTYPE_CELL_FRACTION[tier];
  drawGridToCanvas(ctx, grid, px - (grid.size * cu) / 2, py - (grid.size * cu) / 2, cu);
}
