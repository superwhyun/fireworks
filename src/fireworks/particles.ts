import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DynamicDrawUsage,
  LineSegments,
  Points,
  ShaderMaterial,
  Texture,
} from 'three'

/**
 * GPU side: only what the shader needs (position, current color, size, alpha).
 * CPU side: full physics/behaviour state per particle. Colour, size and alpha
 * are recomputed every frame on the CPU so that stars can change colour,
 * strobe, crackle, flicker and fade to embers.
 */

const vertexShader = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;

uniform float uPixelScale;
uniform float uMirror;
uniform float uTime;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec3 p = position;
  float a = aAlpha;
  if (uMirror > 0.5) {
    // reflection on the water surface: flip, ripple, dim with height
    float h = p.y;
    p.y = -h;
    // waves break the mirror image into wobbling, flickering fragments
    float w1 = sin(p.x * 0.31 + uTime * 2.9 + h * 0.21);
    float w2 = sin(p.z * 0.47 - uTime * 2.2 + h * 0.13 + p.x * 0.05);
    p.x += (w1 * 1.6 + sin(h * 0.09 + uTime * 1.7) ) * (1.0 + h * 0.03);
    p.y += w2 * (0.5 + h * 0.06);
    float shimmer = 0.25 + 0.75 * pow(0.5 + 0.5 * w1 * w2, 2.0);
    a *= 0.42 * shimmer * clamp(1.0 - h / 320.0, 0.0, 1.0);
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 0.5);
  float raw = aSize * 0.7 * uPixelScale / dist;
  gl_PointSize = clamp(raw, 1.0, 64.0);
  // sub-pixel points: keep energy by moving size into alpha
  if (raw < 1.0) a *= max(raw, 0.15);
  vColor = aColor;
  vAlpha = a;
}
`

const fragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p) * 2.0;
  if (d > 1.0) discard;
  float core = exp(-d * d * 9.0);
  float halo = exp(-d * d * 3.0) * 0.12;
  float a = (core + halo) * vAlpha;
  if (a < 0.002) discard;
  // white-hot centre, coloured rim
  vec3 col = mix(vColor, vec3(1.0) * max(max(vColor.r, vColor.g), vColor.b), core * 0.3);
  gl_FragColor = vec4(col * a, a);
}
`

const lineVertex = /* glsl */ `
attribute vec3 aColor;
uniform float uMirror;
uniform float uTime;
varying vec3 vColor;
void main() {
  vec3 p = position;
  vec3 c = aColor;
  if (uMirror > 0.5) {
    float h = p.y;
    p.y = -h;
    float w1 = sin(p.x * 0.31 + uTime * 2.9 + h * 0.21);
    float w2 = sin(p.z * 0.47 - uTime * 2.2 + h * 0.13 + p.x * 0.05);
    p.x += (w1 * 1.6 + sin(h * 0.09 + uTime * 1.7)) * (1.0 + h * 0.03);
    p.y += w2 * (0.5 + h * 0.06);
    c *= 0.35 * (0.25 + 0.75 * pow(0.5 + 0.5 * w1 * w2, 2.0)) * clamp(1.0 - h / 320.0, 0.0, 1.0);
  }
  vColor = c;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`

const lineFragment = /* glsl */ `
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 1.0);
}
`

// behaviour flags
export const F_TRAIL = 1
export const F_GLITTER = 2
export const F_STROBE = 4
export const F_CRACKLE = 8
export const F_SPLIT = 16
export const F_CHANGE = 32
export const F_FISH = 64
export const F_FLICKER = 128
export const F_HOT = 256
export const F_EMBER = 512
export const F_SUBSHELL = 1024

export const PARAM = 6

export interface ParticlePool {
  points: Points
  mirror: Points
  lines: LineSegments
  lineMirror: LineSegments
  lineGeometry: BufferGeometry
  lineMaterial: ShaderMaterial
  lineMirrorMaterial: ShaderMaterial
  linePos: Float32Array
  lineCol: Float32Array
  /** motion-blur exposure in seconds (0 = no streak) */
  streak: Float32Array
  geometry: BufferGeometry
  material: ShaderMaterial
  mirrorMaterial: ShaderMaterial
  capacity: number
  alive: number
  // GPU
  positions: Float32Array
  colors: Float32Array
  sizes: Float32Array
  alphas: Float32Array
  // CPU
  vel: Float32Array
  life: Float32Array // [remaining, max]
  phys: Float32Array // [gravityScale, drag]
  colA: Float32Array
  colB: Float32Array
  baseSize: Float32Array
  flags: Uint16Array
  param: Float32Array // [at, trailInterval, trailTimer, phase, trailLife, trailSize]
  trailCol: Float32Array
  setPixelScale(scale: number): void
  setTime(t: number): void
}

