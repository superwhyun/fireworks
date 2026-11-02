import { useEffect } from 'react'

interface FireworksCanvasProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  onReadyChange: (ready: boolean) => void
}

export function FireworksCanvas({ canvasRef, onReadyChange }: FireworksCanvasProps) {
  useEffect(() => {
    onReadyChange(true)
    return () => onReadyChange(false)
  }, [onReadyChange])

  return (
    <canvas
      ref={canvasRef}
      className="fireworks-canvas"
      onContextMenu={(e) => e.preventDefault()}
      aria-label="3D 불꽃놀이 무대. 드래그로 회전, 휠로 확대, 클릭한 위치에 불꽃이 발사됩니다."
    />
  )
}
