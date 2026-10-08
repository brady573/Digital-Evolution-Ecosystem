/**
 * AC #131 visual proof: transparent rich sprites composited over a world.
 *
 * The blocking defect was only ever visible against a background: opaque dark
 * texture cards overlapping each other and obscuring the world. Rendering the
 * organism on a flat backdrop hides exactly that, so this composites the real
 * production rasters over a representative world field at the actual gameplay
 * footprint and at a magnified one.
 *
 * Left column of each block is the corrected output. The "card" column is the
 * pre-fix behaviour, reconstructed by forcing unowned pixels back to the old
 * opaque (16,20,26,255) backdrop, so the defect and the fix are visible in one
 * image instead of requiring a rebuild to compare.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { renderPhenotypeGrid, resolvePhenotype, type ResolvedPhenotype } from "../packages/phenotype/src/index.ts";
import {
  applyMaterialRoles,
  buildArtRecipe,
  materializeRaster,
  rasterizeStructuralArt,
  resolveArtLod,
} from "../packages/phenotype/src/art/index.ts";

const FIXTURES = {
  blob: { speed: 1.56, sensing: 69.5, metabolism: 0.224, reproduction: 100, diet: 0.6, habitat: 0.6, byproductUse: 0.6, dormancyResponse: 0.8 },
  segmented: { speed: 2.5, sensing: 86.5, metabolism: 0.27, reproduction: 100, diet: 0.9, habitat: 1.5, byproductUse: 1.5, dormancyResponse: 0.8 },
  radial: { speed: 1.38, sensing: 149.4, metabolism: 0.247, reproduction: 100, diet: 0.6, habitat: 0.9, byproductUse: 1.5, dormancyResponse: 0.8 },
  paddled: { speed: 3.55, sensing: 115.4, metabolism: 0.371, reproduction: 100, diet: 1.5, habitat: 1.5, byproductUse: 1.5, dormancyResponse: 0.8 },
  plated: { speed: 1.4, sensing: 70, metabolism: 0.3392, reproduction: 100, diet: 0.675, habitat: 0.675, byproductUse: 0.68, dormancyResponse: 1 },
  branching: { speed: 1, sensing: 139.2, metabolism: 0.247, reproduction: 100, diet: 1.4, habitat: 1.4, byproductUse: 1.4, dormancyResponse: 0.8 },
} as const;

type Family = keyof typeof FIXTURES;
const FAMILIES = Object.keys(FIXTURES) as Family[];

function png(width: number, height: number, rgba: Uint8Array): Buffer {
  const table = Array.from({ length: 256 }, (_, index) => {
    let v = index;
    for (let b = 0; b < 8; b++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
    return v >>> 0;
  });
  const crc = (buf: Buffer) => {
    let v = 0xffffffff;
    for (const byte of buf) v = table[(v ^ byte) & 0xff]! ^ (v >>> 8);
    return (v ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const check = Buffer.alloc(4);
    check.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, check]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scan = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    scan[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(scan, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scan)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * A stand-in world field: layered terrain with grid variation and mottling, so
 * "is the world readable between organisms" is answerable by eye. It is not a
 * simulation rendering and claims nothing about ecology.
 */
function terrain(width: number, height: number, seed: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const grid = ((x >> 4) + (y >> 4)) % 2 === 0 ? 6 : 0;
      const mottle = ((x * 7 + y * 13 + seed) % 17) - 8;
      const r = 22 + grid + mottle;
      const g = 38 + grid * 2 + mottle;
      const b = 30 + grid + mottle;
      const o = (y * width + x) * 4;
      out[o] = Math.max(0, Math.min(255, r));
      out[o + 1] = Math.max(0, Math.min(255, g));
      out[o + 2] = Math.max(0, Math.min(255, b));
      out[o + 3] = 255;
    }
  }
  return out;
}

function richRaster(res: ResolvedPhenotype, tier: "population" | "inspection"): { rgba: Uint8Array; size: number; ownership: Int16Array } {
  const size = tier === "population" ? 64 : 128;
  const recipe = buildArtRecipe(res, "active");
  const view = resolveArtLod(recipe, tier);
  const neutral = rasterizeStructuralArt({ ...recipe, regions: view.regions }, { width: size, height: size });
  const rendered = materializeRaster(neutral, applyMaterialRoles(view, res));
  return { rgba: rendered.rgba, size, ownership: neutral.masks.ownership };
}

