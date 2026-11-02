import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Points,
  ShaderMaterial,
  Texture,
} from 'three'

const vertexShader = /* glsl */ `
attribute vec3 aColor;
attribute vec4 aLife;
attribute float aSize;
attribute vec4 aPrev;

uniform float uPixelScale;

varying vec3 vColor;
varying float vAlpha;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;

  float t = clamp(aLife.x / max(aLife.y, 0.0001), 0.0, 1.0);
  float fade = pow(t, 0.65);
  vAlpha = fade * aLife.z;
  vColor = aColor * (1.0 + aLife.w * 0.55);

  float base = aSize * (0.55 + 0.45 * fade) * aLife.w;
  float dist = max(-mv.z, 0.1);
  float persp = base / dist * uPixelScale;
  float streak = max(persp, base / max(dist - aPrev.y * 0.5, 0.1) * uPixelScale);

  gl_PointSize = max(streak * 1.65, 1.0);
}
`

const fragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  if (d > 0.5) discard;
  float core = smoothstep(0.5, 0.0, d);
  core = core * core;
  float halo = smoothstep(0.5, 0.12, d) * 0.3;
  float a = (core + halo) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, a);
}
`

export interface ParticlePool {
  points: Points
  geometry: BufferGeometry
  capacity: number
  alive: number
  material: ShaderMaterial
  positions: Float32Array
  colors: Float32Array
  life: Float32Array
  sizes: Float32Array
  prev: Float32Array
  setPixelScale(scale: number): void
}

export function createPool(capacity: number): ParticlePool {
  const geometry = new BufferGeometry()
  const positions = new Float32Array(capacity * 3)
  const colors = new Float32Array(capacity * 3)
  const life = new Float32Array(capacity * 4)
  const sizes = new Float32Array(capacity)
  const prev = new Float32Array(capacity * 4)

  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('aColor', new BufferAttribute(colors, 3))
  geometry.setAttribute('aLife', new BufferAttribute(life, 4))
  geometry.setAttribute('aSize', new BufferAttribute(sizes, 1))
  geometry.setAttribute('aPrev', new BufferAttribute(prev, 4))
  geometry.setDrawRange(0, 0)
  geometry.boundingSphere = null

  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    uniforms: {
      uPixelScale: { value: 1 },
    },
  })

  const points = new Points(geometry, material)
  points.frustumCulled = false

  return {
    points,
    geometry,
    capacity,
    alive: 0,
    material,
    positions,
    colors,
    life,
    sizes,
    prev,
    setPixelScale(scale: number) {
      ;(material.uniforms.uPixelScale as { value: number }).value = scale
    },
  }
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
  color: { r: number; g: number; b: number }
  sparkle: number
}

export function spawnParticle(pool: ParticlePool, a: SpawnArgs): number {
  if (pool.alive >= pool.capacity) return -1
  const i = pool.alive++
  const p3 = i * 3
  const p4 = i * 4

  pool.positions[p3] = a.x
  pool.positions[p3 + 1] = a.y
  pool.positions[p3 + 2] = a.z

  pool.colors[p3] = a.color.r
  pool.colors[p3 + 1] = a.color.g
  pool.colors[p3 + 2] = a.color.b

  pool.life[p4] = a.life
  pool.life[p4 + 1] = a.life
  pool.life[p4 + 2] = 1
  pool.life[p4 + 3] = a.sparkle

  pool.sizes[i] = a.size

  pool.prev[p4] = a.vx
  pool.prev[p4 + 1] = a.vy
  pool.prev[p4 + 2] = a.vz
  pool.prev[p4 + 3] = 0

  return i
}

export function killParticle(pool: ParticlePool, index: number): void {
  const last = --pool.alive
  if (index === last) return

  const i3 = index * 3
  const l3 = last * 3
  pool.positions[i3] = pool.positions[l3]
  pool.positions[i3 + 1] = pool.positions[l3 + 1]
  pool.positions[i3 + 2] = pool.positions[l3 + 2]

  pool.colors[i3] = pool.colors[l3]
  pool.colors[i3 + 1] = pool.colors[l3 + 1]
  pool.colors[i3 + 2] = pool.colors[l3 + 2]

  const i4 = index * 4
  const l4 = last * 4
  pool.life[i4] = pool.life[l4]
  pool.life[i4 + 1] = pool.life[l4 + 1]
  pool.life[i4 + 2] = pool.life[l4 + 2]
  pool.life[i4 + 3] = pool.life[l4 + 3]

  pool.sizes[index] = pool.sizes[last]

  pool.prev[i4] = pool.prev[l4]
  pool.prev[i4 + 1] = pool.prev[l4 + 1]
  pool.prev[i4 + 2] = pool.prev[l4 + 2]
  pool.prev[i4 + 3] = pool.prev[l4 + 3]
}

export function commitPool(pool: ParticlePool): void {
  pool.geometry.setDrawRange(0, pool.alive)
  pool.geometry.attributes.position.needsUpdate = true
  pool.geometry.attributes.aColor.needsUpdate = true
  pool.geometry.attributes.aLife.needsUpdate = true
  pool.geometry.attributes.aSize.needsUpdate = true
  pool.geometry.attributes.aPrev.needsUpdate = true
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
