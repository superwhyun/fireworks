import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  ShaderMaterial,
  Texture,
} from 'three'
import { Rng } from './rng'

/**
 * Night-time city toolkit: buildings with several facade types (different
 * window sizes and lighting habits), rooftop/crown lighting, moving traffic,
 * and wavy reflections of all of it on water.
 */

type Disposable = { dispose(): void }

// ------------------------------------------------------------ facades

export type FacadeKind = 'apt' | 'office' | 'hotel' | 'shop'

interface FacadeSpec {
  /** world size of one window bay / one storey */
  bay: number
  floor: number
  cols: number
  rows: number
  cw: number
  ch: number
}

const FACADES: Record<FacadeKind, FacadeSpec> = {
  // Korean apartment slab: 2.8 m floors, alternating living-room / bedroom windows
  apt: { bay: 3.0, floor: 2.8, cols: 64, rows: 48, cw: 16, ch: 14 },
  // glass office tower: tall floors, narrow mullions, lights in whole-floor bands
  office: { bay: 1.6, floor: 4.0, cols: 96, rows: 64, cw: 10, ch: 16 },
  // hotel / officetel: small regular windows
  hotel: { bay: 2.2, floor: 3.2, cols: 80, rows: 64, cw: 12, ch: 14 },
  // low-rise commercial: bright storefronts, irregular upper windows
  shop: { bay: 3.6, floor: 3.6, cols: 48, rows: 12, cw: 20, ch: 18 },
}

function canvasFor(spec: FacadeSpec): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas')
  c.width = spec.cols * spec.cw
  c.height = spec.rows * spec.ch
  const g = c.getContext('2d')
  if (!g) throw new Error('2D canvas context unavailable')
  return { c, g }
}

const warm = (rng: Rng) => `rgb(255,${rng.int(176, 222)},${rng.int(105, 160)})`
const cool = (rng: Rng) => `rgb(${rng.int(205, 235)},${rng.int(222, 245)},255)`
const tv = (rng: Rng) => `rgb(${rng.int(90, 150)},${rng.int(140, 190)},255)`

/**
 * Draws a facade tile. Row 0 is the ground floor (canvas bottom), so the
 * texture is never offset vertically — only horizontally per building.
 */
