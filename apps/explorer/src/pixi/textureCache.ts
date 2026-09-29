/**
 * P0 — production-shaped texture-cache mirror (CPU side, ref-counted).
 *
 * Extracted from tools/pixi-spike/cache.ts without duplicating phenotype
 * semantics: one entry per exact texture key, acquire on first use /
 * phenotype change, release when a sprite stops using a key, prune drops
 * zero-user entries (the P1 view destroys the GPU texture there).
 *
 * No Pixi, DOM, sim-core, or sim-runtime imports. Movement never touches the
 * cache (positions are not key inputs).
 */

import type { LodTier, ResolvedPhenotype } from "@digital-evolution/phenotype";
import { describeTexture, type ActivityState } from "./phenotypeTextures";

export interface TextureCacheEntry {
  readonly key: string;
  readonly tier: LodTier;
  readonly activity: ActivityState;
  readonly size: number;
  readonly bits: string;
  users: number;
  /** Ever-created serial number (proves identity stability across steps). */
  readonly serial: number;
}

export class PhenotypeTextureCache {
  private entries = new Map<string, TextureCacheEntry>();
  private nextSerial = 0;
  creations = 0;
  cumulative = 0;
  lookups = 0;
  hits = 0;
  pruned = 0;

  acquire(res: ResolvedPhenotype, tier: LodTier, activity: ActivityState): TextureCacheEntry {
    this.lookups++;
    const desc = describeTexture(res, tier, activity);
    const hit = this.entries.get(desc.key);
    if (hit) {
      // Collision guard: a hash hit must carry the identical bitmap, or two
      // phenotypes would share one texture. Fail loudly, never swap silently.
      if (hit.bits !== desc.bits || hit.size !== desc.size) {
        throw new Error(`render-key collision for ${desc.key}: same hash, different bitmaps`);
      }
      this.hits++;
      hit.users++;
      return hit;
    }
    const entry: TextureCacheEntry = {
      key: desc.key,
      tier: desc.tier,
      activity: desc.activity,
      size: desc.size,
      bits: desc.bits,
      users: 1,
      serial: this.nextSerial++,
    };
    this.entries.set(desc.key, entry);
    this.creations++;
    this.cumulative++;
    return entry;
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

  entriesList(): TextureCacheEntry[] {
    return [...this.entries.values()];
  }
}
