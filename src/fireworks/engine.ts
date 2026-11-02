import { Color, Group } from 'three'
import { SpriteLayer } from './glow'
import {
  F_CHANGE,
  F_CRACKLE,
  F_EMBER,
  F_FISH,
  F_FLICKER,
  F_GLITTER,
  F_HOT,
  F_SPLIT,
  F_STROBE,
  F_SUBSHELL,
  F_TRAIL,
  PARAM,
  commitPool,
  createPool,
  killParticle,
  spawnParticle,
  type ParticlePool,
  type RGB,
  type SpawnArgs,
} from './particles'
import { Rng } from './rng'
import { GOLD, SHELL_PATTERNS, SILVER, type PatternId, type ShellPattern } from './patterns'

export type Quality = 'low' | 'medium' | 'high'

const QUALITY_SCALE: Record<Quality, number> = { low: 0.4, medium: 0.7, high: 1 }
export const GRAVITY = 9.8
/** shells rise faster than real time so the audience doesn't wait 5 s per shell */
const SHELL_G = 34
const MAX_POOL = 200000
/** Star HDR multiplier — values above 1 feed the bloom pass. */
const HOT = 1.8

export type TailStyle = 'gold' | 'glitter' | 'crackle' | 'silver' | 'none'

interface Shell {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  age: number
  fuse: number
  pattern: ShellPattern
  colors: RGB[]
  scale: number
  density: number
  tail: TailStyle
  tailTimer: number
  seed: number
  burn: number
  snap: number
  whistle: boolean
}

export interface LaunchOptions {
  pattern: PatternId
  /** hex colours of the palette for this shell */
  colors: string[]
  from: [number, number]
  to: [number, number, number]
  /** burst radius multiplier (1 ≈ 55 world units) */
  scale?: number
  /** star count multiplier */
  density?: number
  tail?: TailStyle
  /** extra delay before leaving the ground (seconds) */
  delay?: number
  /** star burn-time multiplier (how long it hangs in the sky) */
  burn?: number
  /** expansion snappiness multiplier */
  snap?: number
  whistle?: boolean
}

export type BurstKind = 'boom' | 'salute' | 'crackle' | 'heavy' | 'soft' | 'strobe' | 'pop'

export interface BurstEvent {
  x: number
  y: number
  z: number
  size: number
  kind: BurstKind
  /** approx. seconds the stars keep burning */
  duration: number
}

export interface LaunchEvent {
  x: number
  z: number
  fuse: number
  whistle: boolean
}

const tmp = new Color()
function rgb(hex: string, mul = 1): RGB {
  tmp.set(hex)
  return { r: tmp.r * mul, g: tmp.g * mul, b: tmp.b * mul }
}
function scaleRGB(c: RGB, m: number): RGB {
  return { r: c.r * m, g: c.g * m, b: c.b * m }
}
function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }
}
/** colour a star fades toward at the end of its life */
function emberOf(c: RGB): RGB {
  return { r: c.r * 0.55 + 0.25, g: c.g * 0.25 + 0.04, b: c.b * 0.12 }
}

const GOLD_RGB = rgb(GOLD, 1.6)
const SILVER_RGB = rgb(SILVER, 1.7)
const WHITE_RGB = { r: 2.4, g: 2.3, b: 2.1 }
const EMBER_RGB = { r: 0.5, g: 0.09, b: 0.01 }

interface Pending {
  at: number
  shell: Shell
}

export class FireworksEngine {
  readonly group = new Group()
  onBurst: ((e: BurstEvent) => void) | null = null
  onLaunch: ((e: LaunchEvent) => void) | null = null
  /** current sky illumination from bursts (linear rgb, unbounded) */
  readonly skyLight = new Color(0, 0, 0)

  private pool: ParticlePool
  private glow: SpriteLayer
  private smoke: SpriteLayer
  private shells: Shell[] = []
  private pending: Pending[] = []
  private rng = new Rng()
  private quality: Quality = 'high'
  private clock = 0
  private wind = 1.2

  constructor(quality: Quality = 'high') {
    this.pool = createPool(MAX_POOL)
    this.glow = new SpriteLayer(400, { mirror: true, renderOrder: 9 })
    this.smoke = new SpriteLayer(1600, { smoke: true, renderOrder: 5 })
    this.group.add(this.smoke.points)
    this.group.add(this.pool.mirror)
    this.group.add(this.pool.lineMirror)
    if (this.glow.mirror) this.group.add(this.glow.mirror)
    this.group.add(this.glow.points)
    this.group.add(this.pool.lines)
    this.group.add(this.pool.points)
    this.setQuality(quality)
  }

  setQuality(q: Quality): void {
    this.quality = q
  }

  get activeParticles(): number {
    return this.pool.alive
  }

  get activeShells(): number {
    return this.shells.length + this.pending.length
  }

  setPixelScale(scale: number): void {
    this.pool.setPixelScale(scale)
    this.glow.setPixelScale(scale)
    this.smoke.setPixelScale(scale)
  }

