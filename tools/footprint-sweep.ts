/**
 * LOD footprint sweep: density × tier coverage from existing evidence scenes.
 *
 * Reads packages/phenotype/evidence/evidence.json (no sim, no regen) and emits
 * a self-contained sweep page + machine numbers: for each scene × tier, at a
 * fixed world→pixel mapping, the fraction of canvas covered by phenotype
 * pixels. Footprint tuning (step 5 of the review response) gets decided on
 * these pictures and numbers, not intuition.
 *
 * Run: pnpm exec tsx tools/footprint-sweep.ts
 * Writes: /sdcard/DEE/review/footprint/{sweep.html,footprint.json}
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const OUT = "/sdcard/DEE/review/footprint/";
mkdirSync(OUT, { recursive: true });

interface SceneOrg { x: number; y: number; activity: string; family: string; eco: string; pop: string; insp: string }
interface Scene {
  name: string; source: "current-engine" | "design-fixture";
  tick: number; population: number; dormant: number;
  organisms: SceneOrg[];
}

const ev = JSON.parse(readFileSync("packages/phenotype/evidence/evidence.json", "utf8")) as {
  baseline: string;
  sections: { scenes: Array<{ name: string; source: string; tick: number; population: number; dormant: number }> };
};
const viewerSrc = readFileSync("packages/phenotype/evidence/viewer.html", "utf8");
const m = viewerSrc.match(/const DATA = (\{.*?\});\nconst TIER/);
if (!m) throw new Error("viewer payload not found");
const viewer = JSON.parse(m[1]) as { baseline: string; scenes: Scene[]; shots: unknown[] };

// Fixed mapping for the whole sweep: world 600 -> 240px.
const SCALE = 240 / 600;
const CELL: Record<string, number> = { eco: 2, pop: 1, insp: 1 };

interface SweepRow {
  scene: string; source: string; population: number; tier: string;
  gridSize: number; cellPx: number; footprintPx: number;
  paintedPx: number; coveragePct: number; perOrgPx: number;
}

const rows: SweepRow[] = [];
for (const sc of viewer.scenes) {
  for (const tier of ["eco", "pop", "insp"] as const) {
    const painted = new Set<number>();
    const cell = CELL[tier]!;
    let gridSize = 0;
    for (const o of sc.organisms) {
      const bits = o[tier];
      const n = Math.sqrt(bits.length);
      gridSize = n;
      for (let i = 0; i < bits.length; i++) {
        if (bits[i] !== "1") continue;
        const px = Math.round((o.x - (n * cell) / 2 + (i % n) * cell) * SCALE);
        const py = Math.round((o.y - (n * cell) / 2 + Math.floor(i / n) * cell) * SCALE);
        for (let dy = 0; dy < Math.max(1, Math.round(cell * SCALE)); dy++) {
          for (let dx = 0; dx < Math.max(1, Math.round(cell * SCALE)); dx++) {
            painted.add((py + dy) * 240 + (px + dx));
          }
        }
      }
    }
    const footprint = gridSize * cell;
    rows.push({
      scene: sc.name, source: sc.source, population: sc.population, tier,
      gridSize, cellPx: cell, footprintPx: footprint,
      paintedPx: painted.size,
      coveragePct: Math.round((painted.size / (240 * 240)) * 1000) / 10,
      perOrgPx: Math.round((painted.size / Math.max(1, sc.population)) * 10) / 10,
    });
  }
}

writeFileSync(OUT + "footprint.json", JSON.stringify({ baseline: ev.baseline, scale: SCALE, rows }, null, 2));

const payload = JSON.stringify({ scenes: viewer.scenes }).replace(/<\//g, "<\\/");
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LOD footprint sweep — ${ev.baseline}</title>
<style>
body{background:#070c11;color:#cfe0d8;font:14px/1.4 system-ui,sans-serif;margin:0 auto;max-width:1200px;padding:24px}
h1{color:#eafff3;font-size:1.2rem} .note{color:#8fa8a0;font-size:.82rem}
table{border-collapse:collapse;margin:12px 0;font-size:.8rem}
td,th{border:1px solid #1d2f3a;padding:4px 10px} th{color:#7fd4c1}
canvas{background:#060b0f;border:1px solid #1d2f3a;image-rendering:pixelated;margin:4px}
.cards{display:flex;flex-wrap:wrap;gap:14px} figure{margin:0;text-align:center}
figcaption{font-size:.72rem;color:#9fb8ad}
.src-design{color:#e7b36a} .src-engine{color:#7fd4c1}
</style>
</head>
<body>
<h1>LOD footprint sweep</h1>
<p class="note">Same scenes as the art-review viewer, fixed mapping (600 world → 240px).
Coverage = distinct painted px / canvas. Footprint = grid size × cell px per organism.
Decide zoom-vs-density footprint on these numbers, not intuition.</p>
<table><tr><th>scene</th><th>source</th><th>pop</th><th>tier</th><th>grid</th><th>cell</th><th>footprint px</th><th>coverage</th><th>px/org</th></tr>
${rows.map((r) => `<tr><td>${r.scene}</td><td class="${r.source === "design-fixture" ? "src-design" : "src-engine"}">${r.source}</td><td>${r.population}</td><td>${r.tier}</td><td>${r.gridSize}²</td><td>${r.cellPx}</td><td>${r.footprintPx}</td><td>${r.coveragePct}%</td><td>${r.perOrgPx}</td></tr>`).join("\n")}
</table>
<h2>Thumbnails (240px, same mapping)</h2>
<div class="cards" id="cards"></div>
<script>
const DATA = ${payload};
const SCALE = ${SCALE};
const CELL = { eco: 2, pop: 1, insp: 1 };
function draw(sc, tier) {
  const cv = document.createElement('canvas'); cv.width = 240; cv.height = 240;
  const x = cv.getContext('2d'); x.fillStyle = '#e6f2ea';
  const cell = CELL[tier];
  sc.organisms.forEach(o => {
    const bits = o[tier]; const n = Math.sqrt(bits.length);
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] !== '1') continue;
      const px = Math.round((o.x - (n * cell) / 2 + (i % n) * cell) * SCALE);
      const py = Math.round((o.y - (n * cell) / 2 + Math.floor(i / n) * cell) * SCALE);
      x.globalAlpha = o.activity === 'dormant' ? 0.6 : 1;
      x.fillRect(px, py, Math.max(1, Math.round(cell * SCALE)), Math.max(1, Math.round(cell * SCALE)));
    }
  });
  x.globalAlpha = 1;
  const f = document.createElement('figure'); f.appendChild(cv);
  const c = document.createElement('figcaption'); c.textContent = sc.name + ' · ' + tier; f.appendChild(c);
  return f;
}
const host = document.getElementById('cards');
DATA.scenes.forEach(sc => { ['eco', 'pop', 'insp'].forEach(t => host.appendChild(draw(sc, t))); });
</script>
</body>
</html>`;
writeFileSync(OUT + "sweep.html", html);
console.log(`footprint sweep: ${rows.length} rows -> ${OUT}`);
for (const r of rows.filter((x) => x.population >= 1000)) {
  console.log(` ${r.scene}/${r.tier}: coverage ${r.coveragePct}% (${r.paintedPx}px, ${r.perOrgPx}px/org)`);
}
