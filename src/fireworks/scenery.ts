import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from 'three'
import { Rng } from './rng'

export type SceneId = 'river' | 'lake' | 'sea' | 'city'

export const SCENES: { id: SceneId; label: string }[] = [
  { id: 'river', label: '강' },
  { id: 'lake', label: '호수' },
  { id: 'sea', label: '바다' },
  { id: 'city', label: '도심' },
]

export interface WaterParams {
  visible: boolean
  /** slope multiplier (wave height) */
  amp: number
  /** time multiplier */
  speed: number
  /** surface drift (current), world units / s */
  flow: [number, number]
}

export interface Scenery {
  group: Group
  water: WaterParams
  /** whether fireworks should be mirrored (water surface present) */
  reflections: boolean
  update(t: number, light: Color): void
  dispose(): void
}

type Disposable = { dispose(): void }

// ------------------------------------------------------------ helpers

const FLOOR = 3 // world units per storey
const BAY = 3.2 // world units per window bay
const TILE_COLS = 32
const TILE_ROWS = 64

/** Apartment/office facade: grid of windows, some lit warm/cool, most dark. */
function makeWindowTexture(seed: number, litRatio: number): Texture {
  const cw = 16
  const ch = 10
  const canvas = document.createElement('canvas')
  canvas.width = TILE_COLS * cw
  canvas.height = TILE_ROWS * ch
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  ctx.fillStyle = '#07080b'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const rng = new Rng(seed)
  for (let r = 0; r < TILE_ROWS; r++) {
    // whole floors tend to be similar (people's habits / building use)
    const floorBias = rng.range(-0.15, 0.15)
    for (let c = 0; c < TILE_COLS; c++) {
      const lit = rng.next() < litRatio + floorBias
      if (lit) {
        const k = rng.next()
        const col =
          k < 0.6
            ? `rgb(${255},${rng.int(190, 225)},${rng.int(120, 165)})` // warm incandescent
            : k < 0.85
              ? `rgb(${rng.int(215, 240)},${rng.int(225, 245)},255)` // cool LED
              : `rgb(${rng.int(120, 170)},${rng.int(160, 200)},255)` // TV glow
        ctx.fillStyle = col
        ctx.globalAlpha = rng.range(0.45, 1)
      } else {
        ctx.fillStyle = '#0e1016'
        ctx.globalAlpha = 1
      }
      ctx.fillRect(c * cw + 3, r * ch + 2, cw - 6, ch - 4)
    }
  }
  ctx.globalAlpha = 1
  const tex = new CanvasTexture(canvas)
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

interface Box {
  x: number
  z: number
  w: number
  d: number
  h: number
  rot: number
}

/** Merge many buildings into one mesh. Facade UVs are in "window units". */
function buildingMesh(boxes: Box[], tex: Texture, rng: Rng, brightness: number): { mesh: Mesh; roofs: Box[] } {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  let v = 0
  for (const b of boxes) {
    const c = Math.cos(b.rot)
    const s = Math.sin(b.rot)
    const hw = b.w / 2
    const hd = b.d / 2
    const corners: [number, number][] = [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ].map(([lx, lz]) => [b.x + lx * c - lz * s, b.z + lx * s + lz * c])
    const u0 = Math.floor(rng.next() * TILE_COLS) / TILE_COLS
    const v0 = Math.floor(rng.next() * TILE_ROWS) / TILE_ROWS
    const vTop = b.h / FLOOR / TILE_ROWS
    for (let f = 0; f < 4; f++) {
      const [ax, az] = corners[f]
      const [bx, bz] = corners[(f + 1) % 4]
      const len = Math.hypot(bx - ax, bz - az)
      const uLen = len / BAY / TILE_COLS
      pos.push(ax, 0, az, bx, 0, bz, bx, b.h, bz, ax, b.h, az)
      uv.push(u0, v0, u0 + uLen, v0, u0 + uLen, v0 + vTop, u0, v0 + vTop)
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3)
      v += 4
    }
    // roof (dark: sample an unlit gap of the texture)
    pos.push(corners[0][0], b.h, corners[0][1], corners[1][0], b.h, corners[1][1], corners[2][0], b.h, corners[2][1], corners[3][0], b.h, corners[3][1])
    uv.push(0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001)
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3)
    v += 4
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  const mat = new MeshBasicMaterial({ map: tex, color: new Color(brightness, brightness, brightness), side: DoubleSide })
  const mesh = new Mesh(geo, mat)
  mesh.renderOrder = 1
  return { mesh, roofs: boxes }
}

