/**
 * Exact TypeScript extraction of the prototype's deterministic RNG.
 * Do not change this algorithm during migration.
 */
export class DeterministicRng {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0;
  }

  next(): number {
    let a = this.#state | 0;
    a = (a + 0x6d2b79f5) | 0;
    this.#state = a >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  getState(): number { return this.#state >>> 0; }
  setState(state: number): void { this.#state = state >>> 0; }

  clone(): DeterministicRng {
    const clone = new DeterministicRng(0);
    clone.setState(this.getState());
    return clone;
  }
}
