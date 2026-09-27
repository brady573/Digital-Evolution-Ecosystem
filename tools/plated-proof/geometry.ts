/**
 * Plated geometry round (review §15): imbricated shell-cluster construction.
 *
 * The failure is plate grammar, not material: stacked bands instead of
 * individually oriented overlapping shells. This module builds plates as
 * spine-driven teardrop/leaf primitives:
 *
 * - root point + axis angle + length + width profile (broad proximal root,
 *   tapered distal tip) + camber (perpendicular bow) + asymmetric shoulders;
 * - overlap strictly back-to-front (strong occlusion by paint order);
 * - dark interstitial channels where no plate covers (gap topology);
 * - controlled asymmetry via per-plate angle/size/exposure differences.
 *
 * No texture, no specular, no metabolism, no glow, no pearls: flat neutral
 * fill (two values by depth order) plus derived silhouette-mask and
 * plate-boundary-overlay evidence. Deterministic integer hashing only.
 */
import { hash01 } from "./render.ts";

export interface ShellDef {
  /** Root point, normalized coords. */
  rx: number;
  ry: number;
  /** Axis angle root->tip, radians. */
  theta: number;
  /** Spine length, normalized units. */
  len: number;
  /** Max half-width at root, normalized units. */
  wid: number;
  /** Shoulder asymmetry in [-1, 1]. */
  asym: number;
}

export interface ShellPlate extends ShellDef {
  index: number;
}

/** Sampled spine points for raster tests. */
export function spineSamples(pl: ShellDef, n = 28): Array<{ x: number; y: number; t: number }> {
  const dx = Math.cos(pl.theta);
  const dy = Math.sin(pl.theta);
  const px = -dy;
  const py = dx;
  const tx = pl.rx + dx * pl.len;
  const ty = pl.ry + dy * pl.len;
  const cx = (pl.rx + tx) / 2 + px * 0.08 * pl.len;
  const cy = (pl.ry + ty) / 2 + py * 0.08 * pl.len;
  const pts: Array<{ x: number; y: number; t: number }> = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const u = 1 - t;
    pts.push({
      x: u * u * pl.rx + 2 * u * t * cx + t * t * tx,
      y: u * u * pl.ry + 2 * u * t * cy + t * t * ty,
      t,
    });
  }
  return pts;
}

/** Half-width at spine parameter t (broad root, tapered tip). */
export function halfWidth(pl: ShellDef, t: number): number {
  return pl.wid * Math.pow(Math.max(0, 1 - t), 0.72) + pl.wid * 0.06;
}

/**
 * Test a point against one plate. Returns inside flag, spine t of the
 * nearest sample, and signed side (for asymmetric shoulders).
 */
export function plateHit(
  nx: number, ny: number, pl: ShellDef, samples: Array<{ x: number; y: number; t: number }>,
): { inside: boolean; t: number; side: number } {
  let best = Infinity;
  let bt = 0;
  let bx = 0;
  let by = 0;
  for (const s of samples) {
    const dx = nx - s.x;
    const dy = ny - s.y;
    const dd = dx * dx + dy * dy;
    if (dd < best) {
      best = dd;
      bt = s.t;
      bx = dx;
      by = dy;
    }
  }
  const w = halfWidth(pl, bt);
  // Asymmetric shoulders: one side slightly fuller.
  const dirx = Math.cos(pl.theta);
  const diry = Math.sin(pl.theta);
  const side = bx * -diry + by * dirx >= 0 ? 1 : -1;
  const wEff = w * (1 + pl.asym * 0.22 * side * Math.min(1, bt * 2));
  return { inside: best <= wEff * wEff, t: bt, side };
}

export interface GeometryRender {
  size: number;
  /** plate index per pixel, -1 = gap/background. */
  plateId: Int16Array;
  /** tip pixel per plate (farthest inside pixel along axis), -1 if none. */
  tips: Array<{ x: number; y: number } | null>;
}

/** Rasterize a plate set back-to-front. Later plates occlude earlier ones. */
export function rasterizeGeometry(plates: ShellPlate[], size: number): GeometryRender {
  const plateId = new Int16Array(size * size).fill(-1);
  const samples = plates.map((pl) => spineSamples(pl));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;
      for (let pi = 0; pi < plates.length; pi++) {
        const hit = plateHit(nx, ny, plates[pi]!, samples[pi]!);
        if (hit.inside) plateId[y * size + x] = pi;
      }
    }
  }
  // Tips: farthest inside pixel from each root along the plate axis.
  const tips: Array<{ x: number; y: number } | null> = plates.map((pl) => {
    const dx = Math.cos(pl.theta);
    const dy = Math.sin(pl.theta);
    let best: { x: number; y: number } | null = null;
    let bestProj = -Infinity;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (plateId[y * size + x] !== pl.index) continue;
        const proj = ((x + 0.5) / size - pl.rx) * dx + ((y + 0.5) / size - pl.ry) * dy;
        if (proj > bestProj) {
          bestProj = proj;
          best = { x, y };
        }
      }
    }
    return best;
  });
  return { size, plateId, tips };
}

