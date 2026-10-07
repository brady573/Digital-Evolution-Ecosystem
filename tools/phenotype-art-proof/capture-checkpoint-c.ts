import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { renderPhenotypeGrid } from "../../packages/phenotype/src/renderer.ts";
import {
  MATERIAL_ROLE_IDS,
  PROCEDURAL_ART_VERSION,
  applyMaterialRoles,
  buildArtRecipe,
  materializeRaster,
  rasterizeStructuralArt,
  resolveArtLod,
  scaleRasterNearest,
  type ProceduralPhenotypeRaster,
  type StructuralArtRecipe,
} from "../../packages/phenotype/src/art/index.ts";
import { platedCenterFixture } from "./fixture.ts";

const outputDir = resolve(process.argv[2] ?? "/tmp/opencode/phenotype-art-proof-checkpoint-c");
const referencePath = resolve(process.argv[3] ?? "/sdcard/DEE/review/plated/reference-crop.png");
mkdirSync(outputDir, { recursive: true });

const sha256 = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex");

function pngChunk(type: string, data: Uint8Array): Buffer {
  const name = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  name.copy(chunk, 4);
  Buffer.from(data).copy(chunk, 8);
  const crcInput = chunk.subarray(4, 8 + data.length);
  let crc = 0xffffffff;
  for (const byte of crcInput) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return chunk;
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) throw new Error("PNG input does not match its dimensions");
  const stride = width * 4;
  const scanlines = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    scanlines[row] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(scanlines, row + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

function maskPng(raster: ProceduralPhenotypeRaster, kind: "silhouette" | "depth" | "ownership" | "boundary"): Buffer {
  const { width, height, masks } = raster;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const offset = i * 4;
    if (kind === "silhouette") {
      const value = masks.silhouette[i] ? 238 : 16;
      rgba.set([value, value, value, 255], offset);
    } else if (kind === "depth") {
      const owner = masks.ownership[i]!;
      const colors = [[53, 85, 128], [83, 151, 191], [156, 218, 229]] as const;
      const color = owner < 0 ? [16, 20, 26] : colors[Math.min(2, masks.depth[i]!)]!;
      rgba.set([...color, 255], offset);
    } else if (kind === "ownership") {
      const owner = masks.ownership[i]!;
      if (owner < 0) rgba.set([16, 20, 26, 255], offset);
      else if (masks.materialRole[i] === MATERIAL_ROLE_IDS.interstitial) rgba.set([7, 19, 39, 255], offset);
      else {
        const seed = Math.imul(owner + 1, 0x9e3779b1) >>> 0;
        rgba.set([70 + (seed & 127), 70 + ((seed >>> 8) & 127), 70 + ((seed >>> 16) & 127), 255], offset);
      }
    } else {
      const x = i % width;
      const y = Math.floor(i / width);
      const owner = masks.ownership[i]!;
      let boundary = false;
      if (owner >= 0 && masks.silhouette[i] === 1) {
        const neighbors = [x > 0 ? i - 1 : -1, x + 1 < width ? i + 1 : -1,
          y > 0 ? i - width : -1, y + 1 < height ? i + width : -1];
        boundary = neighbors.some((neighbor) => neighbor >= 0 && masks.ownership[neighbor] !== owner
          && (masks.silhouette[neighbor] === 1 || masks.materialRole[neighbor] === MATERIAL_ROLE_IDS.interstitial));
      }
      rgba.set(boundary ? [235, 244, 248, 255] : [16, 20, 26, 255], offset);
    }
  }
  return encodePng(width, height, rgba);
}

function ecosystemRaster(resolved: ReturnType<typeof platedCenterFixture>): ProceduralPhenotypeRaster {
  const grid = renderPhenotypeGrid(resolved, "ecosystem", "active");
  if (grid.size !== 9 || grid.cells.length !== 81) throw new Error("Accepted ecosystem renderer no longer yields 9×9");
  const rgba = new Uint8Array(9 * 9 * 4);
  const silhouette = new Uint8Array(81);
  const ownership = new Int16Array(81);
  ownership.fill(-1);
  const depth = new Uint8Array(81);
  const materialRole = new Uint8Array(81);
  for (let i = 0; i < 81; i++) {
    const value = grid.cells[i] ? 230 : 16;
    rgba.set([value, value, value, 255], i * 4);
    silhouette[i] = Number(grid.cells[i]);
  }
  return { width: 9, height: 9, rgba, masks: { silhouette, ownership, depth, materialRole } };
}

