import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ReceiptCorners } from '../../types/accountingReceiptLegal'
import {
  cornersToDisplay,
  type DisplayRect,
  imagePointToDisplayPoint,
  moveReceiptCornerSafely,
} from '../../utils/receiptCorners'

type CornerKey = keyof ReceiptCorners

type Props = {
  imageUrl: string
  imageWidth: number
  imageHeight: number
  corners: ReceiptCorners
  onChange: (corners: ReceiptCorners) => void
  disabled?: boolean
}

const HANDLE_RADIUS = 18

export function ReceiptCornerEditor({
  imageUrl,
  imageWidth,
  imageHeight,
  corners,
  onChange,
  disabled,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [displayRect, setDisplayRect] = useState<DisplayRect>({
    offsetX: 0,
    offsetY: 0,
    displayWidth: 1,
    displayHeight: 1,
    imageWidth,
    imageHeight,
  })
  const dragKeyRef = useRef<CornerKey | null>(null)

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }

    const updateRect = () => {
      const bounds = element.getBoundingClientRect()
      const scale = Math.min(
        bounds.width / Math.max(imageWidth, 1),
        bounds.height / Math.max(imageHeight, 1),
      )
      const displayWidth = imageWidth * scale
      const displayHeight = imageHeight * scale
      setDisplayRect({
        offsetX: (bounds.width - displayWidth) / 2,
        offsetY: (bounds.height - displayHeight) / 2,
        displayWidth,
        displayHeight,
        imageWidth,
        imageHeight,
      })
    }

    updateRect()
    const observer = new ResizeObserver(updateRect)
    observer.observe(element)
    return () => observer.disconnect()
  }, [imageWidth, imageHeight, imageUrl])

  const displayCorners = cornersToDisplay(corners, displayRect)

  const onPointerDown = (key: CornerKey, event: ReactPointerEvent<Element>) => {
    if (disabled) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    dragKeyRef.current = key
    ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const key = dragKeyRef.current
    const element = containerRef.current
    if (!key || !element || disabled) {
      return
    }
    event.preventDefault()
    const bounds = element.getBoundingClientRect()
    const displayPoint = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    }
    const imagePoint = {
      x: ((displayPoint.x - displayRect.offsetX) / Math.max(displayRect.displayWidth, 1)) * imageWidth,
      y: ((displayPoint.y - displayRect.offsetY) / Math.max(displayRect.displayHeight, 1)) * imageHeight,
    }
    onChange(moveReceiptCornerSafely(corners, key, imagePoint, imageWidth, imageHeight))
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragKeyRef.current) {
      try {
        ;(event.target as HTMLElement).releasePointerCapture(event.pointerId)
      } catch {
        // ignore
      }
    }
    dragKeyRef.current = null
  }

  const polygonPoints = [
    displayCorners.topLeft,
    displayCorners.topRight,
    displayCorners.bottomRight,
    displayCorners.bottomLeft,
  ]
    .map((point) => `${point.x},${point.y}`)
    .join(' ')

  return (
    <div
      ref={containerRef}
      className="receipt-corner-editor"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <img
        alt="領収書範囲"
        className="receipt-corner-editor-image"
        src={imageUrl}
        draggable={false}
        style={{
          width: displayRect.displayWidth,
          height: displayRect.displayHeight,
          left: displayRect.offsetX,
          top: displayRect.offsetY,
        }}
      />
      <svg className="receipt-corner-editor-overlay" aria-hidden="true">
        <polygon points={polygonPoints} className="receipt-corner-editor-poly" />
        {(Object.keys(displayCorners) as CornerKey[]).map((key) => {
          const point = imagePointToDisplayPoint(corners[key], displayRect)
          return (
            <g key={key}>
              <circle
                className="receipt-corner-editor-handle"
                cx={point.x}
                cy={point.y}
                r={HANDLE_RADIUS}
                onPointerDown={(event) => onPointerDown(key, event)}
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}
