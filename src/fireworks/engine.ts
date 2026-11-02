import { Color, Group } from 'three'
import { GlowLayer } from './glow'
import { commitPool, createGlowTexture, createPool, killParticle, spawnParticle, type ParticlePool } from './particles'
import { Rng } from './rng'
import {
  PATTERNS,
  type BurstSpec,
  type Palette,
  type PatternId,
} from './patterns'

export type Quality = 'low' | 'medium' | 'high'

const QUALITY_SCALE: Record<Quality, number> = { low: 0.5, medium: 0.8, high: 1 }
const GRAVITY = 9.2
const DRAG = 0.34
const MAX_POOL = 26000

const COLOR = new Color()

interface Shell {
  alive: boolean
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  age: number
  fuse: number
  spec: BurstSpec
  palette: Palette
  size: number
  trailTimer: number
  seed: number
  crackleTail: boolean
  burstDelay: number
  burstOffsetX: number
  burstOffsetY: number
  burstOffsetZ: number
  burstSpeed: number
  burstCount: number
}

export interface LaunchOptions {
  pattern: PatternId
  palette: Palette
  count: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  size: number
  fuse: number
  crackleTail?: boolean
  burstDelay?: number
  burstOffset?: [number, number, number]
  burstSpeed?: number
  burstCount?: number
}

export interface LaunchResult {
  id: number
  fuse: number
  delay: number
  pattern: Exclude<PatternId, 'random'>
}

export class FireworksEngine {
  readonly group = new Group()
  onBurst: ((x: number, y: number, z: number, size: number) => void) | null = null
  private pool: ParticlePool
  private glow: GlowLayer
  private glowTexture = createGlowTexture(64)
  private shells: Shell[] = []
  private rng = new Rng()
  private quality: Quality = 'high'
  private shellSeq = 0

  constructor(quality: Quality = 'high') {
    this.pool = createPool(MAX_POOL)
    this.glow = new GlowLayer(this.glowTexture)
    this.group.add(this.pool.points)
    this.group.add(this.glow.points)
    this.setQuality(quality)
  }

  setQuality(q: Quality): void {
    this.quality = q
  }

  get qualityLevel(): Quality {
    return this.quality
  }

  get activeParticles(): number {
    return this.pool.alive
  }

  get activeShells(): number {
    let n = 0
    for (const s of this.shells) if (s.alive) n++
    return n
  }

  setPixelScale(scale: number): void {
    this.pool.setPixelScale(scale)
  }

  clear(): void {
    this.pool.alive = 0
    for (const s of this.shells) s.alive = false
    this.glow.clear()
    commitPool(this.pool)
  }

  launch(opts: LaunchOptions): LaunchResult {
    const patternId: Exclude<PatternId, 'random'> =
      opts.pattern === 'random'
        ? this.rng.pick(Object.keys(PATTERNS) as Exclude<PatternId, 'random'>[])
        : opts.pattern
    const spec = PATTERNS[patternId]
    const burstOffset = opts.burstOffset ?? [0, 0, 0]

    const shell: Shell = {
      alive: true,
      x: opts.x,
      y: opts.y,
      z: opts.z,
      vx: opts.vx,
      vy: opts.vy,
      vz: opts.vz,
      age: 0,
      fuse: opts.fuse,
      spec,
      palette: opts.palette,
      size: opts.size,
      trailTimer: 0,
      seed: Math.floor(this.rng.next() * 0xffffff),
      crackleTail: opts.crackleTail ?? false,
      burstDelay: opts.burstDelay ?? 0,
      burstOffsetX: burstOffset[0],
      burstOffsetY: burstOffset[1],
      burstOffsetZ: burstOffset[2],
      burstSpeed: opts.burstSpeed ?? 1,
      burstCount: opts.burstCount ?? opts.count,
    }

    this.shells.push(shell)
    this.shellSeq++
    return { id: this.shellSeq, fuse: opts.fuse, delay: shell.burstDelay, pattern: patternId }
  }

