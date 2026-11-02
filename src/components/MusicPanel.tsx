import { memo } from 'react'
import type { MusicMode } from '../fireworks/director'
import type { SoundEngine } from '../fireworks/sound'
import {
  CloseIcon,
  MusicIcon,
  MuteIcon,
  PauseIcon,
  PlayIcon,
  SpeakerIcon,
  UploadIcon,
} from './icons'

export interface TrackInfo {
  name: string
  duration: number
  size: number
}

interface MusicPanelProps {
  musicRef: React.RefObject<HTMLAudioElement | null>
  fileInputRef: React.RefObject<HTMLInputElement | null>
  track: TrackInfo | null
  error: string | null
  playing: boolean
  currentTime: number
  duration: number
  musicMode: MusicMode
  musicLevel: number
  sound: SoundEngine
  audioEnabled: boolean
  onPickFile: () => void
  onFile: (file: File | null) => void
  onPlayPause: () => void
  onSeek: (time: number) => void
  onMusicMode: (mode: MusicMode) => void
  onToggleSound: () => void
  onClearTrack: () => void
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const MODES: { id: MusicMode; label: string; caption: string }[] = [
  { id: 'off', label: '정지', caption: '음악 반응 끔' },
  { id: 'reactive', label: '반응', caption: '비트에 맞춰 발사' },
  { id: 'auto', label: '자동', caption: '음악과 함께 연속 발사' },
]

export const MusicPanel = memo(function MusicPanel({
  musicRef,
  fileInputRef,
  track,
  error,
  playing,
  currentTime,
  duration,
  musicMode,
  musicLevel,
  sound,
  audioEnabled,
  onPickFile,
  onFile,
  onPlayPause,
  onSeek,
  onMusicMode,
  onToggleSound,
  onClearTrack,
}: MusicPanelProps) {
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0

  return (
    <section className="music-panel" aria-label="음악 연동">
      <div className="music-head">
        <span className="music-title">
          <MusicIcon className="rail-icon" aria-hidden />
          음악 연동
        </span>
        <div className="music-head-actions">
          <button
            type="button"
            className="icon-button"
            aria-label={audioEnabled ? '사운드 끄기' : '사운드 켜기'}
            aria-pressed={audioEnabled}
            onClick={() => {
              sound.setEnabled(!audioEnabled)
              onToggleSound()
            }}
          >
            {audioEnabled ? <SpeakerIcon /> : <MuteIcon />}
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.mp4,.ogg,.flac,.aac,.opus"
        className="visually-hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />

      {track ? (
        <div className="track">
          <div className="track-row">
            <div className="track-meta">
              <span className="track-name" title={track.name}>
                {track.name}
              </span>
              <span className="track-sub">
                {formatSize(track.size)} · {formatTime(duration || track.duration)}
              </span>
            </div>
            <div className="track-actions">
              <button type="button" className="icon-button is-play" onClick={onPlayPause}>
                {playing ? <PauseIcon /> : <PlayIcon />}
                <span className="visually-hidden">{playing ? '일시정지' : '재생'}</span>
              </button>
              <button type="button" className="icon-button" onClick={onClearTrack} aria-label="음악 제거">
                <CloseIcon />
              </button>
            </div>
          </div>

          <div className="track-scrub">
            <input
              type="range"
              min={0}
              max={Math.max(duration, 0.1)}
              step={0.1}
              value={Math.min(currentTime, duration || 0)}
              onChange={(e) => onSeek(Number(e.target.value))}
              className="scrub"
              style={{ ['--fill' as string]: `${progress * 100}%` }}
              aria-label="재생 위치"
            />
            <div className="track-times">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          <div className="level-meter" aria-hidden>
            {Array.from({ length: 24 }).map((_, i) => {
              const threshold = (i + 1) / 24
              const lit = musicLevel >= threshold * 0.9
              return <span key={i} className={`level-bar${lit ? ' is-lit' : ''}`} />
            })}
          </div>
        </div>
      ) : (
        <button type="button" className="dropzone" onClick={onPickFile}>
          <UploadIcon className="dropzone-icon" aria-hidden />
          <span className="dropzone-title">음악 파일 올리기</span>
          <span className="dropzone-sub">MP3 · WAV · M4A · MP4 오디오 · OGG</span>
        </button>
      )}

      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mode-switch" role="group" aria-label="음악 반응 모드">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`mode-button${musicMode === m.id ? ' is-active' : ''}`}
            aria-pressed={musicMode === m.id}
            onClick={() => onMusicMode(m.id)}
          >
            <span className="mode-label">{m.label}</span>
            <span className="mode-caption">{m.caption}</span>
          </button>
        ))}
      </div>

      <audio ref={musicRef} preload="metadata" crossOrigin="anonymous" hidden />
    </section>
  )
})
