import { mulberry32 } from './field2d'
import { LCD_PIXELS, N_TOKENS, type Params } from './params'

/** Rasterise x_t as an LCD_PIXELS² amplitude pattern (0..1) — what M_in writes onto the beam. */
export function renderInput(p: Params): Float32Array {
  const L = LCD_PIXELS
  const c = document.createElement('canvas')
  c.width = c.height = L
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, L, L)
  ctx.fillStyle = ctx.strokeStyle = '#fff'
  ctx.lineCap = 'round'

  switch (p.input) {
    case 'smiley':
      ctx.lineWidth = 3
      ctx.beginPath(); ctx.arc(32, 32, 23, 0, 2 * Math.PI); ctx.stroke()
      ctx.beginPath(); ctx.ellipse(24, 25, 3, 4.5, 0, 0, 2 * Math.PI); ctx.fill()
      ctx.beginPath(); ctx.ellipse(40, 25, 3, 4.5, 0, 0, 2 * Math.PI); ctx.fill()
      ctx.beginPath(); ctx.arc(32, 33, 13, 0.18 * Math.PI, 0.82 * Math.PI); ctx.stroke()
      break
    case 'text': {
      const txt = p.text.slice(0, 12) || ' '
      let size = 40
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (; size > 8; size--) {
        ctx.font = `700 ${size}px "IBM Plex Mono", ui-monospace, monospace`
        if (ctx.measureText(txt).width <= 58) break
      }
      ctx.fillText(txt, 32, 34)
      break
    }
    case 'token': {
      // one-hot token id: one lit cell in a 4 × 2 grid
      const cols = 4
      const cell = 12
      const x0 = (L - cols * cell) / 2
      const y0 = (L - 2 * cell) / 2
      const k = Math.min(p.token, N_TOKENS - 1)
      ctx.fillRect(x0 + (k % cols) * cell + 1, y0 + Math.floor(k / cols) * cell + 1, cell - 2, cell - 2)
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.lineWidth = 1
      break
    }
    case 'gaussian': {
      const img = ctx.createImageData(L, L)
      for (let y = 0; y < L; y++)
        for (let x = 0; x < L; x++) {
          const v = 255 * Math.exp(-(((x - 31.5) ** 2 + (y - 31.5) ** 2) / (2 * 9 ** 2)))
          const i = (y * L + x) * 4
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v
          img.data[i + 3] = 255
        }
      ctx.putImageData(img, 0, 0)
      break
    }
    case 'uniform':
      ctx.fillRect(0, 0, L, L)
      break
    case 'slits':
      ctx.fillRect(24, 12, 4, 40)
      ctx.fillRect(36, 12, 4, 40)
      break
    case 'bits': {
      const rand = mulberry32(p.seed * 31 + 1)
      for (let by = 0; by < 8; by++)
        for (let bx = 0; bx < 8; bx++) if (rand() > 0.5) ctx.fillRect(8 + bx * 6, 8 + by * 6, 6, 6)
      break
    }
  }

  const data = ctx.getImageData(0, 0, L, L).data
  const amp = new Float32Array(L * L)
  for (let i = 0; i < L * L; i++) amp[i] = data[i * 4] / 255
  return amp
}
