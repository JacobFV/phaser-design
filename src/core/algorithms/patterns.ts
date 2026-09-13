import { mulberry32 } from './random'

/**
 * Pure, deterministic raster patterns (amplitude ∈ [0, 1], row-major). No browser canvas: the same config yields the
 * same pattern on every machine, which is what makes experiments reproducible.
 */
export type PatternKind = 'smiley' | 'text' | 'token' | 'gaussian' | 'uniform' | 'slits' | 'bits'

export interface PatternOptions {
  width: number
  height: number
  text?: string
  token?: number
  seed?: number
}

// 5×7 bitmap font, one string per row.
const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '10001', '11001', '10101', '10011', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '10001', '01010', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
}

/** Average coverage of `inside` over a 4×4 sub-sample grid per pixel (anti-aliasing without a rasteriser). */
function coverage(w: number, h: number, inside: (x: number, y: number) => boolean): Float64Array {
  const out = new Float64Array(w * h)
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      let c = 0
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (inside(i + (sx + 0.5) / 4, j + (sy + 0.5) / 4)) c++
      out[j * w + i] = c / 16
    }
  return out
}

export function renderPattern(kind: PatternKind, o: PatternOptions): Float64Array {
  const { width: W, height: H } = o
  const S = Math.min(W, H)
  const cx = W / 2, cy = H / 2
  switch (kind) {
    case 'uniform':
      return new Float64Array(W * H).fill(1)
    case 'gaussian': {
      const s = (9 / 64) * S
      const out = new Float64Array(W * H)
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) out[j * W + i] = Math.exp(-((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2) / (2 * s * s))
      return out
    }
    case 'smiley': {
      const t = 0.047 * S
      return coverage(W, H, (x, y) => {
        const dx = x - cx, dy = y - cy
        const r = Math.hypot(dx, dy)
        if (Math.abs(r - 0.36 * S) < t) return true
        for (const ex of [-0.125, 0.125]) if (((dx - ex * S) / (0.047 * S)) ** 2 + ((dy + 0.11 * S) / (0.07 * S)) ** 2 < 1) return true
        const sx = dx, sy = dy - 0.016 * S
        const a = Math.atan2(sy, sx)
        return Math.abs(Math.hypot(sx, sy) - 0.2 * S) < t && a > 0.18 * Math.PI && a < 0.82 * Math.PI
      })
    }
    case 'slits':
      return coverage(W, H, (x, y) => {
        const u = (x / W) * 64, v = (y / H) * 64
        return v > 12 && v < 52 && ((u > 24 && u < 28) || (u > 36 && u < 40))
      })
    case 'token': {
      const cols = 4, rows = 2
      const cell = (12 / 64) * S
      const k = Math.max(0, Math.min(cols * rows - 1, o.token ?? 0))
      const x0 = cx - (cols * cell) / 2 + (k % cols) * cell
      const y0 = cy - (rows * cell) / 2 + Math.floor(k / cols) * cell
      const m = cell / 12
      return coverage(W, H, (x, y) => x > x0 + m && x < x0 + cell - m && y > y0 + m && y < y0 + cell - m)
    }
    case 'bits': {
      const rand = mulberry32((o.seed ?? 1) * 31 + 1)
      const bits = Array.from({ length: 64 }, () => rand() > 0.5)
      return coverage(W, H, (x, y) => {
        const bx = Math.floor(((x / W) * 64 - 8) / 6), by = Math.floor(((y / H) * 64 - 8) / 6)
        return bx >= 0 && bx < 8 && by >= 0 && by < 8 && bits[by * 8 + bx]
      })
    }
    case 'text': {
      const chars = [...(o.text ?? '').toUpperCase()].map((c) => (FONT[c] ? c : '?'))
      const out = new Float64Array(W * H)
      if (!chars.length) return out
      const cols = chars.length * 6 - 1
      const scale = Math.max(1, Math.floor(Math.min((W * 0.92) / cols, (H * 0.9) / 7)))
      const ox = Math.floor((W - cols * scale) / 2)
      const oy = Math.floor((H - 7 * scale) / 2)
      chars.forEach((c, n) => {
        const glyph = FONT[c]
        for (let gy = 0; gy < 7; gy++)
          for (let gx = 0; gx < 5; gx++) {
            if (glyph[gy][gx] !== '1') continue
            for (let py = 0; py < scale; py++)
              for (let px = 0; px < scale; px++) {
                const i = ox + (n * 6 + gx) * scale + px
                const j = oy + gy * scale + py
                if (i >= 0 && i < W && j >= 0 && j < H) out[j * W + i] = 1
              }
          }
      })
      return out
    }
  }
}
