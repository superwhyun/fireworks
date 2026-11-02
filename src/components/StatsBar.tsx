import { memo } from 'react'

interface StatsBarProps {
  fps: number
  particles: number
  shells: number
  bursts: number
}

export const StatsBar = memo(function StatsBar({ fps, particles, shells, bursts }: StatsBarProps) {
  return (
    <dl className="stats" aria-label="실시간 렌더 지표">
      <div className="stat">
        <dt>FPS</dt>
        <dd>{fps}</dd>
      </div>
      <div className="stat">
        <dt>입자</dt>
        <dd>{particles.toLocaleString('ko-KR')}</dd>
      </div>
      <div className="stat">
        <dt>비행중</dt>
        <dd>{shells}</dd>
      </div>
      <div className="stat">
        <dt>발사</dt>
        <dd>{bursts}</dd>
      </div>
    </dl>
  )
})
