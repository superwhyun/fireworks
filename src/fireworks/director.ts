import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { FireworksEngine, type BurstKind, type Quality, type TailStyle } from './engine'
import { createEnvironment, type Environment } from './environment'
import type { SceneId } from './scenery'
import { createGlowTexture } from './particles'
import { FOV, createStage, type Stage } from './stage'
import { Rng } from './rng'
import {
  PYRO,
  PATTERN_WEIGHT,
  RANDOM_PALETTE_ID,
  SHELL_PATTERNS,
  type Palette,
  type PatternId,
  type ShellPattern,
} from './patterns'

export type MusicMode = 'off' | 'reactive' | 'auto'
export type CameraPreset = 'front' | 'audience' | 'close' | 'low' | 'aerial' | 'side'

export const CAMERA_PRESETS: Record<CameraPreset, { label: string; pos: [number, number, number]; target: [number, number, number] }> = {
  front: { label: '정면', pos: [0, 22, 280], target: [0, 95, -30] },
  audience: { label: '관람석', pos: [0, 2.4, 330], target: [0, 80, -60] },
  close: { label: '근접', pos: [-30, 70, 70], target: [0, 115, -40] },
  low: { label: '수면', pos: [60, 3, 190], target: [0, 105, -30] },
  aerial: { label: '조감', pos: [0, 300, 230], target: [0, 70, -40] },
  side: { label: '측면', pos: [300, 70, 40], target: [0, 100, -30] },
}

export interface DirectorSettings {
  quality: Quality
  intensity: number
  /** automatic show (choreographed sequence) */
  autoFire: boolean
  pattern: PatternId
  palette: Palette
}

export interface SoundCue {
  kind: BurstKind | 'crackle-pops' | 'split'
  size: number
  /** -1 (left) … 1 (right) relative to the camera */
  pan: number
  /** seconds until the sound reaches the listener */
  delay: number
  /** 0..1 loudness from distance */
  gain: number
  duration: number
}

export interface DirectorOptions {
  canvas: HTMLCanvasElement
  width: number
  height: number
  settings: DirectorSettings
  onBurstSound?: (cue: SoundCue) => void
  onLaunchSound?: (cue: { fuse: number; whistle: boolean; pan: number; gain: number; delay: number }) => void
  onCrackleSound?: (amount: number) => void
  onSplitSound?: (amount: number) => void
  onInteract?: () => void
}

/**
 * World units are roughly half-metres; sound travels ~343 m/s, so ~690 u/s.
 * Bursts are seen first and heard a fraction of a second later.
 */
const SOUND_SPEED = 690
const HANGING = new Set<ShellPattern>(['willow', 'kamuro', 'waterfall', 'brocade', 'strobe'])
const GROUND_X = 170
const GROUND_Z_MIN = -130
const GROUND_Z_MAX = 30

interface Cue {
  at: number
  run: () => void
}

export class Director {
  private stage: Stage
  private engine: FireworksEngine
  private environment: Environment
  private controls: OrbitControls
  private rng = new Rng()
  private raf = 0
  private lastTime = 0
  private elapsed = 0
  private settings: DirectorSettings
  private opts: DirectorOptions
  private musicMode: MusicMode = 'off'
  private musicLevel = 0
  private lastOnset = 0
  private burstCount = 0
  private fps = 0
  private fpsAccum = 0
  private fpsFrames = 0
  private lowPass = 0
  private running = false

  private showTimer = 1
  private showCues = 0
  private cues: Cue[] = []
  private finaleUntil = 0
  private lastLaunchSound = 0

  private camAnim: { from: Vector3; to: Vector3; tFrom: Vector3; tTo: Vector3; t: number; dur: number } | null =
    null
  private shake = 0
  private readonly shakeOffset = new Vector3()

  private pointerDown: { x: number; y: number; t: number } | null = null
  private raycaster = new Raycaster()
  private ndc = new Vector2()
  private plane = new Plane()

