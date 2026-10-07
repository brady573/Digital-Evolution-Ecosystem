import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import {
  MATERIAL_ROLE_IDS,
  PROCEDURAL_ART_VERSION,
  applyMaterialRoles,
  buildArtRecipe,
  deriveMaterialRoleView,
  materializeRaster,
  rasterizeStructuralArt,
  resolveArtLod,
  scaleRasterNearest,
} from "../../packages/phenotype/src/art/index.ts";
import { platedCenterFixture } from "./fixture.ts";
import { buildGeometryReviewPage } from "./page.ts";

const outputDir = resolve(process.argv[2] ?? "/tmp/opencode/phenotype-art-proof-checkpoint-a");
const referencePath = resolve(process.argv[3] ?? "/sdcard/DEE/review/plated/reference-crop.png");
mkdirSync(outputDir, { recursive: true });

function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

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
  const stride = width * 4;
  const scanlines = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    scanlines[start] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(scanlines, start + 1);
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

const resolved = platedCenterFixture();
const recipe = buildArtRecipe(resolved);
const geometryRaster = rasterizeStructuralArt(recipe, { width: 128, height: 128 });
const materialRecipe = applyMaterialRoles(resolveArtLod(recipe, "inspection"), resolved);
const materialRaster = materializeRaster(geometryRaster, materialRecipe);
const nearestMaterial = scaleRasterNearest(materialRaster, 3);
const displayRoleIds = deriveMaterialRoleView(materialRaster);
const roleColorsById = Object.fromEntries(Object.entries(MATERIAL_ROLE_IDS).map(([role, id]) => [id, materialRecipe.palette[role as keyof typeof materialRecipe.palette]])) as Record<number, { r: number; g: number; b: number }>;
const roleMapRgba = new Uint8Array(materialRaster.width * materialRaster.height * 4);
for (let pixel = 0; pixel < materialRaster.width * materialRaster.height; pixel++) {
  const color = roleColorsById[displayRoleIds[pixel]!] ?? { r: 16, g: 20, b: 26 };
  roleMapRgba[pixel * 4] = color.r;
  roleMapRgba[pixel * 4 + 1] = color.g;
  roleMapRgba[pixel * 4 + 2] = color.b;
  roleMapRgba[pixel * 4 + 3] = 255;
}
const roleMapRaster = { ...materialRaster, rgba: roleMapRgba };
const nearestGeometry = scaleRasterNearest(geometryRaster, 3);
const recipeJson = JSON.stringify(recipe);
const geometryPng = encodePng(geometryRaster.width, geometryRaster.height, geometryRaster.rgba);
const geometryNearestPng = encodePng(nearestGeometry.width, nearestGeometry.height, nearestGeometry.rgba);
const materialPng = encodePng(materialRaster.width, materialRaster.height, materialRaster.rgba);
const materialNearestPng = encodePng(nearestMaterial.width, nearestMaterial.height, nearestMaterial.rgba);
const roleMapPng = encodePng(roleMapRaster.width, roleMapRaster.height, roleMapRaster.rgba);
const referenceBytes = readFileSync(referencePath);
const referenceName = "reference-calibration-only.png";

const sourceFiles = [
  "packages/phenotype/src/constants.ts",
  "packages/phenotype/src/index.ts",
  "packages/phenotype/src/model.ts",
  "packages/phenotype/src/art/index.ts",
  "packages/phenotype/src/art/families/plated.ts",
  "packages/phenotype/src/art/recipe.ts",
  "packages/phenotype/src/art/raster.ts",
  "packages/phenotype/src/art/material.ts",
  "packages/phenotype/src/art/types.ts",
  "packages/phenotype/src/art/version.ts",
  "tools/phenotype-art-proof/capture.ts",
  "tools/phenotype-art-proof/fixture.ts",
  "tools/phenotype-art-proof/page.ts",
];
const sourceHashes = Object.fromEntries(sourceFiles.map((path) => [path, sha256(readFileSync(resolve(process.cwd(), path)))]));
const sourceStateSha256 = sha256(sourceFiles.map((path) => `${path}\0${sourceHashes[path]}\n`).join(""));
const maskHashes = {
  silhouette: sha256(geometryRaster.masks.silhouette),
  ownership: sha256(Buffer.from(geometryRaster.masks.ownership.buffer, geometryRaster.masks.ownership.byteOffset, geometryRaster.masks.ownership.byteLength)),
  depth: sha256(geometryRaster.masks.depth),
  materialRole: sha256(geometryRaster.masks.materialRole),
};
const materialMaskHashes = {
  silhouette: sha256(materialRaster.masks.silhouette),
  ownership: sha256(Buffer.from(materialRaster.masks.ownership.buffer, materialRaster.masks.ownership.byteOffset, materialRaster.masks.ownership.byteLength)),
  depth: sha256(materialRaster.masks.depth),
  materialRole: sha256(materialRaster.masks.materialRole),
};
const unchangedMasks = Object.keys(maskHashes).every((key) =>
  maskHashes[key as keyof typeof maskHashes] === materialMaskHashes[key as keyof typeof materialMaskHashes]);
