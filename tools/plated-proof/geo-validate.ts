/**
 * Geometry-round validation (review §15, round 3): single packed-cluster
 * layout. Determinism, plate-count grammar, BURIED ROOTS (packed cluster),
 * REDUCED TIP EXPOSURE (many tips tuck under neighbors — the old 100%-
 * exposed metric pushed the renderer away from the reference), interior
 * root distribution (never a common circle), rear-plate hiding, fan
 * coverage, asymmetry, silhouette landmarks, dominance, bed exposure,
 * evidence sanity, no sim imports.
 *
 * Run: pnpm exec tsx tools/plated-proof/geo-validate.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platedSweep } from "./fixtures.ts";
import {
  BED,
  GEOMETRY_SEED,
  geometryBoundaries,
  geometrySilhouette,
  layoutPlates,
  rasterizeGeometry,
  type GeometryRender,
  type ShellPlate,
} from "./geometry.ts";

const SIZE = 128;
const plates = layoutPlates(GEOMETRY_SEED);
const g = rasterizeGeometry(plates, SIZE, BED);

/** Anatomical tip pixel: exposed only if it still belongs to this plate. */
function tipExposure(plates: ShellPlate[], g: GeometryRender): { exposed: number; tucked: number } {
  let exposed = 0;
  let tucked = 0;
  for (const pl of plates) {
    const tx = Math.floor((pl.rx + Math.cos(pl.theta) * pl.len) * g.size);
    const ty = Math.floor((pl.ry + Math.sin(pl.theta) * pl.len) * g.size);
    assert.ok(tx >= 0 && ty >= 0 && tx < g.size && ty < g.size, `plate ${pl.index}: tip in frame`);
    if (g.plateId[ty * g.size + tx] === pl.index) exposed++;
    else tucked++;
  }
  return { exposed, tucked };
}

/** Fraction of plates whose anatomical root is buried under another plate. */
function rootOcclusion(plates: ShellPlate[], g: GeometryRender): number {
  let buried = 0;
  for (const pl of plates) {
    const rx = Math.floor(pl.rx * g.size);
    const ry = Math.floor(pl.ry * g.size);
    if (g.plateId[ry * g.size + rx] !== pl.index) buried++;
  }
  return buried / plates.length;
}

// 1. Same phenotype inputs (checked via shared fixture).
{
  const m2 = platedSweep().find((s) => s.label === "M2")!;
  assert.equal(m2.res.family, "plated", "M2 fixture holds plated");
  console.log("shared M2 inputs: PASS");
}

// 2. Determinism: identical raster twice (plates + bed).
{
  const a = rasterizeGeometry(plates, SIZE, BED);
  const b = rasterizeGeometry(plates, SIZE, BED);
  assert.deepEqual([...a.plateId], [...b.plateId], "deterministic plate raster");
  assert.deepEqual([...a.bed], [...b.bed], "deterministic bed raster");
}
console.log("geometry determinism: PASS (bit-identical reraster)");