function drawFacade(kind: FacadeKind, seed: number): HTMLCanvasElement {
  const spec = FACADES[kind]
  const { c, g } = canvasFor(spec)
  const rng = new Rng(seed)
  const { cols, rows, cw, ch } = spec
  const H = c.height
  const cell = (col: number, row: number) => ({ x: col * cw, y: H - (row + 1) * ch })

  if (kind === 'apt') {
    g.fillStyle = '#0b0c10'
    g.fillRect(0, 0, c.width, H)
    // unit layout repeats every 5 bays: living, living, bed, bed, stairwell
    for (let col = 0; col < cols; col++) {
      const k = col % 5
      const stair = k === 4
      const unitLit = new Array(rows).fill(0).map(() => rng.next())
      for (let row = 0; row < rows; row++) {
        const { x, y } = cell(col, row)
        if (row === 0) {
          // pilotis / lobby
          if (stair || rng.next() < 0.25) {
            g.fillStyle = cool(rng)
            g.globalAlpha = 0.85
            g.fillRect(x + 2, y + 3, cw - 4, ch - 4)
          }
          continue
        }
        if (stair) {
          // stairwell / lift lobby: cool fluorescent on nearly every floor
          if (rng.next() < 0.9) {
            g.fillStyle = cool(rng)
            g.globalAlpha = 0.7
            g.fillRect(x + cw * 0.38, y + 3, cw * 0.24, ch - 6)
          }
          continue
        }
        const living = k < 2
        const p = unitLit[row]
        const lit = p < (living ? 0.3 : 0.18)
        const w = living ? cw - 2 : cw * 0.55
        const ox = living ? 1 : cw * 0.22
        if (lit) {
          g.fillStyle = p < 0.03 ? tv(rng) : rng.next() < 0.85 ? warm(rng) : cool(rng)
          g.globalAlpha = rng.range(0.55, 1)
        } else {
          g.fillStyle = '#12141b'
          g.globalAlpha = 1
        }
        g.fillRect(x + ox, y + 2, w, ch - 4)
        // balcony railing hides the lower part of the glass
        g.globalAlpha = 1
        g.fillStyle = 'rgba(8,9,12,0.75)'
        g.fillRect(x + ox, y + ch - 6, w, 3)
      }
    }
  } else if (kind === 'office') {
    g.fillStyle = '#070a12'
    g.fillRect(0, 0, c.width, H)
    // occupancy comes in floors (whole tenants), with a few late workers elsewhere
    for (let row = 0; row < rows; row++) {
      const floorLit = rng.next() < 0.3
      const tint = rng.next() < 0.75 ? '#e9f1ff' : '#dff7ea'
      for (let col = 0; col < cols; col++) {
        const { x, y } = cell(col, row)
        // dark glass with faint sky reflection
        g.globalAlpha = 1
        g.fillStyle = `rgb(${10 + (row % 7)},${14 + (row % 5)},${26 + (col % 9)})`
        g.fillRect(x + 1, y + 3, cw - 1, ch - 4)
        const on = floorLit ? rng.next() < 0.88 : rng.next() < 0.03
        if (on) {
          g.fillStyle = tint
          g.globalAlpha = floorLit ? rng.range(0.6, 0.95) : rng.range(0.4, 0.8)
          g.fillRect(x + 1, y + 3, cw - 1, ch - 4)
        }
      }
      // floor slab
      g.globalAlpha = 1
      g.fillStyle = '#040508'
      g.fillRect(0, H - (row + 1) * ch, c.width, 3)
    }
  } else if (kind === 'hotel') {
    g.fillStyle = '#0d0c0c'
    g.fillRect(0, 0, c.width, H)
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const { x, y } = cell(col, row)
        const lit = rng.next() < (row === 0 ? 0.8 : 0.4)
        if (lit) {
          // curtains: mostly warm and partly drawn
          g.fillStyle = rng.next() < 0.9 ? warm(rng) : tv(rng)
          g.globalAlpha = rng.range(0.3, 0.9)
        } else {
          g.fillStyle = '#16151a'
          g.globalAlpha = 1
        }
        g.fillRect(x + cw * 0.2, y + 3, cw * 0.6, ch - 6)
      }
    }
  } else {
    g.fillStyle = '#0c0b0b'
    g.fillRect(0, 0, c.width, H)
    const signs = ['#ff3d5a', '#27e0ff', '#ffd23a', '#ffffff', '#ff7a1a', '#7dff6a', '#c86bff']
    for (let col = 0; col < cols; col++) {
      // storefront: bright glass + signboard above it
      const { x, y } = cell(col, 0)
      if (rng.next() < 0.8) {
        g.fillStyle = rng.next() < 0.7 ? '#fff1d6' : '#e8f4ff'
        g.globalAlpha = rng.range(0.6, 1)
        g.fillRect(x + 1, y + ch * 0.35, cw - 2, ch * 0.62)
      }
      g.globalAlpha = 1
      g.fillStyle = signs[rng.int(0, signs.length - 1)]
      g.fillRect(x + 1, y + 2, cw - 2, ch * 0.28)
      for (let row = 1; row < rows; row++) {
        const p = cell(col, row)
        const lit = rng.next() < 0.35
        g.fillStyle = lit ? (rng.next() < 0.6 ? warm(rng) : cool(rng)) : '#15151a'
        g.globalAlpha = lit ? rng.range(0.4, 0.9) : 1
        const w = rng.next() < 0.5 ? cw * 0.8 : cw * 0.45
        g.fillRect(p.x + (cw - w) / 2, p.y + 3, w, ch - 7)
        // vertical neon signs on some upper floors
        if (row < 5 && rng.next() < 0.06) {
          g.globalAlpha = 1
          g.fillStyle = signs[rng.int(0, signs.length - 1)]
          g.fillRect(p.x + cw - 5, p.y, 4, ch)
        }
      }
    }
  }
  g.globalAlpha = 1
  return c
}

function facadeTexture(kind: FacadeKind, seed: number): Texture {
  const tex = new CanvasTexture(drawFacade(kind, seed))
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.colorSpace = SRGBColorSpace
  tex.minFilter = LinearMipmapLinearFilter
  tex.anisotropy = 8
  return tex
}

// ------------------------------------------------------------ building shader

