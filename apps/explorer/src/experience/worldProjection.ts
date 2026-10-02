import type { RenderSnapshot } from "@digital-evolution/contracts";
import { fillWaste, fracArray } from "../landscape";

/**
 * Explorer-side projection of current authoritative render state into the
 * channels the World can present. This is deliberately not a runtime/read-model
 * contract: it is recomputed from the supplied snapshot and carries no history.
 */
export interface WorldPresentation {
  readonly gridSize: number;
  readonly nutrients: {
    readonly a: Float32Array;
    readonly b: Float32Array;
    readonly c: Float32Array;
  };
  readonly waste: Float32Array;
}

/**
 * Normalize the existing environmental World inputs without inferring ecology.
 * Each field value remains the authoritative stock/capacity ratio at its grid
 * cell. Organism encoding stays in the existing organismEncoding module.
 */
export function projectWorldPresentation(
  snapshot: RenderSnapshot,
): WorldPresentation {
  const n = snapshot.resources.gridSize;
  const cells = n * n;
  const a = new Float32Array(cells);
  const b = new Float32Array(cells);
  const c = new Float32Array(cells);
  const waste = new Float32Array(cells);
  fracArray(snapshot.resources.stock, snapshot.resources.capacity, 0, a);
  fracArray(snapshot.resources.stock, snapshot.resources.capacity, 1, b);
  fracArray(snapshot.resources.stock, snapshot.resources.capacity, 2, c);
  fillWaste(snapshot.waste, waste);

  return {
    gridSize: n,
    nutrients: { a, b, c },
    waste,
  };
}
