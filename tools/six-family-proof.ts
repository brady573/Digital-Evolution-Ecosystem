/**
 * Six-family rich-art proof — writes inspectable PNGs for human review.
 *
 * Assertions cannot establish that a family *looks* like its reference. This
 * renders every family, both rich LODs, active and dormant, plus a monochrome
 * cross-family matrix, so identity and cross-family legibility can be judged by
 * eye. Output is operator-supplied; nothing here is versioned evidence.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { resolvePhenotype, type ResolvedPhenotype } from "../packages/phenotype/src/index.ts";
import {
  applyMaterialRoles,
  buildArtRecipe,
  materializeRaster,
  rasterizeStructuralArt,
  resolveArtLod,
  type StructuralArtRecipe,
} from "../packages/phenotype/src/art/index.ts";

/**
 * One trait vector per family, resolved from each family's own attractor
 * neighbourhood so the fixture is a genuine member of that family rather than
 * an arbitrary organism forced into the label.
 */
const FAMILY_FIXTURES: Readonly<Record<string, Parameters<typeof resolvePhenotype>[0]>> = {
  blob: { speed: 1.56, sensing: 69.5, metabolism: 0.224, reproduction: 100, diet: 0.6, habitat: 0.6, byproductUse: 0.6, dormancyResponse: 0.8 },
  segmented: { speed: 2.5, sensing: 86.5, metabolism: 0.27, reproduction: 100, diet: 0.9, habitat: 1.5, byproductUse: 1.5, dormancyResponse: 0.8 },
  radial: { speed: 1.38, sensing: 149.4, metabolism: 0.247, reproduction: 100, diet: 0.6, habitat: 0.9, byproductUse: 1.5, dormancyResponse: 0.8 },
  paddled: { speed: 3.55, sensing: 115.4, metabolism: 0.371, reproduction: 100, diet: 1.5, habitat: 1.5, byproductUse: 1.5, dormancyResponse: 0.8 },
  plated: { speed: 1.4, sensing: 70, metabolism: 0.3392, reproduction: 100, diet: 0.675, habitat: 0.675, byproductUse: 0.68, dormancyResponse: 1 },
  branching: { speed: 1, sensing: 139.2, metabolism: 0.247, reproduction: 100, diet: 1.4, habitat: 1.4, byproductUse: 1.4, dormancyResponse: 0.8 },
};

const FAMILIES = Object.keys(FAMILY_FIXTURES);

function resolveFamily(family: string, overrides: Partial<Parameters<typeof resolvePhenotype>[0]> = {}): ResolvedPhenotype {
  const resolved = resolvePhenotype({ ...FAMILY_FIXTURES[family]!, ...overrides },
    { organismId: 9100, lineageId: 5150 });
  if (resolved.family !== family) {
    throw new Error(`${family} fixture resolved to ${resolved.family}; it must stay inside its own family neighbourhood`);
  }
  return resolved;
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

/** Flat luminance copy: the cross-family legibility check the handoff requires. */
function monochrome(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length);
  for (let pixel = 0; pixel < rgba.length; pixel += 4) {
    const luma = Math.round(rgba[pixel]! * 0.299 + rgba[pixel + 1]! * 0.587 + rgba[pixel + 2]! * 0.114);
    out[pixel] = luma;
    out[pixel + 1] = luma;
    out[pixel + 2] = luma;
    out[pixel + 3] = rgba[pixel + 3]!;
  }
  return out;
}

const cell = 128;

/** Nearest-neighbour resample so 64px population cells match 128px inspection cells. */
function upscale(source: Uint8Array, from: number, to: number): Uint8Array {
  const out = new Uint8Array(to * to * 4);
  for (let y = 0; y < to; y++) {
    for (let x = 0; x < to; x++) {
      const from2 = Math.min(from - 1, Math.floor((y * from) / to));
      const fromPixel = (from2 * from + Math.min(from - 1, Math.floor((x * from) / to))) * 4;
      const toPixel = (y * to + x) * 4;
      out[toPixel] = source[fromPixel]!;
      out[toPixel + 1] = source[fromPixel + 1]!;
      out[toPixel + 2] = source[fromPixel + 2]!;
      out[toPixel + 3] = source[fromPixel + 3]!;
    }
  }
  return out;
}

/**
 * 5x7 uppercase bitmap glyphs. A sheet whose cells carry no labels cannot be
 * reviewed: the reader has to be told the row and column order in prose, and
 * that prose lives only in a console log that is not part of the artifact.
 */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
};

const GLYPH_W = 5;
const GLYPH_H = 7;