function glowPoints(
  pts: number[],
  cols: number[],
  tex: Texture,
  size: number,
  opacity: number,
): { points: Points; mat: PointsMaterial; geo: BufferGeometry } {
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(pts, 3))
  geo.setAttribute('color', new Float32BufferAttribute(cols, 3))
  const mat = new PointsMaterial({
    size,
    map: tex,
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    opacity,
  })
  const points = new Points(geo, mat)
  points.renderOrder = 3
  return { points, mat, geo }
}

/** Flat dark ground (land, banks, city plaza), faintly lit by bursts. */
function groundMesh(
  shape: { x0: number; x1: number; z0: number; z1: number }[],
  base: Color,
): { mesh: Mesh; mat: MeshBasicMaterial } {
  const pos: number[] = []
  const idx: number[] = []
  let v = 0
  for (const r of shape) {
    pos.push(r.x0, 0.05, r.z0, r.x1, 0.05, r.z0, r.x1, 0.05, r.z1, r.x0, 0.05, r.z1)
    idx.push(v, v + 2, v + 1, v, v + 3, v + 2)
    v += 4
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  const mat = new MeshBasicMaterial({ color: base.clone(), side: DoubleSide })
  const mesh = new Mesh(geo, mat)
  mesh.renderOrder = 1
  return { mesh, mat }
}

function blinkers(
  roofs: Box[],
  chance: number,
  rng: Rng,
  tex: Texture,
): { points: Points; mat: PointsMaterial; geo: BufferGeometry } {
  const pts: number[] = []
  const cols: number[] = []
  for (const b of roofs) {
    if (b.h > 60 && rng.next() < chance) {
      pts.push(b.x, b.h + 1.5, b.z)
      cols.push(1, 0.08, 0.04)
    }
  }
  return glowPoints(pts, cols, tex, 6, 0.9)
}

// ------------------------------------------------------------ scenes

export function createRiver(glowTex: Texture): Scenery {
  const group = new Group()
  const disp: Disposable[] = []
  const rng = new Rng(2024)
  const tex = makeWindowTexture(11, 0.38)
  disp.push(tex)

  // far bank: dense mixed skyline facing the river; near bank behind the audience
  const boxes: Box[] = []
  for (let i = 0; i < 150; i++) {
    const tower = rng.next() < 0.18
    boxes.push({
      x: rng.range(-1600, 1600),
      z: rng.range(-560, -1000),
      w: tower ? rng.range(25, 40) : rng.range(35, 70),
      d: tower ? rng.range(25, 40) : rng.range(12, 16),
      h: tower ? rng.range(90, 170) : rng.range(35, 85),
      rot: tower ? rng.range(0, 1) : rng.range(-0.08, 0.08),
    })
  }
  for (let i = 0; i < 70; i++) {
    boxes.push({
      x: rng.range(-1400, 1400),
      z: rng.range(520, 900),
      w: rng.range(35, 70),
      d: rng.range(12, 16),
      h: rng.range(35, 80),
      rot: rng.range(-0.08, 0.08),
    })
  }
  const { mesh, roofs } = buildingMesh(boxes, tex, rng, 0.8)
  disp.push(mesh.geometry, mesh.material as MeshBasicMaterial)
  group.add(mesh)

  const ground = groundMesh(
    [
      { x0: -4000, x1: 4000, z0: -480, z1: -4000 },
      { x0: -4000, x1: 4000, z0: 470, z1: 4000 },
    ],
    new Color(0.006, 0.007, 0.009),
  )
  disp.push(ground.mesh.geometry, ground.mat)
  group.add(ground.mesh)

  // riverside road lights along both banks + bridge
  const pts: number[] = []
  const cols: number[] = []
  for (let x = -2000; x <= 2000; x += 26) {
    pts.push(x, 4, -488, x + 13, 4, 478)
    cols.push(1, 0.62, 0.28, 1, 0.62, 0.28)
  }
  const bridgeX = -460
  for (let z = -480; z <= 470; z += 14) {
    pts.push(bridgeX - 9, 13, z, bridgeX + 9, 13, z)
    cols.push(0.9, 0.85, 0.75, 0.9, 0.85, 0.75)
  }
  // car lights crossing the bridge
  for (let i = 0; i < 40; i++) {
    pts.push(bridgeX + rng.range(-5, 5), 10.5, rng.range(-470, 460))
    if (rng.next() < 0.5) cols.push(1, 0.95, 0.8)
    else cols.push(1, 0.1, 0.05)
  }
  const lamps = glowPoints(pts, cols, glowTex, 5, 0.75)
  disp.push(lamps.geo, lamps.mat)
  group.add(lamps.points)

  // bridge deck and piers (silhouette)
  const deck = groundMesh([{ x0: bridgeX - 10, x1: bridgeX + 10, z0: -480, z1: 470 }], new Color(0.01, 0.011, 0.014))
  deck.mesh.position.y = 9
  disp.push(deck.mesh.geometry, deck.mat)
  group.add(deck.mesh)
  const piers: Box[] = []
  for (let z = -420; z <= 420; z += 70) piers.push({ x: bridgeX, z, w: 6, d: 6, h: 9, rot: 0 })
  const pierMesh = buildingMesh(piers, tex, rng, 0.02)
  disp.push(pierMesh.mesh.geometry, pierMesh.mesh.material as MeshBasicMaterial)
  group.add(pierMesh.mesh)

  const blink = blinkers(roofs, 0.7, rng, glowTex)
  disp.push(blink.geo, blink.mat)
  group.add(blink.points)

  const groundBase = new Color(0.006, 0.007, 0.009)
  return {
    group,
    water: { visible: true, amp: 0.75, speed: 1, flow: [9, 0] },
    reflections: true,
    update(t, light) {
      blink.mat.opacity = Math.sin(t * 2.4) > 0.2 ? 0.95 : 0.08
      ground.mat.color.setRGB(groundBase.r + light.r * 0.15, groundBase.g + light.g * 0.15, groundBase.b + light.b * 0.15)
    },
    dispose() {
      for (const d of disp) d.dispose()
    },
  }
}

export function createCity(glowTex: Texture): Scenery {
  const group = new Group()
  const disp: Disposable[] = []
  const rng = new Rng(5150)
  const tex = makeWindowTexture(23, 0.42)
  disp.push(tex)

  // apartment complexes all around the park: rows of slab towers
  const boxes: Box[] = []
  const complexes = 26
  for (let c = 0; c < complexes; c++) {
    const ang = (c / complexes) * Math.PI * 2 + rng.range(-0.08, 0.08)
    const r = rng.range(360, 760)
    const cx = Math.cos(ang) * r
    const cz = Math.sin(ang) * r
    const face = ang + Math.PI / 2 + rng.range(-0.25, 0.25)
    const rows = rng.int(2, 3)
    const perRow = rng.int(2, 4)
    const h = rng.range(45, 95)
    for (let a = 0; a < rows; a++) {
      for (let b = 0; b < perRow; b++) {
        const lx = (b - (perRow - 1) / 2) * 62
        const lz = (a - (rows - 1) / 2) * 48
        boxes.push({
          x: cx + lx * Math.cos(face) - lz * Math.sin(face),
          z: cz + lx * Math.sin(face) + lz * Math.cos(face),
          w: rng.range(42, 56),
          d: rng.range(12, 15),
          h: h + rng.range(-8, 8),
          rot: face,
        })
      }
    }
  }
  // far skyline ring
  for (let i = 0; i < 180; i++) {
    const ang = rng.range(0, Math.PI * 2)
    const r = rng.range(1050, 1500)
    boxes.push({
      x: Math.cos(ang) * r,
      z: Math.sin(ang) * r,
      w: rng.range(30, 60),
      d: rng.range(12, 30),
      h: rng.range(30, 130),
      rot: ang + Math.PI / 2,
    })
  }
  const { mesh, roofs } = buildingMesh(boxes, tex, rng, 0.75)
  disp.push(mesh.geometry, mesh.material as MeshBasicMaterial)
  group.add(mesh)

  const groundBase = new Color(0.008, 0.009, 0.011)
  const ground = groundMesh([{ x0: -5000, x1: 5000, z0: -5000, z1: 5000 }], groundBase)
  disp.push(ground.mesh.geometry, ground.mat)
  group.add(ground.mesh)

  // street lamps on ring roads, and a lit park boundary
  const pts: number[] = []
  const cols: number[] = []
  for (const r of [300, 560, 980]) {
    const n = Math.round((Math.PI * 2 * r) / 30)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      pts.push(Math.cos(a) * r, 7, Math.sin(a) * r)
      cols.push(1, 0.6, 0.25)
    }
  }
  // traffic: white heads / red tails scattered on the ring roads
  for (let i = 0; i < 220; i++) {
    const r = rng.pick([305, 565, 985])
    const a = rng.range(0, Math.PI * 2)
    pts.push(Math.cos(a) * r, 1.2, Math.sin(a) * r)
    if (rng.next() < 0.5) cols.push(1, 0.95, 0.85)
    else cols.push(1, 0.08, 0.04)
  }
  const lamps = glowPoints(pts, cols, glowTex, 5, 0.7)
  disp.push(lamps.geo, lamps.mat)
  group.add(lamps.points)

  const blink = blinkers(roofs, 0.5, rng, glowTex)
  disp.push(blink.geo, blink.mat)
  group.add(blink.points)

  return {
    group,
    water: { visible: false, amp: 0, speed: 0, flow: [0, 0] },
    reflections: false,
    update(t, light) {
      blink.mat.opacity = Math.sin(t * 2.4) > 0.2 ? 0.95 : 0.08
      ground.mat.color.setRGB(groundBase.r + light.r * 0.25, groundBase.g + light.g * 0.25, groundBase.b + light.b * 0.25)
    },
    dispose() {
      for (const d of disp) d.dispose()
    },
  }
}

