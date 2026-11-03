import { memo } from 'react'
import { CAMERA_PRESETS, type CameraPreset } from '../fireworks/director'
import { CameraIcon, ExpandIcon, EyeIcon, OrbitIcon } from './icons'

interface CameraBarProps {
  preset: CameraPreset | null
  autoRotate: boolean
  onPreset: (p: CameraPreset) => void
  onAutoRotate: (on: boolean) => void
  onFullscreen: () => void
  onHideUi: () => void
}

const ORDER: CameraPreset[] = ['front', 'audience', 'close', 'low', 'aerial', 'side']

export const CameraBar = memo(function CameraBar({
  preset,
  autoRotate,
  onPreset,
  onAutoRotate,
  onFullscreen,
  onHideUi,
}: CameraBarProps) {
  return (
    <div className="camera-bar" role="group" aria-label="카메라">
      <span className="camera-label">
        <CameraIcon className="rail-icon" aria-hidden />
        시점
      </span>
      <div className="segmented">
        {ORDER.map((p, i) => (
          <button
            key={p}
            type="button"
            className={`segment${preset === p ? ' is-active' : ''}`}
            aria-pressed={preset === p}
            onClick={() => onPreset(p)}
            title={`${CAMERA_PRESETS[p].label} (${i + 1})`}
          >
            {CAMERA_PRESETS[p].label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={`icon-chip${autoRotate ? ' is-on' : ''}`}
        aria-pressed={autoRotate}
        onClick={() => onAutoRotate(!autoRotate)}
        title="자동 회전 (R)"
      >
        <OrbitIcon aria-hidden />
        <span className="visually-hidden">자동 회전</span>
      </button>
      <button type="button" className="icon-chip" onClick={onFullscreen} title="전체 화면 (F11 / Enter)">
        <ExpandIcon aria-hidden />
        <span className="visually-hidden">전체 화면</span>
      </button>
      <button type="button" className="icon-chip" onClick={onHideUi} title="UI 숨기기 (H)">
        <EyeIcon aria-hidden />
        <span className="visually-hidden">UI 숨기기</span>
      </button>
      <span className="camera-hint">드래그 회전 · 휠 확대 · 우클릭 이동 · 클릭한 곳에 발사</span>
    </div>
  )
})