function recordRaster(name: string, raster: ProceduralPhenotypeRaster, files: Map<string, Buffer>): object {
  const png = encodePng(raster.width, raster.height, raster.rgba);
  files.set(name, png);
  return {
    file: name,
    width: raster.width,
    height: raster.height,
    format: "RGBA8",
    rgbaSha256: sha256(raster.rgba),
    pngSha256: sha256(png),
  };
}

function renderPage(input: {
  readonly reference: Buffer;
  readonly ecosystem: Buffer;
  readonly population: Buffer;
  readonly inspection: Buffer;
  readonly manifest: object;
}): string {
  const uri = (data: Buffer): string => `data:image/png;base64,${data.toString("base64")}`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plated Checkpoint C — LOD continuity</title><style>
  *{box-sizing:border-box}body{margin:0;padding:22px;background:#080e16;color:#e2eaf0;font:14px/1.45 system-ui,sans-serif}h1{margin:0 0 4px}h2{font-size:17px}.notice{padding:10px;border:1px solid #7d6a36;background:#251f12;color:#f1dba0}p{color:#a8b6c2}.sheet{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0}.panel{min-width:0;padding:12px;background:#0e1722;border:1px solid #2b3948}.panel img{display:block;width:100%;max-width:340px;margin:8px auto;image-rendering:pixelated;image-rendering:crisp-edges}.ref{max-width:min(100%,600px);height:auto}.evidence{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.evidence figure{margin:0;padding:10px;background:#0e1722;border:1px solid #2b3948}.evidence img{max-width:100%;height:auto;image-rendering:pixelated}pre{white-space:pre-wrap;word-break:break-word;background:#0a1119;padding:12px;overflow:auto}@media(max-width:800px){.sheet,.evidence{grid-template-columns:1fr}}
  </style><body><h1>Plated procedural art — Checkpoint C: LOD continuity</h1><p>One resolved family-center phenotype and one source recipe feed both rich LODs. Ecosystem view is the unchanged accepted coarse renderer.</p><div class="notice"><strong>Calibration-only reference.</strong> The supplied reference is embedded unchanged and is not a production sprite or template.</div>
  <h2>Continuity sheet — ecosystem → population → inspection</h2><div class="sheet"><section class="panel"><h2>1 · Ecosystem · existing 9×9 active renderer</h2><img src="${uri(input.ecosystem)}" alt="Ecosystem renderer enlarged for review"><p>Native 9×9 coarse phenotype, nearest-neighbor review scale.</p></section><section class="panel"><h2>2 · Population · simplified structural view</h2><img src="${uri(input.population)}" alt="Population material view"><p>Native 64×64 recipe-derived view; structure retained, secondary/micro/highlight detail omitted.</p></section><section class="panel"><h2>3 · Inspection · full accepted Checkpoint A/B</h2><img src="${uri(input.inspection)}" alt="Inspection material view"><p>Native 128×128 full-detail continuity anchor.</p></section></div>
  <h2>Calibration reference — separate from the continuity sequence</h2><img class="ref" src="${uri(input.reference)}" alt="Plated calibration-only reference"><h2>Shared source and deterministic evidence</h2><pre>${JSON.stringify(input.manifest, null, 2)}</pre></body></html>`;
}

function renderContinuitySheet(ecosystem: Buffer, population: Buffer, inspection: Buffer): string {
  const image = (bytes: Buffer, x: number): string =>
    `<image x="${x}" y="78" width="340" height="340" preserveAspectRatio="xMidYMid meet" image-rendering="pixelated" href="data:image/png;base64,${bytes.toString("base64")}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="460" viewBox="0 0 1120 460"><rect width="100%" height="100%" fill="#080e16"/><g font-family="sans-serif" fill="#e2eaf0"><text x="24" y="34" font-size="24">Plated LOD continuity · same resolved phenotype / one source recipe</text><text x="24" y="62" font-size="16">Calibration progression: ecosystem → population → inspection · review enlargements are nearest-neighbor</text><text x="24" y="445" font-size="16">9×9 existing active renderer</text><text x="390" y="445" font-size="16">64×64 structure-only</text><text x="756" y="445" font-size="16">128×128 full A/B detail</text></g><g fill="#0e1722" stroke="#2b3948"><rect x="20" y="72" width="350" height="360"/><rect x="385" y="72" width="350" height="360"/><rect x="750" y="72" width="350" height="360"/></g>${image(ecosystem, 25)}${image(population, 390)}${image(inspection, 755)}</svg>`;
}

const resolved = platedCenterFixture();
const source = buildArtRecipe(resolved);
const populationLod = resolveArtLod(source, "population");
const inspectionLod = resolveArtLod(source, "inspection");
const populationRecipe = applyMaterialRoles(populationLod, resolved);
const inspectionRecipe = applyMaterialRoles(inspectionLod, resolved);
const ecosystem = ecosystemRaster(resolved);
const populationNeutral = rasterizeStructuralArt({ ...source, regions: populationLod.regions }, { width: 64, height: 64 });
const populationMaterial = materializeRaster(populationNeutral, populationRecipe);
const inspectionNeutral = rasterizeStructuralArt({ ...source, regions: inspectionLod.regions }, { width: 128, height: 128 });
const inspectionMaterial = materializeRaster(inspectionNeutral, inspectionRecipe);
const files = new Map<string, Buffer>();
const scaleAndRecord = (file: string, raster: ProceduralPhenotypeRaster, scale: number): object =>
  recordRaster(file, scaleRasterNearest(raster, scale), files);

const rasterEvidence = {
  ecosystem: recordRaster("ecosystem-native-9x9.png", ecosystem, files),
  ecosystemNearest: scaleAndRecord("ecosystem-nearest-8x.png", ecosystem, 8),
  populationNeutral: recordRaster("population-neutral-native-64.png", populationNeutral, files),
  populationMaterial: recordRaster("population-material-native-64.png", populationMaterial, files),
  populationNeutralNearest: scaleAndRecord("population-neutral-nearest-4x.png", populationNeutral, 4),
  populationMaterialNearest: scaleAndRecord("population-material-nearest-4x.png", populationMaterial, 4),
  inspectionNeutral: recordRaster("inspection-neutral-native-128.png", inspectionNeutral, files),
  inspectionMaterial: recordRaster("inspection-material-native-128.png", inspectionMaterial, files),
  inspectionNeutralNearest: scaleAndRecord("inspection-neutral-nearest-3x.png", inspectionNeutral, 3),
  inspectionMaterialNearest: scaleAndRecord("inspection-material-nearest-3x.png", inspectionMaterial, 3),
};

const maskEvidence: Record<string, object> = {};
for (const [lod, raster] of [["population", populationNeutral], ["inspection", inspectionNeutral]] as const) {
  for (const kind of ["silhouette", "ownership", "depth", "boundary"] as const) {
    const file = `${lod}-${kind}-mask.png`;
    const bytes = maskPng(raster, kind);
    files.set(file, bytes);
    maskEvidence[`${lod}${kind[0]!.toUpperCase()}${kind.slice(1)}`] = {
      file,
      pngSha256: sha256(bytes),
      rawMaskSha256: kind === "silhouette" ? sha256(raster.masks.silhouette)
        : kind === "ownership" ? sha256(Buffer.from(raster.masks.ownership.buffer, raster.masks.ownership.byteOffset, raster.masks.ownership.byteLength))
          : kind === "depth" ? sha256(raster.masks.depth) : undefined,
    };
  }
}

const sourceRecipeJson = `${JSON.stringify(source, null, 2)}\n`;
const sourceRecipeHash = sha256(sourceRecipeJson);
const sourceFiles = [
  "packages/phenotype/src/constants.ts",
  "packages/phenotype/src/index.ts",
  "packages/phenotype/src/model.ts",
  "packages/phenotype/src/renderer.ts",
  "packages/phenotype/src/art/index.ts",
  "packages/phenotype/src/art/families/plated.ts",
  "packages/phenotype/src/art/recipe.ts",
  "packages/phenotype/src/art/raster.ts",
  "packages/phenotype/src/art/material.ts",
  "packages/phenotype/src/art/types.ts",
  "packages/phenotype/src/art/version.ts",
  "tools/phenotype-art-proof/fixture.ts",
  "tools/phenotype-art-proof/capture-checkpoint-c.ts",
];
const sourceHashes = Object.fromEntries(sourceFiles.map((path) => [path, sha256(readFileSync(resolve(process.cwd(), path)))]));
const sourceStateSha256 = sha256(sourceFiles.map((path) => `${path}\0${sourceHashes[path]}\n`).join(""));
const retention = source.regions.map((region) => ({
  id: region.id,
  detail: region.detail,
  depth: region.depth,
  materialRole: region.materialRole,
  paintOrder: region.paintOrder,
  population: populationLod.regions.includes(region),
  inspection: inspectionLod.regions.includes(region),
}));
const referenceBytes = readFileSync(referencePath);
const referenceName = "reference-calibration-only.png";
const continuitySheetBytes = Buffer.from(renderContinuitySheet(
  files.get("ecosystem-nearest-8x.png")!,
  files.get("population-material-nearest-4x.png")!,
  files.get("inspection-material-nearest-3x.png")!,
));
const manifest = {
  checkpoint: "C — LOD continuity",
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  rendererVersion: PROCEDURAL_ART_VERSION,
  structuralVersion: source.structuralVersion,
  resolvedPhenotype: resolved,
  cosmeticSeed: resolved.cosmeticSeed,
  sourceRecipe: { file: "recipe.json", sha256: sourceRecipeHash, oneRecipeFeedsBothRichLods: populationLod.source === source && inspectionLod.source === source },
  sourceState: { kind: "generator-input-content-address", sha256: sourceStateSha256, files: sourceHashes },
  richLods: {
    population: { regionIds: populationLod.regions.map((region) => region.id), accentRoles: populationRecipe.accents.map((accent) => accent.role) },
    inspection: { regionIds: inspectionLod.regions.map((region) => region.id), accentRoles: inspectionRecipe.accents.map((accent) => accent.role) },
  },
  lodRetentionFile: "lod-retention.json",
  rasters: rasterEvidence,
  masks: maskEvidence,
  reference: { file: referenceName, role: "calibration-only-not-for-runtime", unchangedFileSha256: sha256(referenceBytes) },
  continuitySheet: { file: "checkpoint-c-continuity-sheet.svg", sha256: sha256(continuitySheetBytes) },
};

files.set("recipe.json", Buffer.from(sourceRecipeJson));
files.set("lod-retention.json", Buffer.from(`${JSON.stringify(retention, null, 2)}\n`));
files.set("manifest.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
files.set(referenceName, referenceBytes);
files.set("checkpoint-c-continuity-sheet.svg", continuitySheetBytes);
files.set("checkpoint-c-review.html", Buffer.from(renderPage({
  reference: referenceBytes,
  ecosystem: files.get("ecosystem-nearest-8x.png")!,
  population: files.get("population-material-nearest-4x.png")!,
  inspection: files.get("inspection-material-nearest-3x.png")!,
  manifest,
})));
for (const [name, bytes] of files) writeFileSync(resolve(outputDir, name), bytes);
console.log(`Checkpoint C LOD continuity evidence written to ${outputDir}`);
console.log(`Git head: ${manifest.gitHead}`);
console.log(`Source recipe SHA-256: ${sourceRecipeHash}`);
console.log(`Source-state SHA-256: ${sourceStateSha256}`);
