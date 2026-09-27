/**
 * Plated geometry round (review §15): imbricated shell-cluster construction.
 *
 * Plates are spine-driven teardrops: root point + axis angle + length +
 * convex body profile (narrow rounded root cap, widest at t≈0.3, tapered
 * distal tip with a small cap) + asymmetric shoulders. Reference-calibrated
 * aspect: len/(2*wid) in 2.0–2.4, tips radiating outward in a fan.
 *
 * Paint order is strictly back-to-front by layer (0 back, 1 mid, 2 front).
 * A flat dark pearl-bed placeholder ellipse sits underneath and shows
 * through gaps (plateId -2) — topology only, no material.
 *
 * Geometry-only: flat neutral fill (two plate values by depth + dark bed
 * placeholder), silhouette masks, plate-boundary overlays. No texture, no
 * specular, no metabolism, no glow. Deterministic integer hashing only.
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
  /** Max half-width, normalized units (full width 2*wid near t≈0.3). */
  wid: number;
  /** Shoulder asymmetry in [-1, 1]. */
  asym: number;
  /** Depth layer: 0 back, 1 mid, 2 front. Paint order is layer, then index. */
  layer: number;
}

export interface ShellPlate extends ShellDef {
  index: number;
}

export interface BedDef {
  discs: Array<{ cx: number; cy: number; r: number }>;
}

/** Fallback bed (used only if gap-fitting finds no interior gaps). */
export const DEFAULT_BED: BedDef = { discs: [{ cx: 0.6, cy: 0.6, r: 0.1 }] };

/**
 * Per-candidate bed discs, hand-placed in the actual inter-plate bays
 * (verified adjacency: discs touch plates on most of their perimeter).
 * Part of the arrangement; deterministic literals, same M2 inputs.
 */
export const BEDS: BedDef[] = [
  { discs: [{ cx: 0.67, cy: 0.69, r: 0.08 }, { cx: 0.24, cy: 0.75, r: 0.07 }, { cx: 0.50, cy: 0.55, r: 0.04 }] },
  { discs: [{ cx: 0.70, cy: 0.56, r: 0.08 }, { cx: 0.48, cy: 0.71, r: 0.07 }, { cx: 0.46, cy: 0.56, r: 0.04 }] },
  { discs: [{ cx: 0.67, cy: 0.67, r: 0.08 }, { cx: 0.27, cy: 0.77, r: 0.07 }, { cx: 0.50, cy: 0.55, r: 0.04 }] },
];

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
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

/**
 * Half-width at spine parameter t: narrow rounded root cap, convex body
 * peaking near t≈0.3, tapering to a small (non-zero) tip cap. This is the
 * teardrop primitive — the old (1-t)^0.72 falloff peaked at the root and
 * produced blobs/disks.
 */
export function halfWidth(pl: ShellDef, t: number): number {
  const tc = Math.min(1, Math.max(0, t));
  const body = 0.45 + 0.65 * Math.sin(Math.PI * Math.pow(tc, 0.55));
  const tipTaper = 1 - 0.15 * smoothstep(0.55, 1, tc);
  const rootCap = 0.55 + 0.45 * smoothstep(0, 0.18, tc);
  return pl.wid * body * tipTaper * rootCap;
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

/** Disc-union test for the pearl-bed placeholder. */
export function bedHit(nx: number, ny: number, bed: BedDef): boolean {
  for (const d of bed.discs) {
    const dx = (nx - d.cx) / d.r;
    const dy = (ny - d.cy) / d.r;
    if (dx * dx + dy * dy <= 1) return true;
  }
  return false;
}

export interface GeometryRender {
  size: number;
  /** -1 background, -2 exposed bed placeholder, >=0 plate index. */
  plateId: Int16Array;
  /** 1 where the bed placeholder shows through gaps. */
  bed: Uint8Array;
  /** Tip pixel per plate (farthest inside pixel along axis), null if none. */
  tips: Array<{ x: number; y: number } | null>;
  /** Plates in paint order (layer, then index). */
  plates: ShellPlate[];
}

/** Rasterize a plate set over the bed, back-to-front. */
export function rasterizeGeometry(
  plates: ShellPlate[], size: number, bed: BedDef = DEFAULT_BED,
): GeometryRender {
  const ordered = [...plates].sort((a, b) => a.layer - b.layer || a.index - b.index);
  const plateId = new Int16Array(size * size).fill(-1);
  const bedPx = new Uint8Array(size * size);
  const samples = ordered.map((pl) => spineSamples(pl));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;
      const i = y * size + x;
      if (bedHit(nx, ny, bed)) {
        plateId[i] = -2;
        bedPx[i] = 1;
      }
      for (let pi = 0; pi < ordered.length; pi++) {
        const hit = plateHit(nx, ny, ordered[pi]!, samples[pi]!);
        if (hit.inside) {
          plateId[i] = ordered[pi]!.index;
          bedPx[i] = 0;
        }
      }
    }
  }
  // Tips: farthest inside pixel from each root along the plate axis.
  const byIndex = new Map(plates.map((p) => [p.index, p]));
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
  void byIndex;
  return { size, plateId, bed: bedPx, tips, plates: ordered };
}