const buildingVertex = /* glsl */ `
attribute vec3 color;
uniform float uMirror;
uniform float uTime;
varying vec2 vUv;
varying vec3 vTint;
varying float vDepth;
varying float vY;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vY = w.y;
  if (uMirror > 0.5) {
    // rippled water stretches reflections toward the viewer
    w.y = -w.y * 1.7;
    // ripples bend the mirror image sideways
    w.x += sin(w.y * 0.35 + uTime * 1.9 + w.z * 0.03) * (0.4 - w.y * 0.03);
  }
  vUv = uv;
  vTint = color;
  vec4 mv = viewMatrix * w;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`

const buildingFragment = /* glsl */ `
uniform sampler2D map;
uniform float uBright;
uniform vec3 uLight;
uniform float uMirror;
uniform float uTime;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying vec2 vUv;
varying vec3 vTint;
varying float vDepth;
varying float vY;
void main() {
  vec2 uv = vUv;
  float fade = 1.0;
  vec3 tex;
  if (uMirror > 0.5) {
    // rippled reflection: each light is smeared into a vertical, broken column
    float row = gl_FragCoord.y;
    float wob = sin(row * 0.9 + uTime * 3.1) * sin(row * 0.23 - uTime * 1.3);
    uv.x += wob * 0.006 + sin(row * 0.37 + uTime * 2.3) * 0.004;
    tex = vec3(0.0);
    for (int k = -4; k <= 4; k++) {
      tex += texture2D(map, uv + vec2(0.0, float(k) * 0.011)).rgb;
    }
    tex /= 9.0;
    // only lights reflect visibly; dark glass and walls vanish
    tex = max(tex - vec3(0.06), vec3(0.0)) * 2.2;
    // gaps where wave troughs face away from the lights (two scales, so no regular banding)
    float gap = smoothstep(-0.3, 0.7, sin(row * 0.61 + uTime * 2.7 + vUv.x * 40.0) * 0.6 + sin(row * 0.173 - uTime * 1.1 + vUv.x * 17.0) * 0.6);
    fade = 0.6 * exp(-vY / 110.0) * gap;
  } else {
    tex = texture2D(map, uv).rgb;
  }
  vec3 col = tex * uBright * vTint;
  // fireworks light the walls a little
  col += uLight * 0.22 * vTint * (1.0 - min(1.0, dot(tex, vec3(0.33)) * 3.0));
  float f = 1.0 - exp(-pow(vDepth * uFogDensity, 2.0));
  if (uMirror > 0.5) {
    gl_FragColor = vec4(col * fade * (1.0 - f), 1.0);
  } else {
    gl_FragColor = vec4(mix(col, uFogColor, f), 1.0);
  }
}
`

interface BuildingMaterialSet {
  normal: ShaderMaterial
  mirror: ShaderMaterial
}

function buildingMaterials(map: Texture, bright: number): BuildingMaterialSet {
  const uniforms = () => ({
    map: { value: map },
    uBright: { value: bright },
    uLight: { value: new Color(0, 0, 0) },
    uMirror: { value: 0 },
    uTime: { value: 0 },
    uFogColor: { value: new Color('#05060d') },
    uFogDensity: { value: 0.0011 },
  })
  const normal = new ShaderMaterial({
    vertexShader: buildingVertex,
    fragmentShader: buildingFragment,
    uniforms: uniforms(),
    side: DoubleSide,
  })
  const mirror = new ShaderMaterial({
    vertexShader: buildingVertex,
    fragmentShader: buildingFragment,
    uniforms: uniforms(),
    side: DoubleSide,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  })
  mirror.uniforms.uMirror.value = 1
  return { normal, mirror }
}

// ------------------------------------------------------------ geometry

export interface Building {
  x: number
  z: number
  w: number
  d: number
  h: number
  rot: number
  kind: FacadeKind
  /** crown / rooftop lighting colour (null = none) */
  crown?: string | null
  /** rooftop sign (apartment complex name board) */
  sign?: string | null
  /** vertical LED strips on the front corners */
  strips?: string | null
  /** tower set back on a podium (offices) */
  podium?: number
}

interface Quads {
  pos: number[]
  uv: number[]
  col: number[]
  idx: number[]
}

const quads = (): Quads => ({ pos: [], uv: [], col: [], idx: [] })

function pushQuad(q: Quads, p: number[], uv: number[], c: [number, number, number]): void {
  const v = q.pos.length / 3
  q.pos.push(...p)
  q.uv.push(...uv)
  for (let i = 0; i < 4; i++) q.col.push(...c)
  q.idx.push(v, v + 1, v + 2, v, v + 2, v + 3)
}