  update(dt: number, t: number): { bursts: number } {
    let bursts = 0
    for (const shell of this.shells) {
      if (!shell.alive) continue
      shell.age += dt

      if (shell.crackleTail) {
        shell.trailTimer -= dt
        if (shell.trailTimer <= 0) {
          shell.trailTimer = 0.016
          this.spawnCrackleTrail(shell)
        }
      }

      const vx = shell.vx
      const vy = shell.vy
      const vz = shell.vz
      shell.x += vx * dt
      shell.y += vy * dt
      shell.z += vz * dt

      if (shell.age < shell.fuse * 0.82) {
        shell.vy -= GRAVITY * dt * 0.95
      }

      this.emitTrail(shell, dt)

      if (shell.age >= shell.fuse) {
        if (shell.burstDelay > 0) {
          shell.age = shell.fuse
          shell.fuse += shell.burstDelay
          shell.burstDelay = 0
          shell.x += shell.burstOffsetX
          shell.y += shell.burstOffsetY
          shell.z += shell.burstOffsetZ
          shell.burstOffsetX = 0
          shell.burstOffsetY = 0
          shell.burstOffsetZ = 0
          shell.vx = 0
          shell.vy = 0
          shell.vz = 0
          shell.burstSpeed = 0.82
          continue
        }
        shell.alive = false
        const by = Math.max(shell.y, 26)
        this.burst(shell.x, by, shell.z, shell.spec, shell.palette, shell.seed, {
          speed: shell.burstSpeed,
          count: shell.burstCount,
        })
        bursts++
      }
    }

    this.shells = this.shells.filter((s) => s.alive)
    this.simulateParticles(dt, t)
    this.glow.update(dt)
    commitPool(this.pool)
    return { bursts }
  }

  private simulateParticles(dt: number, t: number): void {
    const pool = this.pool
    const { positions, life, prev } = pool
    const dragF = Math.exp(-DRAG * dt)

    for (let i = 0; i < pool.alive; i++) {
      const p3 = i * 3
      const p4 = i * 4
      const remaining = life[p4] - dt
      if (remaining <= 0) {
        killParticle(pool, i)
        i--
        continue
      }
      life[p4] = remaining

      const vx = prev[p4]
      const vy = prev[p4 + 1]
      const vz = prev[p4 + 2]

      const nvx = vx * dragF
      const nvy = (vy - GRAVITY * dt) * dragF
      const nvz = vz * dragF

      positions[p3] += (vx + nvx) * 0.5 * dt
      positions[p3 + 1] += (vy + nvy) * 0.5 * dt
      positions[p3 + 2] += (vz + nvz) * 0.5 * dt

      if (positions[p3 + 1] < 0.2) {
        positions[p3 + 1] = 0.2
        prev[p4 + 1] = -nvy * 0.18
      } else {
        prev[p4 + 1] = nvy
      }
      prev[p4] = nvx
      prev[p4 + 2] = nvz

      const sparkle = life[p4 + 3]
      if (sparkle > 0) {
        const flick = Math.sin(t * 61 + i * 1.7) * Math.cos(t * 27 + i * 0.31)
        life[p4 + 2] = 0.55 + 0.45 * flick
      } else {
        life[p4 + 2] = 1
      }
    }
  }

  private emitTrail(shell: Shell, dt: number): void {
    this.glow.add({
      x: shell.x,
      y: shell.y,
      z: shell.z,
      color: COLOR.setRGB(1, 0.78, 0.45),
      size: 3.2,
      intensity: 0.55,
      decay: 2.6,
    })

    shell.trailTimer -= dt
    if (shell.trailTimer > 0) return
    shell.trailTimer = 0.011

    const count = shell.crackleTail ? 1 : 2
    for (let k = 0; k < count; k++) {
      const jx = this.rng.range(-0.6, 0.6)
      const jy = this.rng.range(-1.6, 0.3)
      const jz = this.rng.range(-0.6, 0.6)
      spawnParticle(this.pool, {
        x: shell.x + jx,
        y: shell.y + jy,
        z: shell.z + jz,
        vx: shell.vx * 0.18 + this.rng.range(-1.4, 1.4),
        vy: shell.vy * 0.18 + this.rng.range(-1.8, 0.6),
        vz: shell.vz * 0.18 + this.rng.range(-1.4, 1.4),
        life: this.rng.range(0.3, 0.75),
        size: this.rng.range(0.42, 0.85),
        color: warmTrailColor(),
        sparkle: 0.55,
      })
    }
  }

  private spawnCrackleTrail(shell: Shell): void {
    for (let k = 0; k < 3; k++) {
      spawnParticle(this.pool, {
        x: shell.x,
        y: shell.y,
        z: shell.z,
        vx: this.rng.range(-2.6, 2.6),
        vy: this.rng.range(-2.2, 1.6),
        vz: this.rng.range(-2.6, 2.6),
        life: this.rng.range(0.12, 0.4),
        size: this.rng.range(0.3, 0.7),
        color: COLOR.set('#ffe9c2').clone(),
        sparkle: 1,
      })
    }
  }

