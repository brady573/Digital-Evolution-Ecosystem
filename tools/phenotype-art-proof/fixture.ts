import { resolvePhenotype, type ResolvedPhenotype } from "../../packages/phenotype/src/index.ts";

/** One deterministic Plated-center lineage input for geometry-only review. */
export function platedCenterFixture(): ResolvedPhenotype {
  const resolved = resolvePhenotype({
    speed: 1.375,
    sensing: 69.5,
    metabolism: 0.339,
    reproduction: 100,
    diet: 0.675,
    habitat: 0.675,
    byproductUse: 0.675,
    dormancyResponse: 1,
  }, { parentFamily: "plated", organismId: 7000, lineageId: 4242 });
  if (resolved.family !== "plated") throw new Error(`Plated-center fixture resolved to ${resolved.family}`);
  return resolved;
}
