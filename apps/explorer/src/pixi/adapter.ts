/**
 * P0 — local read-only adapter from current presentation data to P0 texture
 * requests (no new contracts types; issue #54 may replace this boundary).
 *
 * Consumes what the Explorer presentation store already resolves: joined
 * organism rows plus phenotype resolutions memoized per organism (see
 * apps/explorer/src/phenotype.ts PhenotypeCache.resolveSnapshot). It never
 * reimplements family selection, normalization, or hysteresis, and it never
 * mutates simulation, analysis, checkpoint, or command state.
 */

import type { RenderOrganism } from "@digital-evolution/contracts";
import type { LodTier, ResolvedPhenotype } from "@digital-evolution/phenotype";
import { describeRenderableTexture, type ActivityState } from "./phenotypeTextures";

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
 * Map joined read-model rows to texture requests. `resolved` is the live resolution
 * pass output (organism id -> ResolvedPhenotype); organisms without a
 * resolution are skipped (caller decides the fallback — P0 never guesses).
 */
export function toTextureRequests(
  organisms: readonly RenderOrganism[],
  resolved: ReadonlyMap<number, ResolvedPhenotype>,
  tier: LodTier,
): OrganismTextureRequest[] {
  const out: OrganismTextureRequest[] = [];
  for (const o of organisms) {
    const res = resolved.get(o.id);
    if (!res) continue;
    const activity: ActivityState = o.activity === "dormant" ? "dormant" : "active";
    const desc = describeRenderableTexture(res, tier, activity);
    out.push({ organismId: o.id, x: o.x, y: o.y, key: desc.key, tier, activity, size: desc.size });
  }
  return out;
}
