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
 * Coherence gates (handoff §7, AC9/AC10): every frame carries its world's
 * identity, an effective tick, and the read-model version, and `apply`
 * enforces all three before a frame may compose into the view —
 * - a frame whose read-model version differs is dropped and counted;
 * - a frame from a superseded (numerically older) world is dropped and
 *   counted, so cross-world state can never compose;
 * - a frame from a newer world (create/restore mints a larger
 *   process-unique id) resets coherence via `reset()` — the same reset an
 *   arriving identity frame triggers explicitly;
 * - a same-channel frame at an older tick than the slot holds is dropped
 *   and counted; an equal tick re-applies idempotently (a refused command
 *   re-emits the unchanged world, and that must still release backpressure).
 * A transient view may still mix channels at different effective ticks, so
 * every view carries each channel's effective tick (`channelTicks`) and
 * consumers must never imply slower state is newer than its tick.
 *
 * Join semantics: `organisms` pairs each live entry with its catalog entry
 * in live-frame order, producing RenderOrganism-shaped records (the exact
 * field union of the two classes, so deep-equal to the snapshot rows they
 * were derived from). A live id with no catalog entry is skipped, never
 * invented: that is exactly what a removal reads as, so selection lookup
 * of a departed id returns null through `organismById`.
 *
 * Staggered cadence (fix-wave; the earlier "no cadence-splitting" ruling is
 * rescinded per Owner handoff): the runtime now emits identity on world-change
 * paths plus the first advance after each, catalog only on membership change,
 * environment on a bounded period, interpretation only on payload change, and
 * live every advance. The store consumes whatever arrives, whenever it
 * arrives, exposes per-channel effective ticks on the view, and needs no
 * change for the cadence: slots compose independently, the tick gates already
 * tolerate absent channels, and the first-paint gate (all five slots filled)
 * converges on the create/restore + first-advance full sets.
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
  /**
   * Reset coherence to a new world, clearing every channel slot. A no-op for
   * the current world, and never moves coherence backwards: an explicit reset
   * to a superseded world is ignored, so a stale identity frame cannot wipe a
   * newer view. Wired to identity-frame arrival inside `apply`.
   */
  reset(worldId: WorldId): void;
  /** Frames dropped by the coherence gates since creation. Tests-only. */
  readonly dropped: number;
  /** A fresh coherent view over the current slots (safe to mirror into state). */
  getView(): PresentationView;
}

export function createPresentationStore(): PresentationStore {
  let identity: WorldPresentationIdentity | null = null;
  let catalog: WorldEntityCatalog | null = null;
  let live: WorldLiveFrame | null = null;
  let environment: WorldEnvironmentFrame | null = null;
  let interpretation: WorldInterpretationState | null = null;
  /** First-seen world wins until an explicit newer-world reset. */
  let currentWorld: WorldId | null = null;
  let droppedCount = 0;

  function reset(worldId: WorldId): void {
    if (currentWorld !== null && worldId <= currentWorld) return;
    currentWorld = worldId;
    identity = catalog = live = environment = interpretation = null;
  }

  return {
    apply(frame: PresentationFrame): void {
      // Version gate first: a frame from an incompatible read model can never
      // compose, regardless of which world or tick it names.
      if (frame.readModelVersion !== READ_MODEL_VERSION) {
        droppedCount++;
        return;
      }
      // Identity frames announce create/restore: an explicit coherence reset.
      // Same-world is a no-op and a superseded world never moves coherence
      // backwards, both by reset's own guard.
      if ("config" in frame) reset(frame.worldId);
      if (currentWorld === null) {
        currentWorld = frame.worldId;
      } else if (frame.worldId !== currentWorld) {
        if (frame.worldId > currentWorld) {
          // A newer world whose identity has not applied yet (defense in
          // depth; the ordered transport always delivers identity first).
          reset(frame.worldId);
        } else {
          droppedCount++;
          return;
        }
      }
      // Same-world, same-channel older ticks are stale retransmissions.
      // Unknown shapes are ignored: a future class must not crash a subscriber.
      if ("config" in frame) {
        if (frame.tick < (identity?.tick ?? Number.NEGATIVE_INFINITY)) { droppedCount++; return; }
        identity = frame;
      } else if ("entries" in frame) {
        if (frame.tick < (catalog?.tick ?? Number.NEGATIVE_INFINITY)) { droppedCount++; return; }
        catalog = frame;
      } else if ("organisms" in frame) {
        if (frame.tick < (live?.tick ?? Number.NEGATIVE_INFINITY)) { droppedCount++; return; }
        live = frame;
      } else if ("resources" in frame) {
        if (frame.tick < (environment?.tick ?? Number.NEGATIVE_INFINITY)) { droppedCount++; return; }
        environment = frame;
      } else if ("metrics" in frame) {
        if (frame.tick < (interpretation?.tick ?? Number.NEGATIVE_INFINITY)) { droppedCount++; return; }
        interpretation = frame;
      }
    },
    reset,
    get dropped(): number {
      return droppedCount;
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
