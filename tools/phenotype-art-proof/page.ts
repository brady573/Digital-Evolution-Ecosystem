import type { ResolvedPhenotype } from "../../packages/phenotype/src/index.ts";
import type { StructuralArtRecipe } from "../../packages/phenotype/src/art/index.ts";

const DEPTH_COLORS = ["#718092", "#aeb8c3", "#e0e4e8"] as const;

function geometrySvg(recipe: StructuralArtRecipe, mode: "recipe" | "silhouette" | "depth" | "neutral", scale: number): string {
  const shapes = [...recipe.regions].sort((a, b) => a.paintOrder - b.paintOrder).map((region) => {
    const geometry = region.geometry;
    let shape: string;
    if (geometry.kind === "polygon") {
      const points = geometry.points.map((p) => `${p.x * 128},${p.y * 128}`).join(" ");
      shape = `<polygon points="${points}"/>`;
    } else {
      const cx = geometry.center.x * 128;
      const cy = geometry.center.y * 128;
      const angle = (geometry.axisRadians * 180) / Math.PI;
      const rx = (geometry.length * 128) / 2;
      const ry = geometry.width * 128;
      if (geometry.kind === "ellipse") {
        shape = `<ellipse cx="0" cy="0" rx="${rx}" ry="${ry}" transform="translate(${cx} ${cy}) rotate(${angle})"/>`;
      } else {
        const shoulder = Math.max(0.15, Math.min(0.42, geometry.taper));
        const d = `M ${-rx} 0 C ${-rx * 0.85} ${-ry * 0.95}, ${-rx * shoulder} ${-ry}, ${rx * 0.14} ${-ry * 0.82} Q ${rx} ${-ry * 0.38}, ${rx} 0 Q ${rx} ${ry * 0.38}, ${rx * 0.14} ${ry * 0.82} C ${-rx * shoulder} ${ry}, ${-rx * 0.85} ${ry * 0.95}, ${-rx} 0 Z`;
        shape = `<path d="${d}" transform="translate(${cx} ${cy}) rotate(${angle})"/>`;
      }
    }
    if (region.materialRole === "interstitial") {
      return `<g class="region interstitial" data-region="${region.id}">${shape}</g>`;
    }
    const fill = mode === "silhouette" ? "#e9eef2"
      : mode === "depth" ? DEPTH_COLORS[Math.max(0, Math.min(2, region.depth))]!
        : mode === "neutral" ? ["#555f6b", "#9099a4", "#c8cdd3"][Math.max(0, Math.min(2, region.depth))]!
          : DEPTH_COLORS[Math.max(0, Math.min(2, region.depth))]!;
    return `<g class="region" data-region="${region.id}" data-depth="${region.depth}" fill="${fill}">${shape}</g>`;
  }).join("");
  return `<svg class="geometry ${mode}" width="${128 * scale}" height="${128 * scale}" viewBox="0 0 128 128" role="img" aria-label="Plated ${mode} structural preview" shape-rendering="geometricPrecision"><rect width="128" height="128" fill="#111923"/>${shapes}</svg>`;
}

export function buildGeometryReviewPage(
  resolved: ResolvedPhenotype,
  recipe: StructuralArtRecipe,
  evidence: {
    readonly referenceDataUrl: string;
    readonly geometryRasterDataUrl: string;
    readonly materialRasterDataUrl: string;
    readonly nearestMaterialDataUrl: string;
    readonly roleMapDataUrl: string;
  },
): string {
  const panel = (title: string, mode: "recipe" | "silhouette" | "depth" | "neutral") =>
    `<section><h2>${title}</h2><div class="pair">${geometrySvg(recipe, mode, 1)}${geometrySvg(recipe, mode, 4)}</div><p>Logical viewBox 128×128 · review scales 1× and 4× · structural vector preview only</p></section>`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plated geometry checkpoint A</title><style>
    *{box-sizing:border-box}body{margin:0;padding:24px;background:#080e16;color:#e2eaf0;font:14px/1.45 system-ui,sans-serif}h1{margin:0 0 4px}h2{font-size:16px}p{color:#9aabb8}.notice{padding:10px;border:1px solid #7d6a36;background:#251f12;color:#f1dba0}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}section{padding:12px;border:1px solid #2b3948;background:#0e1722;overflow:auto}.pair{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}.geometry{display:block;background:#111923;flex:none}.interstitial{fill:#202a36;stroke:#080e16;stroke-width:.6}.region{stroke:#080e16;stroke-width:.35;stroke-linejoin:round}.depth .region[data-depth="0"]{opacity:.72}.recipe .region[data-region^="front"]{stroke:#fff;stroke-width:.55}.pixels{image-rendering:pixelated;image-rendering:crisp-edges;background:#070b10;max-width:100%;height:auto}.reference{max-width:100%;height:auto;object-fit:contain}pre{white-space:pre-wrap;word-break:break-word;background:#0a1119;padding:10px;color:#bdc8d1}
  </style><body><h1>Plated procedural art — Checkpoint B material pass</h1><p>Material treatment is applied over the accepted structural recipe. No geometry or mask changes, production integration, or LOD work.</p><div class="notice"><strong>Reference is calibration-only.</strong> The embedded original is unchanged and is not a production asset or template.</div><h2>Reference and accepted geometry — native 128×128</h2><div class="pair"><figure><figcaption>Reference crop — calibration only</figcaption><img class="reference" src="${evidence.referenceDataUrl}" alt="Plated calibration reference" width="500"></figure><figure><figcaption>Accepted neutral geometry raster</figcaption><img class="pixels" src="${evidence.geometryRasterDataUrl}" alt="Accepted geometry raster" width="384" height="384"></figure><figure><figcaption>Checkpoint B material raster</figcaption><img class="pixels" src="${evidence.materialRasterDataUrl}" alt="Native material raster" width="384" height="384"></figure><figure><figcaption>Same material raster enlarged 3× nearest-neighbor</figcaption><img class="pixels" src="${evidence.nearestMaterialDataUrl}" alt="Nearest-neighbor material raster" width="384" height="384"></figure><figure><figcaption>Unchanged semantic material-role mask (palette coded)</figcaption><img class="pixels" src="${evidence.roleMapDataUrl}" alt="Material-role mask evidence" width="384" height="384"></figure></div><div class="grid">
  ${panel("Structural recipe / depth order", "recipe")}${panel("Silhouette-only", "silhouette")}${panel("Plate boundary and depth bands", "depth")}${panel("Neutral geometry reference", "neutral")}
  </div><h2>Resolved input and structural recipe</h2><pre>${JSON.stringify({ resolved, recipe }, null, 2)}</pre></body></html>`;
}
