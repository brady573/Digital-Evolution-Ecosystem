import { VoxelRng } from "./rng";

export interface VoxelConfig {
  readonly seed: number;
  /** Lattice dimensions (portrait by default). */
  readonly width: number;
  readonly height: number;
  /** Founding voxels. */
  readonly population: number;
  /** 0..1 patchiness of the abiotic capacity map. */
  readonly patchiness: number;
  /** A/B share of capacity (0..1). */
  readonly variety: number;
  /** Environmental regeneration rate. */
  readonly regen: number;
  /** Survival cost multiplier. */
  readonly pressure: number;
  /** Mutation probability per trait per reproduction. */
  readonly mutationChance: number;
  /** Mutation step size. */
  readonly mutationSize: number;
}

export interface VoxelOrganism {
  id: number;
  cell: number;
  generation: number;
  born: number;
  energy: number;
  /** -1 (A specialist) .. +1 (B specialist). */
  diet: number;
  /** 0.5..1.5 assimilation efficiency. */
  efficiency: number;
  /** 0..1.5 C access. */
  byproductUse: number;
  /** 0..1.5 dormancy readiness. */
  dormancyResponse: number;
  /** Energy needed to reproduce. */
  reproThreshold: number;
  activity: "active" | "dormant";
  dormantSince: number | null;
  aEaten: number;
  bEaten: number;
  cEaten: number;
}

const NEIGHBORS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

const C_YIELD = 6;
const C_EXCRETE = 0.3;
const C_DECAY = 0.002;

export class VoxelWorld {
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly tick = 0;
  private t = 0;
  private cfg: VoxelConfig;
  private rngInit: VoxelRng;
  private rngPick: VoxelRng;
  private rngMut: VoxelRng;
  private capA: Float32Array;
  private capB: Float32Array;
  private stockA: Float32Array;
  private stockB: Float32Array;
  private stockC: Float32Array;
  private occupant: Int32Array;
  private organisms = new Map<number, VoxelOrganism>();
  private nextId = 1;

  constructor(config: VoxelConfig) {
    this.cfg = config;
    this.width = config.width;
    this.height = config.height;
    this.size = config.width * config.height;
    this.rngInit = new VoxelRng((config.seed ^ 0x11ab3d7d) >>> 0);
    this.rngPick = new VoxelRng((config.seed ^ 0x5bd1e995) >>> 0);
    this.rngMut = new VoxelRng((config.seed ^ 0x85ebca6b) >>> 0);
    this.capA = new Float32Array(this.size);
    this.capB = new Float32Array(this.size);
    this.stockA = new Float32Array(this.size);
    this.stockB = new Float32Array(this.size);
    this.stockC = new Float32Array(this.size);
    this.occupant = new Int32Array(this.size).fill(-1);
    this.buildCapacity();
    this.seedFounders();
  }

  get time(): number {
    return this.t;
  }

  get count(): number {
    return this.organisms.size;
  }

  private cellOf(x: number, y: number): number {
    const xx = ((x % this.width) + this.width) % this.width;
    const yy = ((y % this.height) + this.height) % this.height;
    return yy * this.width + xx;
  }

