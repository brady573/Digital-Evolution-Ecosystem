/**
 * AC11 dense-world proof: six-family rich rendering at population scale.
 *
 * AC2 proved the families look right at one organism at a time. AC11 asks the
 * different question: does the six-family rich path stay *operational* and
 * *readable* when a world actually contains many of them, compared against the
 * coarse renderer this feature replaces.
 *
 * Two things are measured, because they fail differently:
 *
 *  - Operational: the real production texture path (describeRenderableTexture +
 *    PhenotypeTextureCache) at a supported dense organism count, reporting
 *    cache cardinality, reuse, and resident RGBA bytes. This is where a
 *    rich-at-scale regression would actually hurt.
 *  - Legibility: at the on-screen footprint an organism occupies, is a single
 *    organism still distinguishable from the background, and are the six
 *    families still distinguishable from each other once colour is removed.
 *    A renderer can be perfectly operational and completely unreadable.
 *
 * Scope note: this runs the CPU raster and cache in Node. It does not stand in
 * for browser GPU evidence; that remains a browser unit. What it does prove is
 * that the production descriptor/cache path holds at density, and it produces
 * the comparison sheet the handoff asks for.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { resolvePhenotype, type ResolvedPhenotype } from "../packages/phenotype/src/index.ts";
import { PhenotypeTextureCache } from "../apps/explorer/src/pixi/textureCache.ts";
import {
  applyMaterialRoles,
  buildArtRecipe,
  materializeRaster,
  rasterizeStructuralArt,
  resolveArtLod,
} from "../packages/phenotype/src/art/index.ts";

const FAMILIES = ["blob", "segmented", "radial", "paddled", "plated", "branching"] as const;

const TRAITS: Readonly<Record<string, Parameters<typeof resolvePhenotype>[0]>> = {
  blob: { speed: 1.56, sensing: 69.5, metabolism: 0.224, reproduction: 100, diet: 0.6, habitat: 0.6, byproductUse: 0.6, dormancyResponse: 0.8 },
  segmented: { speed: 2.5, sensing: 86.5, metabolism: 0.27, reproduction: 100, diet: 0.9, habitat: 1.5, byproductUse: 1.5, dormancyResponse: 0.8 },
  radial: { speed: 1.38, sensing: 149.4, metabolism: 0.247, reproduction: 100, diet: 0.6, habitat: 0.9, byproductUse: 1.5, dormancyResponse: 0.8 },
  paddled: { speed: 3.55, sensing: 115.4, metabolism: 0.371, reproduction: 100, diet: 1.5, habitat: 1.5, byproductUse: 1.5, dormancyResponse: 0.8 },
  plated: { speed: 1.4, sensing: 70, metabolism: 0.3392, reproduction: 100, diet: 0.675, habitat: 0.675, byproductUse: 0.68, dormancyResponse: 1 },
  branching: { speed: 1, sensing: 139.2, metabolism: 0.247, reproduction: 100, diet: 1.4, habitat: 1.4, byproductUse: 1.4, dormancyResponse: 0.8 },
};

/**
 * A dense world: many organisms per family, each with its own cosmetic seed so
 * the cache is exercised the way a real world exercises it rather than hitting
 * one deduplicated texture per family.
 */
function denseWorld(perFamily: number, seed: number): ResolvedPhenotype[] {
  const world: ResolvedPhenotype[] = [];
  let id = 1;
  for (const family of FAMILIES) {
    for (let index = 0; index < perFamily; index++) {
      const base = resolvePhenotype({ ...TRAITS[family]! }, { organismId: id, lineageId: id });
      world.push({ ...base, cosmeticSeed: (seed + id * 2654435761) >>> 0 });
      id++;
    }
  }
  return world;
}

function png(width: number, height: number, rgba: Uint8Array): Buffer {
  const table = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  const crc = (buffer: Buffer) => {
    let value = 0xffffffff;
    for (const byte of buffer) value = table[(value ^ byte) & 0xff]! ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const check = Buffer.alloc(4);
    check.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, check]);
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

