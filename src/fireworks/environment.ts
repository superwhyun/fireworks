import {
  BackSide,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  Vector2,
  Vector3,
  Vector4,
} from 'three'
import { Rng } from './rng'
import { createScenery, type SceneId, type Scenery } from './scenery'

export const WATER_LIGHTS = 8

/** direction to the moon (low, slightly left, behind the show) */
const MOON_DIR = new Vector3(-0.42, 0.2, -1).normalize()

export interface Environment {
  group: Group
  /** fill these with burst lights each frame: pos [x,y,z,i]*N, col [r,g,b]*N */
  lightPos: Float32Array
  lightCol: Float32Array
  update(t: number, camera: Vector3, light: Color): void
  setScene(id: SceneId): void
  readonly reflections: boolean
  dispose(): void
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
uniform vec3 uGlow;
uniform vec3 uMoon;
varying vec3 vDir;
void main() {
  float h = clamp(vDir.y, -0.2, 1.0);
  vec3 zenith = vec3(0.004, 0.006, 0.018);
  vec3 horizon = vec3(0.022, 0.026, 0.045);
  vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.45));
  // light pollution: warm glow hugging the horizon, fading upward
  col += uGlow * (exp(-max(h, 0.0) * 14.0) + 0.25 * exp(-max(h, 0.0) * 3.5));
  // light from bursts, strongest overhead / at mid-height
  col += uLight * (0.3 + 0.7 * smoothstep(-0.05, 0.5, h)) * 0.2;
  // moon disc + soft halo
  float m = dot(normalize(vDir), uMoon);
  col += vec3(0.95, 0.93, 0.85) * smoothstep(0.99985, 0.99992, m) * 1.4;
  col += vec3(0.5, 0.55, 0.7) * pow(max(m, 0.0), 900.0) * 0.12;
  col += vec3(0.4, 0.45, 0.6) * pow(max(m, 0.0), 40.0) * 0.012;
  gl_FragColor = vec4(col, 1.0);
}
`

const waterVertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const waterFragment = /* glsl */ `
#define NL __NL__
uniform float uTime;
uniform vec3 uCam;
uniform vec3 uLight;
uniform vec3 uMoon;
uniform float uAmp;
uniform float uSpeed;
uniform vec2 uFlow;
uniform vec4 uLP[NL];
uniform vec3 uLC[NL];
varying vec3 vWorld;

// slope of one directional wave: amp * k * cos(k (d·p) - w t)
vec2 wave(vec2 p, vec2 d, float k, float speed, float amp, float t) {
  float ph = k * dot(d, p) - speed * t;
  return d * (amp * k * cos(ph));
}

vec3 waterNormal(vec2 p0, float t0, float detail) {
  vec2 g = vec2(0.0);
  float t = t0 * uSpeed;
  vec2 p = p0 - uFlow * t0;
  // long swell
  g += wave(p, normalize(vec2(0.3, 1.0)), 0.035, 1.1, 1.0, t);
  g += wave(p, normalize(vec2(-0.6, 1.0)), 0.05, 1.4, 0.6, t);
  // chop
  g += wave(p, normalize(vec2(1.0, 0.4)), 0.13, 2.6, 0.28, t);
  g += wave(p, normalize(vec2(-1.0, 0.7)), 0.19, 3.1, 0.2, t);
  // ripples (faded with distance to avoid shimmer aliasing)
  g += detail * wave(p, normalize(vec2(0.2, -1.0)), 0.42, 4.6, 0.09, t);
  g += detail * wave(p, normalize(vec2(0.9, 0.9)), 0.61, 5.3, 0.07, t);
  g += detail * wave(p, normalize(vec2(-0.8, -0.3)), 0.93, 6.7, 0.045, t);
  g += detail * wave(p + 13.0, normalize(vec2(0.5, -0.8)), 1.37, 8.1, 0.03, t);
  g *= uAmp;
  return normalize(vec3(-g.x, 1.0, -g.y));
}