// 3. Plate-count grammar: 9-12 visible plates (a plate counts if >=12px show).
{
  const counts = new Map<number, number>();
  for (const id of g.plateId) {
    if (id >= 0) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const visible = [...counts.entries()].filter(([, n]) => n >= 12).length;
  assert.ok(visible >= 9 && visible <= 12, `9-12 visible plates (got ${visible})`);
  console.log(`plates: PASS (${visible} visible of ${counts.size} defined)`);
}

// 4. Buried roots: >=75% of anatomical roots covered by other plates —
//    the packed-cluster signature (roots through the interior, not a ring).
{
  const frac = rootOcclusion(plates, g);
  assert.ok(frac >= 0.75, `root occlusion ${(frac * 100).toFixed(0)}% (need >=75%)`);
  console.log(`root occlusion: PASS (${(frac * 100).toFixed(0)}% buried)`);
}

// 5. Reduced tip exposure: the old gate celebrated 100% exposed; the
//    reference packs plates under each other, so a meaningful minority of
//    tips tuck. Most dominant/lower tips stay visible (as in the reference).
{
  const { exposed, tucked } = tipExposure(plates, g);
  const frac = exposed / plates.length;
  assert.ok(frac >= 0.55 && frac <= 0.85, `tip exposure ${(frac * 100).toFixed(0)}% (band 55-85%)`);
  assert.ok(tucked >= 2, `at least 2 tucked tips (got ${tucked})`);
  console.log(`tip exposure: PASS (${exposed}/${plates.length} exposed, ${tucked} tucked)`);
}

// 5b. Plates disappear under neighbors: mean visible/solo area per plate
//     must be well under 100% — bodies are substantially covered, not
//     merely juxtaposed.
{
  let sum = 0;
  for (const pl of plates) {
    const solo = rasterizeGeometry([pl], SIZE, { discs: [] });
    let soloArea = 0;
    for (const id of solo.plateId) if (id === pl.index) soloArea++;
    let visArea = 0;
    for (const id of g.plateId) if (id === pl.index) visArea++;
    sum += visArea / soloArea;
  }
  const mean = sum / plates.length;
  assert.ok(mean < 0.8, `mean visible fraction ${(mean * 100).toFixed(0)}% (need <80%)`);
  console.log(`plate hiding: PASS (mean ${(mean * 100).toFixed(0)}% of solo area visible)`);
}

// 6. Reference aspect: every plate len/(2*wid) in [1.4, 1.9]
//    (reference shells measure ~1.3-1.7; jitter perturbs angles only).
{
  for (const p of plates) {
    const aspect = p.len / (2 * p.wid);
    assert.ok(aspect >= 1.4 && aspect <= 1.9, `plate ${p.index}: aspect ${aspect.toFixed(2)}`);
  }
  console.log(`aspect: PASS (${plates.length} plates in 1.4-1.9 window)`);
}

// 7. Roots interior, not a common circle: mean root radius from the root
//    centroid small, and radii spread (CV) high — scattered through the
//    body, not mounted on a ring.
{
  const cx = plates.reduce((s, p) => s + p.rx, 0) / plates.length;
  const cy = plates.reduce((s, p) => s + p.ry, 0) / plates.length;
  const radii = plates.map((p) => Math.hypot(p.rx - cx, p.ry - cy));
  const mean = radii.reduce((s, r) => s + r, 0) / radii.length;
  const sd = Math.sqrt(radii.reduce((s, r) => s + (r - mean) ** 2, 0) / radii.length);
  const cv = sd / mean;
  assert.ok(mean < 0.3, `mean root radius ${mean.toFixed(3)} (interior)`);
  assert.ok(cv > 0.25, `root radius spread CV ${cv.toFixed(2)} (not a common circle)`);
  console.log(`root distribution: PASS (mean r ${mean.toFixed(3)}, CV ${cv.toFixed(2)})`);
}

// 8. Fan coverage: no >=120° empty cone in plate-axis directions.
{
  const norm = (a: number): number => {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a <= -Math.PI) a += 2 * Math.PI;
    return a;
  };
  const angs = plates.map((p) => norm(p.theta)).sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 0; i < angs.length; i++) {
    const cur = angs[i]!;
    const nxt = i + 1 < angs.length ? angs[i + 1]! : angs[0]! + 2 * Math.PI;
    maxGap = Math.max(maxGap, nxt - cur);
  }
  assert.ok(maxGap < (120 * Math.PI) / 180, `max direction gap ${(maxGap * 180 / Math.PI).toFixed(0)}°`);
  console.log(`fan: PASS (max gap ${(maxGap * 180 / Math.PI).toFixed(0)}°)`);
}

// 9. Rear plates mostly hidden: each layer-0 plate shows <55% of its
//    solo area — crescents, not full plates.
{
  for (const pl of plates.filter((p) => p.layer === 0)) {
    const solo = rasterizeGeometry([pl], SIZE, { discs: [] });
    let soloArea = 0;
    for (const id of solo.plateId) if (id === pl.index) soloArea++;
    let visArea = 0;
    for (const id of g.plateId) if (id === pl.index) visArea++;
    const frac = visArea / soloArea;
    assert.ok(frac < 0.55, `rear plate ${pl.index} visible ${(frac * 100).toFixed(0)}% (need <55%)`);
    console.log(`rear plate ${pl.index}: PASS (${(frac * 100).toFixed(0)}% visible)`);
  }
}

// 10. Controlled asymmetry: left/right plate-area ratio inside [0.5, 2.0]
//     (coherent but never mirror-symmetric).
{
  let left = 0;
  let right = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (g.plateId[y * SIZE + x] === -1) continue;
      if (x < SIZE / 2) left++;
      else right++;
    }
  }
  const ratio = left / Math.max(1, right);
  assert.ok(ratio >= 0.5 && ratio <= 2.0, `asymmetry ratio in bounds (got ${ratio.toFixed(2)})`);
  assert.ok(Math.abs(ratio - 1) > 0.02, `not mirror-symmetric (${ratio.toFixed(3)})`);
  console.log(`asymmetry: PASS (L/R ${ratio.toFixed(2)})`);
}

