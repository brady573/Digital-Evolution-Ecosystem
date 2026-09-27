# Art direction brief — Living Evolution Explorer

Adapted from the standard brief to a **procedural** renderer. This project ships
almost no image files: the world, the substrate, and the organisms are all
generated at runtime in Canvas 2D. The "art direction" is therefore a set of
**render rules and palette roles**, and this document is the record that keeps
them stable and reviewable instead of living only in code comments.

## Game frame

- **Player fantasy:** watch a living world model itself, then investigate why it
  looks the way it does. Observation and explanation, never control.
- **Core verbs:** create a universe, run it, select an organism, read its
  history, inspect fields, compare against an untouched twin.
- **Engine and renderer:** React + Canvas 2D (`apps/explorer`), fed by
  `sim-runtime` snapshots. 2D only; no 3D, no spritesheets, no external art.
- **Target platforms:** phone first (Android via Capacitor), then desktop
  browser. Touch and mouse both primary.
- **Camera/view/facing:** strict top-down orthographic over a 600x600 toroidal
  world. Uniform zoom only — never a stretch, never perspective.
- **Native viewport and display scale:** 390x844 phone, 1280x900 desktop;
  canvas backing store follows the displayed element size.
- **Typical asset size on screen:** one simulation cell ≈ 10x10 px at 1x zoom,
  ≈ 30x30 px at 3x zoom. Organisms ≈ 5–18 px. **Most of what the player reads
  is smaller than a favicon**, so legibility rules below are strict.

## Visual system

- **Shape language:** squares and voxels only. The substrate is a continuous
  field; organisms are small chunky pixel clusters. No organic curves, no
  circles for creatures, no perspective.
- **Silhouette priorities:** (1) organisms against substrate, (2) dormant vs
  active, (3) selection focus marker. The substrate must never out-contrast an
  organism.
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
  | Organism base | `#d8f0df` | living, neutral |
  | Organism dormant | `#7f9189` | dormant, desaturated |
  | Cross-feeder | `#e7b36a` | byproduct scavenger |
  | Diet A / Diet B | `#7bd3c4` / `#b79de4` | primary specialism |
  | Selection halo | `#eaffff` / `#7fe9ff` | focus marker |

- **Materials and surface cues:** the substrate is matte and slightly mottled;
  organisms are flat opaque blocks. No gloss, no reflections, no gradients on
  subjects.
- **Edge/line treatment:** organisms are hard-edged filled blocks (dormant ones
  are hollow outlined). Substrate has no outlines. The focus marker is the only
  stroked element, and it is the brightest thing on screen.
- **Lighting direction:** none. Uniform and flat by intent — a simulated field
  is data, not a lit scene. Shading may only come from field values.
- **Detail density and focal hierarchy:** cosmetic stipple on loaded ground only
  (density rises with measured waste), plus a low-amplitude deterministic
  per-cell grain. Both are subordinate to the field and both are cosmetic only.
- **Motion character:** organisms move continuously; the substrate follows the
  field with brief inertia; the minimap and camera are instant. No environment
  animation, no shimmering, no particles.
- **Explicit exclusions:** no invented biomes, no elevation/water/soil/barrier
  implications, no hue-only distinctions, no environmental noise that competes
  with organism motion, no gradient sky or horizon.

## Technical contract

- **Asset dimensions/aspect:** none — everything is procedural at runtime.
- **Alpha/background:** opaque; the canvas is cleared to transparent and fully
  painted by the field buffer before organisms.
- **Grid/tile/frame size:** 60x60 field cells over a 600x600 world (10 world
  units per cell), matching engine constants.
- **Anchor/pivot/baseline:** organisms are drawn centred on their world
  position; the field is drawn as one scaled buffer aligned to world origin.
- **Filtering/mipmaps/compression:** the field buffer is scaled up by the
  browser with `imageSmoothingEnabled` and no mipmaps — this is what makes the
  substrate continuous instead of a grid of cells. Do not disable smoothing.
- **Color space:** sRGB, no conversion.
- **Texture/poly/material budgets:** one 60x60 RGBA buffer (~14 KB) plus the
  canvas. No image assets ship.
- **Naming and folders:** `apps/explorer/src/landscape.ts` owns the substrate
  palette and encodings; `App.tsx` owns organism rendering; `styles.css` owns
  UI chrome. Tests: `tools/validation/landscape.ts` (rules),
  `tools/validation/landscape-capture.ts` (visual evidence).

## Visual target

- **Approved seed/reference paths:** `testdata/visual/*.png` — regenerate with
  `pnpm test:visual`; CI uploads them as the `landscape-visual-evidence`
  artifact. Required frames: whole-world landscape, close zoom, waste-modified
  landscape, waste overlay, nutrient overlay, phone, selected organism.
- **Required do/don't examples:** do keep waste visibly distinct from the soil
  it covers; do keep organisms readable on any substrate value. Don't crush
  degradation toward black; don't let hatching or stipple cover the whole
  world; don't introduce categorical terrain.
- **Native-scale gameplay capture:** required before any visual change is
  accepted. Statistical canvas assertions are not a substitute — reading the
  captures is what caught the grid look, the black voids, and a misread of
  "waste darkens".
- **Approval owner/date:** Owner (design review) — pending on PR #40.
