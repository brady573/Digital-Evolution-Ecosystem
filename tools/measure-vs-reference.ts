/**
 * Reference-vs-current shape measurement.
 *
 * Judging reference fidelity by eye produced a long run of confident but wrong
 * verdicts. This measures both the accepted reference artwork and the current
 * procedural render with the same descriptors, so convergence is a matter of
 * driving measured deltas toward zero rather than re-interpreting a picture.
 *
 * Descriptors are chosen to capture what actually distinguishes these
 * families: how much of the frame is filled, how many separate pieces the
 * silhouette has, whether the outline is lobed or smooth, how far material
 * reaches at each compass bearing, and the overall colour.
 *
 * Shape descriptors are computed on the silhouette cropped to its bounding box
 * and normalized to a unit square, so a render is not penalised for being
 * posed or scaled differently from the reference.
 */
import { readFileSync, mkdirSync } from "node:fs";
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
    } else if (type === "IDAT") {
      chunks.push(data);
    } else if (type === "IEND") break;
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
  readonly rgb: Uint8Array;
}

/** Alpha-keyed silhouette. Reference art has transparent backgrounds; renders do not. */
function maskFromRgba(size: number, rgba: Uint8Array, background: [number, number, number] | null): Mask {
  const ink = new Uint8Array(size * size);
  const rgb = new Uint8Array(size * size * 3);
  for (let pixel = 0; pixel < size * size; pixel++) {
    const alpha = rgba[pixel * 4 + 3]!;
    const r = rgba[pixel * 4]!;
    const g = rgba[pixel * 4 + 1]!;
    const b = rgba[pixel * 4 + 2]!;
    let on: boolean;
    if (background) {
      on = Math.abs(r - background[0]) + Math.abs(g - background[1]) + Math.abs(b - background[2]) > 36;
    } else {
      on = alpha > 24;
    }
    ink[pixel] = on ? 1 : 0;
    rgb[pixel * 3] = r;
    rgb[pixel * 3 + 1] = g;
    rgb[pixel * 3 + 2] = b;
  }
  return { size, ink, rgb };
}

interface Descriptors {
  /** Fraction of the silhouette's own bounding box that is filled. */
  fill: number;
  /** Connected pieces in the silhouette; 1 means a single body. */
  components: number;
  /** Descending component pixel counts; distinguishes a real split body from isolated pixels. */
  componentSizes: number[];
  /** Share of ink in the largest connected piece. */
  cohesion: number;
  /** Perimeter over area: high means a lobed or spiky outline. */
  edgeRatio: number;
  /** Standard deviation of normalized radius: high means material reaches far at some bearings. */
  radialSpread: number;
  /** Twelve-bin mean reach profile, normalized to the unit square. */
  reach: number[];
  /** Mean ink coverage over the full frame. */
  coverage: number;
  /** Mean colour of ink pixels. */
  colour: [number, number, number];
}

