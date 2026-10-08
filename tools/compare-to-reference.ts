/**
 * Reference-vs-current comparison sheets.
 *
 * Side-by-side is the only reliable way to judge "does this match the
 * reference": looking at each in isolation invites confirming whatever the last
 * iteration happened to produce. This decodes the accepted family artwork and
 * composites it next to the current procedural render at the same scale, plus
 * the current dormant render, so active and dormant can be judged against the
 * reference in one glance.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync, deflateSync } from "node:zlib";
import { resolvePhenotype, type ResolvedPhenotype } from "../packages/phenotype/src/index.ts";
import {
  applyMaterialRoles,
  buildArtRecipe,
  materializeRaster,
  rasterizeStructuralArt,
  resolveArtLod,
} from "../packages/phenotype/src/art/index.ts";

const FAMILY_FIXTURES: Readonly<Record<string, Parameters<typeof resolvePhenotype>[0]>> = {
  blob: { speed: 1.56, sensing: 69.5, metabolism: 0.224, reproduction: 100, diet: 0.6, habitat: 0.6, byproductUse: 0.6, dormancyResponse: 0.8 },
  segmented: { speed: 2.5, sensing: 86.5, metabolism: 0.27, reproduction: 100, diet: 0.9, habitat: 1.5, byproductUse: 1.5, dormancyResponse: 0.8 },
  radial: { speed: 1.38, sensing: 149.4, metabolism: 0.247, reproduction: 100, diet: 0.6, habitat: 0.9, byproductUse: 1.5, dormancyResponse: 0.8 },
  paddled: { speed: 3.55, sensing: 115.4, metabolism: 0.371, reproduction: 100, diet: 1.5, habitat: 1.5, byproductUse: 1.5, dormancyResponse: 0.8 },
  plated: { speed: 1.4, sensing: 70, metabolism: 0.3392, reproduction: 100, diet: 0.675, habitat: 0.675, byproductUse: 0.68, dormancyResponse: 1 },
  branching: { speed: 1, sensing: 139.2, metabolism: 0.247, reproduction: 100, diet: 1.4, habitat: 1.4, byproductUse: 1.4, dormancyResponse: 0.8 },
};

/** Minimal non-interlaced 8-bit RGBA PNG decoder, enough for the 128px family art. */
function decodePng(buffer: Buffer): { width: number; height: number; rgba: Uint8Array } {
  let offset = 8;
  let width = 0;
  let height = 0;
  const chunks: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.slice(offset + 4, offset + 8).toString("ascii");
    const data = buffer.slice(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) {
        throw new Error("only 8-bit non-interlaced RGBA PNG is supported");
      }
    } else if (type === "IDAT") {
      chunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[y * stride + x - 4]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4]! : 0;
      let value = line[x]!;
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = value & 0xff;
    }
  }
  return { width, height, rgba: out };
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
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

/** Composite over the same near-black backdrop the proof raster uses. */
function flatten(source: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let pixel = 0; pixel < size * size; pixel++) {
    const alpha = source[pixel * 4 + 3]! / 255;
    for (let channel = 0; channel < 3; channel++) {
      out[pixel * 4 + channel] = Math.round(source[pixel * 4 + channel]! * alpha + 16 * (1 - alpha));
    }
    out[pixel * 4 + 3] = 255;
  }
  return out;
}

function render(resolved: ResolvedPhenotype, activity: "active" | "dormant", size: number): Uint8Array {
  const recipe = buildArtRecipe(resolved, activity);
  const view = resolveArtLod(recipe, "inspection");
  const neutral = rasterizeStructuralArt({ ...recipe, regions: view.regions }, { width: size, height: size });
  return flatten(materializeRaster(neutral, applyMaterialRoles(view, resolved)).rgba, size);
}

const outputDir = resolve(process.argv[2] ?? "/tmp/opencode/compare");
mkdirSync(outputDir, { recursive: true });
const size = 128;

for (const [family, traits] of Object.entries(FAMILY_FIXTURES)) {
  const reference = decodePng(readFileSync(resolve(`apps/explorer/src/family-art/${family}.png`)));
  const resolved = resolvePhenotype({ ...traits }, { organismId: 9100, lineageId: 5150 });
  if (resolved.family !== family) throw new Error(`${family} fixture resolved to ${resolved.family}`);

  // Columns: reference | current active | current dormant.
  const sheet = new Uint8Array(size * 3 * size * 4);
  const sources = [reference.rgba, render(resolved, "active", size), render(resolved, "dormant", size)];
  sources.forEach((source, column) => {
    const flat = flatten(source, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const from = (y * size + x) * 4;
        const to = (y * size * 3 + column * size + x) * 4;
        sheet[to] = flat[from]!;
        sheet[to + 1] = flat[from + 1]!;
        sheet[to + 2] = flat[from + 2]!;
        sheet[to + 3] = 255;
      }
    }
  });
  writeFileSync(resolve(outputDir, `${family}-compare.png`), encodePng(size * 3, size, sheet));
  console.log(`${family}: reference | active | dormant`);
}
console.log(`comparison sheets written to ${outputDir}`);