export function createLake(glowTex: Texture): Scenery {
  const group = new Group()
  const disp: Disposable[] = []
  const rng = new Rng(808)

  // ring of mountains: inner shore at y=0 rising to a noisy ridge
  const pos: number[] = []
  const idx: number[] = []
  const seg = 240
  const ridge = (a: number) =>
    70 +
    55 * Math.sin(a * 3 + 1) +
    30 * Math.sin(a * 7 + 2.3) +
    14 * Math.sin(a * 17 + 0.7) +
    6 * Math.sin(a * 41)
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2
    const c = Math.cos(a)
    const s = Math.sin(a)
    const h = Math.max(25, ridge(a))
    pos.push(c * 1000, 0, s * 1000, c * 1250, h * 0.75, s * 1250, c * 1450, h, s * 1450)
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 3
    const b = (i + 1) * 3
    idx.push(a, b, a + 1, b, b + 1, a + 1, a + 1, b + 1, a + 2, b + 1, b + 2, a + 2)
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
  geo.setIndex(idx)
  const mountBase = new Color(0.004, 0.005, 0.008)
  const mat = new MeshBasicMaterial({ color: mountBase.clone(), side: DoubleSide })
  const mountains = new Mesh(geo, mat)
  mountains.renderOrder = 1
  disp.push(geo, mat)
  group.add(mountains)

  // a few lakeside cabins and a lit pier
  const pts: number[] = []
  const cols: number[] = []
  for (let i = 0; i < 40; i++) {
    const a = rng.range(0, Math.PI * 2)
    const r = rng.range(1005, 1060)
    pts.push(Math.cos(a) * r, rng.range(2, 8), Math.sin(a) * r)
    cols.push(1, rng.range(0.55, 0.75), rng.range(0.25, 0.4))
  }
  const lamps = glowPoints(pts, cols, glowTex, 5, 0.6)
  disp.push(lamps.geo, lamps.mat)
  group.add(lamps.points)

  return {
    group,
    water: { visible: true, amp: 0.3, speed: 0.6, flow: [0, 0] },
    reflections: true,
    update(_t, light) {
      mat.color.setRGB(mountBase.r + light.r * 0.06, mountBase.g + light.g * 0.06, mountBase.b + light.b * 0.06)
    },
    dispose() {
      for (const d of disp) d.dispose()
    },
  }
}

