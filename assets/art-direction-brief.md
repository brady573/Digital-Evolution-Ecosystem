# Art direction brief — Living Evolution Explorer

## Scope and authority (read this first)

**This document governs the ENVIRONMENT only.** It covers the world substrate,
the field compositing, and the analytical overlays. It is authoritative for
those surfaces.

**This document does NOT govern organism art.** Organism morphology is owned by
the accepted phenotype direction, which is a separate and later decision:
inherited recognizable body families, expressive naturalist/alien forms, organic
silhouette variation, and — critically — **ecological analysis remaining
independent of morphology**. Nothing in this brief may be read as constraining
that direction.

Where this brief describes organisms (shape language, sprite construction,
colour families), it is recording the **current/legacy renderer as it exists
today** so a reviewer can tell which constraints are environmental and which
are simply what the code happens to do. Those organism lines are explicitly
provisional and are expected to be superseded by the phenotype direction. The
environmental rules — palette roles, value structure, ecological meaning,
prohibitions against invented terrain — are the durable part.

Adapted from the standard brief to a **procedural** renderer. The world, the
substrate, and in-world organisms are all generated at runtime (Canvas 2D
today; Pixel Phenotype geometry for morphology). The one bundled-image
exception is 24 family-portrait PNGs (six families x 16/32/64/128) used ONLY
as Selected-organism inspection-card art — never as world sprites (see
`assets/asset-manifest.json`: `family-portraits` vs `phenotype-textures`). The
"art direction" is therefore a set of **render rules and palette roles**, and
this document is the record that keeps them stable and reviewable instead of
living only in code comments.

## Game frame

- **Player fantasy:** watch a living world model itself, then investigate why it
  looks the way it does. Observation and explanation, never control.
- **Core verbs:** create a universe, run it, select an organism, read its
  history, inspect fields, compare against an untouched twin.
- **Engine and renderer:** React + Canvas 2D (`apps/explorer`), fed by
  `sim-runtime` snapshots. 2D only; no 3D, no spritesheets, no external world
  art. The 24 bundled family portraits are inspection-card UI chrome, not
  world sprites.
- **Target platforms:** phone first (Android via Capacitor), then desktop
  browser. Touch and mouse both primary.
- **Camera/view/facing:** strict top-down orthographic over a 600x600 toroidal
  world. Uniform zoom only — never a stretch, never perspective.
- **Native viewport and display scale:** 390x844 phone, 1280x900 desktop;
  canvas backing store follows the displayed element size.
- **Typical asset size on screen:** one simulation cell ≈ 10x10 px at 1x zoom,
  ≈ 30x30 px at 3x zoom. **Most of what the player reads is smaller than a
  favicon**, so legibility rules below are strict.

## Visual system — environment (authoritative)

- **Shape language:** the substrate is a continuous field. Nothing about it is
  voxel-based; the current renderer produces squares only because it samples a
  60x60 grid, and that sampling is an implementation detail, not a style.
- **Value structure:** three bands, in order — barren soil (darkest), fertile
  ground (mid, green), waste ash (pale, low chroma). Waste deliberately sits
  *above* fertile ground in luminance: degradation must not read as a hole.
- **Palette roles and exact swatches** (authoritative source is
  `apps/explorer/src/landscape.ts`):

  | Role | Swatch | Meaning |
  |---|---|---|
  | Barren substrate | `rgb(58,66,61)` | low nutrients; never a void |
  | Fertile A | adds `+8,+30,+12` scaled | verdant, cooler — Nutrient A source zone |
  | Fertile B | adds `+30,+28,+9` scaled | olive, warmer — Nutrient B source zone |
  | Altered | adds `+34,+8,+30` scaled | biologically produced Metabolite C |
  | Ash | blends toward `rgb(116,107,96)` | metabolic waste; low chroma, warm |
  | Waste overlay ramp | `rgb(58,52,62)` → `rgb(234,148,170)` | exact analytical load |

- **Materials and surface cues:** the substrate is matte and slightly mottled.
  No gloss, no reflections, no gradients.