function describe(mask: Mask): Descriptors {
  const size = mask.size;
  let minX = size;
  let maxX = -1;
  let minY = size;
  let maxY = -1;
  let total = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!mask.ink[y * size + x]) continue;
      total++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (total === 0) throw new Error("empty silhouette");

  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;
  const boxArea = boxWidth * boxHeight;

  // Connected components, 4-neighbour, on a bbox-cropped copy.
  const cropped = new Uint8Array(boxWidth * boxHeight);
  for (let y = 0; y < boxHeight; y++) {
    for (let x = 0; x < boxWidth; x++) {
      cropped[y * boxWidth + x] = mask.ink[(minY + y) * size + (minX + x)];
    }
  }
  const seen = new Uint8Array(boxArea);
  const stack: number[] = [];
  let components = 0;
  let largest = 0;
  const componentSizes: number[] = [];
  let perimeter = 0;
  for (let start = 0; start < boxArea; start++) {
    if (!cropped[start] || seen[start]) continue;
    let size0 = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const index = stack.pop()!;
      size0++;
      const x = index % boxWidth;
      const y = Math.floor(index / boxWidth);
      if (x === 0 || !cropped[index - 1]) perimeter++;
      if (x === boxWidth - 1 || !cropped[index + 1]) perimeter++;
      if (y === 0 || !cropped[index - boxWidth]) perimeter++;
      if (y === boxHeight - 1 || !cropped[index + boxWidth]) perimeter++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= boxWidth || ny >= boxHeight) continue;
        const next = ny * boxWidth + nx;
        if (cropped[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    if (size0 > largest) largest = size0;
    componentSizes.push(size0);
    // A lone antialias/highlight pixel is not a separate body component.
    if (size0 >= 2) components++;
  }

  // Radial reach relative to the bbox centre, in 12 compass bins.
  const bins = new Float64Array(12);
  const counts = new Float64Array(12);
  const centreX = minX + boxWidth / 2;
  const centreY = minY + boxHeight / 2;
  const scale = Math.max(boxWidth, boxHeight) / 2;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!mask.ink[y * size + x]) continue;
      const dx = (x - centreX) / scale;
      const dy = (y - centreY) / scale;
      const angle = Math.atan2(dy, dx);
      const bin = Math.min(11, Math.floor(((angle + Math.PI) / (Math.PI * 2)) * 12));
      bins[bin] = Math.max(bins[bin]!, Math.hypot(dx, dy));
      counts[bin]++;
    }
  }
  const reach: number[] = [];
  const reachMean: number[] = [];
  for (let bin = 0; bin < 12; bin++) {
    const value = counts[bin] > 0 ? bins[bin]! : 0;
    reach.push(value);
    reachMean.push(value);
  }
  const average = reachMean.reduce((sum, value) => sum + value, 0) / 12;
  const radialSpread = Math.sqrt(reachMean.reduce((sum, value) => sum + (value - average) ** 2, 0) / 12);

  let r = 0;
  let g = 0;
  let b = 0;
  for (let pixel = 0; pixel < size * size; pixel++) {
    if (!mask.ink[pixel]) continue;
    r += mask.rgb[pixel * 3]!;
    g += mask.rgb[pixel * 3 + 1]!;
    b += mask.rgb[pixel * 3 + 2]!;
  }

  return {
    fill: total / boxArea,
    components,
    componentSizes: componentSizes.sort((a, b) => b - a),
    cohesion: largest / total,
    edgeRatio: perimeter / total,
    radialSpread,
    reach,
    coverage: total / (size * size),
    colour: [Math.round(r / total), Math.round(g / total), Math.round(b / total)],
  };
}

function render(family: Family, size: number): Mask {
  const resolved = resolvePhenotype({ ...FIXTURES[family] }, { organismId: 9100, lineageId: 5150 });
  if (resolved.family !== family) throw new Error(`${family} fixture resolved to ${resolved.family}`);
  const recipe = buildArtRecipe(resolved, "active");
  const view = resolveArtLod(recipe, "inspection");
  const neutral = rasterizeStructuralArt({ ...recipe, regions: view.regions }, { width: size, height: size });
  const rendered = materializeRaster(neutral, applyMaterialRoles(view, resolved));
  return maskFromRgba(size, rendered.rgba, [16, 20, 26]);
}

mkdirSync(resolve(process.argv[2] ?? "/tmp/opencode/measure"), { recursive: true });

const size = 128;
const f2 = (value: number) => value.toFixed(3);
const i2 = (value: number) => value.toFixed(2);

for (const family of Object.keys(FIXTURES) as Family[]) {
  const reference = decodePng(readFileSync(resolve(`apps/explorer/src/family-art/${family}.png`)));
  const referenceMask = maskFromRgba(reference.width, reference.rgba, null);
  const currentMask = render(family, size);
  const target = describe(referenceMask);
  const actual = describe(currentMask);

  console.log(`\n=== ${family}`);
  const rows: Array<[string, string, string, string]> = [
    ["coverage", f2(target.coverage), f2(actual.coverage), f2(actual.coverage - target.coverage)],
    ["fill", f2(target.fill), f2(actual.fill), f2(actual.fill - target.fill)],
    ["components", String(target.components), String(actual.components), String(actual.components - target.components)],
    ["cohesion", f2(target.cohesion), f2(actual.cohesion), f2(actual.cohesion - target.cohesion)],
    ["edgeRatio", f2(target.edgeRatio), f2(actual.edgeRatio), f2(actual.edgeRatio - target.edgeRatio)],
    ["radialSpread", f2(target.radialSpread), f2(actual.radialSpread), f2(actual.radialSpread - target.radialSpread)],
    ["colour", target.colour.join(","), actual.colour.join(","), "-"],
  ];
  console.log("  descriptor      target    actual    delta");
  for (const [name, t, a, d] of rows) console.log(`  ${name.padEnd(13)} ${t.padStart(7)} ${a.padStart(9)} ${d.padStart(9)}`);

  const worst = Math.max(...target.reach.map((value, index) => Math.abs(value - actual.reach[index]!)));
  console.log(`  worst reach-bin delta: ${i2(worst)}`);
  console.log(`  component sizes (pixels): ${actual.componentSizes.join(",")}`);
  console.log(`  target reach: ${target.reach.map((value) => i2(value)).join(" ")}`);
  console.log(`  actual reach: ${actual.reach.map((value) => i2(value)).join(" ")}`);
}
