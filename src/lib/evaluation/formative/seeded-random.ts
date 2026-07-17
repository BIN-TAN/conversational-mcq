export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next() {
    this.state += 0x6d2b79f5;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0) {
      throw new Error("seeded_random_empty_choice");
    }
    return values[Math.floor(this.next() * values.length)]!;
  }
}
