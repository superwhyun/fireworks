import { useEffect, useRef, useState } from 'react'
import { Director, type CameraPreset, type DirectorSettings, type MusicMode } from '../fireworks/director'
import type { SoundEngine } from '../fireworks/sound'
import type { SceneId } from '../fireworks/scenery'

const EMPTY_STATS = { fps: 0, particles: 0, shells: 0, bursts: 0, level: 0 }
type Stats = typeof EMPTY_STATS

export interface DirectorHandle {
  fire: () => void
  clear: () => void
  finale: () => void
  setCamera: (preset: CameraPreset) => void
  setAutoRotate: (on: boolean) => void
  setScene: (id: SceneId) => void
}

interface UseDirectorArgs {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  settings: DirectorSettings
  sound: SoundEngine
  musicMode: MusicMode
  onReady: (handle: DirectorHandle) => void
  onError: (message: string) => void
}

export function useDirector({
  canvasRef,
  settings,
  sound,
  musicMode,
  onReady,
  onError,
}: UseDirectorArgs): Stats {
  const [stats, setStats] = useState<Stats>(EMPTY_STATS)
  const directorRef = useRef<Director | null>(null)
  const settingsRef = useRef(settings)
  const musicModeRef = useRef(musicMode)

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    musicModeRef.current = musicMode
  }, [musicMode])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let director: Director
    let crackleAccum = 0
    let lastCrackle = 0
    let lastSplit = 0
    try {
      director = new Director({
        canvas,
        width: window.innerWidth,
        height: window.innerHeight,
        settings: settingsRef.current,
        onBurstSound: (cue) => sound.playBurst(cue),
        onLaunchSound: (cue) => sound.playLaunch(cue),
        onSplitSound: (amount) => {
          const now = performance.now()
          if (now - lastSplit > 90) {
            lastSplit = now
            sound.playSplit(amount)
          }
        },
        onCrackleSound: (amount) => {
          crackleAccum += amount
          const now = performance.now()
          if (now - lastCrackle > 180) {
            lastCrackle = now
            sound.playCrackle(Math.min(1, crackleAccum))
            crackleAccum = 0
          }
        },
        onInteract: () => {
          void sound.resume()
        },
      })
    } catch (err) {
      onError(err instanceof Error ? err.message : 'WebGL을 초기화할 수 없습니다.')
      return
    }

    directorRef.current = director
    director.start()
    onReady({
      fire: () => director.fireManual(),
      clear: () => director.clear(),
      finale: () => director.finale(),
      setCamera: (p) => director.setCameraPreset(p),
      setAutoRotate: (on) => director.setAutoRotate(on),
      setScene: (id) => director.setScene(id),
    })
    if (import.meta.env.DEV) {
      ;(window as unknown as { __pyro?: Director }).__pyro = director
    }

    const onResize = () => director.resize(window.innerWidth, window.innerHeight)
    window.addEventListener('resize', onResize)

    let statsAccum = 0
    let last = performance.now()
    const poll = window.setInterval(() => {
      const now = performance.now()
      statsAccum += now - last
      last = now
      const sample = sound.sample()
      director.setMusicMode(musicModeRef.current)
      if (musicModeRef.current !== 'off') {
        director.setMusicLevel(sample.energy, sample.onset)
      } else {
        director.setMusicLevel(0, false)
      }
      if (statsAccum > 380) {
        statsAccum = 0
        setStats(director.stats)
      }
    }, 60)

    return () => {
      window.clearInterval(poll)
      window.removeEventListener('resize', onResize)
      director.dispose()
      directorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    directorRef.current?.setSettings(settings)
  }, [settings])

  useEffect(() => {
    directorRef.current?.setMusicMode(musicMode)
  }, [musicMode])

  return stats
}
