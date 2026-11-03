import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Texture,
} from 'three'
import { Rng } from './rng'
import {
  buildAviationLights,
  buildCrowd,
  buildRidge,
  buildTower,
  buildRoadsurface,
  buildSkyline,
  buildTraffic,
  type Building,
  type Road,
  type Skyline,
  type Traffic,
} from './urban'

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
  /** light-pollution glow on the horizon (linear rgb) */
  horizonGlow: [number, number, number]
  /** eye-level camera among the audience */
  audience: { pos: [number, number, number]; target: [number, number, number] }
  update(t: number, light: Color): void
  dispose(): void
}

type Disposable = { dispose(): void }

// ------------------------------------------------------------ helpers

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

// ------------------------------------------------------------ urban helpers

const APT_CROWNS = ['#d8dde6', '#9fb8dd', '#7f9fd0', '#b9a2d8', '#d9bf96', '#8fd9c4']
const APT_SIGNS = ['#ffffff', '#ffffff', '#ff4a4a', '#7fd0ff', '#ffd36a']
const OFFICE_CROWNS = ['#9cc8ff', '#ffffff', '#ffcf7a', '#7affd0', '#c9a8ff']
const STRIPS = ['#ff4fd8', '#3fe0ff', '#ffd04a', '#ffffff', '#7dff9a']

/** a Korean apartment complex: parallel slabs, same height, shared crown/sign */
function aptComplex(
  rng: Rng,
  cx: number,
  cz: number,
  face: number,
  rows: number,
  perRow: number,
  out: Building[],
): void {
  const h = FLOORS(rng.int(18, 35))
  const crown = rng.next() < 0.6 ? rng.pick(APT_CROWNS) : null
  const sign = rng.next() < 0.65 ? rng.pick(APT_SIGNS) : null
  const w = rng.range(44, 60)
  const gapX = w + rng.range(14, 22)
  const gapZ = rng.range(42, 55)
  const c = Math.cos(face)
  const s = Math.sin(face)
  for (let a = 0; a < rows; a++) {
    for (let b = 0; b < perRow; b++) {
      const lx = (b - (perRow - 1) / 2) * gapX + rng.range(-3, 3)
      const lz = (a - (rows - 1) / 2) * gapZ
      out.push({
        x: cx + lx * c - lz * s,
        z: cz + lx * s + lz * c,
        w: w + rng.range(-4, 4),
        d: rng.range(12, 15),
        h: h + FLOORS(rng.int(-2, 2)),
        rot: face,
        kind: 'apt',
        crown,
        sign,
      })
    }
  }
}

const FLOORS = (n: number) => n * 2.8

function officeTower(rng: Rng, x: number, z: number, rot: number, out: Building[], tall = 1): void {
  const h = rng.range(90, 200) * tall
  const w = rng.range(28, 46)
  out.push({
    x,
    z,
    w,
    d: w * rng.range(0.6, 1),
    h,
    rot,
    kind: 'office',
    crown: rng.next() < 0.45 ? rng.pick(OFFICE_CROWNS) : null,
    podium: rng.next() < 0.6 ? rng.range(12, 22) : 0,
  })
}

function hotel(rng: Rng, x: number, z: number, rot: number, out: Building[]): void {
  out.push({
    x,
    z,
    w: rng.range(26, 40),
    d: rng.range(16, 24),
    h: rng.range(40, 110),
    rot,
    kind: 'hotel',
    strips: rng.next() < 0.55 ? rng.pick(STRIPS) : null,
    crown: rng.next() < 0.25 ? rng.pick(OFFICE_CROWNS) : null,
  })
}

function shops(rng: Rng, x: number, z: number, rot: number, out: Building[]): void {
  out.push({ x, z, w: rng.range(25, 45), d: rng.range(15, 25), h: rng.range(8, 22), rot, kind: 'shop' })
}

/** horizontal road polyline from x0 to x1 at z (with a few gentle bends) */
function straight(x0: number, x1: number, z: number, wobble = 0, steps = 24): [number, number][] {
  const pts: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps
    pts.push([x, z + Math.sin(i * 0.7) * wobble])
  }
  return pts
}