/** Silhouette mask: any plate pixel or exposed bed. */
export function geometrySilhouette(g: GeometryRender): Uint8Array {
  const out = new Uint8Array(g.size * g.size);
  for (let i = 0; i < out.length; i++) out[i] = g.plateId[i] === -1 ? 0 : 1;
  return out;
}

/**
 * Interior background gaps: connected background regions inside the
 * silhouette bbox that are NOT connected to the frame edge (true
 * interstitial channels/recesses, not exterior bays). Returns components
 * sorted largest-first with pixel counts and centroids (normalized).
 */
export function interiorGaps(
  plateId: Int16Array, size: number,
): Array<{ area: number; cx: number; cy: number }> {
  const bg = new Uint8Array(size * size);
  for (let i = 0; i < bg.length; i++) bg[i] = plateId[i] === -1 ? 1 : 0;
  // Flood fill exterior from all frame edges.
  const ext = new Uint8Array(size * size);
  const stack: number[] = [];
  for (let x = 0; x < size; x++) {
    if (bg[x] === 1) stack.push(x);
    const b = (size - 1) * size + x;
    if (bg[b] === 1) stack.push(b);
  }
  for (let y = 0; y < size; y++) {
    if (bg[y * size] === 1) stack.push(y * size);
    if (bg[y * size + size - 1] === 1) stack.push(y * size + size - 1);
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    if (ext[i] === 1 || bg[i] !== 1) continue;
    ext[i] = 1;
    const x = i % size;
    const y = (i / size) | 0;
    if (x > 0) stack.push(i - 1);
    if (x + 1 < size) stack.push(i + 1);
    if (y > 0) stack.push(i - size);
    if (y + 1 < size) stack.push(i + size);
  }
  // Components over interior (non-exterior) background.
  const seen = new Uint8Array(size * size);
  const comps: Array<{ area: number; cx: number; cy: number }> = [];
  for (let i = 0; i < bg.length; i++) {
    if (bg[i] !== 1 || ext[i] === 1 || seen[i] === 1) continue;
    let area = 0;
    let sx = 0;
    let sy = 0;
    const st = [i];
    seen[i] = 1;
    while (st.length > 0) {
      const j = st.pop()!;
      area++;
      sx += j % size;
      sy += (j / size) | 0;
      const x = j % size;
      const y = (j / size) | 0;
      const nb = [x > 0 ? j - 1 : -1, x + 1 < size ? j + 1 : -1, y > 0 ? j - size : -1, y + 1 < size ? j + size : -1];
      for (const k of nb) {
        if (k >= 0 && bg[k] === 1 && ext[k] !== 1 && seen[k] !== 1) {
          seen[k] = 1;
          st.push(k);
        }
      }
    }
    comps.push({ area, cx: (sx / area + 0.5) / size, cy: (sy / area + 0.5) / size });
  }
  return comps.sort((a, b) => b.area - a.area);
}

/**
 * Fit the pearl-bed placeholder to a plate set: discs centered on the two
 * largest interior gaps (min 8px each), radius from gap area capped at
 * 0.085 normalized units. The bed follows actual interstitial topology —
 * it cannot float over plates or detach into a halo by construction.
 */
export function fitBed(plates: ShellPlate[], size: number): BedDef {
  const bare = rasterizeGeometry(plates, size, { discs: [] });
  const gaps = interiorGaps(bare.plateId, size).filter((g) => g.area >= 8).slice(0, 2);
  if (gaps.length === 0) return DEFAULT_BED;
  return {
    discs: gaps.map((g) => ({
      cx: g.cx,
      cy: g.cy,
      r: Math.min(0.085, (Math.sqrt(g.area / Math.PI) * 0.8 + 0.5) / size),
    })),
  };
}

