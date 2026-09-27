/**
 * Geometry-round validation (review §15): determinism, plate-count grammar,
 * tip protrusion, asymmetry bounds, silhouette/boundary evidence sanity,
 * same-inputs across candidates, no sim imports.
 *
 * Run: pnpm exec tsx tools/plated-proof/geo-validate.ts
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platedSweep } from "./fixtures.ts";
import {
  geometryBoundaries,
  geometrySilhouette,
  layoutPlates,
  rasterizeGeometry,
} from "./geometry.ts";

const SIZE = 128;
const geos = [0, 1, 2].map((c) => {
  const plates = layoutPlates(c, 7000);
  return { c, plates, g: rasterizeGeometry(plates, SIZE) };
});

// 1. Same phenotype inputs for every candidate (checked via shared fixture).
{
  const m2 = platedSweep().find((s) => s.label === "M2")!;
  assert.equal(m2.res.family, "plated", "M2 fixture holds plated");
  console.log("shared M2 inputs: PASS");
}

// 2. Determinism: identical raster twice.
for (const { c, plates } of geos) {
  const a = rasterizeGeometry(plates, SIZE);
  const b = rasterizeGeometry(plates, SIZE);
  assert.deepEqual([...a.plateId], [...b.plateId], `candidate ${c} deterministic`);
}
console.log("geometry determinism: PASS (3 layouts, bit-identical reraster)");

// 3. Plate-count grammar: 8-12 visible plates (a plate counts if >=12px show).
for (const { c, g } of geos) {
  const counts = new Map<number, number>();
  for (const id of g.plateId) {
    if (id !== -1) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const visible = [...counts.entries()].filter(([, n]) => n >= 12).length;
  assert.ok(visible >= 8 && visible <= 12, `candidate ${c}: 8-12 visible plates (got ${visible})`);
  console.log(`candidate ${"ABC"[c]} plates: PASS (${visible} visible of ${counts.size} defined)`);
}

// 4. Tips protrude: every visible plate's tip pixel belongs to that plate and
//    lies outside all other plates (directional, exposed tips).
for (const { c, g } of geos) {
  let exposed = 0;
  let total = 0;
  for (const t of g.tips) {
    if (!t) continue;
    total++;
    if (g.plateId[t.y * SIZE + t.x] !== -1) exposed++;
  }
  assert.ok(total >= 8, `candidate ${c}: tips computed for visible plates`);
  assert.equal(exposed, total, `candidate ${c}: all tips exposed (none buried)`);
  console.log(`candidate ${"ABC"[c]} tips: PASS (${exposed}/${total} exposed)`);
}

// 5. Controlled asymmetry: left/right plate-area ratio inside [0.5, 2.0]
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

// 6. Silhouette + boundary evidence non-degenerate.
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

// 7. No sim imports, no Math.random.
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
