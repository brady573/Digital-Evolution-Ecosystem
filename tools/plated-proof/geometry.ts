/**
 * Plated geometry round 3 (review §15 gate): packed-cluster construction.
 *
 * Plates are spine-driven teardrops: root point + axis angle + length +
 * convex body profile (rounded root cap, full domed body peaking near
 * t≈0.3, soft blunt-teardrop tip) + asymmetric shoulders. Plates are broad
 * and plump (aspect 1.4–1.9, reference-measured 1.3–1.7) — four rounds at
 * 2.0–2.4 produced blades/fingers/stars, never packed shells.
 *
 * Grammar: one packed cluster, roots scattered through the body INTERIOR
 * (never a common circle), paint order back-to-front by layer:
 *   layer 0 — 2–3 rear plates, mostly hidden, crescents at the edges;
 *   layer 1 — 2–3 broad dominant plates spanning the upper/center body,
 *             2 side plates breaking the contour, 3–4 lower plates with
 *             short downward tips;
 *   layer 2 — 1 foreground hero diagonal.
 * Many tips tuck UNDER neighbors (imbrication depth); roots are buried.
 *
 * A flat dark pearl-bed placeholder (discs) sits underneath and shows
 * through recesses (plateId -2) — topology only, no material.
 *
 * Geometry-only: flat neutral fill (two greys alternating by paint order
 * + dark bed placeholder), silhouette masks, plate-boundary overlays. No
 * texture, no specular, no metabolism, no glow. Deterministic hashing.
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
 * Bed discs for the single packed-cluster layout, hand-placed in the actual
 * inter-plate recesses (verified adjacency: discs touch plates on most of
 * their perimeter). Part of the arrangement; deterministic literals, same
 * M2 inputs. Flat dark placeholder only — no material.
 */
export const BED: BedDef = {
  discs: [{ cx: 0.58, cy: 0.74, r: 0.035 }, { cx: 0.30, cy: 0.66, r: 0.035 }],
};

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
 * Half-width at spine parameter t: rounded root cap, full domed body
 * peaking near t≈0.3, soft blunt-teardrop tip (only 10% taper past t=0.5).
 * Broad and plump — the reference shells read domed, not leaf-like.
 */
export function halfWidth(pl: ShellDef, t: number): number {
  const tc = Math.min(1, Math.max(0, t));
  const body = 0.42 + 0.68 * Math.sin(Math.PI * Math.pow(tc, 0.6));
  const tipTaper = 1 - 0.10 * smoothstep(0.5, 1, tc);
  const rootCap = 0.62 + 0.38 * smoothstep(0, 0.15, tc);
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
 * Deterministic plate-set generator: ONE packed-cluster layout (§15 gate
 * round 3 — single candidate until the silhouette is in-family). Same M2
 * phenotype inputs every run; only seeded micro-jitter differs per seed.
 *
 * Grammar (roots scattered through the interior, never a common circle):
 *   R1–R3  rear plates, mostly hidden, crescents at the edges;
 *   D1–D3  broad dominant plates spanning the upper/center body;
 *   S1–S2  side plates breaking the contour without pointing strongly out;
 *   L1–L3  smaller lower plates with short downward tips;
 *   D2     foreground hero diagonal (painted last).
 * Entries are [rx, ry, theta, len, aspect, layer]; wid derives as
 * len/(2*aspect) so the reference-calibrated 1.4–1.9 aspect is explicit.
 * A small seeded angle jitter keeps the table honest (no hand-tuned pixel
 * fitting) while inputs stay fixed.
 */
export function layoutPlates(seed: number): ShellPlate[] {
  // Paint order within a layer follows table order: side/lower plates
  // first, then the dominant plates that tuck their tips.
  const table: Array<[number, number, number, number, number, number]> = [
    // R1 rear upper-left crescent, tip tucked under D1.
    [0.34, 0.38, -0.10, 0.24, 1.6, 0],
    // R2 rear right vertical crescent, tip out at top-right.
    [0.64, 0.52, -1.35, 0.22, 1.5, 0],
    // R3 rear lower-left, tip tucked under L1.
    [0.48, 0.60, 2.20, 0.22, 1.7, 0],
    // S1 side left, sliver breaks the left contour, tip tucked under D3.
    [0.46, 0.46, 2.95, 0.30, 1.5, 1],
    // S2 side right, sliver breaks the right contour.
    [0.54, 0.54, 0.75, 0.30, 1.5, 1],
    // L1 lower, short downward tip.
    [0.44, 0.58, 1.75, 0.22, 1.6, 1],
    // L2 lower, short downward tip.
    [0.52, 0.60, 1.50, 0.26, 1.6, 1],
    // L3 lower, short downward tip.
    [0.60, 0.58, 1.30, 0.24, 1.6, 1],
    // D1 dominant top broad, spans the upper body (paints after S2).
    [0.38, 0.40, 0.25, 0.44, 1.45, 1],
    // D3 dominant left broad (paints after S1, tucks its tip).
    [0.52, 0.48, 2.75, 0.38, 1.45, 1],
    // D2 dominant center diagonal, foreground hero.
    [0.46, 0.46, 0.62, 0.38, 1.75, 2],
  ];
  return table.map(([rx, ry, theta, len, aspect, layer], i) => {
    const j = (hash01(seed, 0, i, 1) - 0.5) * 0.1;
    return {
      rx, ry, theta: theta + j, len,
      wid: len / (2 * aspect),
      asym: hash01(seed, 0, i, 2) * 1.6 - 0.8,
      layer, index: i,
    };
  });
}