function circle(r: number, n = 96): [number, number][] {
  const pts: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    pts.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  return pts
}

interface UrbanParts {
  skyline: Skyline
  traffic: Traffic
  roadsurf: ReturnType<typeof buildRoadsurface>
  aviation: ReturnType<typeof buildAviationLights>
  ridge: ReturnType<typeof buildRidge>
}

function assemble(
  group: Group,
  parts: UrbanParts,
  withMirror: boolean,
): (t: number, light: Color) => void {
  const { skyline, traffic, roadsurf, aviation, ridge } = parts
  group.add(ridge.mesh, skyline.group, roadsurf.group, traffic.group, aviation.points)
  if (withMirror) group.add(skyline.mirror, roadsurf.mirror, traffic.mirror)
  let last = -1
  return (t, light) => {
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, t - last))
    last = t
    traffic.update(dt)
    skyline.update(t, light)
    aviation.update(t)
    ridge.update(light)
  }
}

// ------------------------------------------------------------ river (Han-river style)

export function createRiver(glowTex: Texture): Scenery {
  const group = new Group()
  const disp: Disposable[] = []
  const rng = new Rng(2024)
  const B: Building[] = []

  // far bank, front row: apartment complexes facing the river
  for (let x = -2300; x < 2300; ) {
    const n = rng.int(3, 6)
    const span = n * 68
    if (Math.abs(x + span / 2 - 200) > 420 || rng.next() < 0.3) {
      aptComplex(rng, x + span / 2, -585 - rng.range(0, 25), rng.range(-0.05, 0.05), rng.int(1, 2), n, B)
    }
    x += span + rng.range(60, 140)
  }
  // business district behind the centre: towers on podiums, hotels
  for (let i = 0; i < 26; i++) {
    officeTower(rng, rng.range(-150, 650), rng.range(-700, -1050), rng.range(-0.15, 0.15), B, rng.next() < 0.3 ? 1.3 : 1)
  }
  for (let i = 0; i < 14; i++) hotel(rng, rng.range(-1500, 1700), rng.range(-700, -1150), rng.range(-0.2, 0.2), B)
  // more housing and offices further back, and low-rise streets
  for (let i = 0; i < 12; i++) {
    aptComplex(rng, rng.range(-2200, 2200), rng.range(-800, -1400), rng.range(-0.3, 0.3), rng.int(2, 3), rng.int(2, 4), B)
  }
  for (let i = 0; i < 30; i++) officeTower(rng, rng.range(-2400, 2400), rng.range(-1200, -1700), rng.range(-0.3, 0.3), B, 0.8)
  for (let i = 0; i < 60; i++) shops(rng, rng.range(-2300, 2300), rng.range(-660, -760), rng.range(-0.05, 0.05), B)
  // near bank behind the audience (beyond the riverside park and expressway)
  for (let x = -1800; x < 1800; ) {
    const n = rng.int(3, 5)
    aptComplex(rng, x + n * 34, 700 + rng.range(0, 30), Math.PI + rng.range(-0.05, 0.05), 1, n, B)
    x += n * 68 + rng.range(60, 160)
  }
  // remove anything that would sit on a road / bridge corridor
  const roadsX = [-1250, -520, 340, 760, 1500]
  const buildings = B.filter((b) => roadsX.every((rx) => Math.abs(b.x - rx) > b.w / 2 + 14) && Math.abs(b.z + 640) > b.d / 2 + 8)

  const skyline = buildSkyline(buildings, 77)

  // roads: riverside expressways (heavy traffic), bridges, city streets
  const roads: Road[] = [
    { path: straight(-3000, 3000, -505), lanesPerDir: 4, density: 7, speed: [16, 28] },
    { path: straight(-3000, 3000, 615), lanesPerDir: 4, density: 6, speed: [16, 28] },
    { path: straight(-2600, 2600, -640, 3), lanesPerDir: 2, density: 1.8, speed: [8, 15] },
    { path: [[-520, -505], [-520, 615]], y: 10.2, lanesPerDir: 2, density: 4, speed: [14, 22] },
    { path: [[760, -505], [760, 615]], y: 10.2, lanesPerDir: 3, density: 4, speed: [14, 22] },
  ]
  for (const rx of [-1250, 340, 1500]) roads.push({ path: [[rx, -505], [rx, -1600]], lanesPerDir: 2, density: 1.5, speed: [8, 15] })
  const traffic = buildTraffic(roads, glowTex, 31)
  const roadsurf = buildRoadsurface(roads, glowTex)

  // bridge decks, piers and the bridge's own lamp rows
  const deckQ = groundMesh(
    [
      { x0: -532, x1: -508, z0: -505, z1: 615 },
      { x0: 744, x1: 776, z0: -505, z1: 615 },
    ],
    new Color(0.012, 0.012, 0.015),
  )
  deckQ.mesh.position.y = 9.3
  disp.push(deckQ.mesh.geometry, deckQ.mat)
  group.add(deckQ.mesh)
  // arches on the right bridge: lit truss outline
  const arch: number[] = []
  const archCol: number[] = []
  for (let k = 0; k < 4; k++) {
    const z0 = -480 + k * 240
    for (let i = 0; i <= 24; i++) {
      const f = i / 24
      const yy = 10 + Math.sin(f * Math.PI) * 30
      arch.push(760 - 16, yy, z0 + f * 240, 760 + 16, yy, z0 + f * 240)
      archCol.push(0.55, 0.8, 1, 0.55, 0.8, 1)
    }
  }
  const archPts = glowPoints(arch, archCol, glowTex, 3.5, 0.75)
  disp.push(archPts.geo, archPts.mat)
  group.add(archPts.points)
  const archMirror = new Points(archPts.geo, archPts.mat.clone())
  ;(archMirror.material as PointsMaterial).opacity = 0.25
  archMirror.scale.y = -1
  archMirror.renderOrder = 2
  disp.push(archMirror.material as PointsMaterial)
  group.add(archMirror)

  // banks (land) and a dark riverside park strip
  const groundBase = new Color(0.006, 0.007, 0.009)
  const ground = groundMesh(
    [
      { x0: -5000, x1: 5000, z0: -480, z1: -5000 },
      { x0: -5000, x1: 5000, z0: 470, z1: 5000 },
    ],
    groundBase,
  )
  disp.push(ground.mesh.geometry, ground.mat)
  group.add(ground.mesh)

  const aviation = buildAviationLights(skyline.roofs, 95, glowTex)
  const ridge = buildRidge([0, 0], 2300, [Math.PI * 1.05, Math.PI * 1.95], 260, 5)
  const parts = { skyline, traffic, roadsurf, aviation, ridge }
  const tick = assemble(group, parts, true)
  disp.push(skyline, traffic, roadsurf, aviation, ridge)

  // launch barges moored under the show, with dim work lights
  const barges = groundMesh(
    [-150, -60, 30, 120].map((bx, i) => ({ x0: bx - 34, x1: bx + 34, z0: -95 + (i % 2) * 30, z1: -55 + (i % 2) * 30 })),
    new Color(0.012, 0.012, 0.014),
  )
  barges.mesh.position.y = 1.2
  disp.push(barges.mesh.geometry, barges.mat)
  group.add(barges.mesh)
  const work: number[] = []
  const workCol: number[] = []
  for (const bx of [-150, -60, 30, 120]) {
    for (const dx of [-28, 28]) {
      work.push(bx + dx, 4, -75)
      workCol.push(1, 0.7, 0.4)
    }
  }
  const workPts = glowPoints(work, workCol, glowTex, 4, 0.45)
  disp.push(workPts.geo, workPts.mat)
  group.add(workPts.points)

  // riverside park on the near bank: the audience, trees
  const crowd = buildCrowd(
    [
      // people pack toward the water's edge
      { x0: -600, x1: 600, z0: 476, z1: 492 },
      { x0: -600, x1: 600, z0: 476, z1: 492 },
      { x0: -600, x1: 600, z0: 476, z1: 505 },
      { x0: -600, x1: 600, z0: 478, z1: 585 },
    ],
    3400,
    120,
    glowTex,
    41,
    { x: 40, z: 520, r: 7 },
  )
  group.add(crowd.group)
  disp.push(crowd)
  const tower = buildTower(-1150, -2050, glowTex)
  group.add(tower.group)
  disp.push(tower)

  return {
    group,
    water: { visible: true, amp: 0.75, speed: 1, flow: [9, 0] },
    reflections: true,
    horizonGlow: [0.055, 0.032, 0.018],
    audience: { pos: [40, 2.4, 520], target: [0, 80, -60] },
    update(t, light) {
      tick(t, light)
      crowd.update(t, light)
      tower.update(t, light)
      ground.mat.color.setRGB(groundBase.r + light.r * 0.15, groundBase.g + light.g * 0.15, groundBase.b + light.b * 0.15)
    },
    dispose() {
      for (const d of disp) d.dispose()
    },
  }
}

