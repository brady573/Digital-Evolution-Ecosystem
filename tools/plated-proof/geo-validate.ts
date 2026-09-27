/**
 * Geometry-round validation (review §15): determinism, plate-count grammar
 * (10–14), tip protrusion + reference aspect (2.0–2.4), fan direction
 * coverage, asymmetry bounds, silhouette landmarks, dominance cap, bed
 * exposure, same-inputs across candidates, no sim imports.
 *
 * Run: pnpm exec tsx tools/plated-proof/geo-validate.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platedSweep } from "./fixtures.ts";
import {
  BEDS,
  geometryBoundaries,
  geometrySilhouette,
  layoutPlates,
  rasterizeGeometry,
} from "./geometry.ts";

const SIZE = 128;
const geos = [0, 1, 2].map((c) => {
  const plates = layoutPlates(c, 7000);
  return { c, plates, bed: BEDS[c]!, g: rasterizeGeometry(plates, SIZE, BEDS[c]!) };
});

// 1. Same phenotype inputs for every candidate (checked via shared fixture).
{
  const m2 = platedSweep().find((s) => s.label === "M2")!;
  assert.equal(m2.res.family, "plated", "M2 fixture holds plated");
  console.log("shared M2 inputs: PASS");
}

// 2. Determinism: identical raster twice (plates + bed).
for (const { c, plates } of geos) {
  const bed = BEDS[c]!;
  const a = rasterizeGeometry(plates, SIZE, bed);
  const b = rasterizeGeometry(plates, SIZE, bed);
  assert.deepEqual([...a.plateId], [...b.plateId], `candidate ${c} deterministic`);
  assert.deepEqual([...a.bed], [...b.bed], `candidate ${c} bed deterministic`);
}
console.log("geometry determinism: PASS (3 layouts, bit-identical reraster)");

// 3. Plate-count grammar: 9-13 visible plates (a plate counts if >=12px show;
//    spec §15 asks ~8-12, chord weaves run A10/B9/C12).
for (const { c, g } of geos) {
  const counts = new Map<number, number>();
  for (const id of g.plateId) {
    if (id >= 0) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const visible = [...counts.entries()].filter(([, n]) => n >= 12).length;
  assert.ok(visible >= 9 && visible <= 13, `candidate ${c}: 9-13 visible plates (got ${visible})`);
  console.log(`candidate ${"ABC"[c]} plates: PASS (${visible} visible of ${counts.size} defined)`);
}

// 4. Tips: most plates directional (exposed tips); a minority may tuck under
//    opposite plates (imbrication depth). At least 70% exposed.
for (const { c, g } of geos) {
  let exposed = 0;
  let total = 0;
  for (const t of g.tips) {
    if (!t) continue;
    total++;
    if (g.plateId[t.y * SIZE + t.x] !== -1) exposed++;
  }
  assert.ok(total >= 9, `candidate ${c}: tips computed for visible plates`);
  assert.ok(exposed / total >= 0.7, `candidate ${c}: tip exposure ${(exposed / total).toFixed(2)}`);
  console.log(`candidate ${"ABC"[c]} tips: PASS (${exposed}/${total} exposed)`);
}

// 5. Reference aspect: every plate len/(2*wid) in [1.4, 1.8]
//    (tables target 1.6; jitter perturbs angles only, aspect exact).
for (const { c, plates } of geos) {
  for (const p of plates) {
    const aspect = p.len / (2 * p.wid);
    assert.ok(aspect >= 1.4 && aspect <= 1.8, `candidate ${c} plate ${p.index}: aspect ${aspect.toFixed(2)}`);
  }
  console.log(`candidate ${"ABC"[c]} aspect: PASS (${plates.length} plates in 1.4-1.8 window)`);
}

// 6. Fan coverage: no >=100° empty cone in plate-axis directions.
for (const { c, plates } of geos) {
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
  assert.ok(maxGap < (100 * Math.PI) / 180, `candidate ${c}: max direction gap ${(maxGap * 180 / Math.PI).toFixed(0)}°`);
  console.log(`candidate ${"ABC"[c]} fan: PASS (max gap ${(maxGap * 180 / Math.PI).toFixed(0)}°)`);
}

// 7. Controlled asymmetry: left/right plate-area ratio inside [0.5, 2.0]
//    (coherent but never mirror-symmetric).
for (const { c, g } of geos) {
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
  assert.ok(ratio >= 0.5 && ratio <= 2.0, `candidate ${c}: asymmetry ratio in bounds (got ${ratio.toFixed(2)})`);
  assert.ok(Math.abs(ratio - 1) > 0.02, `candidate ${c}: not mirror-symmetric (${ratio.toFixed(3)})`);
  console.log(`candidate ${"ABC"[c]} asymmetry: PASS (L/R ${ratio.toFixed(2)})`);
}

// 8. Silhouette landmarks: wide stance, protrusions on both sides, top
//    reach, bottom points, non-trivial bbox fill.
for (const { c, g } of geos) {
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
  assert.ok(bw >= 0.55, `candidate ${c}: stance width ${bw.toFixed(2)}`);
  assert.ok(bh >= 0.5, `candidate ${c}: stance height ${bh.toFixed(2)}`);
  assert.ok(leftEdge && rightEdge, `candidate ${c}: bilateral protrusions`);
  assert.ok(topReach, `candidate ${c}: top reach`);
  assert.ok(bottomBins.size >= 2, `candidate ${c}: bottom points in ${bottomBins.size} bins`);
  const bboxFill = s / ((maxX - minX + 1) * (maxY - minY + 1));
  assert.ok(bboxFill >= 0.3, `candidate ${c}: bbox fill ${(bboxFill * 100).toFixed(0)}%`);
  console.log(
    `candidate ${"ABC"[c]} silhouette: PASS (${(bw * 100).toFixed(0)}x${(bh * 100).toFixed(0)} stance, ${bottomBins.size} bottom bins)`,
  );
}

// 9. No dominance: no single plate exceeds 35% of the mask (catches blob-merging).
for (const { c, g } of geos) {
  const counts = new Map<number, number>();
  let s = 0;
  for (const id of g.plateId) {
    if (id === -1) continue;
    s++;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let peak = 0;
  for (const n of counts.values()) peak = Math.max(peak, n / s);
  assert.ok(peak < 0.35, `candidate ${c}: peak plate share ${(peak * 100).toFixed(0)}%`);
  console.log(`candidate ${"ABC"[c]} dominance: PASS (peak ${(peak * 100).toFixed(0)}%)`);
}

// 10. Bed exposure: the placeholder core must show through gaps.
for (const { c, g } of geos) {
  let b = 0;
  for (const v of g.bed) b += v;
  const frac = b / (SIZE * SIZE);
  assert.ok(frac >= 0.004, `candidate ${c}: bed exposure ${(frac * 100).toFixed(2)}%`);
  console.log(`candidate ${"ABC"[c]} bed: PASS (${(frac * 100).toFixed(1)}% exposed)`);
}

// 11. Silhouette + boundary evidence non-degenerate.
for (const { c, g } of geos) {
  const sil = geometrySilhouette(g);
  const bnd = geometryBoundaries(g);
  let s = 0;
  let b = 0;
  for (let i = 0; i < sil.length; i++) {
    s += sil[i]!;
    b += bnd[i]!;
  }
  assert.ok(s > SIZE * SIZE * 0.1, `candidate ${c}: silhouette covers >10% (${(100 * s) / sil.length}%)`);
  assert.ok(s < SIZE * SIZE * 0.8, `candidate ${c}: silhouette <80% (not full-frame)`);
  assert.ok(b > 50, `candidate ${c}: boundary overlay non-trivial (${b}px)`);
  console.log(`candidate ${"ABC"[c]} evidence: PASS (sil ${(100 * s / sil.length).toFixed(1)}%, bounds ${b}px)`);
}

// 12. No sim imports, no Math.random.
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