// 11. Silhouette landmarks: wide squat stance, protrusions on both sides,
//     top reach, multiple bottom points, non-trivial bbox fill.
{
  let minX = SIZE;
  let maxX = -1;
  let minY = SIZE;
  let maxY = -1;
  let s = 0;
  let leftEdge = false;
  let rightEdge = false;
  let topReach = false;
  const bottomBins = new Set<number>();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (g.plateId[y * SIZE + x] === -1) continue;
      s++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x / SIZE < 0.22) leftEdge = true;
      if (x / SIZE > 0.78) rightEdge = true;
      if (y / SIZE < 0.3) topReach = true;
      if (y / SIZE > 0.8) bottomBins.add(Math.floor((x / SIZE) * 6));
    }
  }
  const bw = (maxX - minX + 1) / SIZE;
  const bh = (maxY - minY + 1) / SIZE;
  assert.ok(bw >= 0.55, `stance width ${bw.toFixed(2)}`);
  assert.ok(bh >= 0.45, `stance height ${bh.toFixed(2)}`);
  assert.ok(leftEdge && rightEdge, "bilateral protrusions");
  assert.ok(topReach, "top reach");
  assert.ok(bottomBins.size >= 3, `bottom points in ${bottomBins.size} bins (need >=3)`);
  const bboxFill = s / ((maxX - minX + 1) * (maxY - minY + 1));
  assert.ok(bboxFill >= 0.3, `bbox fill ${(bboxFill * 100).toFixed(0)}%`);
  console.log(`silhouette: PASS (${(bw * 100).toFixed(0)}x${(bh * 100).toFixed(0)} stance, ${bottomBins.size} bottom bins)`);
}

// 12. No dominance: no single plate exceeds 35% of the mask.
{
  const counts = new Map<number, number>();
  let s = 0;
  for (const id of g.plateId) {
    if (id === -1) continue;
    s++;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let peak = 0;
  for (const n of counts.values()) peak = Math.max(peak, n / s);
  assert.ok(peak < 0.35, `peak plate share ${(peak * 100).toFixed(0)}%`);
  console.log(`dominance: PASS (peak ${(peak * 100).toFixed(0)}%)`);
}

// 13. Bed exposure: the placeholder core must show through recesses.
//     The packed cluster's recesses are OPEN bays (no fully-enclosed
//     pockets — verified via interiorGaps), so discs sit partially
//     covered; 0.1% is the honest placeholder scale for this grammar.
{
  let b = 0;
  for (const v of g.bed) b += v;
  const frac = b / (SIZE * SIZE);
  assert.ok(frac >= 0.001, `bed exposure ${(frac * 100).toFixed(2)}%`);
  console.log(`bed: PASS (${(frac * 100).toFixed(2)}% exposed, open-bay recesses)`);
}

// 14. Silhouette + boundary evidence non-degenerate.
{
  const sil = geometrySilhouette(g);
  const bnd = geometryBoundaries(g);
  let s = 0;
  let b = 0;
  for (let i = 0; i < sil.length; i++) {
    s += sil[i]!;
    b += bnd[i]!;
  }
  assert.ok(s > SIZE * SIZE * 0.1, `silhouette covers >10% (${(100 * s) / sil.length}%)`);
  assert.ok(s < SIZE * SIZE * 0.8, `silhouette <80% (not full-frame)`);
  assert.ok(b > 50, `boundary overlay non-trivial (${b}px)`);
  console.log(`evidence: PASS (sil ${(100 * s / sil.length).toFixed(1)}%, bounds ${b}px)`);
}

// 15. No sim imports, no Math.random.
{
  const dir = dirname(fileURLToPath(import.meta.url));
  for (const f of ["geometry.ts", "geo-candidates.ts", "geo-validate.ts"]) {
    const src = readFileSync(join(dir, f), "utf8");
    const bad = /^import\s[^;]*?from\s+["'][^"']*sim-(core|runtime)|require\(\s*["'][^"']*sim-(core|runtime)|Math\.random\s*\(/.test(src);
    assert.ok(!bad, `${f} clean`);
  }
  console.log("geometry isolation: PASS");
}

console.log("plated geometry validation: PASS");
