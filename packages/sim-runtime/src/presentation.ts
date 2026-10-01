import type {
  OrganismId,
  PresentationFrames,
  RenderSnapshot,
  WorldCatalogEntry,
  WorldEntityCatalog,
  WorldEnvironmentFrame,
  WorldInterpretationState,
  WorldLiveFrame,
  WorldPresentationIdentity,
} from "@digital-evolution/contracts";
import {
  INTERPRETATION_EVENT_LIMIT,
  INTERPRETATION_RESOLUTION_LIMIT,
  READ_MODEL_VERSION,
} from "@digital-evolution/contracts";
import { RUNTIME_IDENTITY } from "./provenance";

/**
 * Lane 3 F2a: pure read-model derivation builders.
 *
 * Each builder is a PURE function over an existing RenderSnapshot: no
 * session/engine access, no worker/client/transport access, no mutation of
 * the input, and no new authority. Outputs are fresh objects — nested grids
 * and retained payloads are copied, never aliased — so a consumer that
 * mutates a frame cannot corrupt the snapshot it was derived from, and the
 * runtime's retained state cannot leak out through a shared reference.
 *
 * Catalog shape (§13 freedom): every build returns the FULL living catalog
 * (see WorldEntityCatalog). A delta is uncomputable in a stateless pure
 * function; the "no per-frame retransmission of static traits" intent is met
 * at transport cadence (catalog on change, live frame per tick), which is
 * Tasks 3–4, not this module.
 */

/** Identity: stable across ticks within one world (create/restore mints a new worldId). */
export function buildIdentity(snapshot: RenderSnapshot): WorldPresentationIdentity {
  return {
    readModelVersion: READ_MODEL_VERSION,
    worldId: snapshot.worldId,
    tick: snapshot.tick,
    seed: snapshot.seed,
    // EngineConfig is cloned, not shared: a dozen scalars, so the copy is
    // negligible, and sharing would let a downstream frame mutation corrupt
    // the live session's resolved config across the authority boundary. This
    // also matches the worker-boundary crossing, where postMessage would clone
    // it anyway.
    config: structuredClone(snapshot.config),
    engineVersion: RUNTIME_IDENTITY.engineVersion,
    appVersion: RUNTIME_IDENTITY.appVersion,
  };
}

/** Full living catalog for one snapshot. Order follows snapshot order (deterministic). */
export function buildCatalog(snapshot: RenderSnapshot): WorldEntityCatalog {
  const entries: WorldCatalogEntry[] = snapshot.organisms.map((o) => ({
    id: o.id,
    parent: o.parent,
    generation: o.generation,
    lineageId: o.lineageId,
    cladeId: o.cladeId,
    speed: o.speed,
    sensing: o.sensing,
    metabolism: o.metabolism,
    reproduction: o.reproduction,
    diet: o.diet,
    habitat: o.habitat,
    byproductUse: o.byproductUse,
    dormancyResponse: o.dormancyResponse,
    tolerance: o.tolerance,
    cleanup: o.cleanup,
  }));
  return {
    readModelVersion: READ_MODEL_VERSION,
    worldId: snapshot.worldId,
    tick: snapshot.tick,
    entries,
    count: entries.length,
  };
}

/**
 * Resolve one catalog entry by organism id. Returns null when the id is not
 * in this catalog — which is exactly what a removal reads as: an organism
 * absent from a newer catalog resolves to nothing, without refetching.
 */
export function resolveCatalogEntry(
  catalog: WorldEntityCatalog,
  id: OrganismId,
): WorldCatalogEntry | null {
  for (const entry of catalog.entries) {
    if (entry.id === id) return entry;
  }
  return null;
}

/** Live frame: totals plus per-organism live values only. */
export function buildLive(snapshot: RenderSnapshot): WorldLiveFrame {
  return {
    readModelVersion: READ_MODEL_VERSION,
    worldId: snapshot.worldId,
    tick: snapshot.tick,
    population: snapshot.population,
    activePopulation: snapshot.activePopulation,
    dormantPopulation: snapshot.dormantPopulation,
    organisms: snapshot.organisms.map((o) => ({
      id: o.id,
      x: o.x,
      y: o.y,
      energy: o.energy,
      activity: o.activity,
    })),
  };
}

/** Environment frame: resource/waste presentation fields, deep-copied. */
export function buildEnvironment(snapshot: RenderSnapshot): WorldEnvironmentFrame {
  return {
    readModelVersion: READ_MODEL_VERSION,
    worldId: snapshot.worldId,
    tick: snapshot.tick,
    resources: {
      gridSize: snapshot.resources.gridSize,
      stock: snapshot.resources.stock.map((row) => [...row]),
      capacity: snapshot.resources.capacity.map((row) => [...row]),
    },
    waste: {
      gridSize: snapshot.waste.gridSize,
      stock: [...snapshot.waste.stock],
      capacity: [...snapshot.waste.capacity],
    },
  };
}

/**
 * Interpretation state: bounded metrics summaries, the pending gate, current
 * aftermath, bounded event refs, and the control summary. `structuredClone`
 * keeps retained runtime payloads (metrics, decision, aftermath) from
 * aliasing live session state; the events window is rebuilt as fresh refs.
 */
export function buildInterpretation(snapshot: RenderSnapshot): WorldInterpretationState {
  const events = snapshot.events.slice(-INTERPRETATION_EVENT_LIMIT).map((e) => ({
    tick: e.tick,
    label: e.label,
  }));
  const resolvedDecisions = snapshot.resolvedDecisions.slice(-INTERPRETATION_RESOLUTION_LIMIT);
  return {
    readModelVersion: READ_MODEL_VERSION,
    worldId: snapshot.worldId,
    tick: snapshot.tick,
    metrics: structuredClone(snapshot.metrics),
    events,
    pendingDecision: snapshot.pendingDecision === null ? null : structuredClone(snapshot.pendingDecision),
    resolvedDecisions: structuredClone(resolvedDecisions),
    resolvedDecisionCount: snapshot.resolvedDecisions.length,
    aftermath: snapshot.aftermath === null ? null : structuredClone(snapshot.aftermath),
    control:
      snapshot.control === null
        ? null
        : {
            tick: snapshot.control.tick,
            population: snapshot.control.population,
            metrics: structuredClone(snapshot.control.metrics),
          },
  };
}

/** All five read-model classes derived from one snapshot, in one pass. */
export function buildPresentation(snapshot: RenderSnapshot): PresentationFrames {
  return {
    identity: buildIdentity(snapshot),
    catalog: buildCatalog(snapshot),
    live: buildLive(snapshot),
    environment: buildEnvironment(snapshot),
    interpretation: buildInterpretation(snapshot),
  };
}
