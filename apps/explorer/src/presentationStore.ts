import type {
  OrganismId,
  PresentationFrame,
  RenderOrganism,
  WorldEntityCatalog,
  WorldEnvironmentFrame,
  WorldId,
  WorldInterpretationState,
  WorldLiveFrame,
  WorldPresentationIdentity,
} from "@digital-evolution/contracts";
import { READ_MODEL_VERSION } from "@digital-evolution/contracts";

/**
 * Lane 3 F2b: Explorer presentation store — the consumer cutover.
 *
 * The runtime publishes bounded read-model classes with different lifetimes
 * and cadences (identity, catalog, live, environment, interpretation); this
 * store is Explorer's presentation-side composition of them. Maintained
 * React/Canvas consumers read the coherent `PresentationView` from
 * `getView()` rather than reconstructing runtime authority, and renderers
 * never gain simulation authority.
 *
 * Pure TS, zero React imports: this module is Node-importable (the
 * runtime-boundary validation suite drives it directly, the same way
 * browser-smoke imports landscape.ts).
 *
 * Slot semantics: one slot per channel, and a frame updates its channel
 * only — frames are discriminated by their distinctive payload key
 * (contracts §F2a: `config` / `entries` / `organisms` / `resources` /
 * `metrics`). Unknown shapes are ignored, never crash the subscriber.
 *
 * INTERIM coherence (stated, not hidden): slots are last-write-wins per
 * channel. A transient view may therefore mix channels at different
 * effective ticks, so every view carries each channel's effective tick
 * (`channelTicks`) and consumers must never imply slower state is newer
 * than its tick. Full supersede-rejection — refusing to compose state from
 * a superseded world — lands in Task 5; this store documents the interim
 * rather than silently assuming it.
 *
 * Join semantics: `organisms` pairs each live entry with its catalog entry
 * in live-frame order, producing RenderOrganism-shaped records (the exact
 * field union of the two classes, so deep-equal to the snapshot rows they
 * were derived from). A live id with no catalog entry is skipped, never
 * invented: that is exactly what a removal reads as, so selection lookup
 * of a departed id returns null through `organismById`.
 *
 * NO cadence-splitting here by ruling: the store consumes whatever arrives,
 * whenever it arrives, and exposes per-channel effective ticks on the view.
 */
export interface PresentationChannelTicks {
  readonly identity: number | null;
  readonly catalog: number | null;
  readonly live: number | null;
  readonly environment: number | null;
  readonly interpretation: number | null;
}

export interface PresentationView {
  /** Newest world seen on any channel; null until the first frame arrives. */
  readonly worldId: WorldId | null;
  readonly readModelVersion: typeof READ_MODEL_VERSION;
  /** Effective tick of the live channel; null until the first live frame. */
  readonly tick: number | null;
  /** Per-channel effective ticks: slower state is never presented as newer. */
  readonly channelTicks: PresentationChannelTicks;
  readonly identity: WorldPresentationIdentity | null;
  readonly catalog: WorldEntityCatalog | null;
  readonly live: WorldLiveFrame | null;
  readonly environment: WorldEnvironmentFrame | null;
  readonly interpretation: WorldInterpretationState | null;
  /**
   * Joined catalog + live entries, RenderOrganism-shaped, in live-frame
   * order — the same rows selection, inspection, Tree membership, and Pixel
   * Phenotype resolution read, without refetching static traits per frame.
   */
  readonly organisms: readonly RenderOrganism[];
  /**
   * Resolve one joined organism by id. Returns null when the id is absent —
   * which is exactly what a removal reads as (Task 2 representation, end to
   * end through the store).
   */
  organismById(id: OrganismId): RenderOrganism | null;
}

export interface PresentationStore {
  /** Apply one frame to its channel slot; other channels are untouched. */
  apply(frame: PresentationFrame): void;
  /** A fresh coherent view over the current slots (safe to mirror into state). */
  getView(): PresentationView;
}

export function createPresentationStore(): PresentationStore {
  let identity: WorldPresentationIdentity | null = null;
  let catalog: WorldEntityCatalog | null = null;
  let live: WorldLiveFrame | null = null;
  let environment: WorldEnvironmentFrame | null = null;
  let interpretation: WorldInterpretationState | null = null;

  return {
    apply(frame: PresentationFrame): void {
      if ("config" in frame) identity = frame;
      else if ("entries" in frame) catalog = frame;
      else if ("organisms" in frame) live = frame;
      else if ("resources" in frame) environment = frame;
      else if ("metrics" in frame) interpretation = frame;
      // Unknown shapes are ignored: a future class must not crash a subscriber.
    },
    getView(): PresentationView {
      const statics = new Map<OrganismId, WorldEntityCatalog["entries"][number]>();
      if (catalog) for (const entry of catalog.entries) statics.set(entry.id, entry);
      const organisms: RenderOrganism[] = [];
      if (live) {
        for (const o of live.organisms) {
          const entry = statics.get(o.id);
          if (!entry) continue;
          organisms.push({
            id: o.id,
            parent: entry.parent,
            generation: entry.generation,
            lineageId: entry.lineageId,
            cladeId: entry.cladeId,
            x: o.x,
            y: o.y,
            energy: o.energy,
            activity: o.activity,
            speed: entry.speed,
            sensing: entry.sensing,
            metabolism: entry.metabolism,
            reproduction: entry.reproduction,
            diet: entry.diet,
            habitat: entry.habitat,
            byproductUse: entry.byproductUse,
            dormancyResponse: entry.dormancyResponse,
            tolerance: entry.tolerance,
            cleanup: entry.cleanup,
          });
        }
      }
      return {
        worldId: identity?.worldId ?? live?.worldId ?? catalog?.worldId ?? environment?.worldId ?? interpretation?.worldId ?? null,
        readModelVersion: READ_MODEL_VERSION,
        tick: live?.tick ?? null,
        channelTicks: {
          identity: identity?.tick ?? null,
          catalog: catalog?.tick ?? null,
          live: live?.tick ?? null,
          environment: environment?.tick ?? null,
          interpretation: interpretation?.tick ?? null,
        },
        identity,
        catalog,
        live,
        environment,
        interpretation,
        organisms,
        organismById: (id: OrganismId): RenderOrganism | null =>
          organisms.find((o) => o.id === id) ?? null,
      };
    },
  };
}
