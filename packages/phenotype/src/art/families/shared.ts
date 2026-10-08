/**
 * Shared per-family presentation helpers.
 *
 * These exist only because the four remaining grammars all need the same three
 * things: a seeded deterministic jitter that never touches the simulation RNG,
 * a normalized clamp, and a small ellipse/teardrop region factory. Adding more
 * speculative primitives is explicitly out of scope; these three are the ones
 * two or more grammars demonstrably use.
 *
 * Nothing here reads wall-clock time, `Math.random()`, or any simulation state.
 * Variation is derived only from the resolved cosmetic seed and quantized
 * phenotype values, so identical inputs always produce identical geometry.
 */

export function hash01(seed: number, slot: number, channel: number): number {
  let value = (seed ^ Math.imul(slot + 1, 0x9e3779b1) ^ Math.imul(channel + 1, 0x85ebca6b)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

export function seededJitter(seed: number, slot: number, channel: number, amplitude: number): number {
  return (hash01(seed, slot, channel) * 2 - 1) * amplitude;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export type StemActivity = "active" | "dormant";

/** Every family grammar is activity-aware; dormancy is geometry, not just alpha. */
export function assertFamily(family: string, resolvedFamily: string): void {
  if (resolvedFamily !== family) {
    throw new Error(`${family} grammar only supports ${family} phenotypes (got ${resolvedFamily})`);
  }
}

export function teardropRegion(options: {
  readonly id: string;
  readonly centerX: number;
  readonly centerY: number;
  readonly axisRadians: number;
  readonly length: number;
  readonly width: number;
  readonly taper: number;
  readonly depth: number;
  readonly paintOrder: number;
  readonly detail: "structure" | "secondary";
  readonly materialRole: "deep-tissue" | "shadow" | "body" | "light" | "rim" | "interstitial" | "core" | "accent";
}) {
  return {
    id: options.id,
    geometry: {
      kind: "teardrop" as const,
      center: { x: options.centerX, y: options.centerY },
      axisRadians: options.axisRadians,
      length: options.length,
      width: options.width,
      taper: options.taper,
    },
    depth: options.depth,
    paintOrder: options.paintOrder,
    detail: options.detail,
    materialRole: options.materialRole,
  };
}

export function ellipseRegion(options: {
  readonly id: string;
  readonly centerX: number;
  readonly centerY: number;
  readonly axisRadians: number;
  readonly length: number;
  readonly width: number;
  readonly depth: number;
  readonly paintOrder: number;
  readonly detail: "structure" | "secondary";
  readonly materialRole: "deep-tissue" | "shadow" | "body" | "light" | "rim" | "interstitial" | "core" | "accent";
}) {
  return {
    id: options.id,
    geometry: {
      kind: "ellipse" as const,
      center: { x: options.centerX, y: options.centerY },
      axisRadians: options.axisRadians,
      length: options.length,
      width: options.width,
      taper: 0,
    },
    depth: options.depth,
    paintOrder: options.paintOrder,
    detail: options.detail,
    materialRole: options.materialRole,
  };
}