/** Gameplay footprint: world units per organism display, matching organisms.ts. */
function footprintWorldUnits(res: ResolvedPhenotype, tier: "population" | "inspection"): number {
  const grid = renderPhenotypeGrid(res, tier, "active");
  const fraction = tier === "ecosystem" ? 0.2 : tier === "population" ? 0.22 : 0.4;
  return grid.size * Math.max(2, 2.2 * fraction);
}

const outputDir = resolve(process.argv[2] ?? "/tmp/opencode/transparency-proof");
mkdirSync(outputDir, { recursive: true });

const TIER = (process.argv[3] as "population" | "inspection") ?? "inspection";
const SCALE = 2; // device pixels per world unit
const BLOCK_W = 96;
const BLOCK_H = 84;
const GAP = 6;
const headerH = 26;
const SHEET_H = headerH + (FAMILIES.length + 1) * (BLOCK_H + GAP);
const BLOCKS = 2;
const sheetW = BLOCKS * BLOCK_W + (BLOCKS + 1) * GAP;
const sheet = new Uint8Array(sheetW * SHEET_H * 4);
for (let p = 0; p < sheetW * SHEET_H; p++) {
  sheet[p * 4] = 8; sheet[p * 4 + 1] = 10; sheet[p * 4 + 2] = 13; sheet[p * 4 + 3] = 255;
}

function blit(dst: Uint8Array, dw: number, src: Uint8Array, sw: number, sh: number, ox: number, oy: number, forceOpaqueBackdrop: boolean, ownership: Int16Array) {
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const s = (y * sw + x) * 4;
      let alpha = src[s + 3]!;
      if (forceOpaqueBackdrop && ownership[y * sw + x]! < 0) {
        alpha = 255; // reconstruct the pre-fix opaque card
      }
      if (alpha === 0) continue;
      const tx = ox + x;
      const ty = oy + y;
      if (tx < 0 || ty < 0 || tx >= dw || ty >= SHEET_H) continue;
      const t = (ty * dw + tx) * 4;
      const a = alpha / 255;
      sheet[t] = Math.round(src[s]! * a + sheet[t]! * (1 - a));
      sheet[t + 1] = Math.round(src[s + 1]! * a + sheet[t + 1]! * (1 - a));
      sheet[t + 2] = Math.round(src[s + 2]! * a + sheet[t + 2]! * (1 - a));
      sheet[t + 3] = 255;
    }
  }
}

console.log(`${TIER} tier, ${SCALE} device px per world unit`);
console.log("family      footprint(world u)  card px  transparent px  visible px");

