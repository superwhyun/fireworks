import { useEffect, useRef } from 'react'

interface FireworksCanvasProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  onPointerFire: () => void
  onReadyChange: (ready: boolean) => void
}

export function FireworksCanvas({ canvasRef, onPointerFire, onReadyChange }: FireworksCanvasProps) {
  const readyRef = useRef(false)

  useEffect(() => {
    onReadyChange(true)
    return () => {
      readyRef.current = false
      onReadyChange(false)
    }
  }, [onReadyChange])

  return (
    <canvas
      ref={canvasRef}
      className="fireworks-canvas"
      onClick={onPointerFire}
      aria-label="3D 불꽃놀이 무대. 클릭하면 불꽃이 발사됩니다."
    />
  )
}
