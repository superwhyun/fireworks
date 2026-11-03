import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  NormalBlending,
  Points,
  ShaderMaterial,
} from 'three'

const vertexShader = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
uniform float uPixelScale;
uniform float uMirror;
uniform vec3 uLight;
uniform float uLit;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec3 p = position;
  float a = aAlpha;
  if (uMirror > 0.5) {
    float h = p.y;
    p.y = -h;
    a *= 0.3 * clamp(1.0 - h / 320.0, 0.0, 1.0);
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(aSize * uPixelScale / max(-mv.z, 0.5), 1024.0);
  vColor = aColor + uLight * uLit;
  vAlpha = a;
}
`

const fragmentShader = /* glsl */ `
uniform float uSoft;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p) * 2.0;
  if (d > 1.0) discard;
  float f = exp(-d * d * uSoft) * (1.0 - d);
  float a = f * vAlpha;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor * a, a);
}
`

interface Sprite {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  r: number
  g: number
  b: number
  size: number
  grow: number
  alpha: number
  life: number
  max: number
}

export interface SpriteArgs {
  x: number
  y: number
  z: number
  color: { r: number; g: number; b: number }
  size: number
  intensity: number
  /** seconds */
  life: number
  grow?: number
  vx?: number
  vy?: number
  vz?: number
}

/** Soft sprites: additive flashes/afterglow, or normal-blended smoke. */
export class SpriteLayer {
  readonly points: Points
  readonly mirror: Points | null
  private geometry: BufferGeometry
  private material: ShaderMaterial
  private mirrorMaterial: ShaderMaterial | null = null
  private positions: Float32Array
  private colors: Float32Array
  private sizes: Float32Array
  private alphas: Float32Array
  private alive: Sprite[] = []
  private readonly smoke: boolean

  constructor(
    private capacity: number,
    opts: { smoke?: boolean; mirror?: boolean; renderOrder?: number } = {},
  ) {
    this.smoke = !!opts.smoke
    this.positions = new Float32Array(capacity * 3)
    this.colors = new Float32Array(capacity * 3)
    this.sizes = new Float32Array(capacity)
    this.alphas = new Float32Array(capacity)
    this.geometry = new BufferGeometry()
    const add = (name: string, arr: Float32Array, n: number) => {
      const a = new BufferAttribute(arr, n)
      a.setUsage(DynamicDrawUsage)
      this.geometry.setAttribute(name, a)
    }
    add('position', this.positions, 3)
    add('aColor', this.colors, 3)
    add('aSize', this.sizes, 1)
    add('aAlpha', this.alphas, 1)
    this.geometry.setDrawRange(0, 0)

    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader: this.smoke
        ? fragmentShader.replace('gl_FragColor = vec4(vColor * a, a);', 'gl_FragColor = vec4(vColor, a);')
        : fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: this.smoke ? NormalBlending : AdditiveBlending,
      uniforms: {
        uPixelScale: { value: 1 },
        uMirror: { value: 0 },
        uSoft: { value: this.smoke ? 1.6 : 3.2 },
        uLight: { value: new Color(0, 0, 0) },
        uLit: { value: this.smoke ? 1 : 0 },
      },
    })
    this.points = new Points(this.geometry, this.material)
    this.points.frustumCulled = false
    this.points.renderOrder = opts.renderOrder ?? 9

    if (opts.mirror) {
      this.mirrorMaterial = this.material.clone()
      this.mirrorMaterial.uniforms.uMirror.value = 1
      this.mirrorMaterial.depthTest = true
      this.mirror = new Points(this.geometry, this.mirrorMaterial)
      this.mirror.frustumCulled = false
      this.mirror.renderOrder = 2
    } else {
      this.mirror = null
    }
  }

  get count(): number {
    return this.alive.length
  }

  setPixelScale(s: number): void {
    this.material.uniforms.uPixelScale.value = s
    if (this.mirrorMaterial) this.mirrorMaterial.uniforms.uPixelScale.value = s
  }

  /** smoke only: colour of the light currently illuminating the smoke */
  setLight(c: Color): void {
    ;(this.material.uniforms.uLight.value as Color).copy(c)
  }

  add(e: SpriteArgs): void {
    if (this.alive.length >= this.capacity) this.alive.shift()
    this.alive.push({
      x: e.x,
      y: e.y,
      z: e.z,
      vx: e.vx ?? 0,
      vy: e.vy ?? 0,
      vz: e.vz ?? 0,
      r: e.color.r,
      g: e.color.g,
      b: e.color.b,
      size: e.size,
      grow: e.grow ?? 0,
      alpha: e.intensity,
      life: e.life,
      max: e.life,
    })
  }

  clear(): void {
    this.alive.length = 0
    this.geometry.setDrawRange(0, 0)
  }

  update(dt: number): void {
    const list = this.alive
    let w = 0
    for (let i = 0; i < list.length; i++) {
      const s = list[i]
      s.life -= dt
      if (s.life <= 0) continue
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.z += s.vz * dt
      s.size += s.grow * dt
      list[w++] = s
    }
    list.length = w

    for (let i = 0; i < w; i++) {
      const s = list[i]
      const t = s.life / s.max
      // flashes: sharp attack, smooth decay. smoke: fade in then out
      const f = this.smoke ? Math.min(1, (1 - t) * 6) * t : t * t
      const i3 = i * 3
      this.positions[i3] = s.x
      this.positions[i3 + 1] = s.y
      this.positions[i3 + 2] = s.z
      this.colors[i3] = s.r
      this.colors[i3 + 1] = s.g
      this.colors[i3 + 2] = s.b
      this.sizes[i] = s.size
      this.alphas[i] = s.alpha * f
    }
    this.geometry.setDrawRange(0, w)
    for (const name of ['position', 'aColor', 'aSize', 'aAlpha']) {
      const a = this.geometry.attributes[name] as BufferAttribute
      a.clearUpdateRanges()
      if (w) a.addUpdateRange(0, w * a.itemSize)
      a.needsUpdate = true
    }
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
    this.mirrorMaterial?.dispose()
  }
}
