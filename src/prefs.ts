import { PALETTES, PATTERN_IDS, type PatternId } from './fireworks/patterns'
import { SCENES, type SceneId } from './fireworks/scenery'

/** User settings remembered in this browser (per-device convenience only). */
export interface Prefs {
  scene: SceneId
  pattern: PatternId
  paletteId: string
  intensity: number
  autoFire: boolean
  quality: 'low' | 'medium' | 'high'
  audioEnabled: boolean
  autoRotate: boolean
}

const KEY = 'pyro.prefs.v1'

export const DEFAULT_PREFS: Prefs = {
  scene: 'river',
  pattern: 'random',
  paletteId: 'random',
  intensity: 0.7,
  autoFire: true,
  quality: 'high',
  audioEnabled: true,
  autoRotate: false,
}

/** Read saved prefs, ignoring anything missing, malformed or out of range. */
export function loadPrefs(): Prefs {
  let raw: unknown
  try {
    raw = JSON.parse(window.localStorage.getItem(KEY) ?? 'null')
  } catch {
    return { ...DEFAULT_PREFS }
  }
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS }
  const r = raw as Record<string, unknown>
  const p = { ...DEFAULT_PREFS }
  if (SCENES.some((s) => s.id === r.scene)) p.scene = r.scene as SceneId
  if (PATTERN_IDS.includes(r.pattern as PatternId)) p.pattern = r.pattern as PatternId
  if (PALETTES.some((x) => x.id === r.paletteId)) p.paletteId = r.paletteId as string
  if (typeof r.intensity === 'number' && r.intensity >= 0.1 && r.intensity <= 1) p.intensity = r.intensity
  if (typeof r.autoFire === 'boolean') p.autoFire = r.autoFire
  if (r.quality === 'low' || r.quality === 'medium' || r.quality === 'high') p.quality = r.quality
  if (typeof r.audioEnabled === 'boolean') p.audioEnabled = r.audioEnabled
  if (typeof r.autoRotate === 'boolean') p.autoRotate = r.autoRotate
  return p
}

export function savePrefs(p: Prefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* storage unavailable (private mode, blocked) — settings just won't persist */
  }
}