export function createSea(glowTex: Texture): Scenery {
  const group = new Group()
  const disp: Disposable[] = []
  const rng = new Rng(4321)

  // distant ships (clusters of deck lights) and a lighthouse on a headland
  const pts: number[] = []
  const cols: number[] = []
  for (let s = 0; s < 7; s++) {
    const x = rng.range(-1800, 1800)
    const z = rng.range(-900, -2200)
    const n = rng.int(3, 8)
    for (let i = 0; i < n; i++) {
      pts.push(x + i * rng.range(2, 4), rng.range(2, 7), z)
      cols.push(1, rng.range(0.7, 0.9), rng.range(0.4, 0.6))
    }
    pts.push(x, 12, z)
    cols.push(1, 0.1, 0.05)
  }
  const ships = glowPoints(pts, cols, glowTex, 4, 0.7)
  disp.push(ships.geo, ships.mat)
  group.add(ships.points)

  const lighthouse = glowPoints([1300, 45, -1400], [1, 0.95, 0.8], glowTex, 22, 1)
  disp.push(lighthouse.geo, lighthouse.mat)
  group.add(lighthouse.points)
  const head = groundMesh([{ x0: 1150, x1: 2600, z0: -1300, z1: -1700 }], new Color(0.004, 0.005, 0.007))
  head.mesh.scale.y = 1
  disp.push(head.mesh.geometry, head.mat)
  group.add(head.mesh)

  return {
    group,
    water: { visible: true, amp: 1.5, speed: 0.85, flow: [0, 2] },
    reflections: true,
    update(t) {
      // rotating beam: bright pulse every ~6 s
      const ph = (t / 6) % 1
      lighthouse.mat.opacity = 0.15 + 0.85 * Math.exp(-((ph - 0.5) ** 2) / 0.004)
    },
    dispose() {
      for (const d of disp) d.dispose()
    },
  }
}

export function createScenery(id: SceneId, glowTex: Texture): Scenery {
  switch (id) {
    case 'city':
      return createCity(glowTex)
    case 'lake':
      return createLake(glowTex)
    case 'sea':
      return createSea(glowTex)
    default:
      return createRiver(glowTex)
  }
}
