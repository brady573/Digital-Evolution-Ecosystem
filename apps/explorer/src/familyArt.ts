/**
 * Base family artwork for organism presentation (Lane 2 M4B).
 *
 * Owner-supplied RGBA portraits, one per phenotype family, at 16/32/64/128px
 * LODs. Bundled by Vite (offline-first: no network at runtime). Presentation
 * only: the artwork illustrates the resolved phenotype family and never
 * affects simulation, analysis, or phenotype resolution semantics.
 *
 * Provenance: Digital Evolution — Unevolved Family Art package (Google Drive,
 * 2026-09-26); see review folder manifest. Do not regenerate or recolor here.
 */
import type { PhenotypeFamily } from "@digital-evolution/phenotype";
import blob from "./family-art/blob.png";
import segmented from "./family-art/segmented.png";
import radial from "./family-art/radial.png";
import plated from "./family-art/plated.png";
import branching from "./family-art/branching.png";
import paddled from "./family-art/paddled.png";
import blob16 from "./family-art/blob-16.png";
import segmented16 from "./family-art/segmented-16.png";
import radial16 from "./family-art/radial-16.png";
import plated16 from "./family-art/plated-16.png";
import branching16 from "./family-art/branching-16.png";
import paddled16 from "./family-art/paddled-16.png";
import blob32 from "./family-art/blob-32.png";
import segmented32 from "./family-art/segmented-32.png";
import radial32 from "./family-art/radial-32.png";
import plated32 from "./family-art/plated-32.png";
import branching32 from "./family-art/branching-32.png";
import paddled32 from "./family-art/paddled-32.png";
import blob64 from "./family-art/blob-64.png";
import segmented64 from "./family-art/segmented-64.png";
import radial64 from "./family-art/radial-64.png";
import plated64 from "./family-art/plated-64.png";
import branching64 from "./family-art/branching-64.png";
import paddled64 from "./family-art/paddled-64.png";

/** Available artwork sizes (px). The details card uses 128. */
export type FamilyArtLod = 16 | 32 | 64 | 128;

const ART: Record<PhenotypeFamily, Record<FamilyArtLod, string>> = {
  blob: { 16: blob16, 32: blob32, 64: blob64, 128: blob },
  segmented: { 16: segmented16, 32: segmented32, 64: segmented64, 128: segmented },
  radial: { 16: radial16, 32: radial32, 64: radial64, 128: radial },
  plated: { 16: plated16, 32: plated32, 64: plated64, 128: plated },
  branching: { 16: branching16, 32: branching32, 64: branching64, 128: branching },
  paddled: { 16: paddled16, 32: paddled32, 64: paddled64, 128: paddled },
};

/** Bundled portrait URL for a phenotype family at the given LOD size. */
export function familyArtwork(family: PhenotypeFamily, lod: FamilyArtLod = 128): string {
  return ART[family][lod];
}
