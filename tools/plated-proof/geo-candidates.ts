/**
 * Geometry-round evidence (review §15, round 3): ONE packed-cluster M2
 * candidate, same phenotype inputs, geometry-only (flat neutral fill +
 * silhouette mask + plate-boundary overlay + reference side-by-side).
 * No texture, no specular, no metabolism, no glow, no material variants.
 *
 * Run: pnpm exec tsx tools/plated-proof/geo-candidates.ts
 * Writes: /sdcard/DEE/review/plated/geo-candidates.html
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { platedSweep } from "./fixtures.ts";
import {
  BED,
  GEOMETRY_SEED,
  geometryBoundaries,
  geometrySilhouette,
  layoutPlates,
  rasterizeGeometry,
} from "./geometry.ts";

const OUT = "/sdcard/DEE/review/plated/";
mkdirSync(OUT, { recursive: true });

const toB64 = (rgb: Uint8Array): string => Buffer.from(rgb).toString("base64");
const SIZE = 128;
// Flat neutral fill: two greys alternating by paint order (overlap
// neighbors contrast), plus the dark bed placeholder in recesses.
const FRONT = { r: 200, g: 214, b: 226 };
const BACK = { r: 130, g: 148, b: 172 };
const BED_FILL = { r: 46, g: 58, b: 72 };

interface Shot {
  label: string;
  size: number;
  b64: string;
}

const plates = layoutPlates(GEOMETRY_SEED);
const g = rasterizeGeometry(plates, SIZE, BED);
const byIndex = new Map(plates.map((p) => [p.index, p]));

const rgb = new Uint8Array(SIZE * SIZE * 3);
for (let i = 0; i < SIZE * SIZE; i++) {
  const id = g.plateId[i]!;
  if (id === -1) continue;
  const col = id === -2 ? BED_FILL : byIndex.get(id)!.index % 2 === 0 ? BACK : FRONT;
  rgb[i * 3] = col.r;
  rgb[i * 3 + 1] = col.g;
  rgb[i * 3 + 2] = col.b;
}
const fills: Shot[] = [{ label: "packed-cluster@128", size: SIZE, b64: toB64(rgb) }];

const sil = geometrySilhouette(g);
const silRgb = new Uint8Array(SIZE * SIZE * 3);
for (let i = 0; i < sil.length; i++) {
  if (g.plateId[i] === -2) {
    silRgb[i * 3] = 120;
    silRgb[i * 3 + 1] = 140;
    silRgb[i * 3 + 2] = 160;
  } else if (sil[i] === 1) {
    silRgb[i * 3] = 230;
    silRgb[i * 3 + 1] = 236;
    silRgb[i * 3 + 2] = 242;
  }
}
const masks: Shot[] = [{ label: "packed-cluster-mask@128", size: SIZE, b64: toB64(silRgb) }];

const bnd = geometryBoundaries(g);
const bndRgb = new Uint8Array(SIZE * SIZE * 3);
for (let i = 0; i < bnd.length; i++) {
  const id = g.plateId[i]!;
  const base = id === -2 ? 45 : 70;
  const v = bnd[i] === 1 ? 240 : id === -1 ? 0 : base;
  bndRgb[i * 3] = v;
  bndRgb[i * 3 + 1] = v + 8 > 255 ? 255 : v + 8;
  bndRgb[i * 3 + 2] = Math.min(255, v + 20);
}
const bounds: Shot[] = [{ label: "packed-cluster-bounds@128", size: SIZE, b64: toB64(bndRgb) }];

const m2 = platedSweep().find((s) => s.label === "M2")!;
const payload = JSON.stringify({ fills, masks, bounds });
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plated packed-cluster candidate (M2, geometry-only)</title>
<style>
body{background:#070c11;color:#cfe0d8;font:14px/1.4 system-ui,sans-serif;margin:0 auto;max-width:1400px;padding:24px}
h1,h2{color:#eafff3} .note{color:#8fa8a0;font-size:.82rem}
.row{display:flex;gap:26px;align-items:flex-start;flex-wrap:wrap;margin:14px 0 30px}
figure{margin:0;text-align:center} figcaption{font-size:.75rem;color:#9fb8ad;margin-top:4px}
canvas{image-rendering:pixelated;background:#060b0f;border:1px solid #1d2f3a}
.ref img{width:384px;height:384px;object-fit:cover;display:block}
.ref{border:1px solid #2a4a5a}
</style>
</head>
<body>
<h1>Plated packed-cluster candidate — M2, geometry only</h1>
<p class="note">Single candidate per the §15 gate (round 3): packed-cluster
grammar, roots through the interior, tips tucking under neighbors.
Same phenotype inputs (M2, lineage 4242, seed 7000).
Flat neutral fill only: two greys alternating by paint order, dark bed
placeholder discs in recesses. No texture, specular, metabolism, glow,
or material variants. Question: does this silhouette belong to the approved
Plated reference family?</p>
<h2>Reference vs candidate at 3x</h2>
<div class="row"><figure class="ref"><img src="reference-crop.png" alt="approved Plated reference"><figcaption>approved reference</figcaption></figure><span id="big" style="display:contents"></span></div>
<h2>Candidate at native 128px</h2>
<div class="row" id="native" style="display:flex;gap:26px;flex-wrap:wrap"></div>
<h2>Silhouette mask</h2>
<div class="row" id="masks" style="display:flex;gap:26px;flex-wrap:wrap"></div>
<h2>Plate-boundary overlay</h2>
<div class="row" id="bounds" style="display:flex;gap:26px;flex-wrap:wrap"></div>
<script>
const DATA = ${payload};
function b64ToRgba(b64, size) {
  const bin = atob(b64);
  const out = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = bin.charCodeAt(i * 3);
    out[i * 4 + 1] = bin.charCodeAt(i * 3 + 1);
    out[i * 4 + 2] = bin.charCodeAt(i * 3 + 2);
    out[i * 4 + 3] = 255;
  }
  return out;
}
function fig(entry, scale, label) {
  const cv = document.createElement('canvas');
  cv.width = entry.size; cv.height = entry.size;
  cv.style.width = (entry.size * scale) + 'px';
  cv.style.height = (entry.size * scale) + 'px';
  const ctx = cv.getContext('2d');
  ctx.putImageData(new ImageData(b64ToRgba(entry.b64, entry.size), entry.size, entry.size), 0, 0);
  const f = document.createElement('figure'); f.appendChild(cv);
  const c = document.createElement('figcaption'); c.textContent = label || entry.label; f.appendChild(c);
  return f;
}
const big = document.getElementById('big');
const native = document.getElementById('native');
const masks = document.getElementById('masks');
const bounds = document.getElementById('bounds');
DATA.fills.forEach((s) => { big.appendChild(fig(s, 3)); native.appendChild(fig(s, 1)); });
DATA.masks.forEach((s) => masks.appendChild(fig(s, 1)));
DATA.bounds.forEach((s) => bounds.appendChild(fig(s, 2)));
</script>
</body>
</html>`;
writeFileSync(OUT + "geo-candidates.html", html);
console.log(`packed-cluster candidate -> ${OUT}geo-candidates.html (M2 ${m2.m}, ${plates.length} plates)`);