function footprint(b: { x: number; z: number; w: number; d: number; rot: number }): [number, number][] {
  const c = Math.cos(b.rot)
  const s = Math.sin(b.rot)
  const hw = b.w / 2
  const hd = b.d / 2
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([lx, lz]) => [b.x + lx * c - lz * s, b.z + lx * s + lz * c] as [number, number])
}

function addBox(
  q: Quads,
  b: { x: number; z: number; w: number; d: number; rot: number },
  y0: number,
  y1: number,
  spec: FacadeSpec,
  u0: number,
  tint: [number, number, number],
): void {
  const fp = footprint(b)
  const v0 = y0 / spec.floor / spec.rows
  const v1 = y1 / spec.floor / spec.rows
  let u = u0
  for (let f = 0; f < 4; f++) {
    const [ax, az] = fp[f]
    const [bx, bz] = fp[(f + 1) % 4]
    const len = Math.hypot(bx - ax, bz - az)
    const du = Math.round(len / spec.bay) / spec.cols
    pushQuad(q, [ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az], [u, v0, u + du, v0, u + du, v1, u, v1], tint)
    u += du
  }
  // roof: sample a dark spot (top-left of the tile is never lit window glass)
  pushQuad(
    q,
    [fp[0][0], y1, fp[0][1], fp[1][0], y1, fp[1][1], fp[2][0], y1, fp[2][1], fp[3][0], y1, fp[3][1]],
    [0.0005, 0.9995, 0.0005, 0.9995, 0.0005, 0.9995, 0.0005, 0.9995],
    tint,
  )
}

/** a thin emissive quad standing just in front of a facade */
function addAccent(
  q: Quads,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  y0: number,
  y1: number,
  out: [number, number],
  c: [number, number, number],
): void {
  const o = 0.35
  pushQuad(
    q,
    [ax + out[0] * o, y0, az + out[1] * o, bx + out[0] * o, y0, bz + out[1] * o, bx + out[0] * o, y1, bz + out[1] * o, ax + out[0] * o, y1, az + out[1] * o],
    [0, 0, 1, 0, 1, 1, 0, 1],
    c,
  )
}

function toGeometry(q: Quads): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(q.pos, 3))
  g.setAttribute('uv', new Float32BufferAttribute(q.uv, 2))
  g.setAttribute('color', new Float32BufferAttribute(q.col, 3))
  g.setIndex(q.idx)
  return g
}

const tmpC = new Color()
function rgbOf(hex: string, mul: number): [number, number, number] {
  tmpC.set(hex)
  return [tmpC.r * mul, tmpC.g * mul, tmpC.b * mul]
}

export interface Skyline {
  group: Group
  /** add to a group drawn after the water to get reflections */
  mirror: Group
  roofs: { x: number; y: number; z: number }[]
  update(t: number, light: Color): void
  dispose(): void
}