- **Edge/line treatment:** the substrate has no outlines. Stroked elements are
  reserved for interaction affordances.
- **Lighting direction:** none. Uniform and flat by intent — a simulated field
  is data, not a lit scene. Shading may only come from field values.
- **Detail density and focal hierarchy:** cosmetic stipple on loaded ground only
  (density rises with measured waste), plus a low-amplitude deterministic
  per-cell grain. Both are subordinate to the field and both are cosmetic only.
- **Motion character:** the substrate follows the field with brief inertia; the
  minimap and camera are instant. No environment animation, no shimmering, no
  particles.
- **Explicit exclusions:** no invented biomes, no elevation/water/soil/barrier
  implications, no hue-only distinctions, no environmental noise that competes
  with life, no gradient sky or horizon.

## Visual system — organisms (current renderer, NOT art direction)

Everything in this section describes what the code does today. It is
**provisional** and carries no authority over the phenotype direction.

- Current construction: small chunky pixel clusters, opaque filled blocks when
  active, hollow outlines when dormant, span scaled by stored energy, with a
  per-id deterministic edge texture.
- Current colour families: neutral base `#d8f0df`, dormant `#7f9189`,
  cross-feeder `#e7b36a`, diet-leaning `#7bd3c4` / `#b79de4`.
- The accepted phenotype direction replaces this with inherited recognizable
  body families and organic silhouette variation. When it lands, the
  requirements it must continue to satisfy — legibility at true scale,
  dormant-vs-active distinction, selection affordance, and **ecological
  analysis that does not read morphology** — are environmental requirements
  owned by this document, not morphological ones.

## Technical contract

- **Asset dimensions/aspect:** world rendering is procedural at runtime (no
  world image files). The only bundled images are the 24 family-portrait PNGs
  (six families x 16/32/64/128, RGBA) for the inspection card.
- **Alpha/background:** opaque; the canvas is cleared to transparent and fully
  painted by the field buffer before life is drawn.
- **Grid/tile/frame size:** 60x60 field cells over a 600x600 world (10 world
  units per cell), matching engine constants.
- **Anchor/pivot/baseline:** drawn centred on their world position; the field is
  drawn as one scaled buffer aligned to world origin.
- **Filtering/mipmaps/compression:** the field buffer is scaled up by the
  browser with `imageSmoothingEnabled` and no mipmaps — this is what makes the
  substrate continuous instead of a grid of cells. Do not disable smoothing.
- **Color space:** sRGB, no conversion.
- **Texture/poly/material budgets:** one 60x60 RGBA buffer (~14 KB) plus the
  canvas for the world. Bundled images are inspection UI only: 24 portrait
  PNGs (~170 KB total). In-world Pixi phenotype textures (P0, non-production)
  are deterministic GPU cache artifacts generated from phenotype geometry —
  never stored, never shipped as files.
- **Naming and folders:** `apps/explorer/src/landscape.ts` owns the substrate
  palette and encodings; `App.tsx` owns organism rendering; `styles.css` owns
  UI chrome. Tests: `tools/validation/landscape.ts` (rules),
  `tools/validation/landscape-capture.ts` (visual evidence).

## Visual target

- **Approved seed/reference paths:** `testdata/visual/*.png` — regenerate with
  `pnpm test:visual`; CI uploads them as the `landscape-visual-evidence`
  artifact. Required frames: whole-world landscape, close zoom, waste-modified
  landscape, waste overlay, nutrient overlay, phone shell widths, selected
  organism.
- **Required do/don't examples:** do keep waste visibly distinct from the soil
  it covers; do keep life readable on any substrate value. Don't crush
  degradation toward black; don't let stipple cover the whole world; don't
  introduce categorical terrain; don't let morphology encode ecological claims.
- **Native-scale gameplay capture:** required before any visual change is
  accepted. Statistical canvas assertions are not a substitute — reading the
  captures is what caught the grid look, the black voids, and a misread of
  "waste darkens".
- **Approval owner/date:** environment surfaces — Owner, pending on PR #40.
  Organism art — not covered here; see the phenotype direction.
