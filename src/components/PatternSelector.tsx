import { memo } from 'react'
import { PALETTES, PATTERN_IDS, PATTERN_LABELS, type PatternId } from '../fireworks/patterns'
import { PaletteIcon, SparkIcon } from './icons'

interface PatternSelectorProps {
  pattern: PatternId
  paletteId: string
  onPattern: (pattern: PatternId) => void
  onPalette: (paletteId: string) => void
}

export const PatternSelector = memo(function PatternSelector({
  pattern,
  paletteId,
  onPattern,
  onPalette,
}: PatternSelectorProps) {
  return (
    <div className="rail">
      <section className="rail-block">
        <header className="rail-head">
          <span className="rail-label">
            <SparkIcon className="rail-icon" aria-hidden />
            불꽃 종류
          </span>
          <span className="rail-hint">Space</span>
        </header>
        <div className="pattern-grid">
          {PATTERN_IDS.map((id) => {
            const active = id === pattern
            return (
              <button
                key={id}
                type="button"
                className={`pattern-chip${active ? ' is-active' : ''}`}
                aria-pressed={active}
                onClick={() => onPattern(id)}
              >
                <span className="pattern-dot" aria-hidden />
                <span className="pattern-text">
                  <span className="pattern-ko">{PATTERN_LABELS[id].ko}</span>
                  <span className="pattern-en">{PATTERN_LABELS[id].en}</span>
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="rail-block">
        <header className="rail-head">
          <span className="rail-label">
            <PaletteIcon className="rail-icon" aria-hidden />
            색상 팔레트
          </span>
          <span className="rail-hint">{PALETTES.find((p) => p.id === paletteId)?.name}</span>
        </header>
        <div className="palette-row">
          {PALETTES.map((p) => {
            const active = p.id === paletteId
            return (
              <button
                key={p.id}
                type="button"
                className={`palette-swatch${active ? ' is-active' : ''}`}
                aria-label={p.name}
                aria-pressed={active}
                onClick={() => onPalette(p.id)}
              >
                <span className="palette-stripes" aria-hidden>
                  {p.colors.map((c) => (
                    <span key={c} style={{ background: c }} />
                  ))}
                </span>
                <span className="palette-name">{p.name}</span>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
})
