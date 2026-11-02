import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  PointsMaterial,
  Texture,
} from 'three'

export interface GlowEntry {
  x: number
  y: number
  z: number
  color: Color
  size: number
  intensity: number
  decay: number
}

interface LiveGlow {
  x: number
  y: number
  z: number
  r: number
  g: number
  b: number
  size: number
  intensity: number
  decay: number
}

const CAPACITY = 96

export class GlowLayer {
  readonly points: Points
  private geometry: BufferGeometry
  private material: PointsMaterial
  private positions = new Float32Array(CAPACITY * 3)
  private colors = new Float32Array(CAPACITY * 3)
  private sizes = new Float32Array(CAPACITY)
  private alive: LiveGlow[] = []

  constructor(texture: Texture) {
    this.geometry = new BufferGeometry()
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3))
    this.geometry.setAttribute('color', new BufferAttribute(this.colors, 3))
    this.geometry.setAttribute('size', new BufferAttribute(this.sizes, 1))
    this.geometry.setDrawRange(0, 0)

    this.material = new PointsMaterial({
      size: 1,
      map: texture,
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      sizeAttenuation: true,
      opacity: 1,
    })

    this.points = new Points(this.geometry, this.material)
    this.points.frustumCulled = false
  }

  add(e: GlowEntry): void {
    if (this.alive.length >= CAPACITY) this.alive.shift()
    this.alive.push({
      x: e.x,
      y: e.y,
      z: e.z,
      r: e.color.r,
      g: e.color.g,
      b: e.color.b,
      size: e.size,
      intensity: e.intensity,
      decay: e.decay,
    })
  }

  clear(): void {
    this.alive.length = 0
    this.geometry.setDrawRange(0, 0)
  }

  update(dt: number): void {
    for (let i = this.alive.length - 1; i >= 0; i--) {
      const g = this.alive[i]
      g.intensity -= dt * g.decay
      if (g.intensity <= 0) this.alive.splice(i, 1)
    }

    const n = this.alive.length
    for (let i = 0; i < n; i++) {
      const g = this.alive[i]
      this.positions[i * 3] = g.x
      this.positions[i * 3 + 1] = g.y
      this.positions[i * 3 + 2] = g.z
      this.colors[i * 3] = g.r * g.intensity
      this.colors[i * 3 + 1] = g.g * g.intensity
      this.colors[i * 3 + 2] = g.b * g.intensity
      this.sizes[i] = g.size * g.intensity
    }
    this.geometry.setDrawRange(0, n)
    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.color.needsUpdate = true
    this.geometry.attributes.size.needsUpdate = true
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.map?.dispose()
    this.material.dispose()
  }
}
