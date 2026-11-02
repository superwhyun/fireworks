import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CameraBar } from './components/CameraBar'
import { ControlDeck, CollapseHandle } from './components/ControlDeck'
import { FireworksCanvas } from './components/FireworksCanvas'
import { MusicPanel, type TrackInfo } from './components/MusicPanel'
import { PatternSelector } from './components/PatternSelector'
import { StatsBar } from './components/StatsBar'
import { CloseIcon } from './components/icons'
import type { CameraPreset, MusicMode } from './fireworks/director'
import { PALETTES, type PatternId } from './fireworks/patterns'
import { SoundEngine } from './fireworks/sound'
import { useDirector, type DirectorHandle } from './hooks/useDirector'

const AUDIO_EXT = /\.(mp3|wav|m4a|mp4|ogg|oga|flac|aac|opus|weba|webm|aiff?)$/i

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const musicRef = useRef<HTMLAudioElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const directorHandle = useRef<DirectorHandle | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const soundRef = useRef<SoundEngine | null>(null)

  const [pattern, setPattern] = useState<PatternId>('random')
  const [paletteId, setPaletteId] = useState('random')
  const [intensity, setIntensity] = useState(0.7)
  const [autoFire, setAutoFire] = useState(true)
  const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('high')
  const [musicMode, setMusicMode] = useState<MusicMode>('off')
  const [track, setTrack] = useState<TrackInfo | null>(null)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [musicLevel, setMusicLevel] = useState(0)
  const [audioEnabled, setAudioEnabled] = useState(true)
  const [ready, setReady] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [uiHidden, setUiHidden] = useState(false)
  const [cameraPreset, setCameraPreset] = useState<CameraPreset | null>('front')
  const [autoRotate, setAutoRotate] = useState(false)

  const sound = useMemo(() => {
    if (!soundRef.current) soundRef.current = new SoundEngine()
    return soundRef.current
  }, [])

  const palette = useMemo(
    () => PALETTES.find((p) => p.id === paletteId) ?? PALETTES[0],
    [paletteId],
  )

  const settings = useMemo(
    () => ({ quality, intensity, autoFire, pattern, palette }),
    [quality, intensity, autoFire, pattern, palette],
  )
  const handleReady = useCallback((handle: DirectorHandle) => {
    directorHandle.current = handle
  }, [])

  const handleError = useCallback((message: string) => {
    setError(message)
    setReady(true)
  }, [])

  const stats = useDirector({
    canvasRef,
    settings,
    sound,
    musicMode,
    onReady: handleReady,
    onError: handleError,
  })

  const fire = useCallback(() => {
    void sound.resume()
    directorHandle.current?.fire()
  }, [sound])

  const finale = useCallback(() => {
    void sound.resume()
    directorHandle.current?.finale()
  }, [sound])

  const changeCamera = useCallback((p: CameraPreset) => {
    setCameraPreset(p)
    directorHandle.current?.setCamera(p)
  }, [])

  const changeAutoRotate = useCallback((on: boolean) => {
    setAutoRotate(on)
    directorHandle.current?.setAutoRotate(on)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen?.().catch(() => undefined)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault()
        fire()
        return
      }
      const presets: CameraPreset[] = ['front', 'close', 'low', 'aerial', 'side']
      const n = Number(e.key)
      if (n >= 1 && n <= presets.length) {
        changeCamera(presets[n - 1])
        return
      }
      switch (e.key.toLowerCase()) {
        case 'f':
          finale()
          break
        case 'h':
          setUiHidden((v) => !v)
          break
        case 'r':
          changeAutoRotate(!autoRotate)
          break
        case 'enter':
          toggleFullscreen()
          break
        case 'escape':
          setUiHidden(false)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fire, finale, changeCamera, changeAutoRotate, autoRotate, toggleFullscreen])

  useEffect(() => {
    if (musicMode === 'off') {
      setMusicLevel(0)
      return
    }
    const id = window.setInterval(() => {
      setMusicLevel(sound.sample().energy)
    }, 90)
    return () => window.clearInterval(id)
  }, [musicMode, sound])

  const revoke = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  useEffect(() => () => revoke(), [revoke])

  useEffect(() => () => sound.dispose(), [sound])

  const loadFile = useCallback(
    (file: File | null) => {
      setAudioError(null)
      if (!file) return
      if (!AUDIO_EXT.test(file.name) && !file.type.startsWith('audio/')) {
        setAudioError('오디오 파일만 올릴 수 있습니다. (MP3, WAV, M4A, MP4 오디오, OGG)')
        return
      }

      revoke()
      const url = URL.createObjectURL(file)
      objectUrlRef.current = url
      const el = musicRef.current
      if (!el) return

      el.pause()
      el.src = url
      el.load()
      el.onloadedmetadata = () => {
        setDuration(el.duration)
        setTrack({ name: file.name, duration: el.duration, size: file.size })
      }
      el.onerror = () => {
        setAudioError('이 파일은 브라우저에서 디코딩할 수 없습니다. MP3 또는 WAV를 사용해 주세요.')
        setTrack(null)
      }
      el.ontimeupdate = () => setCurrentTime(el.currentTime)
      el.onended = () => setPlaying(false)
      el.onplay = () => setPlaying(true)
      el.onpause = () => setPlaying(false)

      void sound.resume().then(() => sound.attachMusic(el))
    },
    [revoke, sound],
  )

  const playPause = useCallback(() => {
    const el = musicRef.current
    if (!el || !el.src) return
    void sound.resume().then(() => {
      sound.attachMusic(el)
      if (el.paused) void el.play()
      else el.pause()
    })
  }, [sound])

  const clearTrack = useCallback(() => {
    const el = musicRef.current
    if (el) {
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
    sound.detachMusic()
    revoke()
    setTrack(null)
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setMusicMode('off')
  }, [revoke, sound])

  const changeMusicMode = useCallback(
    (mode: MusicMode) => {
      setMusicMode(mode)
      if (mode !== 'off') {
        const el = musicRef.current
        if (el && el.src) {
          void sound.resume().then(() => {
            sound.attachMusic(el)
            if (el.paused) void el.play()
          })
        }
      }
    },
    [sound],
  )

  return (
    <div
      className={`app${dragging ? ' is-dragging' : ''}${uiHidden ? ' is-ui-hidden' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        if (e.dataTransfer.types.includes('Files')) setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        loadFile(e.dataTransfer.files?.[0] ?? null)
      }}
    >
      <FireworksCanvas canvasRef={canvasRef} onReadyChange={setReady} />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <span />
          </span>
          <div className="brand-text">
            <span className="brand-name">PYRO</span>
            <span className="brand-tag">실시간 3D 불꽃놀이 스튜디오</span>
          </div>
        </div>
        <StatsBar {...stats} />
      </header>

      <div className="camera-dock">
        <CameraBar
          preset={cameraPreset}
          autoRotate={autoRotate}
          onPreset={changeCamera}
          onAutoRotate={changeAutoRotate}
          onFullscreen={toggleFullscreen}
          onHideUi={() => setUiHidden(true)}
        />
      </div>

      {uiHidden ? (
        <button type="button" className="ui-restore" onClick={() => setUiHidden(false)}>
          UI 보기 (H)
        </button>
      ) : null}

      <aside className={`panel${collapsed ? ' is-collapsed' : ''}`} aria-label="불꽃 제어 패널">
        <CollapseHandle collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
        <div className="panel-scroll">
          <MusicPanel
            musicRef={musicRef}
            fileInputRef={fileInputRef}
            track={track}
            error={audioError}
            playing={playing}
            currentTime={currentTime}
            duration={duration}
            musicMode={musicMode}
            musicLevel={musicLevel}
            sound={sound}
            audioEnabled={audioEnabled}
            onPickFile={() => fileInputRef.current?.click()}
            onFile={loadFile}
            onPlayPause={playPause}
            onSeek={(t) => {
              const el = musicRef.current
              if (!el) return
              el.currentTime = t
              setCurrentTime(t)
            }}
            onMusicMode={changeMusicMode}
            onToggleSound={() => setAudioEnabled((v) => !v)}
            onClearTrack={clearTrack}
          />

          <PatternSelector
            pattern={pattern}
            paletteId={paletteId}
            onPattern={setPattern}
            onPalette={setPaletteId}
          />
        </div>
      </aside>

      <footer className="bottombar">
        <ControlDeck
          intensity={intensity}
          autoFire={autoFire}
          quality={quality}
          onIntensity={setIntensity}
          onAutoFire={setAutoFire}
          onQuality={setQuality}
          onFire={fire}
          onFinale={finale}
          onClear={() => directorHandle.current?.clear()}
        />
      </footer>

      {!ready ? (
        <div className="loading-veil" role="status">
          <div className="loading-skeleton">
            <span />
            <span />
            <span />
          </div>
          <p>무대를 준비하는 중…</p>
        </div>
      ) : null}

      {error ? (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="오류 닫기">
            <CloseIcon />
          </button>
        </div>
      ) : null}

      {dragging ? (
        <div className="drop-overlay" aria-hidden>
          <span>음악 파일을 놓아주세요</span>
        </div>
      ) : null}

    </div>
  )
}
