/**
 * Art-review viewer gate: the handoff deliverable (Gallery/Evolution/World)
 * is generated, so its controls and payload stay exercised deterministically.
 *
 * Checks (static DOM + parsed payload, no browser needed):
 * - three mode tabs, five zoom stops, zoom->tier map, all selectors,
 *   phone frame, dual scene-class labels, separation prose, pixelated sampling;
 * - payload parses: 6 matrix families, 4 lineage cases x 3 tiers,
 *   >=1 design-fixture and >=1 current-engine scene, tuning present;
 * - evidence.json agrees with the viewer payload on scene list.
 *
 * Run: pnpm test:art-review
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../packages/phenotype/evidence");
const html = readFileSync(join(root, "viewer.html"), "utf8");

function has(fragment: string, label: string): void {
  assert.ok(html.includes(fragment), `viewer missing ${label}`);
}

has('id="tab-gallery"', "gallery tab");
has('id="tab-evolution"', "evolution tab");
has('id="tab-world"', "world tab");
for (const z of ["1.0", "1.5", "2.0", "2.5", "3.0"]) {
  assert.ok(html.includes(`>${z}</option>`), `viewer missing zoom stop ${z}`);
}
for (const [z, t] of [["1.0", "ecosystem"], ["1.5", "ecosystem"], ["2.0", "population"], ["2.5", "population"], ["3.0", "inspection"]] as const) {
  assert.ok(html.includes(`"${z}":"${t}"`), `viewer missing zoom->tier ${z}x>${t}`);
}
for (const id of ["ctl-family", "ctl-zoom", "ctl-activity", "ctl-expr", "ctl-color", "ctl-lineage", "ctl-scene", "ctl-phone", "tier-pill"]) {
  has(`id="${id}"`, `control ${id}`);
}
for (const f of ["blob", "segmented", "radial", "plated", "branching", "paddled"]) {
  assert.ok(html.includes(`<option>${f}</option>`), `viewer missing family option ${f}`);
}
has("DESIGN FIXTURE", "design-fixture label");
has("CURRENT-ENGINE", "current-engine label");
has("390px", "phone frame");
has('getContext("2d")', "canvas 2D drawing");
has("image-rendering:pixelated", "pixelated sampling");
has("never turns analysis labels into morphology", "separation prose");

const dStart = html.indexOf("const DATA = ");
assert.ok(dStart >= 0, "viewer payload block not found");
const dEnd = html.indexOf(";\nconst ART = ", dStart);
assert.ok(dEnd > dStart, "viewer ART payload block not found");
const data = JSON.parse(html.slice(dStart + "const DATA = ".length, dEnd)) as {
  shots: Array<{ section: string; key: string; tier: string; family: string }>;
  scenes: Array<{ name: string; source: string; population: number }>;
  tuning: Record<string, unknown>;
};
const matrixFams = new Set(data.shots.filter((s) => s.section === "matrix").map((s) => s.family));
assert.equal(matrixFams.size, 6, `matrix must span 6 families (got ${matrixFams.size})`);
const lineageKeys = new Set(data.shots.filter((s) => s.section === "lineages").map((s) => s.key));
for (const c of ["stable", "directional", "near-boundary", "transition"]) {
  assert.ok(lineageKeys.has(c), `lineage case missing: ${c}`);
}
for (const c of ["stable", "directional", "near-boundary", "transition"]) {
  const tiers = new Set(data.shots.filter((s) => s.section === "lineages" && s.key === c).map((s) => s.tier));
  assert.deepEqual([...tiers].sort(), ["ecosystem", "inspection", "population"], `lineage ${c} must ship all 3 tiers`);
}
const sources = new Set(data.scenes.map((s) => s.source));
assert.ok(sources.has("design-fixture"), "need >=1 design-fixture scene");
assert.ok(sources.has("current-engine"), "need >=1 current-engine scene");
assert.ok(data.scenes.length >= 7, `expect >=7 scenes (got ${data.scenes.length})`);
assert.ok(data.tuning && typeof data.tuning === "object", "tuning section missing");

// Base family portraits: 6 families x 16/32/64/128, valid PNG data URIs.
const am = html.match(/const ART = (\{.*?\});/);
assert.ok(am, "viewer ART payload block not found");
const art = JSON.parse(am[1]) as Record<string, string>;
for (const f of ["blob", "segmented", "radial", "plated", "branching", "paddled"]) {
  for (const px of ["16", "32", "64", "128"]) {
    const uri = art[`${f}/${px}`];
    assert.ok(uri?.startsWith("data:image/png;base64,iVBOR"), `ART ${f}/${px} must be a PNG data URI`);
  }
}
assert.equal(Object.keys(art).length, 24, `ART payload must hold 24 portraits (got ${Object.keys(art).length})`);
assert.ok(html.includes("Owner base art only"), "gallery portrait block missing");
// Complete replacement: Gallery must not render the procedural matrix;
// dormancy pairs live in Evolution as labeled procedural transform evidence.
const gallerySrc = html.slice(html.indexOf("function renderGallery"), html.indexOf("function renderEvolution"));
assert.ok(!gallerySrc.includes('section==="matrix"'), "gallery must not render the procedural matrix");
assert.ok(!gallerySrc.includes('section==="dormancy"'), "gallery must not render dormancy pairs");
assert.ok(html.includes("Dormancy transforms (procedural"), "evolution dormancy block missing");
assert.ok(html.includes("img.mono"), "monochrome art filter missing");

const evidence = JSON.parse(readFileSync(join(root, "evidence.json"), "utf8")) as {
  sections: { scenes: Array<{ name: string }> };
};
const evNames = evidence.sections.scenes.map((s) => s.name).sort();
const vwNames = data.scenes.map((s) => s.name).sort();
assert.deepEqual(vwNames, evNames, "viewer scenes must agree with evidence.json");

console.log(`art-review viewer: PASS (${data.shots.length} shots, ${data.scenes.length} scenes, controls+tiers+labels verified)`);
