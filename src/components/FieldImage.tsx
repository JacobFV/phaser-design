import { useEffect, useRef } from 'react'
import { N } from '../physics/params'

export type ImageMode = 'intensity' | 'phase'

interface Props {
  /** interleaved complex (re, im) N², or plain intensity N² when `intensity` is set */
  data: Float32Array
  intensity?: boolean
  mode: ImageMode
  size?: number
}

/**
 * A 2-D transverse wavefront. Intensity: white on black with gamma 0.5 so dim speckle shows.
 * Phase: hue = arg E, brightness = |E| (domain colouring).
 */
export function FieldImage({ data, intensity, mode, size = 128 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    const img = ctx.createImageData(N, N)
    const I = new Float32Array(N * N)
    let mx = 0
    for (let i = 0; i < N * N; i++) {
      I[i] = intensity ? data[i] : data[2 * i] ** 2 + data[2 * i + 1] ** 2
      if (I[i] > mx) mx = I[i]
    }
    for (let i = 0; i < N * N; i++) {
      const v = mx > 0 ? Math.sqrt(I[i] / mx) : 0
      const p = i * 4
      if (mode === 'phase' && !intensity) {
        const [r, g, b] = hue(Math.atan2(data[2 * i + 1], data[2 * i]))
        img.data[p] = r * v
        img.data[p + 1] = g * v
        img.data[p + 2] = b * v
      } else {
        img.data[p] = img.data[p + 1] = img.data[p + 2] = 255 * v
      }
      img.data[p + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  }, [data, intensity, mode])
  return <canvas ref={ref} className="field-image" width={N} height={N} style={{ width: size, height: size }} />
}

function hue(ph: number): [number, number, number] {
  const h = ((ph + Math.PI) / (2 * Math.PI)) * 6
  const x = 1 - Math.abs((h % 2) - 1)
  const table: [number, number, number][] = [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1], [1, 0, x]]
  const [r, g, b] = table[Math.min(5, Math.floor(h))]
  return [r * 255, g * 255, b * 255]
}
