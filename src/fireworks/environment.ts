import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Texture,
} from 'three'
import { Rng } from './rng'

export interface Environment {
  group: Group
  update(t: number): void
  dispose(): void
}

function makeWaterTexture(): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')

  ctx.fillStyle = '#020409'
  ctx.fillRect(0, 0, 256, 512)

  const rng = new Rng(1337)
  for (let i = 0; i < 220; i++) {
    const y = rng.range(0, 512)
    const x = rng.range(0, 256)
    const w = rng.range(18, 120)
    const h = rng.range(1, 3)
    const a = rng.range(0.02, 0.16) * (1 - y / 512) ** 0.6
    ctx.fillStyle = `rgba(120,160,200,${a.toFixed(3)})`
    ctx.fillRect(x, y, w, h)
  }

  const tex = new CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

export function createEnvironment(glowTexture: Texture): Environment {
  const group = new Group()
  const disposables: { dispose(): void }[] = [glowTexture]

  const skyGeo = new BufferGeometry()
  const positions: number[] = []
  const colors: number[] = []
  const rng = new Rng(90210)
  for (let i = 0; i < 2600; i++) {
    const theta = rng.range(0, Math.PI * 2)
    const phi = Math.acos(rng.range(0.02, 1))
    const r = rng.range(520, 700)
    positions.push(
      Math.sin(phi) * Math.cos(theta) * r,
      Math.cos(phi) * r + 60,
      Math.sin(phi) * Math.sin(theta) * r,
    )
    const w = rng.range(0.45, 1)
    colors.push(w * 0.72, w * 0.78, w * 0.92)
  }
  skyGeo.setAttribute('position', new Float32BufferAttribute(positions, 3))
  skyGeo.setAttribute('color', new Float32BufferAttribute(colors, 3))
  const skyMat = new PointsMaterial({
    size: 2.2,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  })
  disposables.push(skyGeo, skyMat)
  const stars = new Points(skyGeo, skyMat)
  stars.frustumCulled = false
  group.add(stars)

  const waterGeo = new PlaneGeometry(1400, 700, 1, 1)
  const waterTex = makeWaterTexture()
  const waterMat = new MeshBasicMaterial({
    color: '#050a14',
    map: waterTex,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  })
  disposables.push(waterGeo, waterMat, waterTex)
  const water = new Mesh(waterGeo, waterMat)
  water.rotation.x = -Math.PI / 2
  water.position.set(0, -0.4, 0)
  group.add(water)

  const horizonGeo = new BufferGeometry()
  const horizonPos: number[] = []
  const horizonCol: number[] = []
  const hr = new Rng(4242)
  for (let i = 0; i < 160; i++) {
    const x = hr.range(-260, 260)
    const h = hr.range(2, 14)
    const z = hr.range(-140, -30)
    horizonPos.push(x, 0, z, x, h, z)
    const warm = hr.range(0.25, 0.7)
    horizonCol.push(warm * 0.9, warm * 0.55, warm * 0.3, 0, 0, 0)
  }
  horizonGeo.setAttribute('position', new Float32BufferAttribute(horizonPos, 3))
  horizonGeo.setAttribute('color', new Float32BufferAttribute(horizonCol, 3))
  const horizonMat = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.5,
    blending: AdditiveBlending,
    depthWrite: false,
  })
  disposables.push(horizonGeo, horizonMat)
  const horizon = new LineSegments(horizonGeo, horizonMat)
  group.add(horizon)

  const glowGeo = new BufferGeometry()
  const glowPos: number[] = []
  const glowCol: number[] = []
  const gr = new Rng(777)
  for (let i = 0; i < 34; i++) {
    const x = gr.range(-170, 170)
    const z = gr.range(-120, -20)
    glowPos.push(x, gr.range(1, 3), z)
    const w = gr.range(0.3, 1)
    glowCol.push(w, w * 0.55, w * 0.25)
  }
  glowGeo.setAttribute('position', new Float32BufferAttribute(glowPos, 3))
  glowGeo.setAttribute('color', new Float32BufferAttribute(glowCol, 3))
  const glowMat = new PointsMaterial({
    size: 9,
    map: glowTexture,
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    opacity: 0.55,
  })
  disposables.push(glowGeo, glowMat)
  const cityLights = new Points(glowGeo, glowMat)
  group.add(cityLights)

  return {
    group,
    update(t: number) {
      waterTex.offset.y = (t * 0.012) % 1
      waterTex.offset.x = Math.sin(t * 0.08) * 0.02
      glowMat.opacity = 0.42 + Math.sin(t * 1.7) * 0.08
      stars.rotation.y = t * 0.0025
    },
    dispose() {
      for (const d of disposables) d.dispose()
    },
  }
}
