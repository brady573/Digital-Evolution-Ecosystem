/**
 * Reference-extracted geometry templates.
 *
 * Aggregate silhouette statistics (fill, coverage, cohesion) proved too
 * permissive: a symmetric two-lobe shape and an asymmetric three-lobe shape
 * score almost identically while looking nothing alike. Those descriptors are
 * invariant to precisely the features that define a family — body axis,
 * elongation, tail taper, limb count, and bilateral symmetry.
 *
 * This tool measures those features directly, on the reference artwork and on
 * the current render with identical code, so a geometrically wrong family is
 * reported as a wrong number rather than as an opinion.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { resolvePhenotype } from "../packages/phenotype/src/index.ts";
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

function decodePng(buffer: Buffer) {
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
    } else if (type === "IDAT") chunks.push(data);
    else if (type === "IEND") break;
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

interface Mask {
  readonly size: number;
  readonly ink: Uint8Array;
}

function maskFromRgba(size: number, rgba: Uint8Array, background: [number, number, number] | null): Mask {
  const ink = new Uint8Array(size * size);
  for (let pixel = 0; pixel < size * size; pixel++) {
    const alpha = rgba[pixel * 4 + 3]!;
    const r = rgba[pixel * 4]!;
    const g = rgba[pixel * 4 + 1]!;
    const b = rgba[pixel * 4 + 2]!;
    ink[pixel] = background
      ? Math.abs(r - background[0]) + Math.abs(g - background[1]) + Math.abs(b - background[2]) > 36
      : alpha > 24
      ? 1
      : 0;
  }
  return { size, ink };
}

interface Template {
  /** Principal body axis, degrees, 0 = left-to-right. */
  axisDegrees: number;
  /**
   * 0 = a straight line, 1 = a circle. Note the direction: this is
   * `sqrt(1 - eigenvalueGap/trace)`, which is maximal for a round silhouette.
   * Naming it "elongation" and reading it as "higher is longer" is what drove
   * several rounds of tuning in the wrong direction.
   */
  elongation: number;
  /** Silhouette bounding-box aspect ratio, long axis over short axis. */
  aspect: number;
  /** Share of ink mirrored across the vertical axis: 1 = fully bilateral. */
  symmetry: number;
  /** Number of separated extremities (lobes, rays, limbs). */
  limbs: number;
  /** Extent profile along the body axis, -1 (tail) to +1 (head). */
  alongAxis: number[];
  /** Widest cross-section position along the body axis: -1 tail, 0 middle, +1 head. */
  waistPosition: number;
}

