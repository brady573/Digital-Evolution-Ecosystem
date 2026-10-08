/**
 * Rasterizer calibration probe.
 *
 * The shared rasterizer divides `along` by length/2 but `across` by `width`,
 * so `length` behaves as a full extent and `width` as a HALF extent. Every
 * family grammar has to be authored against that measured mapping rather than
 * against the field names. This prints the true rendered bounds of a single
 * region so the mapping is evidence, not assumption.
 */
import { rasterizeStructuralArt } from "../packages/phenotype/src/art/index.ts";

function measure(kind: "ellipse" | "teardrop", length: number, width: number, size = 128) {
  const raster = rasterizeStructuralArt({
    family: "plated",
    cosmeticSeed: 1,
    structuralVersion: "probe",
    regions: [{
      id: "probe",
      geometry: {
        kind,
        center: { x: 0.5, y: 0.5 },
        axisRadians: 0,
        length,
        width,
        taper: kind === "teardrop" ? 0.15 : 0,
      },
      depth: 0,
      paintOrder: 0,
      detail: "structure",
      materialRole: "body",
    }],
  }, { width: size, height: size });

  let minX = size, maxX = -1, minY = size, maxY = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (raster.masks.silhouette[y * size + x] !== 1) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return {
    pxAlong: maxX - minX + 1,
    pxAcross: maxY - minY + 1,
    normalizedAlong: (maxX - minX + 1) / size,
    normalizedAcross: (maxY - minY + 1) / size,
  };
}

console.log("requested length/width -> measured normalized along x across");
for (const [length, width] of [[0.4, 0.1], [0.4, 0.2], [0.4, 0.4], [0.6, 0.06], [0.6, 0.12], [0.2, 0.2]] as const) {
  for (const kind of ["ellipse", "teardrop"] as const) {
    const m = measure(kind, length, width);
    console.log(`${kind.padEnd(9)} L=${length} W=${width} -> along=${m!.normalizedAlong.toFixed(3)} across=${m!.normalizedAcross.toFixed(3)}`);
  }
}
console.log("\nIf across == 2 x width, then width is a HALF extent and grammars must halve it to get the intended full width.");