  private buildCapacity(): void {
    const { patchiness, variety } = this.cfg;
    const total = 2400;
    const shareB = Math.max(0, Math.min(1, variety));
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const i = y * this.width + x;
        const nx = x / this.width - 0.5;
        const ny = y / this.height - 0.5;
        const patchA = Math.exp(-((nx + 0.22) ** 2 + ny ** 2) / 0.08);
        const patchB = Math.exp(-((nx - 0.22) ** 2 + ny ** 2) / 0.08);
        const noise = 0.75 + 0.5 * this.rngInit.next();
        const wA = (1 - patchiness * 0.85) + patchiness * 2.4 * patchA;
        const wB = (1 - patchiness * 0.85) + patchiness * 2.4 * patchB;
        this.capA[i] = ((total * (1 - shareB)) / this.size) * wA * noise;
        this.capB[i] = ((total * shareB) / this.size) * wB * noise;
        this.stockA[i] = this.capA[i] * 0.6;
        this.stockB[i] = this.capB[i] * 0.6;
      }
    }
  }

  private seedFounders(): void {
    const { population } = this.cfg;
    for (let k = 0; k < population; k++) {
      const cell = this.rngInit.int(this.size);
      if (this.occupant[cell] !== -1) continue;
      const id = this.nextId++;
      const diet = this.rngInit.next() * 2 - 1;
      const org: VoxelOrganism = {
        id, cell, generation: 0, born: 0, energy: 40,
        diet,
        efficiency: 0.85 + this.rngInit.next() * 0.3,
        byproductUse: 0.05 + this.rngInit.next() * 0.2,
        dormancyResponse: 0.2 + this.rngInit.next() * 0.5,
        reproThreshold: 90,
        activity: "active", dormantSince: null,
        aEaten: 0, bEaten: 0, cEaten: 0,
      };
      this.occupant[cell] = id;
      this.organisms.set(id, org);
    }
  }

  private access(o: VoxelOrganism, kind: 0 | 1 | 2): number {
    if (kind === 2) {
      const v = Math.max(0, Math.min(1.5, o.byproductUse));
      return v <= 0 ? 0 : (v * v) / (v * v + 0.1024);
    }
    const match = kind === 0 ? -o.diet : o.diet;
    return 0.35 + 0.9 * ((Math.tanh(1.2 * match) + 1) / 2);
  }

  private mutate(value: number, lo: number, hi: number): number {
    const { mutationChance, mutationSize } = this.cfg;
    if (this.rngMut.next() >= mutationChance) return value;
    const next = value + (this.rngMut.next() * 2 - 1) * mutationSize;
    return Math.max(lo, Math.min(hi, next));
  }

  step(): void {
    this.t++;
    const { regen, pressure } = this.cfg;
    for (let i = 0; i < this.size; i++) {
      this.stockA[i] += (this.capA[i] - this.stockA[i]) * regen;
      this.stockB[i] += (this.capB[i] - this.stockB[i]) * regen;
      this.stockC[i] *= 1 - C_DECAY;
    }
    const ids = [...this.organisms.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      const o = this.organisms.get(id);
      if (!o) continue;
      const cell = o.cell;
      if (o.activity === "dormant") {
        const rich = this.stockA[cell] + this.stockB[cell] + this.stockC[cell];
        const cap = this.capA[cell] + this.capB[cell] + 1e-9;
        if (rich / cap > 0.35 + 0.2 * o.dormancyResponse) {
          o.activity = "active";
          o.dormantSince = null;
        } else {
          o.energy -= 0.12 * pressure;
          if (o.energy <= 0) {
            this.organisms.delete(id);
            this.occupant[cell] = -1;
          }
          continue;
        }
      } else {
        const rich = this.stockA[cell] + this.stockB[cell] + this.stockC[cell];
        const cap = this.capA[cell] + this.capB[cell] + 1e-9;
        const stress = o.energy < o.reproThreshold * 0.4 && rich / cap < 0.15 + 0.15 * o.dormancyResponse;
        if (stress) {
          o.activity = "dormant";
          o.dormantSince = this.t;
          continue;
        }
      }
      // Feed: sessile voxels draw from their Moore neighborhood (root-like),
      // which makes crowded neighborhoods deplete and creates spatial
      // competition without movement. Uptake is capped so grazing is
      // sustainable against regeneration.
      const x = cell % this.width;
      const y = Math.floor(cell / this.width);
      const hood: number[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) hood.push(this.cellOf(x + dx, y + dy));
      }
      let best = -1;
      let kind: 0 | 1 | 2 = 0;
      for (const k of [0, 1, 2] as const) {
        const pool = hood.reduce((s, n) => s + (k === 0 ? this.stockA[n] : k === 1 ? this.stockB[n] : this.stockC[n]), 0);
        const score = pool * this.access(o, k);
        if (score > best) {
          best = score;
          kind = k;
        }
      }
      if (best > 0) {
        const pool = hood.reduce((s, n) => s + (kind === 0 ? this.stockA[n] : kind === 1 ? this.stockB[n] : this.stockC[n]), 0);
        const take = Math.min(pool * 0.25, 1.4);
        if (pool > 1e-9 && take > 1e-9) {
          for (const n of hood) {
            const have = kind === 0 ? this.stockA[n] : kind === 1 ? this.stockB[n] : this.stockC[n];
            const share = (have / pool) * take;
            if (kind === 0) this.stockA[n] -= share;
            else if (kind === 1) this.stockB[n] -= share;
            else this.stockC[n] -= share;
          }
          const yield_ = kind === 2 ? C_YIELD : 15;
          const gain = take * yield_ * o.efficiency * this.access(o, kind);
          o.energy += gain;
          if (kind === 0) {
            o.aEaten += take;
            this.stockC[cell] += take * C_EXCRETE;
          } else if (kind === 1) {
            o.bEaten += take;
            this.stockC[cell] += take * C_EXCRETE;
          } else {
            o.cEaten += take;
          }
        }
      }
      o.energy -= (0.9 + 0.008 * o.diet * o.diet + 0.01 * o.byproductUse * o.byproductUse) * pressure;
      if (o.energy <= 0) {
        this.organisms.delete(id);
        this.occupant[cell] = -1;
        continue;
      }
      if (o.energy >= o.reproThreshold) {
        const x = cell % this.width;
        const y = Math.floor(cell / this.width);
        const empty: number[] = [];
        for (const [dx, dy] of NEIGHBORS) {
          const n = this.cellOf(x + dx, y + dy);
          if (this.occupant[n] === -1) empty.push(n);
        }
        if (empty.length > 0) {
          const target = empty[this.rngPick.int(empty.length)];
          const childId = this.nextId++;
          const child: VoxelOrganism = {
            id: childId, cell: target, generation: o.generation + 1, born: this.t,
            energy: o.energy * 0.45,
            diet: this.mutate(o.diet, -1.5, 1.5),
            efficiency: this.mutate(o.efficiency, 0.5, 1.5),
            byproductUse: this.mutate(o.byproductUse, 0, 1.5),
            dormancyResponse: this.mutate(o.dormancyResponse, 0, 1.5),
            reproThreshold: o.reproThreshold,
            activity: "active", dormantSince: null,
            aEaten: 0, bEaten: 0, cEaten: 0,
          };
          o.energy *= 0.55;
          this.occupant[target] = childId;
          this.organisms.set(childId, child);
        }
      }
    }
  }

  metrics(): {
    tick: number;
    population: number;
    dormant: number;
    meanDiet: number;
    dietSpread: number;
    cShare: number;
    crossfeeders: number;
    stockTotal: number;
  } {
    let dormant = 0;
    let dietSum = 0;
    let cE = 0;
    let totalE = 0;
    let cross = 0;
    let stock = 0;
    const diets: number[] = [];
    for (const o of this.organisms.values()) {
      if (o.activity === "dormant") dormant++;
      dietSum += o.diet;
      diets.push(o.diet);
      const e = o.aEaten + o.bEaten + o.cEaten;
      totalE += e;
      cE += o.cEaten;
      if (e > 5 && o.cEaten / e >= 0.15 && o.byproductUse >= 0.35) cross++;
    }
    for (let i = 0; i < this.size; i++) stock += this.stockA[i] + this.stockB[i] + this.stockC[i];
    const n = this.organisms.size;
    const mean = n ? dietSum / n : 0;
    const spread = n ? Math.sqrt(diets.reduce((s, d) => s + (d - mean) ** 2, 0) / n) : 0;
    return {
      tick: this.t, population: n, dormant,
      meanDiet: mean, dietSpread: spread,
      cShare: totalE > 0 ? cE / totalE : 0,
      crossfeeders: n ? cross / n : 0,
      stockTotal: stock,
    };
  }

  /** Coarse deterministic fingerprint for replay checks. */
  hash(): string {
    let h = 0x811c9dc5;
    const mix = (v: number) => {
      h ^= Math.floor(v * 1000) & 0xffffffff;
      h = Math.imul(h, 0x01000193);
    };
    mix(this.t);
    mix(this.organisms.size);
    let e = 0;
    for (const o of this.organisms.values()) e += o.energy;
    mix(e);
    let s = 0;
    for (let i = 0; i < this.size; i += 7) s += this.stockA[i] + this.stockB[i] + this.stockC[i];
    mix(s);
    return (h >>> 0).toString(16);
  }
}