/**
 * Boundary overlay: plate/bed pixels whose 4-neighborhood spans two ids.
 * Carries the overlap topology (front/back ordering, bed channels).
 */
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
 * Deterministic plate-set generator: hand-authored shingle compositions per
 * candidate, same M2 phenotype inputs; only arrangement differs. Plates are
 * packed side-by-side (roots spread across the body, 2–3 direction
 * families) rather than fanned from one point — a radial fan of 2:1 plates
 * cannot have interstitial gaps by pure geometry. Entries are
 * [rx, ry, theta, len, aspect]; wid derives as len/(2*aspect) so the
 * reference-calibrated 2.0–2.4 aspect is explicit. Layers derive from
 * thirds of the table (back third painted first); the hero diagonal is
 * table-last so it reads foreground. A small seeded angle jitter keeps the
 * tables honest (no hand-tuned pixel fitting) while inputs stay fixed.
 */
export function layoutPlates(candidate: number, seed: number): ShellPlate[] {
  // A: balanced rosette, 11 plates — closest to the reference.
  // B: left-lean, 11 plates — max controlled asymmetry, sparser east.
  // C: dense, 12 plates — smallest bays.
  const tables: Array<Array<[number, number, number, number, number]>> = [
    // A territorial rosette: pinwheel ring (shared +0.55 lean imbricates
    // every plate under its angular neighbor) + top satellites + hero.
    [
      [0.382, 0.494, -2.15, 0.28, 1.6],
      [0.452, 0.429, -1.40, 0.28, 1.6],
      [0.547, 0.429, -0.65, 0.28, 1.6],
      [0.617, 0.493, 0.10, 0.28, 1.6],
      [0.624, 0.588, 0.85, 0.28, 1.6],
      [0.565, 0.663, 1.60, 0.28, 1.6],
      [0.470, 0.677, 2.35, 0.28, 1.6],
      [0.392, 0.623, 3.10, 0.28, 1.6],
      [0.420, 0.380, -1.90, 0.24, 1.6],
      [0.600, 0.360, -1.20, 0.24, 1.6],
      [0.480, 0.560, -0.45, 0.36, 1.6],
    ],
    // B left-lean rosette: ring center west, extra west satellite, no east plate.
    [
      [0.342, 0.504, -2.15, 0.28, 1.6],
      [0.412, 0.439, -1.40, 0.28, 1.6],
      [0.507, 0.439, -0.65, 0.28, 1.6],
      [0.577, 0.503, 0.10, 0.28, 1.6],
      [0.525, 0.673, 1.60, 0.28, 1.6],
      [0.430, 0.687, 2.35, 0.28, 1.6],
      [0.352, 0.633, 3.10, 0.28, 1.6],
      [0.240, 0.560, 2.95, 0.22, 1.6],
      [0.380, 0.380, -1.95, 0.24, 1.6],
      [0.560, 0.370, -1.25, 0.24, 1.6],
      [0.440, 0.570, -0.50, 0.36, 1.6],
    ],
    // C dense rosette: tighter ring, 9 plates + satellites + hero.
    [
      [0.387, 0.510, -2.25, 0.27, 1.6],
      [0.432, 0.451, -1.62, 0.27, 1.6],
      [0.504, 0.430, -0.99, 0.27, 1.6],
      [0.574, 0.455, -0.36, 0.27, 1.6],
      [0.615, 0.517, 0.27, 0.27, 1.6],
      [0.613, 0.591, 0.90, 0.27, 1.6],
      [0.567, 0.650, 1.53, 0.27, 1.6],
      [0.495, 0.670, 2.16, 0.27, 1.6],
      [0.425, 0.644, 2.79, 0.27, 1.6],
      [0.420, 0.380, -1.90, 0.23, 1.6],
      [0.600, 0.370, -1.20, 0.23, 1.6],
      [0.490, 0.560, -0.50, 0.34, 1.6],
    ],
  ];
  const table = tables[candidate]!;
  const n = table.length;
  return table.map(([rx, ry, theta, len, aspect], i) => {
    const j = (hash01(seed, candidate, i, 1) - 0.5) * 0.1;
    return {
      rx, ry, theta: theta + j, len,
      wid: len / (2 * aspect),
      asym: hash01(seed, candidate, i, 2) * 1.6 - 0.8,
      layer: i < n / 3 ? 0 : i < (2 * n) / 3 ? 1 : 2,
      index: i,
    };
  });
}