  clear(): void {
    this.pool.alive = 0
    this.shells.length = 0
    this.pending.length = 0
    this.glow.clear()
    this.smoke.clear()
    this.skyLight.setRGB(0, 0, 0)
    commitPool(this.pool)
  }

  resolvePattern(p: PatternId): ShellPattern {
    return p === 'random' ? this.rng.pick(SHELL_PATTERNS) : p
  }

  /** Launch a shell from the ground so that it bursts at `to`. Returns flight time. */
  launch(o: LaunchOptions): number {
    const [tx, ty, tz] = o.to
    const [fx, fz] = o.from
    const h = Math.max(10, ty - 1)
    const vy = Math.sqrt(2 * SHELL_G * h)
    const t = vy / SHELL_G
    const shell: Shell = {
      x: fx,
      y: 1,
      z: fz,
      vx: (tx - fx) / t,
      vy,
      vz: (tz - fz) / t,
      age: 0,
      fuse: t * 0.97,
      pattern: this.resolvePattern(o.pattern),
      colors: o.colors.map((c) => rgb(c, HOT)),
      scale: o.scale ?? 1,
      density: o.density ?? 1,
      tail: o.tail ?? 'gold',
      tailTimer: 0,
      seed: Math.floor(this.rng.next() * 0xffffff),
      burn: o.burn ?? 1,
      snap: o.snap ?? 1,
      whistle: o.whistle ?? false,
    }
    if (o.delay && o.delay > 0) {
      this.pending.push({ at: this.clock + o.delay, shell })
    } else {
      this.shells.push(shell)
      this.onLaunch?.({ x: shell.x, z: shell.z, fuse: shell.fuse, whistle: shell.whistle })
    }
    return shell.fuse + (o.delay ?? 0)
  }

  /** Burst a shell immediately at a point (no rise). */
  burstAt(pattern: PatternId, colors: string[], x: number, y: number, z: number, scale = 1): void {
    this.burst({
      x,
      y,
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      age: 0,
      fuse: 0,
      pattern: this.resolvePattern(pattern),
      colors: colors.map((c) => rgb(c, HOT)),
      scale,
      density: 1,
      tail: 'none',
      tailTimer: 0,
      seed: Math.floor(this.rng.next() * 0xffffff),
      burn: 1,
      snap: 1,
      whistle: false,
    })
  }

  update(dt: number, t: number): void {
    this.clock += dt
    if (this.pending.length) {
      for (let i = this.pending.length - 1; i >= 0; i--) {
        if (this.pending[i].at <= this.clock) {
          const s = this.pending[i].shell
          this.pending.splice(i, 1)
          this.shells.push(s)
          this.onLaunch?.({ x: s.x, z: s.z, fuse: s.fuse, whistle: s.whistle })
        }
      }
    }

    let w = 0
    for (let i = 0; i < this.shells.length; i++) {
      const s = this.shells[i]
      s.age += dt
      s.vy -= SHELL_G * dt
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.z += s.vz * dt
      this.emitTail(s, dt)
      if (s.age >= s.fuse) {
        this.burst(s)
        continue
      }
      this.shells[w++] = s
    }
    this.shells.length = w

    this.simulate(dt, t)
    this.glow.update(dt)
    this.smoke.setLight(this.skyLight)
    this.smoke.update(dt)
    const k = Math.exp(-dt * 3.2)
    this.skyLight.multiplyScalar(k)
    this.pool.setTime(t)
    commitPool(this.pool)
  }

  // ---------------------------------------------------------------- simulate