  burst(
    x: number,
    y: number,
    z: number,
    spec: BurstSpec,
    palette: Palette,
    seed: number,
    override?: { speed?: number; count?: number },
  ): void {
    const rng = new Rng(seed || Math.floor(Math.random() * 0xffffff))
    const count = Math.max(
      40,
      Math.round((override?.count ?? spec.count) * QUALITY_SCALE[this.quality]),
    )
    const speed = spec.speed * (override?.speed ?? 1)
    const paletteColors = palette.colors.map((c) => COLOR.set(c).clone())

    this.spawnFlash(x, y, z, paletteColors[0])
    this.onBurst?.(x, y, z, count)

    if (spec.family === 'ring') {
      this.burstRing(x, y, z, spec, paletteColors, speed, count, rng)
    } else if (spec.family === 'multi') {
      this.burstMulti(x, y, z, spec, paletteColors, speed, count, rng)
    } else if (spec.family === 'comet') {
      this.burstComet(x, y, z, spec, paletteColors, speed, count, rng)
    } else {
      this.burstSphere(x, y, z, spec, paletteColors, speed, count, rng)
    }

    if (spec.crackle > 0) {
      this.spawnCrackleCloud(x, y, z, paletteColors[0], rng, spec.crackle)
    }
  }

  private spawnFlash(x: number, y: number, z: number, color: Color): void {
    const c = color.clone().lerp(COLOR.set('#ffffff'), 0.5)
    this.glow.add({ x, y, z, color, size: 78, intensity: 1, decay: 2.4 })
    this.glow.add({ x, y, z, color: c, size: 26, intensity: 1, decay: 5.5 })
    for (let i = 0; i < 14; i++) {
      spawnParticle(this.pool, {
        x,
        y,
        z,
        vx: this.rng.range(-3, 3),
        vy: this.rng.range(-3, 3),
        vz: this.rng.range(-3, 3),
        life: this.rng.range(0.1, 0.24),
        size: this.rng.range(5, 12),
        color: c,
        sparkle: 0,
      })
    }
  }

  private burstSphere(
    x: number,
    y: number,
    z: number,
    spec: BurstSpec,
    paletteColors: Color[],
    speed: number,
    count: number,
    rng: Rng,
  ): void {
    const dir: [number, number, number] = [0, 0, 0]
    const trailChance = spec.trailRatio
    for (let i = 0; i < count; i++) {
      rng.unitSphere(dir)
      const jitter = 1 + rng.range(-spec.jitter, spec.jitter)
      const s = speed * jitter
      const color = paletteColors[Math.floor(rng.next() * paletteColors.length)]
      const life = spec.life * rng.range(0.82, 1.12)
      const size = rng.range(0.55, 1.05)

      spawnParticle(this.pool, {
        x,
        y,
        z,
        vx: dir[0] * s,
        vy: dir[1] * s,
        vz: dir[2] * s,
        life,
        size,
        color,
        sparkle: rng.next() < spec.sparkle ? 1 : 0,
      })

      if (rng.next() < trailChance) {
        this.spawnTrailCluster(
          x,
          y,
          z,
          dir[0] * s,
          dir[1] * s,
          dir[2] * s,
          spec.trailTime,
          color,
          rng,
        )
      }
    }
  }

