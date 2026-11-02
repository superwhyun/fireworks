import { Color, FogExp2 } from 'three'
import { FireworksEngine, type Quality } from './engine'
import { createEnvironment, type Environment } from './environment'
import { createGlowTexture } from './particles'
import { FOV, createStage, type Stage } from './stage'
import { Rng } from './rng'
import type { Palette, PatternId } from './patterns'

export type MusicMode = 'off' | 'reactive' | 'auto'

export interface DirectorSettings {
  quality: Quality
  intensity: number
  autoFire: boolean
  pattern: PatternId
  palette: Palette
}

export interface DirectorOptions {
  canvas: HTMLCanvasElement
  width: number
  height: number
  settings: DirectorSettings
  onBurstSound?: (size: number) => void
  onLaunchSound?: (fuse: number) => void
}

const BURST_TOP = 92
const BURST_BOTTOM = 58

export class Director {
  private stage: Stage
  private engine: FireworksEngine
  private environment: Environment
  private rng = new Rng()
  private raf = 0
  private lastTime = 0
  private elapsed = 0
  private settings: DirectorSettings
  private opts: DirectorOptions
  private musicMode: MusicMode = 'off'
  private musicLevel = 0
  private autoTimer = 0
  private autoVolleyTimer = 0
  private autoVolleyCount = 0
  private lastOnset = 0
  private burstCount = 0
  private fps = 0
  private fpsAccum = 0
  private fpsFrames = 0
  private lowPass = 0
  private running = false

  constructor(opts: DirectorOptions) {
    this.opts = opts
    this.settings = opts.settings
    this.stage = createStage(opts.canvas, opts.width, opts.height)
    this.environment = createEnvironment(createGlowTexture(96))
    this.stage.scene.add(this.environment.group)
    this.engine = new FireworksEngine(opts.settings.quality)
    this.stage.scene.add(this.engine.group)

    const fogColor = new Color('#04050a')
    this.stage.scene.fog = new FogExp2(fogColor.getHex(), 0.0026)

    this.resize(opts.width, opts.height)
    this.engine.onBurst = (_x, _y, _z, size) => {
      this.opts.onBurstSound?.(size)
    }
  }

  get scene(): Stage['scene'] {
    return this.stage.scene
  }

  get stats(): { fps: number; particles: number; shells: number; bursts: number; level: number } {
    return {
      fps: Math.round(this.fps),
      particles: this.engine.activeParticles,
      shells: this.engine.activeShells,
      bursts: this.burstCount,
      level: this.musicLevel,
    }
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.lastTime = performance.now()
    const loop = (now: number) => {
      if (!this.running) return
      this.raf = requestAnimationFrame(loop)
      const raw = (now - this.lastTime) / 1000
      this.lastTime = now
      const dt = Math.min(0.05, Math.max(0.0005, raw))
      this.elapsed += dt

      this.fpsAccum += raw
      this.fpsFrames++
      if (this.fpsAccum >= 0.5) {
        this.fps = this.fpsFrames / this.fpsAccum
        this.fpsAccum = 0
        this.fpsFrames = 0
      }

      this.environment.update(this.elapsed)
      this.tickAuto(dt)
      this.engine.update(dt, this.elapsed)
      this.updateCamera(dt)
      this.stage.composer.render(dt)
    }
    this.raf = requestAnimationFrame(loop)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
  }

  resize(width: number, height: number): void {
    const pr = Math.min(window.devicePixelRatio || 1, 2)
    this.stage.resize(width, height, pr)
    const scale = height / (2 * Math.tan((FOV * Math.PI) / 360))
    this.engine.setPixelScale(scale * pr * 0.5)
    this.stage.renderer.setSize(width, height, false)
  }

  setSettings(settings: DirectorSettings): void {
    const qualityChanged = settings.quality !== this.settings.quality
    this.settings = settings
    if (qualityChanged) this.engine.setQuality(settings.quality)
  }

  setMusicMode(mode: MusicMode): void {
    this.musicMode = mode
  }

  setMusicLevel(level: number, onset: boolean): void {
    this.lowPass = this.lowPass * 0.82 + level * 0.18
    this.musicLevel = this.lowPass
    if (onset) {
      const now = performance.now()
      if (now - this.lastOnset > 220) {
        this.lastOnset = now
        if (this.musicMode === 'reactive') this.reactiveFire()
      }
    }
  }