  private simulate(dt: number, t: number): void {
    const pool = this.pool
    const { positions: pos, vel, life, phys, colA, colB, colors, sizes, alphas, baseSize, flags, param } =
      pool
    const { linePos, lineCol, streak } = pool
    const g = GRAVITY * dt
    const wind = this.wind * dt
    const load = pool.alive / pool.capacity
    const trailKeep = load < 0.7 ? 1 : Math.max(0.05, (1 - load) / 0.3)

    for (let i = 0; i < pool.alive; i++) {
      const i2 = i * 2
      const i3 = i * 3
      const i6 = i * PARAM
      const f = flags[i]
      const max = life[i2 + 1]
      const rem = life[i2] - dt
      if (rem <= 0 || pos[i3 + 1] < 0) {
        if (f & F_CRACKLE && rem <= 0) this.crackleAt(i)
        killParticle(pool, i)
        i--
        continue
      }
      life[i2] = rem
      const age = max - rem
      const tt = age / max

      // trigger events (split / subshell)
      if (f & (F_SPLIT | F_SUBSHELL) && tt >= param[i6]) {
        if (f & F_SPLIT) this.splitAt(i)
        else this.subshellAt(i)
        killParticle(pool, i)
        i--
        continue
      }

      // physics
      const drag = Math.exp(-phys[i2 + 1] * dt)
      let vx = vel[i3] * drag + wind * 0.15
      let vy = (vel[i3 + 1] - g * phys[i2]) * drag
      let vz = vel[i3 + 2] * drag
      if (f & F_FISH) {
        const ph = param[i6 + 3] + age * 13
        const amp = 26 * dt
        vx += Math.sin(ph) * amp
        vz += Math.cos(ph * 1.3) * amp
        vy += Math.sin(ph * 0.7) * amp * 0.6
      }
      vel[i3] = vx
      vel[i3 + 1] = vy
      vel[i3 + 2] = vz
      pos[i3] += vx * dt
      pos[i3 + 1] += vy * dt
      pos[i3 + 2] += vz * dt

      // trail sparks
      if (f & F_TRAIL) {
        let timer = param[i6 + 2] - dt
        if (timer <= 0) {
          timer += param[i6 + 1]
          if (trailKeep >= 1 || Math.random() < trailKeep) this.emitTrailSpark(i, tt)
        }
        param[i6 + 2] = timer
      }

      // colour
      let r: number
      let gg: number
      let b: number
      if (f & F_CHANGE) {
        const k = tt < param[i6] ? 0 : 1
        r = k ? colB[i3] : colA[i3]
        gg = k ? colB[i3 + 1] : colA[i3 + 1]
        b = k ? colB[i3 + 2] : colA[i3 + 2]
      } else {
        const k = f & F_EMBER ? Math.min(1, tt * 1.4) : tt * tt * tt
        r = colA[i3] + (colB[i3] - colA[i3]) * k
        gg = colA[i3 + 1] + (colB[i3 + 1] - colA[i3 + 1]) * k
        b = colA[i3 + 2] + (colB[i3 + 2] - colA[i3 + 2]) * k
      }
      if (f & F_HOT && age < 0.22) {
        const h = 1 - age / 0.22
        const hw = h * h * 2.2
        r += hw
        gg += hw
        b += hw
      }

      // alpha
      const lf = rem / max
      let a = f & F_EMBER ? lf * (0.4 + 0.6 * lf) : Math.min(1, lf * 3.2)
      if (f & F_STROBE && age > 0.35) {
        const ph = (param[i6 + 3] + age * 9) % 1
        a *= ph < 0.28 ? 1.6 : 0.02
      } else if (f & F_FLICKER) {
        const ph = param[i6 + 3]
        a *= 0.35 + 0.65 * Math.abs(Math.sin(t * 37 + ph) * Math.cos(t * 23 + ph * 1.7))
      }
      colors[i3] = r
      colors[i3 + 1] = gg
      colors[i3 + 2] = b
      alphas[i] = a
      sizes[i] = baseSize[i] * (f & F_EMBER ? 1 : 0.3 + 0.7 * lf)

      // motion-blur streak: head at the star, tail along -velocity
      const l6 = i * 6
      const px = pos[i3]
      const py = pos[i3 + 1]
      const pz = pos[i3 + 2]
      linePos[l6] = px
      linePos[l6 + 1] = py
      linePos[l6 + 2] = pz
      const st = streak[i]
      if (st > 0) {
        linePos[l6 + 3] = px - vx * st
        linePos[l6 + 4] = py - vy * st
        linePos[l6 + 5] = pz - vz * st
        const la = Math.min(1.2, a) * 0.85
        lineCol[l6] = r * la
        lineCol[l6 + 1] = gg * la
        lineCol[l6 + 2] = b * la
      } else {
        linePos[l6 + 3] = px
        linePos[l6 + 4] = py
        linePos[l6 + 5] = pz
        lineCol[l6] = 0
        lineCol[l6 + 1] = 0
        lineCol[l6 + 2] = 0
      }
      lineCol[l6 + 3] = 0
      lineCol[l6 + 4] = 0
      lineCol[l6 + 5] = 0
    }
  }

  private emitTrailSpark(i: number, tt: number): void {
    const pool = this.pool
    const i3 = i * 3
    const i6 = i * PARAM
    const glitter = pool.flags[i] & F_GLITTER
    const c = { r: pool.trailCol[i3], g: pool.trailCol[i3 + 1], b: pool.trailCol[i3 + 2] }
    const j = glitter ? 2.2 : 0.5
    spawnParticle(pool, {
      x: pool.positions[i3],
      y: pool.positions[i3 + 1],
      z: pool.positions[i3 + 2],
      vx: pool.vel[i3] * 0.08 + (Math.random() - 0.5) * j,
      vy: pool.vel[i3 + 1] * 0.08 + (Math.random() - 0.5) * j,
      vz: pool.vel[i3 + 2] * 0.08 + (Math.random() - 0.5) * j,
      life: pool.param[i6 + 4] * (0.6 + Math.random() * 0.6) * (1 - tt * 0.4),
      size: pool.param[i6 + 5] * (0.8 + Math.random() * 0.5),
      color: c,
      color2: EMBER_RGB,
      gravity: glitter ? 0.6 : 0.25,
      drag: glitter ? 2.2 : 3.2,
      flags: F_EMBER | (glitter ? F_FLICKER : 0),
    })
  }