/** Draw uppercase text with a dark backing so it stays readable over any art. */
function drawText(
  target: Uint8Array,
  width: number,
  height: number,
  text: string,
  originX: number,
  originY: number,
): void {
  const scale = 2;
  let cursor = originX;
  for (const character of text.toUpperCase()) {
    const glyph = GLYPHS[character];
    if (glyph) {
      for (let row = 0; row < GLYPH_H; row++) {
        for (let column = 0; column < GLYPH_W; column++) {
          if (glyph[row]![column] !== "1") continue;
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const x = cursor + column * scale + dx;
              const y = originY + row * scale + dy;
              if (x < 0 || y < 0 || x >= width || y >= height) continue;
              const offset = (y * width + x) * 4;
              target[offset] = 236;
              target[offset + 1] = 240;
              target[offset + 2] = 248;
              target[offset + 3] = 255;
            }
          }
        }
      }
    }
    cursor += (GLYPH_W + 1) * scale;
  }
}

function render(resolved: ResolvedPhenotype, activity: "active" | "dormant", lod: "population" | "inspection") {
  const recipe: StructuralArtRecipe = buildArtRecipe(resolved, activity);
  const size = lod === "population" ? 64 : 128;
  const view = resolveArtLod(recipe, lod);
  const neutral = rasterizeStructuralArt({ ...recipe, regions: view.regions }, { width: size, height: size });
  const rendered = materializeRaster(neutral, applyMaterialRoles(view, resolved));
  const silhouette = neutral.masks.silhouette.reduce((sum, value) => sum + value, 0);
  return { rgba: rendered.rgba, size, regions: recipe.regions.length, silhouette };
}

const outputDir = resolve(process.argv[2] ?? "/tmp/opencode/six-family-proof");
mkdirSync(outputDir, { recursive: true });

// One cell per family per activity per LOD. Keeping the variants as explicit
// rows means the sheet states family AND variant/LOD on its face, rather than
// relying on a console line that no reviewer of the PNG will ever read.
const VARIANTS = ["active/population", "active/inspection", "dormant/population", "dormant/inspection"] as const;

const matrix: Array<{ family: string; cells: Uint8Array[] }> = [];

for (const family of FAMILIES) {
  const resolved = resolveFamily(family);
  const cells: Uint8Array[] = [];
  for (const activity of ["active", "dormant"] as const) {
    for (const lod of ["population", "inspection"] as const) {
      const { rgba, size, regions, silhouette } = render(resolved, activity, lod);
      writeFileSync(resolve(outputDir, `${family}-${activity}-${lod}.png`), png(size, size, rgba));
      // Upsample the 64px population rasters so every cell is the same size.
      cells.push(size === cell ? monochrome(rgba) : upscale(monochrome(rgba), size, cell));
      console.log(`${family}/${activity}/${lod}: ${regions} regions, ${(silhouette / (size * size) * 100).toFixed(1)}% ink`);
    }
  }
  matrix.push({ family, cells });
}

// Labelled monochrome matrix: one row per family/variant, one column per family.
// Column headers name the family; the left gutter names the variant/LOD.
const labelGutter = 152;
const labelHeader = 44;
const columns = FAMILIES.length;
const rows = VARIANTS.length;
const sheetWidth = labelGutter + columns * cell;
const sheetHeight = labelHeader + rows * cell;
const sheet = new Uint8Array(sheetWidth * sheetHeight * 4);

// Neutral dark ground so unlabelled area is visibly empty, not art.
for (let pixel = 0; pixel < sheetWidth * sheetHeight; pixel++) {
  sheet[pixel * 4] = 12;
  sheet[pixel * 4 + 1] = 14;
  sheet[pixel * 4 + 2] = 18;
  sheet[pixel * 4 + 3] = 255;
}

drawText(sheet, sheetWidth, sheetHeight, "FAMILY", 8, 6);
for (const [index, family] of FAMILIES.entries()) {
  drawText(sheet, sheetWidth, sheetHeight, family, labelGutter + index * cell + 8, labelHeader - 26);
}
for (const [variantIndex, variant] of VARIANTS.entries()) {
  // Two lines per row label: activity above, LOD below. Clipping this to one
  // truncated line was why the earlier sheet could not be read at all.
  drawText(sheet, sheetWidth, sheetHeight, variant.split("/")[0]!, 8, labelHeader + variantIndex * cell + 46);
  drawText(sheet, sheetWidth, sheetHeight, variant.split("/")[1]!, 8, labelHeader + variantIndex * cell + 68);
  for (const [familyIndex, row] of matrix.entries()) {
    const source = row.cells[variantIndex]!;
    const originX = labelGutter + familyIndex * cell;
    const originY = labelHeader + variantIndex * cell;
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const from = (y * cell + x) * 4;
        const to = ((originY + y) * sheetWidth + originX + x) * 4;
        sheet[to] = source[from]!;
        sheet[to + 1] = source[from + 1]!;
        sheet[to + 2] = source[from + 2]!;
        sheet[to + 3] = 255;
      }
    }
  }
}
writeFileSync(resolve(outputDir, "six-family-monochrome.png"), png(sheetWidth, sheetHeight, Buffer.from(sheet)));
console.log(`monochrome matrix rows: ${VARIANTS.join(" | ")}`);
console.log(`monochrome matrix columns: ${FAMILIES.join(" | ")}`);
console.log(`six-family proof written to ${outputDir}`);