export function createPool(capacity: number): ParticlePool {
  const geometry = new BufferGeometry()
  const positions = new Float32Array(capacity * 3)
  const colors = new Float32Array(capacity * 3)
  const sizes = new Float32Array(capacity)
  const alphas = new Float32Array(capacity)

  const add = (name: string, arr: Float32Array, size: number) => {
    const attr = new BufferAttribute(arr, size)
    attr.setUsage(DynamicDrawUsage)
    geometry.setAttribute(name, attr)
  }
  add('position', positions, 3)
  add('aColor', colors, 3)
  add('aSize', sizes, 1)
  add('aAlpha', alphas, 1)
  geometry.setDrawRange(0, 0)

  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    uniforms: {
      uPixelScale: { value: 1 },
      uMirror: { value: 0 },
      uTime: { value: 0 },
    },
  })
  const mirrorMaterial = material.clone()
  mirrorMaterial.uniforms.uMirror.value = 1
  // reflections are only visible over water: let land / banks occlude them
  mirrorMaterial.depthTest = true

  const points = new Points(geometry, material)
  points.frustumCulled = false
  points.renderOrder = 10

  const lineGeometry = new BufferGeometry()
  const linePos = new Float32Array(capacity * 6)
  const lineCol = new Float32Array(capacity * 6)
  const lp = new BufferAttribute(linePos, 3)
  lp.setUsage(DynamicDrawUsage)
  const lc = new BufferAttribute(lineCol, 3)
  lc.setUsage(DynamicDrawUsage)
  lineGeometry.setAttribute('position', lp)
  lineGeometry.setAttribute('aColor', lc)
  lineGeometry.setDrawRange(0, 0)
  const lineMaterial = new ShaderMaterial({
    vertexShader: lineVertex,
    fragmentShader: lineFragment,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    uniforms: { uMirror: { value: 0 }, uTime: { value: 0 } },
  })
  const lineMirrorMaterial = lineMaterial.clone()
  lineMirrorMaterial.uniforms.uMirror.value = 1
  lineMirrorMaterial.depthTest = true
  const lines = new LineSegments(lineGeometry, lineMaterial)
  lines.frustumCulled = false
  lines.renderOrder = 10
  const lineMirror = new LineSegments(lineGeometry, lineMirrorMaterial)
  lineMirror.frustumCulled = false
  lineMirror.renderOrder = 2
  const mirror = new Points(geometry, mirrorMaterial)
  mirror.frustumCulled = false
  mirror.renderOrder = 2

  return {
    points,
    mirror,
    lines,
    lineMirror,
    lineGeometry,
    lineMaterial,
    lineMirrorMaterial,
    linePos,
    lineCol,
    streak: new Float32Array(capacity),
    geometry,
    material,
    mirrorMaterial,
    capacity,
    alive: 0,
    positions,
    colors,
    sizes,
    alphas,
    vel: new Float32Array(capacity * 3),
    life: new Float32Array(capacity * 2),
    phys: new Float32Array(capacity * 2),
    colA: new Float32Array(capacity * 3),
    colB: new Float32Array(capacity * 3),
    baseSize: new Float32Array(capacity),
    flags: new Uint16Array(capacity),
    param: new Float32Array(capacity * PARAM),
    trailCol: new Float32Array(capacity * 3),
    setPixelScale(scale: number) {
      material.uniforms.uPixelScale.value = scale
      mirrorMaterial.uniforms.uPixelScale.value = scale
    },
    setTime(t: number) {
      mirrorMaterial.uniforms.uTime.value = t
      lineMirrorMaterial.uniforms.uTime.value = t
    },
  }
}

export interface RGB {
  r: number
  g: number
  b: number
}

