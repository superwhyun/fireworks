export class Rng {
  private s: number

  constructor(seed = Math.random() * 0xffffffff) {
    this.s = seed >>> 0 || 1
  }

  next(): number {
    this.s ^= this.s << 13
    this.s ^= this.s >>> 17
    this.s ^= this.s << 5
    this.s >>>= 0
    return this.s / 0x100000000
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next()
  }

  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1))
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]
  }

  unitSphere(out: [number, number, number]): [number, number, number] {
    const u = this.next() * 2 - 1
    const t = this.next() * Math.PI * 2
    const r = Math.sqrt(1 - u * u)
    out[0] = r * Math.cos(t)
    out[1] = u
    out[2] = r * Math.sin(t)
    return out
  }
}
