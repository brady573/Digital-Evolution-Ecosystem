/**
 * Plated proof evidence generator: strips, review sheet, manifest.
 *
 * Writes a self-contained offline HTML page (embedded base64 RGBA -> canvas
 * putImageData, nearest-neighbor display) plus console manifest. PNG contact
 * sheets for the review folder are rendered from the same pixels via Pillow.
 *
 * Run: pnpm exec tsx tools/plated-proof/evidence.ts
 * Writes: /sdcard/DEE/review/plated/plated-proof.html + plated-pixels.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { continuityPair, flipSamples, platedSweep } from "./fixtures.ts";
import { renderPhenotypeGrid } from "../../packages/phenotype/src/index.ts";
import {
  LOD_SIZES,
  SWEEP_LABELS,
  activityMetric,
  luminance,
  renderPlated,
  silhouette,
  silhouetteIoU,
} from "./render.ts";

const OUT = "/sdcard/DEE/review/plated/";
mkdirSync(OUT, { recursive: true });

const samples = platedSweep();
const flips = flipSamples();
const pair = continuityPair();

interface Img {
  label: string;
  size: number;
  b64: string;
}
const imgs: Img[] = [];
const toB64 = (rgb: Uint8Array): string => Buffer.from(rgb).toString("base64");

for (const s of samples) {
  for (const size of LOD_SIZES) {
    const p = renderPlated(s.res, s.m, size);
    imgs.push({ label: `${s.label}@${size}`, size, b64: toB64(p.rgb) });
  }
}
// Flip strip at 128 (out-of-basin honesty evidence) + continuity + mono.
const mono: Img[] = [];
for (const s of samples) {
  const p = renderPlated(s.res, s.m, 128);
  const lum = luminance(p);
  const rgb = new Uint8Array(128 * 128 * 3);
  for (let i = 0; i < lum.length; i++) {
    rgb[i * 3] = lum[i]!;
    rgb[i * 3 + 1] = lum[i]!;
    rgb[i * 3 + 2] = lum[i]!;
  }
  mono.push({ label: `${s.label}-mono@128`, size: 128, b64: toB64(rgb) });
}
for (const f of flips) {
  // Honesty rendering: what M0/M1 actually resolve to (blob, monochrome grid).
  const g = renderPhenotypeGrid(f.res, "inspection", "active");
  const rgb = new Uint8Array(13 * 13 * 3);
  g.cells.forEach((b, i) => {
    if (b) {
      rgb[i * 3] = 230;
      rgb[i * 3 + 1] = 242;
      rgb[i * 3 + 2] = 234;
    }
  });
  imgs.push({ label: `${f.label}-flip@13`, size: 13, b64: toB64(rgb) });
}
const pc = renderPlated(pair.parent.res, pair.parent.m, 128);
const cc = renderPlated(pair.child.res, pair.parent.m, 128);
imgs.push({ label: "parent-M2@128", size: 128, b64: toB64(pc.rgb) });
imgs.push({ label: "child-M2mut@128", size: 128, b64: toB64(cc.rgb) });

// Metrics for the manifest.
const metrics128 = samples.map((s) => {
  const p = renderPlated(s.res, s.m, 128);
  return { label: s.label, m: s.m, raw: s.metabolismRaw, activity: activityMetric(p) };
});
const sils = samples.map((s) => silhouette(renderPlated(s.res, s.m, 128)));
let minIoU = 1;
for (let i = 1; i < sils.length; i++) minIoU = Math.min(minIoU, silhouetteIoU(sils[0]!, sils[i]!));
const childIoU = silhouetteIoU(silhouette(pc), silhouette(cc));

const payload = JSON.stringify({ imgs, mono });
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plated metabolism proof — M0..M4</title>
<style>
body{background:#070c11;color:#cfe0d8;font:14px/1.4 system-ui,sans-serif;margin:0 auto;max-width:1400px;padding:24px}
h1,h2{color:#eafff3} .note{color:#8fa8a0;font-size:.82rem}
.strip{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin:10px 0 26px}
figure{margin:0;text-align:center} figcaption{font-size:.72rem;color:#9fb8ad}
canvas{image-rendering:pixelated;background:#060b0f;border:1px solid #1d2f3a}
table{border-collapse:collapse;margin:10px 0;font-size:.8rem}
td,th{border:1px solid #1d2f3a;padding:4px 10px} th{color:#7fd4c1}
</style>
</head>
<body>
<h1>Plated metabolism proof — one lineage, M2..M4 (+ M0/M1 flip evidence)</h1>
<p class="note">Isolated evidence prototype (NOT production). Structure is fixed by family +
quantized inputs; only internal activity follows raw metabolism. No sim changes.</p>
<h2>Progression strips M2..M4 (128 / 64 / 32 / 16)</h2>
<div class="strip" id="s128"></div>
<div class="strip" id="s64"></div>
<div class="strip" id="s32"></div>
<div class="strip" id="s16"></div>
<h2>Out-of-basin flip (M0/M1 resolve blob — founder and anchored; not faked)</h2>
<p class="note">The specified M0/M1 cannot hold Plated under the accepted hysteresis model. Shown here so the gap is visible, not hidden.</p>
<div class="strip" id="flip"></div>
<h2>Review sheet (128 shown at 384, nearest-neighbor)</h2>
<div class="strip" id="review"></div>
<h2>Parent → descendant continuity (M2 → +6% metabolism mutation)</h2>
<div class="strip" id="cont"></div>
<h2>Monochrome structural comparison (silhouette must not depend on color)</h2>
<div class="strip" id="mono"></div>
<h2>Parameter manifest</h2>
<table><tr><th>sample</th><th>M (norm)</th><th>metabolism raw</th><th>activity metric</th></tr>
${metrics128.map((r) => `<tr><td>${r.label}</td><td>${r.m}</td><td>${r.raw.toFixed(4)}</td><td>${r.activity.toFixed(4)}</td></tr>`).join("\n")}
${flips.map((f) => `<tr><td>${f.label} (flip)</td><td>${f.m}</td><td>${f.metabolismRaw.toFixed(4)}</td><td>— (resolves ${f.founderFamily})</td></tr>`).join("\n")}
</table>
<p class="note">Silhouette IoU vs M0 (min over sweep): ${minIoU.toFixed(3)}. Parent/child IoU: ${childIoU.toFixed(3)}.</p>
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
function fig(entry, scale) {
  const cv = document.createElement('canvas');
  cv.width = entry.size; cv.height = entry.size;
  cv.style.width = (entry.size * scale) + 'px';
  cv.style.height = (entry.size * scale) + 'px';
  const ctx = cv.getContext('2d');
  ctx.putImageData(new ImageData(b64ToRgba(entry.b64, entry.size), entry.size, entry.size), 0, 0);
  const f = document.createElement('figure'); f.appendChild(cv);
  const c = document.createElement('figcaption'); c.textContent = entry.label; f.appendChild(c);
  return f;
}
const byLabel = (l) => DATA.imgs.find((e) => e.label === l);
['s128', 's64', 's32', 's16'].forEach((id) => {
  const size = Number(id.slice(1));
  const host = document.getElementById(id);
  ['M2', 'M3', 'M4'].forEach((m) => host.appendChild(fig(byLabel(m + '@' + size), size <= 32 ? 4 : 2)));
});
const flipHost = document.getElementById('flip');
['M0', 'M1'].forEach((m) => flipHost.appendChild(fig(byLabel(m + '-flip@13'), 8)));
const rev = document.getElementById('review');
['M2', 'M3', 'M4'].forEach((m) => rev.appendChild(fig(byLabel(m + '@128'), 3)));
const cont = document.getElementById('cont');
cont.appendChild(fig(byLabel('parent-M2@128'), 2));
cont.appendChild(fig(byLabel('child-M2mut@128'), 2));
const mon = document.getElementById('mono');
DATA.mono.forEach((e) => mon.appendChild(fig(e, 2)));
</script>
</body>
</html>`;
writeFileSync(OUT + "plated-proof.html", html);
writeFileSync(OUT + "plated-pixels.json", JSON.stringify({ meta: metrics128, minIoU, childIoU }));
console.log(`plated evidence -> ${OUT} (${imgs.length} color + ${mono.length} mono images)`);
console.log("activity:", metrics128.map((r) => `${r.label}=${r.activity.toFixed(4)}`).join(" "));
console.log(`silhouette IoU min vs M2: ${minIoU.toFixed(3)}; parent/child: ${childIoU.toFixed(3)}`);