  private crackleAt(i: number): void {
    const pool = this.pool
    const i3 = i * 3
    const n = this.quality === 'low' ? 3 : 6
    for (let k = 0; k < n; k++) {
      spawnParticle(pool, {
        x: pool.positions[i3],
        y: pool.positions[i3 + 1],
        z: pool.positions[i3 + 2],
        vx: (Math.random() - 0.5) * 22,
        vy: (Math.random() - 0.5) * 22,
        vz: (Math.random() - 0.5) * 22,
        life: 0.08 + Math.random() * 0.16,
        size: 1.1 + Math.random() * 0.8,
        color: WHITE_RGB,
        color2: GOLD_RGB,
        gravity: 0.2,
        drag: 5,
        flags: F_FLICKER,
      })
    }
    this.crackleCount++
  }

  /** number of crackle pops since last read (for sound) */
  crackleCount = 0
  /** number of crossette splits since last read (for sound) */
  splitCount = 0

  private splitAt(i: number): void {
    const pool = this.pool
    const i3 = i * 3
    const vx = pool.vel[i3]
    const vy = pool.vel[i3 + 1]
    const vz = pool.vel[i3 + 2]
    const sp = Math.hypot(vx, vy, vz) || 1
    // orthonormal basis around the travel direction
    const dx = vx / sp
    const dy = vy / sp
    const dz = vz / sp
    let ux = -dz
    let uy = 0
    let uz = dx
    const ul = Math.hypot(ux, uy, uz)
    if (ul < 0.1) {
      ux = 1
      uy = 0
      uz = 0
    } else {
      ux /= ul
      uz /= ul
    }
    const wx = dy * uz - dz * uy
    const wy = dz * ux - dx * uz
    const wz = dx * uy - dy * ux
    const c = { r: pool.colA[i3], g: pool.colA[i3 + 1], b: pool.colA[i3 + 2] }
    const s = 16 * pool.baseSize[i]
    const dirs = [
      [ux, uy, uz],
      [-ux, -uy, -uz],
      [wx, wy, wz],
      [-wx, -wy, -wz],
    ]
    for (const [ax, ay, az] of dirs) {
      spawnParticle(pool, {
        x: pool.positions[i3],
        y: pool.positions[i3 + 1],
        z: pool.positions[i3 + 2],
        vx: ax * s + dx * 3,
        vy: ay * s + dy * 3,
        vz: az * s + dz * 3,
        life: 1.1 + Math.random() * 0.4,
        size: pool.baseSize[i] * 0.85,
        color: c,
        color2: emberOf(c),
        gravity: 0.6,
        drag: 1.3,
        flags: F_TRAIL | F_HOT,
        streak: 0.06,
        trailInterval: 0.02,
        trailLife: 0.45,
        trailColor: mixRGB(c, GOLD_RGB, 0.5),
      })
    }
    this.glow.add({ x: pool.positions[i3], y: pool.positions[i3 + 1], z: pool.positions[i3 + 2], color: c, size: 10, intensity: 0.5, life: 0.18 })
    this.splitCount++
  }

  private subshellAt(i: number): void {
    const pool = this.pool
    const i3 = i * 3
    const c = { r: pool.colA[i3], g: pool.colA[i3 + 1], b: pool.colA[i3 + 2] }
    const x = pool.positions[i3]
    const y = pool.positions[i3 + 1]
    const z = pool.positions[i3 + 2]
    const n = Math.round(110 * QUALITY_SCALE[this.quality])
    const R = 20 * pool.baseSize[i]
    const dir: [number, number, number] = [0, 0, 0]
    for (let k = 0; k < n; k++) {
      fibDir(k, n, dir, Math.random() * 0.3)
      const s = R * (0.95 + Math.random() * 0.1)
      spawnParticle(pool, {
        x,
        y,
        z,
        vx: dir[0] * s,
        vy: dir[1] * s,
        vz: dir[2] * s,
        life: 1.4 + Math.random() * 0.5,
        size: 1.15,
        color: c,
        color2: emberOf(c),
        gravity: 0.6,
        drag: 1.3,
        flags: F_HOT | (Math.random() < 0.2 ? F_FLICKER : 0),
        streak: 0.05,
      })
    }
    this.flash(x, y, z, c, R * 0.9, 0.6)
    this.onBurst?.({ x, y, z, size: 0.45, kind: 'pop', duration: 1.6 })
  }

  // ---------------------------------------------------------------- shells