/** Build all buildings into a handful of meshes (one per facade texture). */
export function buildSkyline(buildings: Building[], seed: number, opts: { bright?: number } = {}): Skyline {
  const rng = new Rng(seed)
  const group = new Group()
  const mirror = new Group()
  const disp: Disposable[] = []
  const kinds: FacadeKind[] = ['apt', 'office', 'hotel', 'shop']
  // two texture variants per kind to avoid visible repetition
  const variants = kinds.flatMap((k, i) => [0, 1].map((v) => ({ kind: k, tex: facadeTexture(k, seed * 7 + i * 31 + v * 977) })))
  const buckets = variants.map(() => quads())
  const accents = quads()
  const roofs: { x: number; y: number; z: number }[] = []

  for (const b of buildings) {
    const vi = kinds.indexOf(b.kind) * 2 + (rng.next() < 0.5 ? 0 : 1)
    const spec = FACADES[b.kind]
    const q = buckets[vi]
    const u0 = Math.floor(rng.next() * spec.cols) / spec.cols
    // slight per-building colour cast (glass tint, paint, lamp types)
    const t = rng.range(0.8, 1.12)
    const tint: [number, number, number] = [t * rng.range(0.94, 1.06), t, t * rng.range(0.94, 1.08)]

    if (b.podium && b.podium > 0) {
      const ph = b.podium
      addBox(q, { ...b, w: b.w * 1.6, d: b.d * 1.6 }, 0, ph, spec, u0, tint)
      addBox(q, b, ph, b.h, spec, u0 + 0.25, tint)
    } else {
      addBox(q, b, 0, b.h, spec, u0, tint)
    }
    roofs.push({ x: b.x, y: b.h, z: b.z })

    // accents on the front face (the one facing +z after rotation) and sides
    const fp = footprint(b)
    const front: [[number, number], [number, number]] = [fp[3], fp[2]]
    const nx = -Math.sin(b.rot)
    const nz = Math.cos(b.rot)
    if (b.crown) {
      const c = rgbOf(b.crown, 0.85)
      for (let f = 0; f < 4; f++) {
        const [ax, az] = fp[f]
        const [bx, bz] = fp[(f + 1) % 4]
        const ex = bz - az
        const ez = -(bx - ax)
        const el = Math.hypot(ex, ez) || 1
        addAccent(accents, ax, az, bx, bz, b.h - 1.6, b.h - 0.4, [ex / el, ez / el], c)
      }
    }
    if (b.sign) {
      const c = rgbOf(b.sign, 1.0)
      const mx = (front[0][0] + front[1][0]) / 2
      const mz = (front[0][1] + front[1][1]) / 2
      const hw = Math.min(9, b.w * 0.18)
      const dx = Math.cos(b.rot) * hw
      const dz = Math.sin(b.rot) * hw
      addAccent(accents, mx - dx, mz - dz, mx + dx, mz + dz, b.h + 0.6, b.h + 3.4, [nx, nz], c)
    }
    if (b.strips) {
      const c = rgbOf(b.strips, 1.3)
      for (const [px, pz] of front) {
        const dx = Math.cos(b.rot) * 0.4
        const dz = Math.sin(b.rot) * 0.4
        addAccent(accents, px - dx, pz - dz, px + dx, pz + dz, 3, b.h, [nx, nz], c)
      }
    }
  }

  const mats: BuildingMaterialSet[] = []
  variants.forEach((v, i) => {
    if (!buckets[i].pos.length) {
      v.tex.dispose()
      return
    }
    const geo = toGeometry(buckets[i])
    const m = buildingMaterials(v.tex, opts.bright ?? 0.62)
    mats.push(m)
    const mesh = new Mesh(geo, m.normal)
    mesh.renderOrder = 1
    group.add(mesh)
    const mm = new Mesh(geo, m.mirror)
    mm.renderOrder = 2
    mm.frustumCulled = false
    mirror.add(mm)
    disp.push(geo, m.normal, m.mirror, v.tex)
  })

  if (accents.pos.length) {
    const geo = toGeometry(accents)
    const mat = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, fog: true })
    const mesh = new Mesh(geo, mat)
    mesh.renderOrder = 1
    group.add(mesh)
    disp.push(geo, mat)
  }

  return {
    group,
    mirror,
    roofs,
    update(t, light) {
      for (const m of mats) {
        ;(m.normal.uniforms.uLight.value as Color).copy(light)
        m.mirror.uniforms.uTime.value = t
        m.normal.uniforms.uTime.value = t
      }
    },
    dispose() {
      for (const d of disp) d.dispose()
    },
  }
}

// ------------------------------------------------------------ traffic

export interface Road {
  /** centreline polyline [x, z] */
  path: [number, number][]
  y?: number
  lanesPerDir: number
  /** cars per 100 units of road per direction */
  density: number
  speed: [number, number]
  closed?: boolean
}

interface Car {
  road: number
  dir: 1 | -1
  lane: number
  s: number
  v: number
}

interface RoadCache {
  pts: [number, number][]
  cum: number[]
  len: number
  y: number
  closed: boolean
}

export interface Traffic {
  group: Group
  mirror: Group
  update(dt: number): void
  dispose(): void
}

const LANE = 3.4

/**
 * Moving cars on road polylines. Each car is two light points — white
 * headlights in front, red tail lights behind — so from the side you see
 * both, and from the ends you see streams of white one way, red the other.
 */