void main() {
  vec3 toCam = uCam - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float detail = 1.0 - smoothstep(150.0, 900.0, dist);
  vec3 N = waterNormal(vWorld.xz, uTime, detail);
  // far water flattens visually
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), smoothstep(400.0, 2500.0, dist) * 0.6));
  vec3 R = reflect(-V, N);
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

  // reflected sky
  float e = max(R.y, 0.0);
  vec3 sky = mix(vec3(0.022, 0.026, 0.045), vec3(0.004, 0.006, 0.018), pow(e, 0.45));
  sky += uLight * 0.25;
  // body colour of the water (very dark teal), lit a little by bursts
  vec3 body = vec3(0.002, 0.007, 0.011) + uLight * 0.05;
  vec3 col = mix(body, sky, fres);

  // moon glitter path
  float mr = max(dot(R, uMoon), 0.0);
  col += vec3(0.75, 0.78, 0.9) * (pow(mr, 900.0) * 1.2 + pow(mr, 120.0) * 0.06) * (0.4 + fres);

  // firework glitter paths: each burst is a point light reflected by the waves
  for (int i = 0; i < NL; i++) {
    float li = uLP[i].w;
    if (li <= 0.0) continue;
    vec3 L = uLP[i].xyz - vWorld;
    float ld = length(L);
    float s = max(dot(R, L / ld), 0.0);
    float glint = pow(s, 700.0) * 5.0 + pow(s, 90.0) * 0.5 + pow(s, 12.0) * 0.04;
    col += uLC[i] * li * glint * (0.35 + fres) * (180.0 / (60.0 + ld * 0.6));
  }

  // fade to the horizon haze
  float fog = 1.0 - exp(-dist * 0.00085);
  vec3 haze = vec3(0.022, 0.026, 0.045) + uLight * 0.08;
  col = mix(col, haze, fog * fog);
  gl_FragColor = vec4(col, 1.0);
}
`.replace('__NL__', String(WATER_LIGHTS))

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
    uniforms: { uLight: { value: new Color(0, 0, 0) }, uMoon: { value: MOON_DIR }, uGlow: { value: new Color(0.03, 0.016, 0.008) } },
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

  // ---- water (animated waves, fresnel, glitter paths)
  const lightPos = new Float32Array(WATER_LIGHTS * 4)
  const lightCol = new Float32Array(WATER_LIGHTS * 3)
  const lpVec = Array.from({ length: WATER_LIGHTS }, () => new Vector4())
  const lcVec = Array.from({ length: WATER_LIGHTS }, () => new Vector3())
  const waterGeo = new PlaneGeometry(8000, 8000, 1, 1)
  const waterMat = new ShaderMaterial({
    vertexShader: waterVertex,
    fragmentShader: waterFragment,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new Vector3() },
      uLight: { value: new Color(0, 0, 0) },
      uMoon: { value: MOON_DIR },
      uAmp: { value: 1 },
      uSpeed: { value: 1 },
      uFlow: { value: new Vector2() },
      uLP: { value: lpVec },
      uLC: { value: lcVec },
    },
  })
  disposables.push(waterGeo, waterMat)
  const water = new Mesh(waterGeo, waterMat)
  water.rotation.x = -Math.PI / 2
  water.position.set(0, -0.2, 0)
  water.renderOrder = 0
  water.frustumCulled = false
  group.add(water)

  // ---- scenery (lake / river / sea / city)
  let scenery: Scenery | null = null
  const setScene = (id: SceneId) => {
    if (scenery) {
      group.remove(scenery.group)
      scenery.dispose()
    }
    scenery = createScenery(id, glowTexture)
    group.add(scenery.group)
    water.visible = scenery.water.visible
    ;(domeMat.uniforms.uGlow.value as Color).setRGB(...scenery.horizonGlow)
    const u = waterMat.uniforms
    u.uAmp.value = scenery.water.amp
    u.uSpeed.value = scenery.water.speed
    ;(u.uFlow.value as Vector2).set(scenery.water.flow[0], scenery.water.flow[1])
  }
  setScene('river')

  return {
    group,
    lightPos,
    lightCol,
    setScene,
    get reflections() {
      return scenery?.reflections ?? true
    },
    update(t, camera, light) {
      sky.position.copy(camera)
      ;(domeMat.uniforms.uLight.value as Color).copy(light)
      // water follows the camera horizontally so it never runs out
      water.position.x = camera.x
      water.position.z = camera.z
      const u = waterMat.uniforms
      u.uTime.value = t
      ;(u.uCam.value as Vector3).copy(camera)
      ;(u.uLight.value as Color).copy(light)
      for (let i = 0; i < WATER_LIGHTS; i++) {
        lpVec[i].set(lightPos[i * 4], lightPos[i * 4 + 1], lightPos[i * 4 + 2], lightPos[i * 4 + 3])
        lcVec[i].set(lightCol[i * 3], lightCol[i * 3 + 1], lightCol[i * 3 + 2])
      }
      scenery?.update(t, light)
      stars.rotation.y = t * 0.002
    },
    dispose() {
      scenery?.dispose()
      for (const d of disposables) d.dispose()
    },
  }
}
