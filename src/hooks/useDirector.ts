import { useEffect, useRef, useState } from 'react'
import { Director, type DirectorSettings, type MusicMode } from '../fireworks/director'
import type { SoundEngine } from '../fireworks/sound'

const EMPTY_STATS = { fps: 0, particles: 0, shells: 0, bursts: 0, level: 0 }
type Stats = typeof EMPTY_STATS

export interface DirectorHandle {
  fire: () => void
  clear: () => void
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
    try {
      director = new Director({
        canvas,
        width: window.innerWidth,
        height: window.innerHeight,
        settings: settingsRef.current,
        onBurstSound: (size) => {
          sound.playBurst(size / 420)
        },
        onLaunchSound: (fuse) => {
          sound.playLaunch(fuse)
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
    })

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

  useEffect(() => {
    directorRef.current?.clear()
  }, [settings.quality])

  return stats
}