  constructor(opts: DirectorOptions) {
    this.opts = opts
    this.settings = opts.settings
    this.stage = createStage(opts.canvas, opts.width, opts.height)
    this.environment = createEnvironment(createGlowTexture(96))
    this.stage.scene.add(this.environment.group)
    this.engine = new FireworksEngine(opts.settings.quality)
    this.stage.scene.add(this.engine.group)

    const controls = new OrbitControls(this.stage.camera, opts.canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.07
    controls.minDistance = 25
    controls.maxDistance = 900
    controls.maxPolarAngle = Math.PI * 0.9
    controls.rotateSpeed = 0.6
    controls.zoomSpeed = 1.1
    controls.panSpeed = 0.8
    controls.screenSpacePanning = true
    controls.autoRotateSpeed = 0.35
    const p = CAMERA_PRESETS.front
    this.stage.camera.position.set(...p.pos)
    controls.target.set(...p.target)
    controls.update()
    controls.addEventListener('start', () => {
      this.camAnim = null
    })
    this.controls = controls

    opts.canvas.addEventListener('pointerdown', this.handlePointerDown)
    opts.canvas.addEventListener('pointerup', this.handlePointerUp)

    this.resize(opts.width, opts.height)
    this.engine.onBurst = (e) => {
      const { dist, pan } = this.listen(e.x, e.y, e.z)
      this.shake = Math.min(1.2, this.shake + (e.size * (e.kind === 'salute' ? 120 : 50)) / Math.max(60, dist))
      this.opts.onBurstSound?.({
        kind: e.kind,
        size: e.size,
        pan,
        delay: dist / SOUND_SPEED,
        gain: Math.min(1.4, 240 / Math.max(90, dist)),
        duration: e.duration,
      })
    }
    this.engine.onLaunch = (e) => {
      const now = this.elapsed
      if (now - this.lastLaunchSound > 0.06 || e.whistle) {
        this.lastLaunchSound = now
        const { dist, pan } = this.listen(e.x, 0, e.z)
        this.opts.onLaunchSound?.({
          fuse: e.fuse,
          whistle: e.whistle,
          pan,
          gain: Math.min(1.3, 220 / Math.max(80, dist)),
          delay: dist / SOUND_SPEED,
        })
      }
    }
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
      this.fpsAccum += raw
      this.fpsFrames++
      if (this.fpsAccum >= 0.5) {
        this.fps = this.fpsFrames / this.fpsAccum
        this.fpsAccum = 0
        this.fpsFrames = 0
      }
      this.step(Math.min(0.05, Math.max(0.0005, raw)))
      this.render(raw)
    }
    this.raf = requestAnimationFrame(loop)
  }

  /** distance and stereo position of a world point relative to the camera */
  private listen(x: number, y: number, z: number): { dist: number; pan: number } {
    const cam = this.stage.camera
    const v = this.tmpV.set(x, y, z).applyMatrix4(cam.matrixWorldInverse)
    const dist = v.length()
    return { dist, pan: clamp(v.x / Math.max(40, -v.z), -1, 1) * 0.8 }
  }
  private tmpV = new Vector3()

  private step(dt: number): void {
    this.elapsed += dt
    this.tickShow(dt)
    this.tickCues()
    this.engine.update(dt, this.elapsed)
    if (this.engine.crackleCount > 0) {
      this.opts.onCrackleSound?.(Math.min(1, this.engine.crackleCount / 30))
      this.engine.crackleCount = 0
    }
    if (this.engine.splitCount > 0) {
      this.opts.onSplitSound?.(Math.min(1, this.engine.splitCount / 40))
      this.engine.splitCount = 0
    }
    this.engine.fillLights(this.environment.lightPos, this.environment.lightCol)
    this.environment.update(this.elapsed, this.stage.camera.position, this.engine.skyLight)
  }

