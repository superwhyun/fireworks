import { memo } from 'react'
import { SCENES, type SceneId } from '../fireworks/scenery'

interface SceneSelectorProps {
  scene: SceneId
  onScene: (id: SceneId) => void
}

export const SceneSelector = memo(function SceneSelector({ scene, onScene }: SceneSelectorProps) {
  return (
    <section className="rail-block scene-block">
      <header className="rail-head">
        <span className="rail-label">배경</span>
      </header>
      <div className="segmented scene-segmented" role="group" aria-label="배경 선택">
        {SCENES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`segment${scene === s.id ? ' is-active' : ''}`}
            aria-pressed={scene === s.id}
            onClick={() => onScene(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </section>
  )
})
