/**
 * Renderer/output identity.
 *
 * This string names the procedure that produces the final rich RGBA. Bump it
 * whenever the rendered bytes change, so one version string never names two
 * different outputs: it participates in rich-texture cache identity, and a
 * stale cache entry would otherwise serve the wrong pixels.
 */
export const PROCEDURAL_ART_VERSION = "plated-art-v2" as const;

/**
 * Cosmetic variation identity, deliberately separate from the renderer version.
 *
 * `unit()` seeds the deterministic boundary and accent variation from this
 * string. Folding the renderer version into that salt made two unrelated
 * concerns share one lever: the AC #131 transparency correction changed
 * output bytes and would have re-rolled every accepted accent and boundary
 * glint, altering family art pixel-for-pixel for no design reason.
 *
 * Bump this only when the *cosmetic variation itself* is meant to change.
 */
export const PROCEDURAL_VARIATION_VERSION = "plated-art-v1" as const;