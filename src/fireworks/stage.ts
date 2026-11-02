import { ACESFilmicToneMapping, Color, FogExp2, PerspectiveCamera, Scene, Vector2, WebGLRenderer } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

export interface Stage {
  renderer: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera
  composer: EffectComposer
  bloom: UnrealBloomPass
  resize(width: number, height: number, pixelRatio: number): void
  dispose(): void
}

export const FOV = 55

export function createStage(canvas: HTMLCanvasElement, width: number, height: number): Stage {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  })
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(width, height, false)
  renderer.setClearColor(new Color('#020308'), 1)
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15

  const scene = new Scene()
  scene.fog = new FogExp2(new Color('#05060d').getHex(), 0.0011)

  const camera = new PerspectiveCamera(FOV, width / height, 0.5, 5000)
  camera.position.set(0, 26, 260)

  const composer = new EffectComposer(renderer)
  composer.setPixelRatio(pixelRatio)
  composer.setSize(width, height)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new Vector2(width, height), 0.95, 0.5, 0.25)
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
    },
    dispose() {
      composer.dispose()
      renderer.dispose()
    },
  }
}