// ------------------------------------------------------------ city

export function createCity(glowTex: Texture): Scenery {
  const group = new Group()
  const disp: Disposable[] = []
  const rng = new Rng(5150)
  const B: Building[] = []
  const radials = 8
  const radialAngle = (i: number) => (i / radials) * Math.PI * 2 + Math.PI / 8

  for (let sct = 0; sct < radials; sct++) {
    const mid = radialAngle(sct) + Math.PI / radials
    const cbd = Math.abs(Math.sin(mid) + 1) < 0.25 // the sector straight behind the show (−z)
    for (const [r, off] of [
      [520, 0],
      [1000, -0.13],
      [1000, 0.13],
      [1500, -0.12],
      [1500, 0.12],
      [1950, -0.15],
      [1950, 0],
      [1950, 0.15],
    ] as [number, number][]) {
      const cx = Math.cos(mid + off) * r
      const cz = Math.sin(mid + off) * r
      const face = Math.atan2(-cz, -cx) - Math.PI / 2 // fronts face the park
      if (cbd && r > 600) {
        // business district: tall towers
        for (let i = 0; i < 9; i++) {
          officeTower(rng, cx + rng.range(-150, 150), cz + rng.range(-110, 110), face + rng.range(-0.2, 0.2), B, r > 1200 ? 1.15 : 1.35)
        }
        for (let i = 0; i < 3; i++) hotel(rng, cx + rng.range(-170, 170), cz + rng.range(-120, 120), face, B)
      } else {
        aptComplex(rng, cx, cz, face + rng.range(-0.15, 0.15), r > 1200 ? 2 : rng.int(2, 3), r > 900 ? rng.int(2, 3) : rng.int(2, 4), B)
      }
      // a strip of shops between complexes and the ring road
      if (r < 1200 && off <= 0) {
        for (let i = 0; i < 5; i++) {
          const a = mid + (i - 2) * 0.07
          shops(rng, Math.cos(a) * (r - 120), Math.sin(a) * (r - 120), Math.atan2(-Math.sin(a), -Math.cos(a)) - Math.PI / 2, B)
        }
      }
    }
  }
  // keep radial avenues clear
  const buildings = B.filter((b) => {
    const ang = Math.atan2(b.z, b.x)
    const r = Math.hypot(b.x, b.z)
    for (let i = 0; i < radials; i++) {
      const d = Math.abs(Math.sin(ang - radialAngle(i))) * r
      if (d < b.w / 2 + 16 && Math.cos(ang - radialAngle(i)) > 0) return false
    }
    return [330, 760, 1250].every((rr) => Math.abs(r - rr) > Math.max(b.w, b.d) / 2 + 14)
  })
  const skyline = buildSkyline(buildings, 91)

  const roads: Road[] = [
    { path: circle(330), closed: true, lanesPerDir: 4, density: 4, speed: [10, 18] },
    { path: circle(760, 128), closed: true, lanesPerDir: 3, density: 3, speed: [12, 20] },
    { path: circle(1250, 160), closed: true, lanesPerDir: 3, density: 2, speed: [14, 22] },
  ]
  roads.push({ path: straight(-3200, 3200, 150), y: 13.4, lanesPerDir: 4, density: 9, speed: [18, 30] })
  for (let i = 0; i < radials; i++) {
    const a = radialAngle(i)
    roads.push({
      path: [
        [Math.cos(a) * 330, Math.sin(a) * 330],
        [Math.cos(a) * 1900, Math.sin(a) * 1900],
      ],
      lanesPerDir: 3,
      density: 3,
      speed: [10, 20],
    })
  }
  const traffic = buildTraffic(roads, glowTex, 17)
  const roadsurf = buildRoadsurface(roads, glowTex, { lampSpacing: 28, lampColor: [1, 0.75, 0.45] })

  const groundBase = new Color(0.006, 0.007, 0.008)
  const ground = groundMesh([{ x0: -5000, x1: 5000, z0: -5000, z1: 5000 }], groundBase)
  // elevated expressway between the audience and the launch site
  const deck = groundMesh([{ x0: -3200, x1: 3200, z0: 133, z1: 167 }], new Color(0.014, 0.014, 0.017))
  deck.mesh.position.y = 12.2
  disp.push(deck.mesh.geometry, deck.mat)
  group.add(deck.mesh)
  const piers: number[] = []
  for (let x = -3000; x <= 3000; x += 60) piers.push(x - 1.5, 0, 150, x + 1.5, 0, 150, x + 1.5, 12.2, 150, x - 1.5, 12.2, 150)
  const pierGeo = new BufferGeometry()
  pierGeo.setAttribute('position', new Float32BufferAttribute(piers, 3))
  const pierIdx: number[] = []
  for (let i = 0; i < piers.length / 12; i++) pierIdx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3)
  pierGeo.setIndex(pierIdx)
  const pierMat = new MeshBasicMaterial({ color: new Color(0.01, 0.01, 0.012), side: DoubleSide })
  const pierMesh = new Mesh(pierGeo, pierMat)
  pierMesh.renderOrder = 1
  disp.push(pierGeo, pierMat)
  group.add(pierMesh)
  disp.push(ground.mesh.geometry, ground.mat)
  group.add(ground.mesh)

  const aviation = buildAviationLights(skyline.roofs, 95, glowTex)
  const ridge = buildRidge([0, 0], 2700, [0, Math.PI * 2], 330, 9)
  const tick = assemble(group, { skyline, traffic, roadsurf, aviation, ridge }, false)
  disp.push(skyline, traffic, roadsurf, aviation, ridge)

  // park between the expressway and the audience: people and trees
  const crowd = buildCrowd(
    [
      { x0: -420, x1: 420, z0: 178, z1: 300 },
      { x0: -300, x1: -195, z0: -120, z1: 120 },
      { x0: 195, x1: 300, z0: -120, z1: 120 },
    ],
    3000,
    160,
    glowTex,
    43,
    { x: 20, z: 305, r: 7 },
  )
  group.add(crowd.group)
  disp.push(crowd)
  const tower = buildTower(-950, -2150, glowTex)
  group.add(tower.group)
  disp.push(tower)

  return {
    group,
    water: { visible: false, amp: 0, speed: 0, flow: [0, 0] },
    reflections: false,
    horizonGlow: [0.075, 0.042, 0.022],
    audience: { pos: [20, 2.4, 305], target: [0, 80, -60] },
    update(t, light) {
      tick(t, light)
      crowd.update(t, light)
      tower.update(t, light)
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
    horizonGlow: [0.012, 0.01, 0.01],
    audience: { pos: [0, 2.4, 330], target: [0, 80, -60] },
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
    horizonGlow: [0.008, 0.009, 0.013],
    audience: { pos: [0, 2.4, 330], target: [0, 80, -60] },
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