/** Silhouette mask: any plate pixel. */
export function geometrySilhouette(g: GeometryRender): Uint8Array {
  const out = new Uint8Array(g.size * g.size);
  for (let i = 0; i < out.length; i++) out[i] = g.plateId[i] === -1 ? 0 : 1;
  return out;
}

/** Boundary overlay: pixels whose 4-neighborhood spans two plate ids. */
export function geometryBoundaries(g: GeometryRender): Uint8Array {
  const out = new Uint8Array(g.size * g.size);
  const n = g.size;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const id = g.plateId[y * n + x]!;
      if (id === -1) continue;
      if (
        (x + 1 < n && g.plateId[y * n + x + 1] !== id) ||
        (y + 1 < n && g.plateId[(y + 1) * n + x] !== id)
      ) {
        out[y * n + x] = 1;
      }
    }
  }
  return out;
}

/**
 * Deterministic plate-set generator: fixed layout slots, per-candidate angle
 * tables. Same phenotype inputs for every candidate; only the arrangement
 * parameters differ (seeded micro-jitter on angles keeps candidates distinct
 * while the phenotype stays fixed).
 */
export function layoutPlates(candidate: number, seed: number): ShellPlate[] {
  // Base arrangement: diagonal dominant, canted sides, pointed bottom row.
  // Angles in radians, root->tip. Candidate varies spread + lean + count.
  const tables: Array<Array<[number, number, number, number, number]>> = [
    // A: diagonal cross — strong -35° dominant, steep sides, 3-point bottom.
    [
      [0.5, 0.62, -0.6, 0.52, 0.16],
      [0.34, 0.55, -1.25, 0.34, 0.11],
      [0.66, 0.55, 0.15, 0.36, 0.11],
      [0.5, 0.42, -0.5, 0.4, 0.13],
      [0.38, 0.3, -1.05, 0.3, 0.09],
      [0.62, 0.3, 0.05, 0.3, 0.09],
      [0.3, 0.72, 2.5, 0.24, 0.08],
      [0.52, 0.78, 1.75, 0.24, 0.08],
      [0.72, 0.7, 0.9, 0.24, 0.08],
    ],
    // B: fan imbricate — plates radiate from a lower-center core.
    [
      [0.5, 0.66, -1.35, 0.5, 0.15],
      [0.42, 0.6, -0.75, 0.42, 0.12],
      [0.58, 0.6, -0.15, 0.42, 0.12],
      [0.3, 0.55, -1.7, 0.32, 0.1],
      [0.7, 0.55, 0.5, 0.32, 0.1],
      [0.5, 0.44, -1.1, 0.36, 0.12],
      [0.4, 0.32, -1.45, 0.28, 0.09],
      [0.6, 0.32, -0.35, 0.28, 0.09],
      [0.36, 0.78, 2.2, 0.22, 0.08],
      [0.64, 0.78, 1.1, 0.22, 0.08],
    ],
    // C: asymmetric cluster — one huge diagonal, small satellites, max lean.
    [
      [0.46, 0.6, -0.55, 0.58, 0.17],
      [0.3, 0.5, -1.5, 0.3, 0.1],
      [0.68, 0.48, 0.35, 0.3, 0.1],
      [0.56, 0.36, -0.9, 0.34, 0.11],
      [0.36, 0.28, -1.2, 0.26, 0.09],
      [0.66, 0.3, -0.1, 0.26, 0.09],
      [0.28, 0.7, 2.7, 0.24, 0.08],
      [0.5, 0.8, 1.5, 0.22, 0.08],
      [0.74, 0.68, 0.7, 0.22, 0.08],
    ],
  ];
  const table = tables[candidate]!;
  return table.map(([rx, ry, theta, len, wid], i) => {
    const j = (hash01(seed, candidate, i, 1) - 0.5) * 0.1;
    // Compact imbrication: shorter spines and fuller widths keep tips from
    // reading as detached spikes; overlap comes from angles, not reach.
    return {
      rx, ry, theta: theta + j, len: len * 0.72, wid: wid * 1.12,
      asym: hash01(seed, candidate, i, 2) * 1.6 - 0.8,
      depth: i, index: i,
    };
  });
}
