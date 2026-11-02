import { Color, FogExp2, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { Vector2 } from 'three'

export interface Stage {
  renderer: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera
  composer: EffectComposer
  bloom: UnrealBloomPass
  resize(width: number, height: number, pixelRatio: number): void
  dispose(): void
}

const FOV = 58

export function createStage(canvas: HTMLCanvasElement, width: number, height: number): Stage {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  })
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(width, height, false)
  renderer.setClearColor(new Color('#04050a'), 1)
  renderer.toneMappingExposure = 1.0

  const scene = new Scene()
  scene.fog = new FogExp2(new Color('#04050a').getHex(), 0.0026)

  const camera = new PerspectiveCamera(FOV, width / height, 0.5, 900)
  camera.position.set(0, 30, 150)
  camera.lookAt(0, 74, 0)

  const composer = new EffectComposer(renderer)
  composer.setPixelRatio(pixelRatio)
  composer.setSize(width, height)

  const renderPass = new RenderPass(scene, camera)
  composer.addPass(renderPass)

  const bloom = new UnrealBloomPass(new Vector2(width, height), 1.15, 0.75, 0.18)
  composer.addPass(bloom)

  composer.addPass(new OutputPass())

  return {
    renderer,
    scene,
    camera,
    composer,
    bloom,
    resize(w, h, pr) {
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setPixelRatio(pr)
      renderer.setSize(w, h, false)
      composer.setPixelRatio(pr)
      composer.setSize(w, h)
      bloom.resolution.set(w, h)
    },
    dispose() {
      composer.dispose()
      renderer.dispose()
    },
  }
}

export { FOV }