function extract(mask: Mask): Template {
  const size = mask.size;
  let total = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = size;
  let maxX = -1;
  let minY = size;
  let maxY = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!mask.ink[y * size + x]) continue;
      total++;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (total === 0) throw new Error("empty silhouette");
  const cx = sumX / total;
  const cy = sumY / total;

  // Second central moments give the principal axis and its elongation.
  let mu20 = 0;
  let mu02 = 0;
  let mu11 = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!mask.ink[y * size + x]) continue;
      const dx = x - cx;
      const dy = y - cy;
      mu20 += dx * dx;
      mu02 += dy * dy;
      mu11 += dx * dy;
    }
  }
  const trace = mu20 + mu02;
  const delta = Math.hypot(mu20 - mu02, 2 * mu11);
  // The major axis is perpendicular to the larger-moment direction.
  const theta = 0.5 * Math.atan2(2 * mu11, mu20 - mu02) + Math.PI / 2;
  const elongation = Math.sqrt(Math.max(0, 1 - delta / Math.max(1, trace)));

  const axisX = Math.cos(theta);
  const axisY = Math.sin(theta);

  // Bilateral symmetry across the axis perpendicular to the principal axis.
  let matched = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!mask.ink[y * size + x]) continue;
      // Reflect across the body axis line through the centroid.
      const dx = x - cx;
      const dy = y - cy;
      const along = dx * axisX + dy * axisY;
      const across = dx * -axisY + dy * axisX;
      const rx = Math.round(cx + along * axisX - across * -axisY);
      const ry = Math.round(cy + along * axisY - across * axisX);
      if (rx < 0 || ry < 0 || rx >= size || ry >= size) continue;
      if (mask.ink[ry * size + rx]) matched++;
    }
  }

  // Extremities: radial reach in 24 bins, counted as local maxima near the rim.
  const bins = 24;
  const reach = new Float64Array(bins);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!mask.ink[y * size + x]) continue;
      const dx = (x - cx) / size;
      const dy = (y - cy) / size;
      const angle = Math.atan2(dy, dx);
      const bin = Math.min(bins - 1, Math.floor(((angle + Math.PI) / (Math.PI * 2)) * bins));
      reach[bin] = Math.max(reach[bin]!, Math.hypot(dx, dy));
    }
  }
  const peak = Math.max(...reach);
  let limbs = 0;
  for (let bin = 0; bin < bins; bin++) {
    const value = reach[bin]!;
    const before = reach[(bin - 1 + bins) % bins]!;
    const after = reach[(bin + 1) % bins]!;
    if (value > peak * 0.72 && value >= before && value > after) limbs++;
  }

  // Along-axis extent and cross-section width in 12 slices.
  const slices = 12;
  const alongReach = new Float64Array(slices).fill(-1);
  const width = new Float64Array(slices);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!mask.ink[y * size + x]) continue;
      const dx = x - cx;
      const dy = y - cy;
      const a = (dx * axisX + dy * axisY) / size;
      const b = (dx * -axisY + dy * axisX) / size;
      const slice = Math.min(slices - 1, Math.max(0, Math.floor(((a + 0.5) * slices))));
      alongReach[slice] = Math.max(alongReach[slice]!, a);
      width[slice] = Math.max(width[slice]!, Math.abs(b));
    }
  }
  const alongAxis = Array.from(alongReach, (value) => (value < -0.5 ? 0 : value));
  let widest = 0;
  let waistPosition = 0;
  for (let slice = 0; slice < slices; slice++) {
    if (width[slice]! > widest) {
      widest = width[slice]!;
      waistPosition = slice / (slices - 1) - 0.5;
    }
  }

  return {
    axisDegrees: ((theta * 180) / Math.PI + 360) % 360,
    elongation,
    aspect: Math.max(maxX - minX + 1, maxY - minY + 1) / Math.max(1, Math.min(maxX - minX + 1, maxY - minY + 1)),
    symmetry: matched / total,
    limbs,
    alongAxis,
    waistPosition,
  };
}

function render(family: Family, size: number): Mask {
  const resolved = resolvePhenotype({ ...FIXTURES[family] }, { organismId: 9100, lineageId: 5150 });
  const recipe = buildArtRecipe(resolved, "active");
  const view = resolveArtLod(recipe, "inspection");
  const neutral = rasterizeStructuralArt({ ...recipe, regions: view.regions }, { width: size, height: size });
  const rendered = materializeRaster(neutral, applyMaterialRoles(view, resolved));
  return maskFromRgba(size, rendered.rgba, [16, 20, 26]);
}

/** Smallest signed angle between two orientations, in degrees. */
function axisDelta(a: number, b: number): number {
  let delta = ((a - b + 540) % 360) - 180;
  return Math.abs(delta);
}

const size = 128;
const f2 = (value: number) => value.toFixed(2);

for (const family of Object.keys(FIXTURES) as Family[]) {
  const reference = decodePng(readFileSync(resolve(`apps/explorer/src/family-art/${family}.png`)));
  const target = extract(maskFromRgba(reference.width, reference.rgba, null));
  const actual = extract(render(family, size));

  console.log(`\n=== ${family}`);
  const rows: Array<[string, string, string, string]> = [
    ["axis deg", f2(target.axisDegrees), f2(actual.axisDegrees), f2(axisDelta(target.axisDegrees, actual.axisDegrees))],
    ["elongation", f2(target.elongation), f2(actual.elongation), f2(actual.elongation - target.elongation)],
    ["aspect", f2(target.aspect), f2(actual.aspect), f2(actual.aspect - target.aspect)],
    ["symmetry", f2(target.symmetry), f2(actual.symmetry), f2(actual.symmetry - target.symmetry)],
    ["limbs", String(target.limbs), String(actual.limbs), String(actual.limbs - target.limbs)],
    ["waist pos", f2(target.waistPosition), f2(actual.waistPosition), f2(actual.waistPosition - target.waistPosition)],
  ];
  console.log("  feature        target   actual     delta");
  for (const [name, t, a, d] of rows) console.log(`  ${name.padEnd(13)} ${t.padStart(7)} ${a.padStart(8)} ${d.padStart(9)}`);
  console.log(`  target along-axis: ${target.alongAxis.map((v) => f2(v)).join(" ")}`);
  console.log(`  actual along-axis: ${actual.alongAxis.map((v) => f2(v)).join(" ")}`);
}