  private render(dt: number): void {
    this.updateCamera(dt)
    const cam = this.stage.camera
    cam.position.add(this.shakeOffset)
    this.stage.composer.render(dt)
    cam.position.sub(this.shakeOffset)
  }

  /** Debug / testing: advance simulation deterministically, then render one frame. */
  advance(seconds: number, fixed = 1 / 60): void {
    const n = Math.round(seconds / fixed)
    for (let i = 0; i < n; i++) {
      this.step(fixed)
      this.updateCamera(fixed)
    }
    this.render(fixed)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
  }

  resize(width: number, height: number): void {
    const pr = Math.min(window.devicePixelRatio || 1, 2)
    this.stage.resize(width, height, pr)
    const scale = height / (2 * Math.tan((FOV * Math.PI) / 360))
    this.engine.setPixelScale(scale * pr)
  }

  setSettings(settings: DirectorSettings): void {
    const qualityChanged = settings.quality !== this.settings.quality
    this.settings = settings
    if (qualityChanged) this.engine.setQuality(settings.quality)
    if (!settings.autoFire) this.showTimer = 0.6
  }

  setMusicMode(mode: MusicMode): void {
    this.musicMode = mode
  }

  setMusicLevel(level: number, onset: boolean): void {
    this.lowPass = this.lowPass * 0.82 + level * 0.18
    this.musicLevel = this.lowPass
    if (onset) {
      const now = performance.now()
      if (now - this.lastOnset > 200) {
        this.lastOnset = now
        if (this.musicMode === 'reactive') this.reactiveFire(level)
      }
    }
  }

  // ------------------------------------------------------------ camera

  setCameraPreset(preset: CameraPreset): void {
    const p = preset === 'audience' ? this.environment.audience : CAMERA_PRESETS[preset]
    this.camAnim = {
      from: this.stage.camera.position.clone(),
      to: new Vector3(...p.pos),
      tFrom: this.controls.target.clone(),
      tTo: new Vector3(...p.target),
      t: 0,
      dur: 1.6,
    }
  }

  setScene(id: SceneId): void {
    this.environment.setScene(id)
    this.engine.setReflections(this.environment.reflections)
  }

  setAutoRotate(on: boolean): void {
    this.controls.autoRotate = on
  }

  private updateCamera(dt: number): void {
    const a = this.camAnim
    if (a) {
      a.t = Math.min(1, a.t + dt / a.dur)
      const e = a.t < 0.5 ? 4 * a.t ** 3 : 1 - (-2 * a.t + 2) ** 3 / 2
      this.stage.camera.position.lerpVectors(a.from, a.to, e)
      this.controls.target.lerpVectors(a.tFrom, a.tTo, e)
      if (a.t >= 1) this.camAnim = null
    }
    this.controls.update(dt)
    // keep the camera above the water surface
    const cam = this.stage.camera
    if (cam.position.y < 2) {
      cam.position.y = 2
      cam.lookAt(this.controls.target)
    }
    this.shake *= Math.exp(-dt * 7)
    const s = this.shake
    this.shakeOffset.set(
      (Math.random() - 0.5) * s,
      (Math.random() - 0.5) * s,
      (Math.random() - 0.5) * s,
    )
  }

