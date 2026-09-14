import { useEffect, useRef } from 'react'

export type ImageMode = 'intensity' | 'phase'

interface Props {
  /** interleaved complex (re, im) nx·ny, or plain intensity when `intensity` is set */
  data: ArrayLike<number>
  nx: number
  ny: number
  intensity?: boolean
  mode: ImageMode
  size?: number
}

/** 2-D transverse wavefront. Intensity: white on black, gamma 0.5. Phase: hue = arg E, brightness = |E|. */
export function FieldImage({ data, nx, ny, intensity, mode, size = 96 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    const n = nx * ny
    const img = ctx.createImageData(nx, ny)
    let mx = 0
    const I = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      I[i] = intensity ? data[i] : data[2 * i] ** 2 + data[2 * i + 1] ** 2
      if (I[i] > mx) mx = I[i]
    }
    for (let i = 0; i < n; i++) {
      const v = mx > 0 ? Math.sqrt(I[i] / mx) : 0
      const p = i * 4
      if (mode === 'phase' && !intensity) {
        const [r, g, b] = hue(Math.atan2(data[2 * i + 1], data[2 * i]))
        img.data[p] = r * v; img.data[p + 1] = g * v; img.data[p + 2] = b * v
      } else {
        img.data[p] = img.data[p + 1] = img.data[p + 2] = 255 * v
      }
      img.data[p + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  }, [data, nx, ny, intensity, mode])
  return <canvas ref={ref} className="field-image" width={nx} height={ny} style={{ width: size, height: (size * ny) / nx }} />
}

function hue(ph: number): [number, number, number] {
  const h = ((ph + Math.PI) / (2 * Math.PI)) * 6
  const x = 1 - Math.abs((h % 2) - 1)
  const t: [number, number, number][] = [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1], [1, 0, x]]
  const [r, g, b] = t[Math.min(5, Math.floor(h))]
  return [r * 255, g * 255, b * 255]
}