export function buildTraffic(roads: Road[], glowTex: Texture, seed: number): Traffic {
  const rng = new Rng(seed)
  const cache: RoadCache[] = roads.map((r) => {
    const pts = r.closed ? [...r.path, r.path[0]] : r.path
    const cum = [0]
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    return { pts, cum, len: cum[cum.length - 1], y: r.y ?? 0.8, closed: !!r.closed }
  })
  const cars: Car[] = []
  roads.forEach((r, ri) => {
    const n = Math.round((cache[ri].len / 100) * r.density)
    for (const dir of [1, -1] as const) {
      for (let i = 0; i < n; i++) {
        cars.push({
          road: ri,
          dir,
          lane: rng.int(0, r.lanesPerDir - 1),
          s: rng.range(0, cache[ri].len),
          v: rng.range(r.speed[0], r.speed[1]),
        })
      }
    }
  })

  const N = cars.length
  const pos = new Float32Array(N * 6)
  const col = new Float32Array(N * 6)
  for (let i = 0; i < N; i++) {
    const big = rng.next() < 0.1 // buses / trucks: dimmer, yellower
    col.set(big ? [1, 0.85, 0.55] : [1, 0.96, 0.86], i * 6)
    col.set([1, 0.06, 0.03], i * 6 + 3)
  }
  const geo = new BufferGeometry()
  const pa = new BufferAttribute(pos, 3)
  pa.setUsage(DynamicDrawUsage)
  geo.setAttribute('position', pa)
  geo.setAttribute('color', new BufferAttribute(col, 3))
  const mat = new PointsMaterial({
    size: 5,
    map: glowTex,
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  })
  const points = new Points(geo, mat)
  points.frustumCulled = false
  points.renderOrder = 3
  const group = new Group()
  group.add(points)

  const mmat = mat.clone()
  mmat.opacity = 0.3
  const mpoints = new Points(geo, mmat)
  mpoints.frustumCulled = false
  mpoints.renderOrder = 2
  const mirror = new Group()
  mirror.scale.y = -1
  mirror.add(mpoints)

  const at = (rc: RoadCache, s: number, out: number[]) => {
    let d = s % rc.len
    if (d < 0) d += rc.len
    let i = 1
    while (i < rc.cum.length - 1 && rc.cum[i] < d) i++
    const [ax, az] = rc.pts[i - 1]
    const [bx, bz] = rc.pts[i]
    const seg = rc.cum[i] - rc.cum[i - 1] || 1
    const f = (d - rc.cum[i - 1]) / seg
    out[0] = ax + (bx - ax) * f
    out[1] = az + (bz - az) * f
    out[2] = (bx - ax) / seg
    out[3] = (bz - az) / seg
  }
  const p = [0, 0, 0, 0]

  const update = (dt: number) => {
    for (let i = 0; i < N; i++) {
      const c = cars[i]
      const rc = cache[c.road]
      c.s += c.v * c.dir * dt
      if (!rc.closed && (c.s > rc.len || c.s < 0)) c.s = c.dir > 0 ? 0 : rc.len
      at(rc, c.s, p)
      const tx = p[2] * c.dir
      const tz = p[3] * c.dir
      // drive on the right: offset to the right of travel direction
      const off = (c.lane + 0.5) * LANE + 0.6
      const x = p[0] - tz * off
      const z = p[1] + tx * off
      const o = i * 6
      pos[o] = x + tx * 2
      pos[o + 1] = rc.y
      pos[o + 2] = z + tz * 2
      pos[o + 3] = x - tx * 2
      pos[o + 4] = rc.y
      pos[o + 5] = z - tz * 2
    }
    pa.needsUpdate = true
  }
  update(0)

  return {
    group,
    mirror,
    update,
    dispose() {
      geo.dispose()
      mat.dispose()
      mmat.dispose()
    },
  }
}

