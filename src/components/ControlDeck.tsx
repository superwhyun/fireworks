import { memo } from 'react'
import { BurstIcon, ChevronIcon, GaugeIcon, ResetIcon, SparkIcon } from './icons'

interface ControlDeckProps {
  intensity: number
  autoFire: boolean
  quality: 'low' | 'medium' | 'high'
  onIntensity: (v: number) => void
  onAutoFire: (on: boolean) => void
  onQuality: (q: 'low' | 'medium' | 'high') => void
  onFire: () => void
  onFinale: () => void
  onClear: () => void
}

const QUALITIES = [
  { id: 'low', label: '절전' },
  { id: 'medium', label: '표준' },
  { id: 'high', label: '최고' },
] as const

export const ControlDeck = memo(function ControlDeck({
  intensity,
  autoFire,
  quality,
  onIntensity,
  onAutoFire,
  onQuality,
  onFire,
  onFinale,
  onClear,
}: ControlDeckProps) {
  return (
    <div className="deck">
      <button type="button" className="fire-button" onClick={onFire}>
        <SparkIcon className="fire-button-icon" aria-hidden />
        <span className="fire-button-label">발사</span>
        <span className="fire-button-key">SPACE</span>
      </button>

      <div className="deck-controls">
        <div className="control">
          <label className="control-label" htmlFor="intensity">
            <GaugeIcon className="rail-icon" aria-hidden />
            규모
            <span className="control-value">{Math.round(intensity * 100)}%</span>
          </label>
          <input
            id="intensity"
            type="range"
            min={0.1}
            max={1}
            step={0.01}
            value={intensity}
            onChange={(e) => onIntensity(Number(e.target.value))}
            className="scrub"
            style={{ ['--fill' as string]: `${((intensity - 0.1) / 0.9) * 100}%` }}
          />
        </div>

        <div className="control control-row">
          <span className="control-label">품질</span>
          <div className="segmented" role="group" aria-label="렌더 품질">
            {QUALITIES.map((q) => (
              <button
                key={q.id}
                type="button"
                className={`segment${quality === q.id ? ' is-active' : ''}`}
                aria-pressed={quality === q.id}
                onClick={() => onQuality(q.id)}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>

        <div className="control control-row">
          <span className="control-label">자동 쇼</span>
          <button
            type="button"
            className={`toggle${autoFire ? ' is-on' : ''}`}
            role="switch"
            aria-checked={autoFire}
            onClick={() => onAutoFire(!autoFire)}
          >
            <span className="toggle-thumb" aria-hidden />
            <span className="visually-hidden">{autoFire ? '자동 쇼 끄기' : '자동 쇼 켜기'}</span>
          </button>
        </div>

        <button type="button" className="ghost-button finale-button" onClick={onFinale} title="피날레 (F)">
          <BurstIcon className="rail-icon" aria-hidden />
          피날레
        </button>

        <button type="button" className="ghost-button" onClick={onClear}>
          <ResetIcon className="rail-icon" aria-hidden />
          하늘 비우기
        </button>
      </div>
    </div>
  )
})

export const CollapseHandle = memo(function CollapseHandle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={`collapse-handle${collapsed ? ' is-collapsed' : ''}`}
      onClick={onToggle}
      aria-label={collapsed ? '패널 펼치기' : '패널 접기'}
      aria-expanded={!collapsed}
    >
      <ChevronIcon className="chevron" aria-hidden />
    </button>
  )
})