const sortedRegions = [...recipe.regions].sort((a, b) => a.paintOrder - b.paintOrder);
const appliedAccentCount = materialRecipe.accents.filter((accent) => {
  const ownerIndex = sortedRegions.findIndex((region) => region.id === accent.regionId);
  const x = Math.floor(accent.x * materialRaster.width);
  const y = Math.floor(accent.y * materialRaster.height);
  return x >= 0 && y >= 0 && x < materialRaster.width && y < materialRaster.height
    && materialRaster.masks.ownership[y * materialRaster.width + x] === ownerIndex;
}).length;
const roleCounts = Object.fromEntries(Object.entries(MATERIAL_ROLE_IDS).map(([role, id]) => [
  role,
  displayRoleIds.filter((value) => value === id).length,
]));
const structuralRoleMaskCounts = Object.fromEntries(Object.entries(MATERIAL_ROLE_IDS).map(([role, id]) => [
  role,
  materialRaster.masks.materialRole.filter((value) => value === id).length,
]));
const manifest = {
  baseGitHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sourceState: { kind: "generator-input-content-address", sha256: sourceStateSha256, files: sourceHashes },
  rendererVersion: PROCEDURAL_ART_VERSION,
  structuralVersion: recipe.structuralVersion,
  resolvedPhenotype: resolved,
  cosmeticSeed: resolved.cosmeticSeed,
  geometry: {
    status: "checkpoint-a-accepted-unchanged",
    recipeSha256: sha256(recipeJson),
    nativeRgbaSha256: sha256(geometryRaster.rgba),
    nativePng: { file: "geometry-neutral-native-128.png", sha256: sha256(geometryPng) },
    nearest3x: { file: "geometry-neutral-nearest-3x.png", sha256: sha256(geometryNearestPng) },
  },
  material: {
    width: materialRaster.width,
    height: materialRaster.height,
    format: "RGBA8",
    renderer: "deterministic CPU colorization over frozen structural masks",
    rgbaSha256: sha256(materialRaster.rgba),
    nativePng: { file: "material-native-128.png", sha256: sha256(materialPng) },
    nearest3x: { file: "material-nearest-3x.png", width: nearestMaterial.width, height: nearestMaterial.height, sha256: sha256(materialNearestPng) },
    roleMap: { file: "material-role-map.png", sha256: sha256(roleMapPng) },
    displayedRoleCounts: roleCounts,
    unchangedStructuralRoleMaskCounts: structuralRoleMaskCounts,
    accents: materialRecipe.accents,
    accentCandidates: materialRecipe.accents.length,
    accentsAppliedToExistingOwners: appliedAccentCount,
  },
  maskEvidence: {
    preservedByteForByte: unchangedMasks,
    before: maskHashes,
    after: materialMaskHashes,
    interstitialPixelCount: roleCounts.interstitial ?? 0,
    interstitialDisplayDerivation: "mask-derived enclosed negative-space tint; original ownership/silhouette/materialRole buffers unchanged",
  },
  recipeSha256: sha256(recipeJson),
  reference: { file: referenceName, role: "calibration-only-not-for-runtime", unchangedFileSha256: sha256(referenceBytes) },
};

writeFileSync(resolve(outputDir, "recipe.json"), `${JSON.stringify(recipe, null, 2)}\n`);
writeFileSync(resolve(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(resolve(outputDir, "geometry-neutral-native-128.png"), geometryPng);
writeFileSync(resolve(outputDir, "geometry-neutral-nearest-3x.png"), geometryNearestPng);
writeFileSync(resolve(outputDir, "material-native-128.png"), materialPng);
writeFileSync(resolve(outputDir, "material-nearest-3x.png"), materialNearestPng);
writeFileSync(resolve(outputDir, "material-role-map.png"), roleMapPng);
copyFileSync(referencePath, resolve(outputDir, referenceName));
writeFileSync(resolve(outputDir, "checkpoint-b.html"), buildGeometryReviewPage(resolved, recipe, {
  referenceDataUrl: `data:image/png;base64,${referenceBytes.toString("base64")}`,
  geometryRasterDataUrl: `data:image/png;base64,${geometryPng.toString("base64")}`,
  materialRasterDataUrl: `data:image/png;base64,${materialPng.toString("base64")}`,
  nearestMaterialDataUrl: `data:image/png;base64,${materialNearestPng.toString("base64")}`,
  roleMapDataUrl: `data:image/png;base64,${roleMapPng.toString("base64")}`,
}));
console.log(`Checkpoint B material evidence written to ${outputDir}`);
console.log(`Generator source content SHA-256: ${sourceStateSha256}`);