let row = 0;
for (const family of FAMILIES) {
  const res = resolvePhenotype({ ...FIXTURES[family] }, { organismId: 9100, lineageId: 5150 });
  const { rgba, size, ownership } = richRaster(res, TIER);
  const fw = footprintWorldUnits(res, TIER);
  const displayPx = Math.max(8, Math.round(fw * SCALE));

  // Count what actually reaches the framebuffer.
  let cardPx = 0;
  let transparent = 0;
  for (let p = 0; p < size * size; p++) {
    const owned = ownership[p]! >= 0;
    const alpha = rgba[p * 4 + 3]!;
    if (!owned && alpha !== 0) cardPx++;
    if (!owned && alpha === 0) transparent++;
  }
  console.log(`${family.padEnd(11)} ${fw.toFixed(1).padStart(8)}  ${String(cardPx).padStart(8)}  ${String(transparent).padStart(15)}  ${String(size * size - transparent).padStart(10)}`);

  // Block 0: dense world, corrected. Block 1: same world, pre-fix cards.
  for (const block of [0, 1]) {
    const ox = GAP + block * (BLOCK_W + GAP);
    const oy = headerH + row * (BLOCK_H + GAP);
    const bg = terrain(BLOCK_W, BLOCK_H, family.length * 31 + block);
    for (let p = 0; p < BLOCK_W * BLOCK_H; p++) {
      const t = ((oy + Math.floor(p / BLOCK_W)) * sheetW + ox + (p % BLOCK_W)) * 4;
      sheet[t] = bg[p * 4]!; sheet[t + 1] = bg[p * 4 + 1]!; sheet[t + 2] = bg[p * 4 + 2]!; sheet[t + 3] = 255;
    }
    // Scatter organisms at real display size so overlap is genuine.
    const spots: Array<[number, number]> = [
      [10, 10], [46, 16], [18, 44], [58, 50], [34, 30], [72, 24], [70, 68], [12, 68],
    ];
    const scaled = new Uint8Array(displayPx * displayPx * 4);
    for (let y = 0; y < displayPx; y++) {
      for (let x = 0; x < displayPx; x++) {
        // Nearest-neighbour downscale from the source raster.
        const sx = Math.min(size - 1, Math.floor((x * size) / displayPx));
        const sy = Math.min(size - 1, Math.floor((y * size) / displayPx));
        const s = (sy * size + sx) * 4;
        const d = (y * displayPx + x) * 4;
        scaled[d] = rgba[s]!; scaled[d + 1] = rgba[s + 1]!; scaled[d + 2] = rgba[s + 2]!; scaled[d + 3] = rgba[s + 3]!;
      }
    }
    const scaledOwnership = new Int16Array(displayPx * displayPx);
    for (let y = 0; y < displayPx; y++) {
      for (let x = 0; x < displayPx; x++) {
        const sx = Math.min(size - 1, Math.floor((x * size) / displayPx));
        const sy = Math.min(size - 1, Math.floor((y * size) / displayPx));
        scaledOwnership[y * displayPx + x] = ownership[sy * size + sx]!;
      }
    }
    for (const [px, py] of spots) {
      if (px + displayPx > BLOCK_W || py + displayPx > BLOCK_H) continue;
      blit(sheet, sheetW, scaled, displayPx, displayPx, ox + px, oy + py, block === 1, scaledOwnership);
    }
  }
  row++;
}

// Footer row: single magnified organism per family, corrected only.
for (const family of FAMILIES) {
  const res = resolvePhenotype({ ...FIXTURES[family] }, { organismId: 9100, lineageId: 5150 });
  const { rgba, size, ownership } = richRaster(res, TIER);
  const zoom = Math.max(1, Math.floor(Math.min(BLOCK_H, BLOCK_W) / size));
  const displayPx = size * zoom;
  if (displayPx > BLOCK_W || displayPx > BLOCK_H) continue;
  const ox = GAP + FAMILIES.indexOf(family) * (BLOCK_W + GAP) + Math.floor((BLOCK_W - displayPx) / 2);
  const oy = headerH + FAMILIES.length * (BLOCK_H + GAP) + Math.floor((BLOCK_H - displayPx) / 2);
  const bg = terrain(BLOCK_W, BLOCK_H, 7);
  for (let p = 0; p < BLOCK_W * BLOCK_H; p++) {
    const t = ((oy + Math.floor(p / BLOCK_W)) * sheetW + ox + (p % BLOCK_W)) * 4;
    sheet[t] = bg[p * 4]!; sheet[t + 1] = bg[p * 4 + 1]!; sheet[t + 2] = bg[p * 4 + 2]!; sheet[t + 3] = 255;
  }
  const zoomed = new Uint8Array(displayPx * displayPx * 4);
  const zoomOwn = new Int16Array(displayPx * displayPx);
  for (let y = 0; y < displayPx; y++) {
    for (let x = 0; x < displayPx; x++) {
      const s = (Math.floor(y / zoom) * size + Math.floor(x / zoom)) * 4;
      const d = (y * displayPx + x) * 4;
      zoomed[d] = rgba[s]!; zoomed[d + 1] = rgba[s + 1]!; zoomed[d + 2] = rgba[s + 2]!; zoomed[d + 3] = rgba[s + 3]!;
      zoomOwn[y * displayPx + x] = ownership[Math.floor(y / zoom) * size + Math.floor(x / zoom)]!;
    }
  }
  blit(sheet, sheetW, zoomed, displayPx, displayPx, ox, oy, false, zoomOwn);
}

const out = resolve(outputDir, `transparency-${TIER}.png`);
writeFileSync(out, png(sheetW, SHEET_H, Buffer.from(sheet)));
console.log(`\nblock 0 = corrected (transparent) | block 1 = reconstructed pre-fix opaque cards`);
console.log(`footer  = magnified silhouettes, corrected only`);
console.log(`written ${out}`);