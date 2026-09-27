/**
 * Material-round 2 evidence: the ACCEPTED packed-cluster geometry with the
 * refined material treatment — calmer whole-compartment interiors, stronger
 * dome/creases, cool-only plate palette, spherical warm beads, pearly caps —
 * plus the M0–M4 sweep, the LOD ladder, the three bounded round-2 variants
 * (Specular-Refined / Pearl-Bed Emphasis / Shell-Clarity), and the
 * silhouette parity proof (rendered mask == gate raster).
 *
 * Run: pnpm exec tsx tools/plated-proof/material-candidates.ts
 * Writes: /sdcard/DEE/review/plated/material-candidates.html
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { activityMetric, renderPlated, type MaterialVariant } from "./render.ts";
import {
  BED,
  GEOMETRY_SEED,
  geometrySilhouette,
  layoutPlates,
  rasterizeGeometry,
} from "./geometry.ts";
import { platedSweep } from "./fixtures.ts";

const OUT = "/sdcard/DEE/review/plated/";
mkdirSync(OUT, { recursive: true });

const toB64 = (rgb: Uint8Array): string => Buffer.from(rgb).toString("base64");
const SIZE = 128;

interface Shot {
  label: string;
  size: number;
  b64: string;
  /** Display scale (nearest-neighbor), default 1. */
  scale?: number;
}

const samples = platedSweep();
const m2 = samples.find((s) => s.label === "M2")!;
const hero: MaterialVariant = "specular";
/** Display names for the bounded round-2 variant set (handoff §5). */
const VARIANT_NAMES: Record<MaterialVariant, string> = {
  specular: "Specular-Refined",
  pearlbed: "Pearl-Bed Emphasis",
  clarity: "Shell-Clarity",
};

/** Silhouette as a flat mask image (white plates, grey bed, black bg). */
function maskShot(rgb: Uint8Array, kind: Uint8Array): string {
  const out = new Uint8Array(rgb.length);
  for (let i = 0; i < kind.length; i++) {
    if (kind[i] === 0) continue;
    const v = kind[i] === 1 ? [120, 140, 160] : [230, 236, 242];
    out[i * 3] = v[0]!;
    out[i * 3 + 1] = v[1]!;
    out[i * 3 + 2] = v[2]!;
  }
  return toB64(out);
}

// Hero: M2 in the carried-forward hero material, native + the parity mask.
const heroPx = renderPlated(m2.res, m2.m, SIZE, hero);
const shots: Record<string, Shot[]> = {
  hero: [{ label: `M2 ${hero}@${SIZE}`, size: SIZE, b64: toB64(heroPx.rgb) }],
  // Three material variants at 3x: same inputs, same masks, material differs.
  variants: (["specular", "pearlbed", "clarity"] as const).map((v) => ({
    label: v === hero ? `${VARIANT_NAMES[v]} (hero pick)` : VARIANT_NAMES[v],
    size: SIZE,
    b64: toB64(renderPlated(m2.res, m2.m, SIZE, v).rgb),
    scale: 3,
  })),
  // M0..M4 ascending: metabolism-as-emission read at fixed geometry.
  sweep: [...samples].sort((a, b) => a.m - b.m).map((s) => {
    const px = renderPlated(s.res, s.m, SIZE, hero);
    return {
      label: `${s.label} · activity ${activityMetric(px).toFixed(3)}`,
      size: SIZE,
      b64: toB64(px.rgb),
    };
  }),
  // LOD ladder: 128 native, smaller sizes upscaled to keep a common read.
  lods: [
    { n: 128, scale: 1 },
    { n: 64, scale: 2 },
    { n: 32, scale: 3 },
    { n: 16, scale: 4 },
  ].map(({ n, scale }) => ({
    label: `LOD ${n}`,
    size: n,
    b64: toB64(renderPlated(m2.res, m2.m, n, hero).rgb),
    scale,
  })),
  // Silhouette parity: gate raster vs rendered mask (identical by assertion).
  parity: [
    (() => {
      const g = rasterizeGeometry(layoutPlates(GEOMETRY_SEED), SIZE, BED);
      const sil = geometrySilhouette(g);
      const out = new Uint8Array(SIZE * SIZE * 3);
      for (let i = 0; i < sil.length; i++) {
        if (g.plateId[i] === -2) {
          out[i * 3] = 120; out[i * 3 + 1] = 140; out[i * 3 + 2] = 160;
        } else if (sil[i] === 1) {
          out[i * 3] = 230; out[i * 3 + 1] = 236; out[i * 3 + 2] = 242;
        }
      }
      return { label: "§15 gate raster mask", size: SIZE, b64: toB64(out) };
    })(),
    { label: `${hero}@${SIZE} rendered mask`, size: SIZE, b64: maskShot(heroPx.rgb, heroPx.kind) },
  ],
};

const payload = JSON.stringify(shots);
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plated material round 6 — Specular-Refined candidate</title>
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
<h1>Plated material round 6 — cobalt cellular shells around a recessed bead core</h1>
<p class="note">Round 6 answers the round-5 review (cells not polygonal
enough, beads too large/exposed, violet dominant, tips too cream, soft
bloom). Same accepted geometry (GEOMETRY_SEED = 7000, 11 plates), same
silhouette, 3×2 budget, metabolism-as-emission — material only,
Specular-Refined: closed cyan wall loops (highlights skip walls; walls
cyan at M2, pearl-white only at high M), quantized dome bands + binary
tiny specular (no radial bloom), violet ~1% of lit cells (beads + shadow
tint carry it), small-dark bead coupling, large beads confined to major
cavities, stronger top-silhouette margin, ~50% deep-occluded beads,
distal tip caps ≈6% of spine. Emission still scaling with M. The
rendered mask is asserted equal to the §15 gate raster at every LOD and
for every variant (validate.ts group 4b, 12 pairs, IoU 1.000).
Acceptance question: at first glance, does M2 read as cobalt cellular
shell plates surrounding a recessed mixed-color bead core with the §16
visual economy?</p>
<h2>Reference vs candidate at 3x (M2, Specular-Refined)</h2>
<div class="row"><figure class="ref"><img src="reference-crop.png" alt="approved Plated reference"><figcaption>approved reference</figcaption></figure><span id="big" style="display:contents"></span></div>
<h2>Hero at native 128px</h2>
<div class="row" id="hero"></div>
<h2>Material comparison sheet — three bounded variants at 3x (same inputs, same silhouette)</h2>
<div class="row" id="variants"></div>
<h2>M0–M4 sweep (metabolism-as-emission, fixed geometry)</h2>
<div class="row" id="sweep"></div>
<h2>LOD ladder (128 / 64 / 32 / 16)</h2>
<div class="row" id="lods"></div>
<h2>Silhouette parity — gate raster vs rendered mask</h2>
<div class="row" id="parity"></div>
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
function fig(entry, label) {
  const scale = entry.scale || 1;
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
for (const [id, key] of [['big', 'hero'], ['hero', 'hero'], ['variants', 'variants'],
  ['sweep', 'sweep'], ['lods', 'lods'], ['parity', 'parity']]) {
  const el = document.getElementById(id);
  DATA[key].forEach((s) => el.appendChild(fig(s)));
}
</script>
</body>
</html>`;
writeFileSync(OUT + "material-candidates.html", html);
console.log(`material round -> ${OUT}material-candidates.html`);
console.log(`hero: ${hero}; sweep: ${shots.sweep!.map((s) => s.label).join(" | ")}`);