/** Dark asphalt ribbons with sodium/LED street lights along both edges. */
export function buildRoadsurface(
  roads: Road[],
  glowTex: Texture,
  opts: { lampSpacing?: number; lampColor?: [number, number, number] } = {},
): { group: Group; mirror: Group; dispose(): void } {
  const pos: number[] = []
  const idx: number[] = []
  const lp: number[] = []
  const lc: number[] = []
  const spacing = opts.lampSpacing ?? 30
  const lcol = opts.lampColor ?? [1, 0.62, 0.3]
  for (const r of roads) {
    const pts = r.closed ? [...r.path, r.path[0]] : r.path
    const hw = r.lanesPerDir * LANE + 1.5
    const y = (r.y ?? 0.8) - 0.6
    let carry = 0
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1]
      const [bx, bz] = pts[i]
      const len = Math.hypot(bx - ax, bz - az) || 1
      const nx = -(bz - az) / len
      const nz = (bx - ax) / len
      const v = pos.length / 3
      pos.push(ax + nx * hw, y, az + nz * hw, bx + nx * hw, y, bz + nz * hw, bx - nx * hw, y, bz - nz * hw, ax - nx * hw, y, az - nz * hw)
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3)
      for (let d = carry; d < len; d += spacing) {
        const f = d / len
        const x = ax + (bx - ax) * f
        const z = az + (bz - az) * f
        lp.push(x + nx * (hw + 0.5), y + 9, z + nz * (hw + 0.5), x - nx * (hw + 0.5), y + 9, z - nz * (hw + 0.5))
        lc.push(...lcol, ...lcol)
        carry = d + spacing - len
      }
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  const mat = new MeshBasicMaterial({ color: new Color(0.034, 0.024, 0.015), side: DoubleSide })
  const mesh = new Mesh(geo, mat)
  mesh.renderOrder = 1
  const lgeo = new BufferGeometry()
  lgeo.setAttribute('position', new Float32BufferAttribute(lp, 3))
  lgeo.setAttribute('color', new Float32BufferAttribute(lc, 3))
  const lmat = new PointsMaterial({
    size: 4.5,
    map: glowTex,
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    opacity: 0.8,
  })
  const lamps = new Points(lgeo, lmat)
  lamps.renderOrder = 3
  const group = new Group()
  group.add(mesh, lamps)
  const mlmat = lmat.clone()
  mlmat.opacity = 0.28
  const ml = new Points(lgeo, mlmat)
  ml.renderOrder = 2
  const mirror = new Group()
  mirror.scale.y = -1
  mirror.add(ml)
  return {
    group,
    mirror,
    dispose() {
      geo.dispose()
      mat.dispose()
      lgeo.dispose()
      lmat.dispose()
      mlmat.dispose()
    },
  }
}

/** Red aviation obstruction lights on tall roofs, blinking in sync. */
export function buildAviationLights(
  roofs: { x: number; y: number; z: number }[],
  minHeight: number,
  glowTex: Texture,
): { points: Points; update(t: number): void; dispose(): void } {
  const pts: number[] = []
  const cols: number[] = []
  for (const r of roofs) {
    if (r.y >= minHeight) {
      pts.push(r.x, r.y + 2, r.z)
      cols.push(1, 0.06, 0.03)
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(pts, 3))
  geo.setAttribute('color', new Float32BufferAttribute(cols, 3))
  const mat = new PointsMaterial({
    size: 6,
    map: glowTex,
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  })
  const points = new Points(geo, mat)
  points.renderOrder = 3
  return {
    points,
    update(t) {
      mat.opacity = Math.sin(t * 2.4) > 0.2 ? 0.95 : 0.06
    },
    dispose() {
      geo.dispose()
      mat.dispose()
    },
  }
}

/** Distant mountain ridge as a dark band (Seoul-style basin backdrop). */
export function buildRidge(
  centre: [number, number],
  radius: number,
  arc: [number, number],
  height: number,
  seed: number,
): { mesh: Mesh; update(light: Color): void; dispose(): void } {
  const rng = new Rng(seed)
  const ph = [rng.range(0, 6), rng.range(0, 6), rng.range(0, 6), rng.range(0, 6)]
  const seg = 160
  const pos: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= seg; i++) {
    const a = arc[0] + (arc[1] - arc[0]) * (i / seg)
    const h =
      height *
      (0.55 + 0.25 * Math.sin(a * 5 + ph[0]) + 0.13 * Math.sin(a * 13 + ph[1]) + 0.07 * Math.sin(a * 29 + ph[2]) + 0.04 * Math.sin(a * 61 + ph[3]))
    const c = Math.cos(a)
    const s = Math.sin(a)
    pos.push(centre[0] + c * radius, 0, centre[1] + s * radius, centre[0] + c * radius * 1.08, h, centre[1] + s * radius * 1.08)
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2
    idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  const base = new Color(0.006, 0.007, 0.011)
  const mat = new MeshBasicMaterial({ color: base.clone(), side: DoubleSide, fog: false })
  const mesh = new Mesh(geo, mat)
  mesh.renderOrder = 0
  return {
    mesh,
    update(light) {
      mat.color.setRGB(base.r + light.r * 0.04, base.g + light.g * 0.04, base.b + light.b * 0.04)
    },
    dispose() {
      geo.dispose()
      mat.dispose()
    },
  }
}