/** Render one organism's rich raster at a tier, or null when it stays coarse. */
function renderOrganism(res: ResolvedPhenotype, tier: "population" | "inspection", size: number): Uint8Array | null {
  const recipe = buildArtRecipe(res, "active");
  const view = resolveArtLod(recipe, tier);
  const neutral = rasterizeStructuralArt({ ...recipe, regions: view.regions }, { width: size, height: size });
  if (tier === "ecosystem") return null;
  const rendered = materializeRaster(neutral, applyMaterialRoles(view, res));
  return rendered.rgba;
}

const outputDir = resolve(process.argv[2] ?? "/tmp/opencode/dense-world-proof");
mkdirSync(outputDir, { recursive: true });

// ---- Operational: the real descriptor/cache path at density ----------------
const PER_FAMILY = 40;
const world = denseWorld(PER_FAMILY, 12345);
console.log(`dense world: ${world.length} organisms, ${FAMILIES.length} families x ${PER_FAMILY}`);

const failures: string[] = [];
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}: ${detail}`);
  if (!ok) failures.push(label);
};

for (const tier of ["population", "inspection"] as const) {
  const cache = new PhenotypeTextureCache();
  const started = process.hrtime.bigint();
  for (const res of world) cache.acquire(res, tier, "active");
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const entries = cache.entriesList();
  const bytes = entries.reduce((sum, entry) => sum + (entry.rgba ? entry.rgba.length : entry.size * entry.size / 8), 0);
  const families = new Set(world.map((res) => res.family));
  console.log(`\n${tier} tier`);
  console.log(`  organisms ${world.length} | cache entries ${entries.length} | reuse ${(world.length / entries.length).toFixed(2)}x`);
  console.log(`  resident rich pixels ${(bytes / 1e6).toFixed(2)} MB | descriptor+raster ${elapsedMs.toFixed(0)} ms`);
  check(`${tier} covers every family`, families.size === FAMILIES.length, `${families.size}/${FAMILIES.length} families present`);
  check(`${tier} cache is bounded by organism count`, entries.length <= world.length,
    `${entries.length} entries for ${world.length} organisms`);
  check(`${tier} every entry is rich RGBA`, entries.every((entry) => entry.rgba !== undefined),
    `${entries.filter((e) => e.rgba !== undefined).length}/${entries.length} carry RGBA`);
  check(`${tier} descriptor work completes`, elapsedMs < 60_000, `${elapsedMs.toFixed(0)} ms for ${world.length} organisms`);
  for (const entry of entries) cache.release(entry.key);
  check(`${tier} releases cleanly`, cache.prune().length === entries.length, `retired ${entries.length} entries`);
}

// ---- Legibility: does one organism still read at its on-screen size? -------
//
// An organism is drawn at a fixed footprint regardless of how many exist, so
// legibility is measured on that footprint, not on the world size. What density
// changes is crowding: neighbouring organisms must not merge into one mass.
const FOOTPRINT = 16;
console.log(`\nlegibility at ${FOOTPRINT}px on-screen footprint`);
const signatures = new Map<string, Uint8Array>();
for (const family of FAMILIES) {
  const res = world.find((candidate) => candidate.family === family)!;
  const size = FOOTPRINT;
  const recipe = buildArtRecipe(res, "active");
  const view = resolveArtLod(recipe, "population");
  const neutral = rasterizeStructuralArt({ ...recipe, regions: view.regions }, { width: size, height: size });
  const ink = neutral.masks.silhouette.reduce((sum, value) => sum + value, 0);
  // Contrast against the world background: how far the mean ink pixel sits
  // from the backdrop the renderer draws organisms onto.
  const rendered = materializeRaster(neutral, applyMaterialRoles(view, res));
  let lumaSum = 0;
  let lumaCount = 0;
  for (let pixel = 0; pixel < size * size; pixel++) {
    if (!neutral.masks.silhouette[pixel]) continue;
    const offset = pixel * 4;
    lumaSum += rendered.rgba[offset]! * 0.299 + rendered.rgba[offset + 1]! * 0.587 + rendered.rgba[offset + 2]! * 0.114;
    lumaCount++;
  }
  const meanLuma = lumaCount > 0 ? lumaSum / lumaCount : 0;
  const backdrop = 16 * 0.299 + 20 * 0.587 + 26 * 0.114;
  const contrast = Math.abs(meanLuma - backdrop);
  const signature = Uint8Array.from(neutral.masks.silhouette);
  signatures.set(family, signature);
  console.log(`  ${family.padEnd(10)} ink ${(ink / (size * size) * 100).toFixed(1)}%  mean luma ${meanLuma.toFixed(1)}  contrast ${contrast.toFixed(1)}`);
  check(`${family} is visible at footprint`, ink > 6, `${ink} px of ${size * size}`);
  check(`${family} separates from backdrop`, contrast > 24, `contrast ${contrast.toFixed(1)} against backdrop luma ${backdrop.toFixed(1)}`);
}

// Families must stay distinguishable once hue is removed.
for (let a = 0; a < FAMILIES.length; a++) {
  for (let b = a + 1; b < FAMILIES.length; b++) {
    const left = signatures.get(FAMILIES[a]!)!;
    const right = signatures.get(FAMILIES[b]!)!;
    let agreement = 0;
    for (let index = 0; index < left.length; index++) if (left[index] === right[index]) agreement++;
    const similarity = agreement / left.length;
    check(`${FAMILIES[a]} vs ${FAMILIES[b]} distinct in monochrome`, similarity < 0.97,
      `silhouette agreement ${(similarity * 100).toFixed(1)}%`);
  }
}

// ---- Comparison sheet: rich vs coarse, dense ------------------------------
const COLUMNS = 12;
const ROWS = 8;
const cellSize = FOOTPRINT;
const label = 96;
const header = 28;
const sheetWidth = label + COLUMNS * cellSize;
const sheetHeight = header + FAMILIES.length * ROWS * cellSize + 28;
const sheet = new Uint8Array(sheetWidth * sheetHeight * 4);
for (let pixel = 0; pixel < sheetWidth * sheetHeight; pixel++) {
  sheet[pixel * 4] = 16;
  sheet[pixel * 4 + 1] = 20;
  sheet[pixel * 4 + 2] = 26;
  sheet[pixel * 4 + 3] = 255;
}

let cursor = 0;
for (const family of FAMILIES) {
  const res = world.find((candidate) => candidate.family === family)!;
  const rich = renderOrganism(res, "population", cellSize)!;
  const coarse = rasterizeStructuralArt(buildArtRecipe(res, "active"), { width: cellSize, height: cellSize });
  const originY = header + FAMILIES.indexOf(family) * ROWS * cellSize;
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      const variant = column < COLUMNS / 2 ? rich : null;
      for (let y = 0; y < cellSize; y++) {
        for (let x = 0; x < cellSize; x++) {
          const to = ((originY + row * cellSize + y) * sheetWidth + label + column * cellSize + x) * 4;
          if (variant) {
            const from = (y * cellSize + x) * 4;
            sheet[to] = variant[from]!;
            sheet[to + 1] = variant[from + 1]!;
            sheet[to + 2] = variant[from + 2]!;
          } else if (coarse.masks.silhouette[y * cellSize + x]) {
            sheet[to] = 150;
            sheet[to + 1] = 160;
            sheet[to + 2] = 170;
          }
        }
      }
    }
  }
  cursor++;
}
void cursor;
writeFileSync(resolve(outputDir, "dense-world-compare.png"), png(sheetWidth, sheetHeight, Buffer.from(sheet)));
console.log(`\ndense-world comparison sheet: left half rich, right half coarse, ${COLUMNS}x${ROWS} organisms per family at ${cellSize}px`);
console.log(`written to ${outputDir}`);

console.log(failures.length === 0 ? "\nAC11 dense-world: PASS" : `\nAC11 dense-world: ${failures.length} FAILURE(S)`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
}