  private handlePointerDown = (e: PointerEvent): void => {
    this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() }
    this.opts.onInteract?.()
  }

  private handlePointerUp = (e: PointerEvent): void => {
    const d = this.pointerDown
    this.pointerDown = null
    if (!d || e.button !== 0) return
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 450) return
    this.fireAtScreen(e.clientX, e.clientY)
  }

  /** Fire a shell that bursts where the user clicked. */
  fireAtScreen(clientX: number, clientY: number): void {
    const canvas = this.opts.canvas
    const rect = canvas.getBoundingClientRect()
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    const cam = this.stage.camera
    this.raycaster.setFromCamera(this.ndc, cam)
    const normal = new Vector3().subVectors(cam.position, this.controls.target)
    normal.y = 0
    if (normal.lengthSq() < 1e-4) normal.set(0, 0, 1)
    normal.normalize()
    // plane through the show area centre, facing the camera horizontally
    this.plane.setFromNormalAndCoplanarPoint(normal, new Vector3(0, 0, -40))
    const hit = new Vector3()
    if (!this.raycaster.ray.intersectPlane(this.plane, hit)) {
      this.fireManual()
      return
    }
    hit.y = clamp(hit.y, 35, 260)
    hit.x = clamp(hit.x, -400, 400)
    hit.z = clamp(hit.z, -400, 200)
    this.fireShell(this.settings.pattern, this.colors(), [hit.x + this.rng.range(-8, 8), hit.z + this.rng.range(-6, 6)], [hit.x, hit.y, hit.z], this.scale())
    this.burstCount++
  }

  // ------------------------------------------------------------ firing

  private scale(): number {
    return 0.75 + this.settings.intensity * 0.75
  }

  private density(): number {
    return 0.6 + this.settings.intensity * 0.8
  }

  private colors(palette?: Palette): string[] {
    const p = palette ?? this.settings.palette
    if (p.id === RANDOM_PALETTE_ID) {
      // real shells are mostly one or two colours; gold/silver are the classics
      const r = this.rng.next()
      if (r < 0.18) return [PYRO.gold]
      if (r < 0.28) return [PYRO.silver]
      const base: string[] = [PYRO.red, PYRO.green, PYRO.blue, PYRO.purple, PYRO.orange, PYRO.yellow, PYRO.aqua, PYRO.pink]
      const a = this.rng.pick(base)
      if (r < 0.62) return [a]
      const b = this.rng.pick([...base, PYRO.silver, PYRO.gold].filter((c) => c !== a))
      return [a, b]
    }
    // a palette: use one or two of its colours per shell
    const a = this.rng.pick(p.colors)
    if (this.rng.next() < 0.5) return [a]
    const b = this.rng.pick(p.colors)
    return b === a ? [a] : [a, b]
  }

  /** shell caliber: small shells fly low, big shells fly high */
  private caliber(): number {
    const r = this.rng.next()
    if (r < 0.22) return 0.5
    if (r < 0.5) return 0.72
    if (r < 0.78) return 1
    if (r < 0.93) return 1.3
    return 1.7
  }

  private heightFor(cal: number): number {
    return clamp(48 + cal * 72 + this.rng.range(-14, 14), 40, 220)
  }

  private pickPattern(): ShellPattern {
    const p = this.settings.pattern
    return p === 'random' ? this.rng.pick(SHELL_PATTERNS) : p
  }

  private tail(pattern: ShellPattern): TailStyle {
    if (pattern === 'kamuro' || pattern === 'willow' || pattern === 'waterfall') return 'glitter'
    if (pattern === 'crackle') return 'crackle'
    if (pattern === 'strobe' || pattern === 'fish') return 'silver'
    const r = this.rng.next()
    return r < 0.55 ? 'gold' : r < 0.75 ? 'glitter' : r < 0.88 ? 'silver' : 'crackle'
  }

  private fireShell(
    pattern: PatternId,
    colors: string[],
    from: [number, number],
    to: [number, number, number],
    scale: number,
    delay = 0,
  ): void {
    const resolved = pattern === 'random' ? this.rng.pick(SHELL_PATTERNS) : pattern
    this.engine.launch({
      pattern: resolved,
      colors,
      from,
      to,
      scale,
      density: this.density(),
      tail: this.tail(resolved),
      delay,
      burn: HANGING.has(resolved) ? this.rng.range(1, 1.35) : this.rng.range(0.7, 1.35),
      snap: this.rng.range(0.8, 1.3),
      whistle: false,
    })
  }

  private randomSpot(cal = this.caliber()): { from: [number, number]; to: [number, number, number]; cal: number } {
    const x = this.rng.range(-GROUND_X, GROUND_X) * 0.8
    const z = this.rng.range(GROUND_Z_MIN, GROUND_Z_MAX)
    return {
      from: [x, z],
      to: [x + this.rng.range(-15, 15), this.heightFor(cal), z + this.rng.range(-10, 10)],
      cal,
    }
  }

  fireManual(patternOverride?: PatternId): void {
    const { from, to, cal } = this.randomSpot()
    this.fireShell(patternOverride ?? this.settings.pattern, this.colors(), from, to, this.scale() * cal)
    this.burstCount++
  }

  private reactiveFire(level: number): void {
    const energy = Math.max(level, this.musicLevel)
    if (energy > 0.62 && this.rng.next() < 0.5) {
      // strong beat: symmetric pair
      const x = this.rng.range(40, 140)
      const z = this.rng.range(GROUND_Z_MIN, 0)
      const pat = this.pickPattern()
      const cols = this.colors()
      const cal = 0.9 + energy * 0.8
      const h = this.heightFor(cal)
      this.fireShell(pat, cols, [-x, z], [-x, h, z], this.scale() * cal)
      this.fireShell(pat, cols, [x, z], [x, h, z], this.scale() * cal)
    } else {
      const cal = 0.5 + energy * 1.1
      const { from, to } = this.randomSpot(cal)
      this.fireShell(this.settings.pattern, this.colors(), from, to, this.scale() * cal)
    }
    this.burstCount++
  }

  // ------------------------------------------------------------ show

  private schedule(delay: number, run: () => void): void {
    this.cues.push({ at: this.elapsed + delay, run })
  }

  private tickCues(): void {
    if (!this.cues.length) return
    for (let i = this.cues.length - 1; i >= 0; i--) {
      if (this.cues[i].at <= this.elapsed) {
        const c = this.cues[i]
        this.cues.splice(i, 1)
        c.run()
      }
    }
  }

  private tickShow(dt: number): void {
    const showOn = this.musicMode === 'auto' || (this.settings.autoFire && this.musicMode === 'off')
    if (!showOn || this.elapsed < this.finaleUntil) return
    this.showTimer -= dt
    if (this.showTimer > 0) return
    const energy = this.musicMode === 'auto' ? 0.5 + this.musicLevel : 1
    this.showCues++
    if (this.showCues % 16 === 0) {
      this.finale()
      this.showTimer = 3.5
      return
    }
    const weight = this.runCue()
    this.showTimer = (this.rng.range(0.9, 2.2) * weight) / ((0.55 + this.settings.intensity * 0.9) * energy)
  }

  /** Runs one show cue, returns its "weight" for pacing. */
  private runCue(): number {
    const r = this.rng.next()
    const pat = this.pickPattern()
    const cols = this.colors()
    const sc = this.scale()
    const w = PATTERN_WEIGHT[pat]
    if (r < 0.22) {
      // big centrepiece
      const z = this.rng.range(-90, -30)
      const cal = this.rng.pick([1.3, 1.5, 1.7])
      this.fireShell(pat, cols, [0, z], [this.rng.range(-20, 20), this.heightFor(cal), z], sc * cal)
      this.burstCount++
      return w * 1.3
    }
    if (r < 0.4) {
      // mirrored pair
      const x = this.rng.range(50, 150)
      const z = this.rng.range(-110, 0)
      const cal = this.caliber()
      const h = this.heightFor(cal)
      this.fireShell(pat, cols, [-x, z], [-x * 1.1, h, z], sc * cal)
      this.fireShell(pat, cols, [x, z], [x * 1.1, h, z], sc * cal)
      this.burstCount += 2
      return w * 1.2
    }
    if (r < 0.56) {
      // fan from one mortar rack
      const n = this.rng.int(5, 7)
      const z = this.rng.range(-80, -20)
      const pSmall = this.rng.pick(['peony', 'chrysanthemum', 'crossette', 'strobe', 'changer', 'dahlia', 'salute'] as const)
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1) - 0.5
        this.fireShell(pSmall, cols, [0, z], [f * 240, this.rng.range(70, 95) - Math.abs(f) * 30, z], sc * 0.55, i * 0.09)
      }
      this.burstCount += n
      return 1.6
    }
    if (r < 0.7) {
      // sweep left → right (or reverse)
      const n = this.rng.int(6, 9)
      const dir = this.rng.next() < 0.5 ? 1 : -1
      const z = this.rng.range(-100, -10)
      const cal = this.rng.pick([0.5, 0.6, 0.75])
      const h = this.heightFor(cal)
      for (let i = 0; i < n; i++) {
        const x = dir * (i / (n - 1) - 0.5) * 300
        this.fireShell(pat, cols, [x, z], [x, h + Math.sin(i) * 8, z], sc * cal, i * 0.16)
      }
      this.burstCount += n
      return 1.8
    }
    if (r < 0.8) {
      // vertical stack: low → high, same column
      const x = this.rng.range(-80, 80)
      const z = this.rng.range(-100, -20)
      const pats: ShellPattern[] = [this.pickPattern(), this.pickPattern(), this.pickPattern()]
      for (let i = 0; i < 3; i++) {
        const cal = 0.55 + i * 0.4
        this.fireShell(pats[i], this.colors(), [x, z], [x, this.heightFor(cal), z], sc * cal, i * 0.35)
      }
      this.burstCount += 3
      return 1.7
    }
    // mixed salvo
    const n = this.rng.int(3, 5)
    for (let i = 0; i < n; i++) {
      const { from, to, cal } = this.randomSpot()
      this.fireShell(this.pickPattern(), this.colors(), from, to, sc * cal, i * this.rng.range(0.05, 0.3))
    }
    this.burstCount += n
    return 1.5
  }

  /** Grand finale: dense barrage with crackle, kamuro canopy and a climax. */
  finale(): void {
    const sc = this.scale()
    const dur = 6
    const n = Math.round(26 + this.settings.intensity * 26)
    for (let i = 0; i < n; i++) {
      const t = (i / n) ** 0.8 * dur
      const { from, to, cal } = this.randomSpot()
      const pat = this.rng.pick<ShellPattern>([
        'salute',
        'peony',
        'chrysanthemum',
        'crackle',
        'brocade',
        'strobe',
        'dahlia',
        'changer',
        'crossette',
        'palm',
        'pistil',
        'multibreak',
      ])
      this.schedule(t, () => this.fireShell(pat, this.colors(), from, to, sc * cal))
    }
    // gold kamuro canopy at the climax
    for (let i = 0; i < 7; i++) {
      const x = (i / 6 - 0.5) * 300
      this.schedule(dur + i * 0.06, () =>
        this.fireShell('kamuro', [PYRO.gold], [x, -60], [x, this.rng.range(150, 180), -60], sc * 1.4),
      )
    }
    // closing crackle wall
    for (let i = 0; i < 6; i++) {
      const x = (i / 5 - 0.5) * 260
      this.schedule(dur + 1.2 + i * 0.05, () =>
        this.fireShell('salute', [PYRO.silver], [x, -20], [x, this.rng.range(80, 110), -20], sc * 0.8),
      )
    }
    this.burstCount += n + 13
    this.finaleUntil = this.elapsed + dur + 4
  }

  clear(): void {
    this.engine.clear()
    this.cues.length = 0
    this.finaleUntil = 0
  }

  dispose(): void {
    this.stop()
    this.opts.canvas.removeEventListener('pointerdown', this.handlePointerDown)
    this.opts.canvas.removeEventListener('pointerup', this.handlePointerUp)
    this.controls.dispose()
    this.environment.dispose()
    this.engine.dispose()
    this.stage.dispose()
  }
}

function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v))
}