  private emitTail(s: Shell, dt: number): void {
    if (s.tail === 'none') return
    const pool = this.pool
    // bright shell head
    const headC = s.tail === 'silver' ? SILVER_RGB : GOLD_RGB
    spawnParticle(pool, {
      x: s.x,
      y: s.y,
      z: s.z,
      vx: s.vx,
      vy: s.vy,
      vz: s.vz,
      life: 0.04,
      size: 1.8,
      color: scaleRGB(headC, 1.2),
      gravity: 0,
      drag: 0,
      streak: 0.09,
    })
    s.tailTimer -= dt
    if (s.tailTimer > 0) return
    const glitter = s.tail === 'glitter' || s.tail === 'crackle'
    s.tailTimer = glitter ? 0.012 : 0.008
    const n = s.tail === 'crackle' ? 3 : 2
    for (let k = 0; k < n; k++) {
      const j = glitter ? 3.5 : 1.2
      spawnParticle(pool, {
        x: s.x + (Math.random() - 0.5) * 0.6,
        y: s.y - Math.random() * 1.5,
        z: s.z + (Math.random() - 0.5) * 0.6,
        vx: s.vx * 0.12 + (Math.random() - 0.5) * j,
        vy: s.vy * 0.12 + (Math.random() - 0.7) * j,
        vz: s.vz * 0.12 + (Math.random() - 0.5) * j,
        life: glitter ? 0.5 + Math.random() * 0.8 : 0.35 + Math.random() * 0.45,
        size: glitter ? 0.9 : 1.1,
        color: headC,
        color2: EMBER_RGB,
        gravity: 0.5,
        drag: 2.2,
        flags: F_EMBER | (glitter ? F_FLICKER : 0) | (s.tail === 'crackle' && Math.random() < 0.15 ? F_CRACKLE : 0),
      })
    }
  }

  private flash(x: number, y: number, z: number, c: RGB, R: number, amount: number): void {
    const w = mixRGB(c, WHITE_RGB, 0.6)
    this.glow.add({ x, y, z, color: w, size: R * 0.7, intensity: 0.9 * amount, life: 0.16 })
    this.glow.add({ x, y, z, color: c, size: R * 2.6, intensity: 0.09 * amount, life: 1.2 })
    const k = 0.03 * amount
    this.skyLight.r = Math.min(0.18, this.skyLight.r + c.r * k)
    this.skyLight.g = Math.min(0.18, this.skyLight.g + c.g * k)
    this.skyLight.b = Math.min(0.18, this.skyLight.b + c.b * k)
  }

  private puffSmoke(x: number, y: number, z: number, R: number, rng: Rng): void {
    const n = this.quality === 'low' ? 5 : 12
    const dir: [number, number, number] = [0, 0, 0]
    for (let i = 0; i < n; i++) {
      rng.unitSphere(dir)
      const r = R * rng.range(0.15, 0.6)
      const shade = rng.range(0.07, 0.12)
      this.smoke.add({
        x: x + dir[0] * r,
        y: y + dir[1] * r * 0.7,
        z: z + dir[2] * r,
        vx: this.wind + dir[0] * 1.2,
        vy: rng.range(-0.6, 0.3),
        vz: dir[2] * 1.2,
        color: { r: shade, g: shade * 1.05, b: shade * 1.25 },
        size: R * rng.range(0.5, 0.9),
        grow: R * 0.08,
        intensity: rng.range(0.04, 0.09),
        life: rng.range(7, 13),
      })
    }
  }

