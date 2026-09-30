/**
 * P0 — local read-only adapter from current presentation data to P0 texture
 * requests (no new contracts types; issue #54 may replace this boundary).
 *
 * Consumes what the Canvas2D World already resolves: a RenderSnapshot plus the
 * phenotype resolutions memoized per organism (see
 * apps/explorer/src/phenotype.ts PhenotypeCache.resolveSnapshot). It never
 * reimplements family selection, normalization, or hysteresis, and it never
 * mutates simulation, analysis, checkpoint, or command state.
 */

import type { RenderSnapshot } from "@digital-evolution/contracts";
import type { LodTier, ResolvedPhenotype } from "@digital-evolution/phenotype";
import { describeTexture, type ActivityState } from "./phenotypeTextures";

export interface OrganismTextureRequest {
  readonly organismId: number;
  readonly x: number;
  readonly y: number;
  readonly key: string;
  readonly tier: LodTier;
  readonly activity: ActivityState;
  readonly size: number;
}

/**
 * Map one snapshot to texture requests. `resolved` is the live resolution
 * pass output (organism id -> ResolvedPhenotype); organisms without a
 * resolution are skipped (caller decides the fallback — P0 never guesses).
 */
export function toTextureRequests(
  snapshot: RenderSnapshot,
  resolved: ReadonlyMap<number, ResolvedPhenotype>,
  tier: LodTier,
): OrganismTextureRequest[] {
  const out: OrganismTextureRequest[] = [];
  for (const o of snapshot.organisms) {
    const res = resolved.get(o.id);
    if (!res) continue;
    const activity: ActivityState = o.activity === "dormant" ? "dormant" : "active";
    const desc = describeTexture(res, tier, activity);
    out.push({ organismId: o.id, x: o.x, y: o.y, key: desc.key, tier, activity, size: desc.size });
  }
  return out;
}