  fireManual(patternOverride?: DirectorSettings['pattern']): void {
    const pattern = patternOverride ?? this.settings.pattern
    const palette = this.settings.palette
    const intensity = this.settings.intensity
    const shells = pattern === 'double' ? 2 : pattern === 'crossette' ? 3 : 1

    const baseX = this.rng.range(-52, 52)
    const baseZ = this.rng.range(-34, 18)
    const apex = this.rng.range(BURST_BOTTOM, BURST_TOP)
    const fuse = this.rng.range(0.95, 1.45)

    for (let i = 0; i < shells; i++) {
      const offset = (i - (shells - 1) / 2) * this.rng.range(16, 26)
      const x = baseX + offset
      const z = baseZ + this.rng.range(-8, 8)
      const vx = (x - baseX) / fuse
      const vy = Math.sqrt(Math.max(1, 2 * 9.2 * 0.86 * (apex - 2)))
      const vz = this.rng.range(-4, 4)

      this.engine.launch({
        pattern: shells > 1 ? 'random' : pattern,
        palette,
        count: Math.round(300 + intensity * 220),
        x: baseX,
        y: 2,
        z,
        vx,
        vy,
        vz,
        size: this.rng.range(0.8, 1.3),
        fuse,
        crackleTail: this.rng.next() < 0.35,
      })
      this.opts.onLaunchSound?.(fuse)
    }
    this.burstCount++
  }

  private reactiveFire(): void {
    const energy = this.musicLevel
    const pattern = this.settings.pattern
    const palette = this.settings.palette
    const apex = BURST_BOTTOM + energy * (BURST_TOP - BURST_BOTTOM) + this.rng.range(-6, 6)
    const fuse = this.rng.range(0.9, 1.3)
    const count = Math.round(220 + energy * 520)

    this.engine.launch({
      pattern,
      palette,
      count,
      x: this.rng.range(-60, 60),
      y: 2,
      z: this.rng.range(-30, 20),
      vx: this.rng.range(-6, 6),
      vy: Math.sqrt(Math.max(1, 2 * 9.2 * 0.86 * (apex - 2))),
      vz: this.rng.range(-4, 4),
      size: this.rng.range(0.9, 1.6),
      fuse,
      crackleTail: this.rng.next() < 0.4,
    })
    this.opts.onLaunchSound?.(fuse)
    this.burstCount++
  }

  private tickAuto(dt: number): void {
    if (this.musicMode === 'auto') {
      this.autoTimer -= dt
      if (this.autoTimer <= 0) {
        const intensity = this.settings.intensity
        this.autoTimer = this.rng.range(0.35, 1.5) / (0.6 + intensity)
        this.fireManual()
        this.autoVolleyTimer = this.rng.range(0.08, 0.26)
        this.autoVolleyCount = this.rng.next() < 0.25 + intensity * 0.3 ? 1 : 0
      }
      if (this.autoVolleyCount > 0) {
        this.autoVolleyTimer -= dt
        if (this.autoVolleyTimer <= 0) {
          this.autoVolleyCount--
          this.fireManual()
        }
      }
    } else if (this.settings.autoFire && this.musicMode === 'off') {
      this.autoTimer -= dt
      if (this.autoTimer <= 0) {
        this.autoTimer = this.rng.range(1.2, 3.2)
        this.fireManual()
      }
    }
  }

  private updateCamera(dt: number): void {
    const cam = this.stage.camera
    const sway = Math.sin(this.elapsed * 0.21) * 6
    const bob = Math.sin(this.elapsed * 0.13 + 1.2) * 2.2
    const targetX = sway * (0.4 + this.settings.intensity * 0.6)
    const targetY = 30 + bob
    cam.position.x += (targetX - cam.position.x) * Math.min(1, dt * 1.4)
    cam.position.y += (targetY - cam.position.y) * Math.min(1, dt * 1.4)
    cam.lookAt(0, 72 + Math.sin(this.elapsed * 0.17) * 3, 0)
  }

  clear(): void {
    this.engine.clear()
  }

  dispose(): void {
    this.stop()
    this.environment.dispose()
    this.engine.dispose()
    this.stage.dispose()
  }
}