  private burst(s: Shell): void {
    const rng = new Rng(s.seed)
    const q = QUALITY_SCALE[this.quality]
    const d = s.density * q
    const R = 68 * s.scale
    const cols = s.colors.length ? s.colors : [rgb('#ffffff', HOT)]
    const pick = () => cols[Math.floor(rng.next() * cols.length)]
    const { x, y, z } = s
    const main = cols[0]
    let kind: BurstKind = 'boom'
    let duration = 2.5 * s.burn
    const burn = s.burn
    const snap = s.snap

    const star = (a: SpawnArgs) =>
      spawnParticle(this.pool, {
        ...a,
        vx: a.vx * snap,
        vy: a.vy * snap,
        vz: a.vz * snap,
        life: a.life * burn,
        drag: (a.drag ?? 0.9) * snap,
        streak: a.streak ?? (a.flags && a.flags & F_EMBER ? 0 : a.flags && a.flags & F_TRAIL ? 0.2 : 0.1),
      })

    // Generic spherical shell. speed ≈ R * drag so the shell ends at ~radius R.
    const sphere = (
      n: number,
      opts: {
        radius?: number
        life?: [number, number]
        size?: number
        drag?: number
        gravity?: number
        color?: () => RGB
        color2?: (c: RGB) => RGB
        flags?: number
        trail?: { interval: number; life: number; color?: (c: RGB) => RGB; size?: number }
        at?: number
        jitter?: number
      } = {},
    ) => {
      const count = Math.max(8, Math.round(n * d))
      const drag = opts.drag ?? 1.2
      const radius = opts.radius ?? R
      const dir: [number, number, number] = [0, 0, 0]
      const offset = rng.next()
      for (let i = 0; i < count; i++) {
        fibDir(i, count, dir, offset)
        const jit = opts.jitter ?? 0.05
        const sp = radius * drag * (1 + (rng.next() - 0.5) * 2 * jit)
        const c = opts.color ? opts.color() : pick()
        const [l0, l1] = opts.life ?? [2.2, 2.9]
        star({
          x,
          y,
          z,
          vx: dir[0] * sp,
          vy: dir[1] * sp,
          vz: dir[2] * sp,
          life: rng.range(l0, l1),
          size: opts.size ?? 1.5,
          color: c,
          color2: opts.color2 ? opts.color2(c) : emberOf(c),
          drag,
          gravity: opts.gravity ?? 0.9,
          flags: (opts.flags ?? 0) | F_HOT | (opts.trail ? F_TRAIL : 0),
          at: opts.at,
          trailInterval: opts.trail?.interval,
          trailLife: opts.trail?.life,
          trailColor: opts.trail ? (opts.trail.color ? opts.trail.color(c) : c) : undefined,
          trailSize: opts.trail?.size,
        })
      }
    }

    // Stars placed along a planar outline (heart, star, ring...). The shape is
    // drawn in a plane roughly facing the audience (+z) with a random twist.
    const planar = (
      pts: [number, number][],
      opts: { color?: () => RGB; life?: [number, number]; size?: number; tilt?: number; flags?: number },
    ) => {
      const yaw = rng.range(-0.45, 0.45)
      const tilt = opts.tilt ?? rng.range(-0.25, 0.25)
      const roll = rng.range(-0.25, 0.25)
      const cy = Math.cos(yaw)
      const sy = Math.sin(yaw)
      const ct = Math.cos(tilt)
      const st = Math.sin(tilt)
      const cr = Math.cos(roll)
      const sr = Math.sin(roll)
      const drag = 1.3
      for (const [px0, py0] of pts) {
        // roll in plane
        const px = px0 * cr - py0 * sr
        const py = px0 * sr + py0 * cr
        // tilt around x, then yaw around y
        const ty = py * ct
        const tz = py * st
        const vx = px * cy + tz * sy
        const vz = -px * sy + tz * cy
        const c = opts.color ? opts.color() : main
        const sp = R * drag
        star({
          x,
          y,
          z,
          vx: vx * sp,
          vy: ty * sp,
          vz: vz * sp,
          life: rng.range(...(opts.life ?? [2.3, 2.7])),
          size: opts.size ?? 1.6,
          color: c,
          color2: emberOf(c),
          drag,
          gravity: 0.25,
          flags: F_HOT | (opts.flags ?? 0),
        })
      }
    }

    switch (s.pattern) {
      case 'peony':
        sphere(420, { flags: rng.next() < 0.3 ? F_FLICKER : 0 })
        break
      case 'chrysanthemum':
        sphere(360, {
          trail: { interval: 0.016, life: 0.75, color: () => GOLD_RGB, size: 0.8 },
          life: [2.4, 3.0],
        })
        break
      case 'dahlia':
        sphere(110, {
          size: 2.6,
          jitter: 0.08,
          trail: { interval: 0.016, life: 1.0, size: 1.3 },
          life: [2.4, 3.0],
        })
        break
      case 'willow':
        sphere(240, {
          drag: 1.6,
          gravity: 0.32,
          life: [4.6, 5.8],
          size: 1.3,
          color: () => GOLD_RGB,
          color2: () => scaleRGB(GOLD_RGB, 0.35),
          flags: F_GLITTER,
          trail: { interval: 0.018, life: 1.8, color: () => scaleRGB(GOLD_RGB, 0.9), size: 0.8 },
        })
        sphere(60, { radius: R * 0.25, life: [1.2, 1.6], size: 1.4 })
        break
      case 'kamuro':
        sphere(360, {
          drag: 1.45,
          gravity: 0.3,
          life: [4.8, 6.0],
          size: 1.5,
          color: () => mixRGB(GOLD_RGB, WHITE_RGB, 0.15),
          color2: () => scaleRGB(GOLD_RGB, 0.3),
          flags: F_FLICKER | F_GLITTER,
          trail: { interval: 0.022, life: 2.1, color: () => GOLD_RGB, size: 0.9 },
        })
        break
      case 'palm': {
        const arms = rng.int(7, 10)
        const c = pick()
        for (let a = 0; a < arms; a++) {
          const th = (a / arms) * Math.PI * 2 + rng.range(-0.15, 0.15)
          const ph = rng.range(0.35, 1.25)
          const dx = Math.sin(ph) * Math.cos(th)
          const dy = Math.cos(ph)
          const dz = Math.sin(ph) * Math.sin(th)
          const sp = R * 1.25
          for (let k = 0; k < 3; k++) {
            const f = 1 - k * 0.12
            star({
              x,
              y,
              z,
              vx: dx * sp * f,
              vy: dy * sp * f,
              vz: dz * sp * f,
              life: rng.range(2.6, 3.2),
              size: k === 0 ? 3.0 : 1.6,
              color: k === 0 ? c : GOLD_RGB,
              color2: emberOf(GOLD_RGB),
              drag: 1.0,
              gravity: 0.9,
              flags: F_HOT | F_TRAIL | F_GLITTER,
              trailInterval: k === 0 ? 0.01 : 0.03,
              trailLife: 1.2,
              trailColor: GOLD_RGB,
              trailSize: 1.2,
            })
          }
        }
        break
      }
      case 'ring': {
        const rings = rng.next() < 0.4 ? 2 : 1
        for (let r = 0; r < rings; r++) {
          const n = Math.round(160 * d)
          const pts: [number, number][] = []
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2
            pts.push([Math.cos(a), Math.sin(a)])
          }
          const c = cols[r % cols.length]
          planar(pts, { color: () => c, tilt: rng.range(-1.2, 1.2), size: 1.7 })
        }
        sphere(40, { radius: R * 0.18, color: () => WHITE_RGB, life: [1.0, 1.4] })
        break
      }
      case 'saturn': {
        const c1 = cols[0]
        const c2 = cols[1 % cols.length]
        sphere(220, { radius: R * 0.55, color: () => c1, life: [2.2, 2.6] })
        const n = Math.round(200 * d)
        const pts: [number, number][] = []
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2
          pts.push([Math.cos(a) * 1.15, Math.sin(a) * 1.15])
        }
        planar(pts, { color: () => c2, tilt: rng.range(1.0, 1.35) * (rng.next() < 0.5 ? 1 : -1), life: [2.4, 2.8] })
        break
      }
      case 'heart': {
        const n = Math.round(170 * d)
        const pts: [number, number][] = []
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2
          const hx = 16 * Math.sin(a) ** 3
          const hy = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)
          pts.push([hx / 17, (hy + 2) / 17])
        }
        const c = cols.find((cc) => cc.r > cc.b) ?? rgb('#ff2d6f', HOT)
        planar(pts, { color: () => c, tilt: rng.range(-0.15, 0.15) })
        sphere(50, { radius: R * 0.2, color: () => WHITE_RGB, life: [1.0, 1.5], flags: F_FLICKER })
        break
      }
      case 'star': {
        const n = Math.round(200 * d)
        const pts: [number, number][] = []
        const verts: [number, number][] = []
        for (let v = 0; v < 10; v++) {
          const a = (v / 10) * Math.PI * 2 + Math.PI / 2
          const r = v % 2 === 0 ? 1 : 0.42
          verts.push([Math.cos(a) * r, Math.sin(a) * r])
        }
        for (let i = 0; i < n; i++) {
          const f = (i / n) * 10
          const v = Math.floor(f)
          const k = f - v
          const [ax, ay] = verts[v]
          const [bx, by] = verts[(v + 1) % 10]
          pts.push([ax + (bx - ax) * k, ay + (by - ay) * k])
        }
        const c = pick()
        planar(pts, { color: () => c, tilt: rng.range(-0.15, 0.15) })
        sphere(40, { radius: R * 0.15, color: () => GOLD_RGB, life: [1.0, 1.4] })
        break
      }
      case 'spiral': {
        const arms = rng.int(4, 6)
        const per = Math.round(70 * d)
        const twist = rng.range(1.6, 2.4) * (rng.next() < 0.5 ? 1 : -1)
        const tilt = rng.range(0.6, 1.3)
        const ct = Math.cos(tilt)
        const st = Math.sin(tilt)
        for (let a = 0; a < arms; a++) {
          const c = cols[a % cols.length]
          for (let i = 0; i < per; i++) {
            const k = (i + 1) / per
            const ang = (a / arms) * Math.PI * 2 + k * twist
            const px = Math.cos(ang) * k
            const pz = Math.sin(ang) * k
            const sp = R * 1.3
            star({
              x,
              y,
              z,
              vx: px * sp,
              vy: pz * st * sp + rng.range(-0.5, 0.5),
              vz: pz * ct * sp,
              life: rng.range(2.4, 2.9),
              size: 1.5,
              color: c,
              color2: emberOf(c),
              drag: 1.3,
              gravity: 0.35,
              flags: F_HOT | (i % 6 === 0 ? F_TRAIL : 0),
              trailInterval: 0.03,
              trailLife: 0.6,
            })
          }
        }
        break
      }
      case 'crossette':
        sphere(34, {
          size: 2.0,
          life: [2.4, 2.8],
          drag: 1.1,
          radius: R * 0.75,
          flags: F_SPLIT,
          at: 0.42,
          trail: { interval: 0.014, life: 0.6, color: () => GOLD_RGB, size: 1.1 },
        })
        break
      case 'salute': {
        kind = 'salute'
        duration = 0.6
        sphere(160, {
          radius: R * 0.45,
          drag: 3.2,
          life: [0.25, 0.5],
          size: 1.4,
          color: () => mixRGB(SILVER_RGB, WHITE_RGB, 0.5),
          flags: F_FLICKER,
        })
        this.glow.add({ x, y, z, color: WHITE_RGB, size: R * 0.8, intensity: 1.4, life: 0.08 })
        break
      }
      case 'crackle':
        kind = 'crackle'
        sphere(240, {
          color: () => (rng.next() < 0.5 ? GOLD_RGB : pick()),
          life: [1.5, 2.3],
          size: 1.3,
          flags: F_CRACKLE,
          trail: { interval: 0.04, life: 0.5, color: () => GOLD_RGB, size: 0.8 },
        })
        break
      case 'strobe':
        sphere(260, {
          color: () => (rng.next() < 0.75 ? WHITE_RGB : pick()),
          life: [3.6, 4.6],
          drag: 1.35,
          gravity: 0.25,
          size: 1.2,
          flags: F_STROBE,
        })
        break
      case 'pistil': {
        const inner = cols[0]
        const outer = cols.length > 1 ? cols[1] : mixRGB(inner, WHITE_RGB, 0.5)
        sphere(200, { radius: R * 0.45, color: () => inner, life: [1.8, 2.2], size: 1.3 })
        sphere(320, {
          color: () => outer,
          trail: { interval: 0.035, life: 0.6, size: 0.9 },
          life: [2.5, 3.0],
        })
        break
      }
      case 'changer': {
        const others = cols.length > 1 ? cols : [main, rgb('#30d1ff', HOT)]
        let k = 0
        sphere(380, {
          flags: F_CHANGE,
          at: rng.range(0.38, 0.5),
          color: () => others[k++ % others.length],
          color2: (c) => {
            const idx = others.indexOf(c)
            return others[(idx + 1 + Math.floor(others.length / 2)) % others.length]
          },
          life: [2.6, 3.2],
        })
        break
      }
      case 'fish':
        sphere(80, {
          flags: F_FISH,
          radius: R * 0.55,
          life: [2.2, 2.8],
          size: 1.3,
          color: () => (rng.next() < 0.5 ? SILVER_RGB : pick()),
          trail: { interval: 0.02, life: 0.5, size: 0.8 },
        })
        sphere(80, { radius: R * 0.7, life: [1.4, 1.8], size: 1.2 })
        break
      case 'waterfall': {
        const n = Math.round(200 * d)
        for (let i = 0; i < n; i++) {
          const th = rng.range(0, Math.PI * 2)
          const ph = rng.range(Math.PI * 0.45, Math.PI * 0.9) // horizontal → downward
          const dx = Math.sin(ph) * Math.cos(th)
          const dy = Math.cos(ph)
          const dz = Math.sin(ph) * Math.sin(th)
          const sp = R * rng.range(0.5, 0.9)
          star({
            x,
            y,
            z,
            vx: dx * sp,
            vy: dy * sp,
            vz: dz * sp,
            life: rng.range(4.5, 6),
            size: 1.3,
            color: i % 4 === 0 ? pick() : GOLD_RGB,
            color2: scaleRGB(GOLD_RGB, 0.3),
            drag: 0.9,
            gravity: 0.7,
            flags: F_HOT | F_TRAIL | F_GLITTER | F_FLICKER,
            trailInterval: 0.05,
            trailLife: 1.6,
            trailColor: GOLD_RGB,
            trailSize: 0.9,
          })
        }
        break
      }
      case 'multibreak': {
        let k = 0
        sphere(9, {
          radius: R * 0.85,
          flags: F_SUBSHELL,
          at: 0.4 + rng.next() * 0.15,
          life: [2.0, 2.4],
          size: 1.3,
          color: () => cols[k++ % cols.length],
          trail: { interval: 0.012, life: 0.5, color: () => GOLD_RGB, size: 1.0 },
        })
        break
      }
      case 'brocade':
        sphere(300, {
          life: [3.0, 3.6],
          drag: 1.3,
          gravity: 0.5,
          size: 1.6,
          flags: F_GLITTER,
          trail: { interval: 0.03, life: 1.2, color: () => GOLD_RGB, size: 1.0 },
        })
        break
    }

    switch (s.pattern) {
      case 'kamuro':
      case 'willow':
      case 'waterfall':
      case 'brocade':
        kind = 'heavy'
        duration = 4.5 * burn
        break
      case 'strobe':
        kind = 'strobe'
        duration = 4 * burn
        break
      case 'heart':
      case 'star':
      case 'ring':
      case 'fish':
        kind = 'soft'
        break
    }
    this.flash(x, y, z, main, R, Math.min(1.6, s.scale))
    this.puffSmoke(x, y, z, R, rng)
    this.onBurst?.({ x, y, z, size: s.scale, kind, duration })
  }

  dispose(): void {
    this.pool.geometry.dispose()
    this.pool.material.dispose()
    this.pool.mirrorMaterial.dispose()
    this.glow.dispose()
    this.smoke.dispose()
  }
}

/** Evenly spread unit vectors (Fibonacci sphere) with a slight random offset. */
function fibDir(i: number, n: number, out: [number, number, number], offset: number): void {
  const golden = 2.399963229728653
  const yy = 1 - ((i + 0.5) / n) * 2
  const r = Math.sqrt(Math.max(0, 1 - yy * yy))
  const th = golden * i + offset * Math.PI * 2
  out[0] = Math.cos(th) * r
  out[1] = yy
  out[2] = Math.sin(th) * r
}
