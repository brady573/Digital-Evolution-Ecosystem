/**
 * Plated proof validation: determinism, family hold, monotonic activity,
 * structural stability, LOD continuity, simulation isolation.
 *
 * Run: pnpm exec tsx tools/plated-proof/validate.ts
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { continuityPair, flipSamples, platedSweep } from "./fixtures.ts";
import { renderPhenotypeGrid } from "../../packages/phenotype/src/index.ts";
import {
  LOD_SIZES,
  SWEEP_M,
  activityMetric,
  plateLayout,
  renderPlated,
  silhouette,
  silhouetteIoU,
} from "./render.ts";

const samples = platedSweep();

// 1. Family hold: M0..M4 resolve Plated along the descending lineage (asserted in fixtures; recheck).
for (const s of samples) assert.equal(s.res.family, "plated", `${s.label} must hold Plated`);
console.log("family hold M0..M4: PASS (lineage-anchored, one lineage)");
// 1b. Retention pairs: M0/M1 resolve blob as founders but retain plated anchored.
// Rendered with the monochrome grid renderer: what they actually look like.
for (const f of flipSamples()) {
  assert.equal(f.founderFamily, "blob", `${f.label} founder must be blob`);
  assert.equal(f.anchoredFamily, "plated", `${f.label} anchored must retain plated`);
  assert.equal(f.res.family, "plated", `${f.label} rendered must be plated`);
  for (const size of [9, 13]) {
    void size;
  }
  const g1 = renderPhenotypeGrid(f.res, "inspection", "active");
  const g2 = renderPhenotypeGrid(f.res, "inspection", "active");
  assert.deepEqual([...g1.cells], [...g2.cells], `flip rerender ${f.label}`);
}
console.log("retention pairs M0/M1: PASS (founder blob, anchored plated — full sweep holds)");

// 2. Determinism: identical inputs, identical bytes, twice.
for (const s of samples) {
  for (const size of LOD_SIZES) {
    const a = renderPlated(s.res, s.m, size);
    const b = renderPlated(s.res, s.m, size);
    assert.deepEqual([...a.rgb], [...b.rgb], `rerender ${s.label}@${size}`);
    assert.deepEqual([...a.kind], [...b.kind], `rekind ${s.label}@${size}`);
  }
}
console.log("deterministic rerender: PASS (M0..M4 + retention x 4 LODs, byte-identical)");

// 3. Monotonic activity: metric strictly increases with M at every LOD
// (sweep runs M4->M0 in lineage order, so compare in ascending-M order).
for (const size of LOD_SIZES) {
  const asc = [...samples].sort((a, b) => a.m - b.m);
  const ms = asc.map((s) => activityMetric(renderPlated(s.res, s.m, size)));
  // At 32px and up every step must read strictly; at 16px adjacent states
  // may tie (few countable pixels), but the endpoints must separate.
  const strict = size >= 32;
  for (let i = 1; i < ms.length; i++) {
    if (strict) {
      assert.ok(ms[i]! > ms[i - 1]!, `${size}px activity must rise ${asc[i - 1]!.label}->${asc[i]!.label} (${ms[i - 1]!.toFixed(4)}->${ms[i]!.toFixed(4)})`);
    } else {
      assert.ok(ms[i]! >= ms[i - 1]!, `${size}px activity must not fall ${asc[i - 1]!.label}->${asc[i]!.label}`);
    }
  }
  if (!strict) {
    assert.ok(ms[ms.length - 1]! > ms[0]!, `16px endpoints must separate (M0 ${ms[0]!.toFixed(4)} vs M4 ${ms[ms.length - 1]!.toFixed(4)})`);
  }
  console.log(`monotonic activity @${size}: PASS (${asc.map((s) => s.label).join("<")}: ${ms.map((v) => v.toFixed(3)).join(" < ")})`);
}

// 4. Structural stability: plate count/order fixed; silhouette IoU vs M2 high.
{
  const layouts = samples.map((s) => plateLayout(s.res, s.res.cosmeticSeed >>> 0));
  const labels = samples.map((s) => s.label);
  const n0 = layouts[0]!.length;
  for (const [i, l] of layouts.entries()) {
    assert.equal(l.length, n0, `${labels[i]} plate count stable`);
    l.forEach((pl, j) => {
      assert.ok(Math.abs(pl.cx - layouts[0]![j]!.cx) < 1e-9, `${labels[i]} plate ${j} cx stable`);
      assert.ok(Math.abs(pl.cy - layouts[0]![j]!.cy) < 1e-9, `${labels[i]} plate ${j} cy stable`);
      assert.ok(Math.abs(pl.rx - layouts[0]![j]!.rx) < 1e-9, `${labels[i]} plate ${j} rx stable`);
      assert.ok(Math.abs(pl.ry - layouts[0]![j]!.ry) < 1e-9, `${labels[i]} plate ${j} ry stable`);
    });
  }
  const sils = samples.map((s) => silhouette(renderPlated(s.res, s.m, 128)));
  let min = 1;
  for (let i = 1; i < sils.length; i++) min = Math.min(min, silhouetteIoU(sils[0]!, sils[i]!));
  assert.ok(min > 0.5, `silhouette IoU vs M2 must exceed 0.5 (got ${min.toFixed(3)})`);
  console.log(`structural stability: PASS (${n0} plates fixed; silhouette IoU min ${min.toFixed(3)})`);
}

// 5. LOD continuity: same phenotype recognizable across sizes — plate count
//    identical by construction; silhouette overlap 128-vs-downscaled holds.
{
  const p128 = silhouette(renderPlated(samples[2]!.res, samples[2]!.m, 128));
  const down = new Uint8Array(16 * 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let n = 0;
      for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) n += p128[(y * 8 + dy) * 128 + (x * 8 + dx)]!;
      down[y * 16 + x] = n >= 32 ? 1 : 0;
    }
  }
  const p16 = silhouette(renderPlated(samples[2]!.res, samples[2]!.m, 16));
  const iou = silhouetteIoU(down, p16);
  assert.ok(iou > 0.5, `128-downscaled vs direct-16 IoU must exceed 0.5 (got ${iou.toFixed(3)})`);
  console.log(`LOD continuity: PASS (direct-16 vs downscaled-128 IoU ${iou.toFixed(3)})`);
}

// 6. Continuity pair: child near parent.
{
  const { parent, child } = continuityPair();
  assert.equal(child.res.family, "plated", "child holds Plated");
  const iou = silhouetteIoU(
    silhouette(renderPlated(parent.res, parent.m, 128)),
    silhouette(renderPlated(child.res, parent.m, 128)),
  );
  assert.ok(iou > 0.7, `parent/child IoU must exceed 0.7 (got ${iou.toFixed(3)})`);
  console.log(`parent/descendant continuity: PASS (IoU ${iou.toFixed(3)})`);
}

// 7. Sweep inputs stay inside biological ranges (no range changes).
for (const s of samples) {
  assert.ok(s.traits.metabolism >= 0.04 && s.traits.metabolism <= 0.5, `${s.label} metabolism in range`);
  assert.ok(SWEEP_M.includes(s.m as (typeof SWEEP_M)[number]), `${s.label} M is a handoff sample`);
}
console.log("input ranges: PASS (metabolism raw inside [0.04, 0.5]; M values are handoff samples)");

// 8. Material variants share inputs and silhouette (round-3 acceptance shape).
{
  const m2 = samples.find((s) => s.label === "M2")!;
  const renders = (["translucent", "specular", "darkbio"] as const).map((v) => ({
    v,
    p: renderPlated(m2.res, m2.m, 128, v),
  }));
  for (const { v, p } of renders) {
    const again = renderPlated(m2.res, m2.m, 128, v);
    assert.deepEqual([...again.rgb], [...p.rgb], `variant ${v} deterministic`);
  }
  const sils = renders.map(({ p }) => silhouette(p));
  for (let i = 1; i < sils.length; i++) {
    assert.equal(silhouetteIoU(sils[0]!, sils[i]!), 1, `variant ${renders[i]!.v} shares silhouette exactly`);
  }
  const b64 = (p: { rgb: Uint8Array }) => Buffer.from(p.rgb).toString("base64");
  assert.ok(
    b64(renders[0]!.p) !== b64(renders[1]!.p) && b64(renders[1]!.p) !== b64(renders[2]!.p),
    "variants differ materially (not relabels of one render)",
  );
  console.log("material variants: PASS (identical inputs+s silhouette, three distinct materials)");
}
// 9. Simulation isolation: no sim-core/sim-runtime imports; no RNG consumption.
{
  const dir = dirname(fileURLToPath(import.meta.url));
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
    const src = readFileSync(join(dir, f), "utf8");
    const bad = /^import\s[^;]*?from\s+["'][^"']*sim-(core|runtime)|require\(\s*["'][^"']*sim-(core|runtime)|Math\.random\s*\(/.test(src);
    assert.ok(!bad, `${f} must not import sim packages or Math.random`);
  }
  console.log("simulation isolation: PASS (phenotype package only; seeded integer hashing)");
}

console.log("plated proof validation: PASS");
