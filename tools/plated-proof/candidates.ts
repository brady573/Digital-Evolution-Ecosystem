/**
 * Plated M2 candidate review (design review round 3).
 *
 * Three 128px M2 renders from the EXACT same phenotype + simulation inputs,
 * one per material variant (translucent / specular / darkbio), shown beside
 * the approved reference at native 128 and 3x nearest-neighbor. No sweeps:
 * the acceptance question is only whether a candidate belongs to the
 * reference family.
 *
 * Run: pnpm exec tsx tools/plated-proof/candidates.ts
 * Writes: /sdcard/DEE/review/plated/m2-candidates.html
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { platedSweep } from "./fixtures.ts";
import { renderPlated, type MaterialVariant } from "./render.ts";

const OUT = "/sdcard/DEE/review/plated/";
mkdirSync(OUT, { recursive: true });

const toB64 = (rgb: Uint8Array): string => Buffer.from(rgb).toString("base64");

const m2 = platedSweep().find((s) => s.label === "M2")!;
const variants: MaterialVariant[] = ["translucent", "specular", "darkbio"];
const shots = variants.map((v) => {
  const p = renderPlated(m2.res, m2.m, 128, v);
  return { variant: v, size: 128, b64: toB64(p.rgb) };
});

const payload = JSON.stringify({ shots });
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plated M2 candidates vs approved reference</title>
<style>
body{background:#070c11;color:#cfe0d8;font:14px/1.4 system-ui,sans-serif;margin:0 auto;max-width:1400px;padding:24px}
h1,h2{color:#eafff3} .note{color:#8fa8a0;font-size:.82rem}
.row{display:flex;gap:26px;align-items:flex-start;flex-wrap:wrap;margin:14px 0 30px}
figure{margin:0;text-align:center} figcaption{font-size:.75rem;color:#9fb8ad;margin-top:4px}
canvas{image-rendering:pixelated;background:#060b0f;border:1px solid #1d2f3a}
.ref{border:1px solid #2a4a5a}
.ref img{width:384px;height:384px;object-fit:cover;display:block}
#big,#native{display:flex;gap:26px;flex-wrap:wrap;align-items:flex-start}
</style>
</head>
<body>
<h1>Plated M2 candidates vs approved reference</h1>
<p class="note">All three candidates render the identical phenotype inputs (M2, lineage 4242,
seed 7000): silhouette, plates, and layout are shared — only material response differs.
Reference: approved dark-sapphire Plated source, center-cropped. Question for review:
does at least one candidate clearly belong to the same visual family?</p>
<h2>Reference (384px crop) vs candidates at 3x (384px)</h2>
<div class="row"><figure class="ref"><img src="reference-crop.png" alt="approved Plated reference"><figcaption>approved reference</figcaption></figure><span id="big"></span></div>
<h2>Candidates at native 128px</h2>
<div class="row" id="native"></div>
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
  const c = document.createElement('figcaption'); c.textContent = label || entry.variant; f.appendChild(c);
  return f;
}
const big = document.getElementById('big');
const native = document.getElementById('native');
DATA.shots.forEach((s) => {
  big.appendChild(fig(s, 3));
  native.appendChild(fig(s, 1));
});
</script>
</body>
</html>`;
writeFileSync(OUT + "m2-candidates.html", html);
console.log(`m2 candidates -> ${OUT}m2-candidates.html (${shots.join(", ")})`);
