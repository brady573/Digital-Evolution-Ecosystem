/**
 * Deterministic streams for the voxel spike. Splitmix-style generator;
 * each purpose gets an independent stream from the master seed so that
 * consuming randomness in one subsystem never perturbs another.
 */
export class VoxelRng {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    let z = (this.#state += 0x9e3779b9) >>> 0;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return ((z ^ (z >>> 15)) >>> 0) / 4294967296;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  getState(): number {
    return this.#state >>> 0;
  }

  setState(state: number): void {
    this.#state = state >>> 0;
  }
}
