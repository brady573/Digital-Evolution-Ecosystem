/**
 * Branching proof capture — writes inspectable PNGs for human review.
 *
 * Assertions cannot establish that a new family *looks* like its design
 * description. This writes real materialized rasters to disk so the identity
 * claim can be reviewed by eye. Output goes to an operator-supplied directory;
 * nothing here is versioned evidence on its own.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { resolvePhenotype } from "../packages/phenotype/src/index.ts";
import {
  applyMaterialRoles,
  buildBranchingRecipe,
  materializeRaster,
  rasterizeStructuralArt,
  resolveArtLod,
} from "../packages/phenotype/src/art/index.ts";

const BASE = {
  speed: 1,
  sensing: 139.2,
  metabolism: 0.247,
  reproduction: 100,
  diet: 1.4,
  habitat: 1.4,
  byproductUse: 1.4,
  dormancyResponse: 0.8,
} as const;

function png(width: number, height: number, rgba: Uint8Array): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  const crc = (buffer: Buffer) => {
    let value = 0xffffffff;
    for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
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

const outputDir = resolve(process.argv[2] ?? "/tmp/opencode/branching-proof");
mkdirSync(outputDir, { recursive: true });

const variants: ReadonlyArray<[string, Partial<typeof BASE>]> = [
  ["active-baseline", {}],
  ["active-low-sensing", { sensing: 120 }],
  ["active-high-sensing", { sensing: 155 }],
  ["active-high-mobility", { speed: 1.7 }],
  ["active-low-specialization", { diet: 0.75, habitat: 0.75, byproductUse: 0.75 }],
  ["dormant-baseline", {}],
];

for (const [name, overrides] of variants) {
  const activity = name.startsWith("dormant") ? "dormant" : "active";
  const resolved = resolvePhenotype({ ...BASE, ...overrides },
    { parentFamily: "branching", organismId: 7100, lineageId: 4343 });
  if (resolved.family !== "branching") throw new Error(`${name} resolved to ${resolved.family}`);
  const recipe = buildBranchingRecipe(resolved, activity);
  for (const [lod, size] of [["population", 64], ["inspection", 128]] as const) {
    const view = resolveArtLod(recipe, lod);
    const neutral = rasterizeStructuralArt({ ...recipe, regions: view.regions }, { width: size, height: size });
    const rendered = materializeRaster(neutral, applyMaterialRoles(view, resolved));
    writeFileSync(resolve(outputDir, `branching-${name}-${lod}.png`), png(size, size, rendered.rgba));
    const silhouette = neutral.masks.silhouette.reduce((sum, value) => sum + value, 0);
    console.log(`${name}/${lod}: ${recipe.regions.length} regions, ${silhouette} silhouette px (${(silhouette / (size * size) * 100).toFixed(1)}%)`);
  }
}
console.log(`branching proof written to ${outputDir}`);