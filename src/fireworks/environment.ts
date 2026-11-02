import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  Vector3,
} from 'three'
import { Rng } from './rng'

export interface Environment {
  group: Group
  update(t: number, camera: Vector3, light: Color): void
  dispose(): void
}

function makeWaterTexture(): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, 256, 512)
  const rng = new Rng(1337)
  for (let i = 0; i < 260; i++) {
    const y = rng.range(0, 512)
    const x = rng.range(0, 256)
    const w = rng.range(18, 120)
    const h = rng.range(1, 3)
    const a = rng.range(0.03, 0.16)
    ctx.fillStyle = `rgba(110,150,200,${a.toFixed(3)})`
    ctx.fillRect(x, y, w, h)
  }
  const tex = new CanvasTexture(canvas)
  tex.wrapS = RepeatWrapping
  tex.wrapT = RepeatWrapping
  tex.repeat.set(6, 12)
  tex.needsUpdate = true
  return tex
}

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`
const skyFragment = /* glsl */ `
uniform vec3 uLight;
varying vec3 vDir;
void main() {
  float h = clamp(vDir.y, -0.2, 1.0);
  vec3 zenith = vec3(0.004, 0.006, 0.018);
  vec3 horizon = vec3(0.022, 0.026, 0.045);
  vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.45));
  // warm city haze near the horizon
  col += vec3(0.03, 0.016, 0.008) * exp(-abs(h) * 22.0);
  // light from bursts, strongest overhead / at mid-height
  col += uLight * (0.3 + 0.7 * smoothstep(-0.05, 0.5, h)) * 0.2;
  gl_FragColor = vec4(col, 1.0);
}
`

export function createEnvironment(glowTexture: Texture): Environment {
  const group = new Group()
  const disposables: { dispose(): void }[] = [glowTexture]

  // ---- sky (follows camera)
  const sky = new Group()
  group.add(sky)
  const domeGeo = new SphereGeometry(1500, 32, 16)
  const domeMat = new ShaderMaterial({
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: { uLight: { value: new Color(0, 0, 0) } },
  })
  disposables.push(domeGeo, domeMat)
  const dome = new Mesh(domeGeo, domeMat)
  dome.renderOrder = -10
  dome.frustumCulled = false
  sky.add(dome)

  const skyGeo = new BufferGeometry()
  const positions: number[] = []
  const colors: number[] = []
  const rng = new Rng(90210)
  for (let i = 0; i < 3200; i++) {
    const theta = rng.range(0, Math.PI * 2)
    const phi = Math.acos(rng.range(0.04, 1))
    const r = 1300
    positions.push(Math.sin(phi) * Math.cos(theta) * r, Math.cos(phi) * r, Math.sin(phi) * Math.sin(theta) * r)
    const w = rng.range(0.15, 0.75) ** 2
    const tint = rng.next()
    colors.push(w * (0.8 + tint * 0.2), w * 0.85, w * (1.0 - tint * 0.15))
  }
  skyGeo.setAttribute('position', new Float32BufferAttribute(positions, 3))
  skyGeo.setAttribute('color', new Float32BufferAttribute(colors, 3))
  const skyMat = new PointsMaterial({
    size: 1.6,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    fog: false,
  })
  disposables.push(skyGeo, skyMat)
  const stars = new Points(skyGeo, skyMat)
  stars.frustumCulled = false
  stars.renderOrder = -9
  sky.add(stars)

  // ---- water
  const waterGeo = new PlaneGeometry(6000, 6000, 1, 1)
  const waterTex = makeWaterTexture()
  const waterMat = new MeshBasicMaterial({
    color: '#0a1220',
    map: waterTex,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  })
  disposables.push(waterGeo, waterMat, waterTex)
  const water = new Mesh(waterGeo, waterMat)
  water.rotation.x = -Math.PI / 2
  water.position.set(0, -0.2, 0)
  water.renderOrder = 0
  group.add(water)

  // ---- far shore lights
  const glowGeo = new BufferGeometry()
  const glowPos: number[] = []
  const glowCol: number[] = []
  const gr = new Rng(777)
  for (let i = 0; i < 160; i++) {
    glowPos.push(gr.range(-900, 900), gr.range(0.5, 6), gr.range(-620, -480))
    const w = gr.range(0.25, 1)
    const cool = gr.next() < 0.25
    glowCol.push(cool ? w * 0.6 : w, cool ? w * 0.8 : w * 0.6, cool ? w : w * 0.3)
  }
  glowGeo.setAttribute('position', new Float32BufferAttribute(glowPos, 3))
  glowGeo.setAttribute('color', new Float32BufferAttribute(glowCol, 3))
  const glowMat = new PointsMaterial({
    size: 7,
    map: glowTexture,
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    opacity: 0.5,
  })
  disposables.push(glowGeo, glowMat)
  group.add(new Points(glowGeo, glowMat))

  const waterBase = new Color('#0a1220')

  return {
    group,
    update(t, camera, light) {
      sky.position.copy(camera)
      ;(domeMat.uniforms.uLight.value as Color).copy(light)
      waterTex.offset.y = (t * 0.01) % 1
      waterTex.offset.x = Math.sin(t * 0.07) * 0.02
      waterMat.color.setRGB(
        waterBase.r + light.r * 0.25,
        waterBase.g + light.g * 0.25,
        waterBase.b + light.b * 0.25,
      )
      glowMat.opacity = 0.42 + Math.sin(t * 1.7) * 0.06
      stars.rotation.y = t * 0.002
    },
    dispose() {
      for (const d of disposables) d.dispose()
    },
  }
}