  private burstRing(
    x: number,
    y: number,
    z: number,
    spec: BurstSpec,
    paletteColors: Color[],
    speed: number,
    count: number,
    rng: Rng,
  ): void {
    const tilt = rng.range(0, Math.PI)
    const roll = rng.range(-0.55, 0.55)
    const cosT = Math.cos(tilt)
    const sinT = Math.sin(tilt)
    const cosR = Math.cos(roll)
    const sinR = Math.sin(roll)

    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng.range(-0.02, 0.02)
      let dx = Math.cos(a)
      let dy = Math.sin(a)
      let dz = rng.range(-spec.spread, spec.spread)
      const nx = dx * cosT - dy * sinT
      const ny = dx * sinT + dy * cosT
      dx = nx
      dy = ny
      const ry = dy * cosR - dz * sinR
      const rz = dy * sinR + dz * cosR
      dy = ry
      dz = rz
      const s = speed * rng.range(0.98, 1.02)
      const color = paletteColors[Math.floor(rng.next() * paletteColors.length)]
      spawnParticle(this.pool, {
        x,
        y,
        z,
        vx: dx * s,
        vy: dy * s,
        vz: dz * s,
        life: spec.life * rng.range(0.9, 1.06),
        size: rng.range(0.6, 1.05),
        color,
        sparkle: rng.next() < spec.sparkle ? 1 : 0,
      })
    }
  }

  private burstMulti(
    x: number,
    y: number,
    z: number,
    spec: BurstSpec,
    paletteColors: Color[],
    speed: number,
    count: number,
    rng: Rng,
  ): void {
    const shells = spec.shellCount
    for (let sIdx = 0; sIdx < shells; sIdx++) {
      const angle = (sIdx / shells) * Math.PI * 2 + rng.range(-0.2, 0.2)
      const radius = shells === 1 ? 0 : 16
      const cx = x + Math.cos(angle) * radius
      const cz = z + Math.sin(angle) * radius
      const cy = y + rng.range(-6, 6)
      const color = paletteColors[sIdx % paletteColors.length]
      const perShell = Math.max(60, Math.floor(count / shells))
      const dir: [number, number, number] = [0, 0, 0]
      for (let i = 0; i < perShell; i++) {
        rng.unitSphere(dir)
        const s = speed * rng.range(0.9, 1.1) * (sIdx === 0 ? 1 : 0.86)
        spawnParticle(this.pool, {
          x: cx,
          y: cy,
          z: cz,
          vx: dir[0] * s,
          vy: dir[1] * s,
          vz: dir[2] * s,
          life: spec.life * rng.range(0.85, 1.1),
          size: rng.range(0.5, 1),
          color,
          sparkle: rng.next() < spec.sparkle ? 1 : 0,
        })
      }
      this.spawnFlash(cx, cy, cz, color)
    }
  }

  private burstComet(
    x: number,
    y: number,
    z: number,
    spec: BurstSpec,
    paletteColors: Color[],
    speed: number,
    count: number,
    rng: Rng,
  ): void {
    const dirs = 7
    for (let d = 0; d < dirs; d++) {
      const theta = rng.range(0, Math.PI * 2)
      const phi = rng.range(0.3, 1.35)
      const dx = Math.sin(phi) * Math.cos(theta)
      const dy = Math.cos(phi)
      const dz = Math.sin(phi) * Math.sin(theta)
      const per = Math.floor(count / dirs)
      const color = paletteColors[d % paletteColors.length]
      for (let i = 0; i < per; i++) {
        const spread = rng.range(-spec.spread * 0.09, spec.spread * 0.09)
        const s = speed * rng.range(0.92, 1.08)
        spawnParticle(this.pool, {
          x,
          y,
          z,
          vx: (dx + spread) * s,
          vy: (dy + spread * 0.5) * s,
          vz: (dz + spread) * s,
          life: spec.life * rng.range(0.8, 1.2),
          size: rng.range(0.7, 1.25),
          color,
          sparkle: 1,
        })
        if (rng.next() < spec.trailRatio) {
          this.spawnTrailCluster(x, y, z, dx * s, dy * s, dz * s, spec.trailTime, color, rng)
        }
      }
    }
  }

  private spawnTrailCluster(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    color: Color,
    rng: Rng,
  ): void {
    const n = 7
    for (let i = 0; i < n; i++) {
      const f = i / n
      spawnParticle(this.pool, {
        x: x + vx * f * 0.06,
        y: y + vy * f * 0.06,
        z: z + vz * f * 0.06,
        vx: vx * 0.9 + rng.range(-1.1, 1.1),
        vy: vy * 0.9 + rng.range(-1.1, 1.1),
        vz: vz * 0.9 + rng.range(-1.1, 1.1),
        life: life * rng.range(0.6, 1.1),
        size: rng.range(0.35, 0.7),
        color,
        sparkle: 0.25,
      })
    }
  }

  private spawnCrackleCloud(
    x: number,
    y: number,
    z: number,
    color: Color,
    rng: Rng,
    intensity: number,
  ): void {
    const n = Math.floor(180 * intensity * QUALITY_SCALE[this.quality])
    for (let i = 0; i < n; i++) {
      const dx = rng.range(-1, 1)
      const dy = rng.range(-1, 1)
      const dz = rng.range(-1, 1)
      const r = 18 + rng.range(0, 14)
      spawnParticle(this.pool, {
        x: x + dx * r,
        y: y + dy * r,
        z: z + dz * r,
        vx: rng.range(-2, 2),
        vy: rng.range(-1, 2),
        vz: rng.range(-2, 2),
        life: rng.range(0.1, 0.42),
        size: rng.range(0.25, 0.6),
        color,
        sparkle: 1,
      })
    }
  }

  dispose(): void {
    this.pool.geometry.dispose()
    this.pool.material.dispose()
    this.glow.dispose()
    this.glowTexture.dispose()
    this.clear()
  }
}

function warmTrailColor(): Color {
  const r = 1
  const g = 0.62 + Math.random() * 0.25
  const b = 0.24 + Math.random() * 0.18
  return COLOR.setRGB(r, g, b).clone()
}