export interface SpawnArgs {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
  size: number
  color: RGB
  /** colour at end of life (fade target) or after colour change */
  color2?: RGB
  gravity?: number
  drag?: number
  flags?: number
  /** fraction of life at which CHANGE / SPLIT / SUBSHELL triggers */
  at?: number
  /** seconds between trail emissions */
  trailInterval?: number
  trailColor?: RGB
  /** lifetime of emitted trail sparks */
  trailLife?: number
  trailSize?: number
  /** motion-blur exposure (s); default 0 */
  streak?: number
  phase?: number
}

export function spawnParticle(pool: ParticlePool, a: SpawnArgs): number {
  if (pool.alive >= pool.capacity) return -1
  const i = pool.alive++
  const i2 = i * 2
  const i3 = i * 3
  const i6 = i * PARAM

  pool.positions[i3] = a.x
  pool.positions[i3 + 1] = a.y
  pool.positions[i3 + 2] = a.z
  pool.vel[i3] = a.vx
  pool.vel[i3 + 1] = a.vy
  pool.vel[i3 + 2] = a.vz

  pool.life[i2] = a.life
  pool.life[i2 + 1] = a.life
  pool.phys[i2] = a.gravity ?? 1
  pool.phys[i2 + 1] = a.drag ?? 0.9

  const c = a.color
  const c2 = a.color2 ?? c
  pool.colA[i3] = c.r
  pool.colA[i3 + 1] = c.g
  pool.colA[i3 + 2] = c.b
  pool.colB[i3] = c2.r
  pool.colB[i3 + 1] = c2.g
  pool.colB[i3 + 2] = c2.b
  pool.colors[i3] = c.r
  pool.colors[i3 + 1] = c.g
  pool.colors[i3 + 2] = c.b
  const tc = a.trailColor ?? c
  pool.trailCol[i3] = tc.r
  pool.trailCol[i3 + 1] = tc.g
  pool.trailCol[i3 + 2] = tc.b

  pool.baseSize[i] = a.size
  pool.sizes[i] = a.size
  pool.alphas[i] = 1
  pool.flags[i] = a.flags ?? 0
  pool.streak[i] = a.streak ?? 0
  pool.param[i6] = a.at ?? 0.5
  pool.param[i6 + 1] = a.trailInterval ?? 0.03
  pool.param[i6 + 2] = Math.random() * (a.trailInterval ?? 0.03)
  pool.param[i6 + 3] = a.phase ?? Math.random() * 100
  pool.param[i6 + 4] = a.trailLife ?? 0.6
  pool.param[i6 + 5] = a.trailSize ?? a.size * 0.6
  return i
}

export function killParticle(pool: ParticlePool, index: number): void {
  const last = --pool.alive
  if (index === last) return
  copy(pool.positions, index, last, 3)
  copy(pool.colors, index, last, 3)
  copy(pool.vel, index, last, 3)
  copy(pool.colA, index, last, 3)
  copy(pool.colB, index, last, 3)
  copy(pool.trailCol, index, last, 3)
  copy(pool.life, index, last, 2)
  copy(pool.phys, index, last, 2)
  copy(pool.param, index, last, PARAM)
  pool.sizes[index] = pool.sizes[last]
  pool.alphas[index] = pool.alphas[last]
  pool.baseSize[index] = pool.baseSize[last]
  pool.flags[index] = pool.flags[last]
  pool.streak[index] = pool.streak[last]
}

function copy(arr: Float32Array, dst: number, src: number, n: number): void {
  const d = dst * n
  const s = src * n
  for (let k = 0; k < n; k++) arr[d + k] = arr[s + k]
}

export function commitPool(pool: ParticlePool): void {
  const n = pool.alive
  pool.geometry.setDrawRange(0, n)
  const attrs = pool.geometry.attributes
  for (const name of ['position', 'aColor', 'aSize', 'aAlpha'] as const) {
    const attr = attrs[name] as BufferAttribute
    attr.clearUpdateRanges()
    if (n > 0) attr.addUpdateRange(0, n * attr.itemSize)
    attr.needsUpdate = true
  }
  pool.lineGeometry.setDrawRange(0, n * 2)
  for (const name of ['position', 'aColor'] as const) {
    const attr = pool.lineGeometry.attributes[name] as BufferAttribute
    attr.clearUpdateRanges()
    if (n > 0) attr.addUpdateRange(0, n * 6)
    attr.needsUpdate = true
  }
}

export function createGlowTexture(size = 128): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.16, 'rgba(255,255,255,0.6)')
  g.addColorStop(0.42, 'rgba(255,255,255,0.12)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}
