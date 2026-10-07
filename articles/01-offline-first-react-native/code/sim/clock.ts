/** Simulated time. Nothing in the simulator ever waits on a real timer. */
export class SimClock {
  private t = 0;
  readonly now = (): number => this.t;

  advance(ms: number): void {
    this.t += ms;
  }

  advanceTo(ms: number): void {
    this.t = Math.max(this.t, ms);
  }
}

/** Small, fast, seedable PRNG (mulberry32), so every run is reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
