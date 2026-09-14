/**
 * Spectral → display colour. The simulation is monochromatic at the configured vacuum wavelength, so the light on
 * screen is the sRGB projection of that spectral line: CIE 1931 2° colour matching functions → XYZ → linear sRGB
 * (D65) → gamut mapping → sRGB transfer. The same integral accepts an arbitrary spectral power distribution.
 */
export interface SpectralSample {
  wavelength: number // m
  power: number // relative
}

export type RGB = [number, number, number] // 0..1, display-encoded

/** Piecewise-Gaussian fit to the CIE 1931 2° observer (Wyman, Sloan & Shirley 2013). λ in nm. */
function cmf(nm: number): [number, number, number] {
  const g = (x: number, mu: number, s1: number, s2: number) => {
    const t = (x - mu) / (x < mu ? s1 : s2)
    return Math.exp(-0.5 * t * t)
  }
  const x = 1.056 * g(nm, 599.8, 37.9, 31.0) + 0.362 * g(nm, 442.0, 16.0, 26.7) - 0.065 * g(nm, 501.1, 20.4, 26.2)
  const y = 0.821 * g(nm, 568.8, 46.9, 40.5) + 0.286 * g(nm, 530.9, 16.3, 31.1)
  const z = 1.217 * g(nm, 437.0, 11.8, 36.0) + 0.681 * g(nm, 459.0, 26.0, 13.8)
  return [x, y, z]
}

/** Integrate an SPD against the colour matching functions. */
export function spectrumToXYZ(spd: SpectralSample[]): [number, number, number] {
  let X = 0, Y = 0, Z = 0
  for (const s of spd) {
    const [x, y, z] = cmf(s.wavelength * 1e9)
    X += x * s.power; Y += y * s.power; Z += z * s.power
  }
  return [X, Y, Z]
}

function xyzToLinearSRGB([X, Y, Z]: [number, number, number]): [number, number, number] {
  return [
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.204 * Y + 1.057 * Z,
  ]
}

const encode = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)

/**
 * Display colour of a spectrum at full brightness. Spectral lines lie outside the sRGB gamut; the negative channels
 * are clipped (projection onto the gamut boundary along the channel axes, which keeps the hue of the nearest
 * primary rather than washing the line toward white), then scaled so the brightest channel is 1: the display cannot
 * exceed its primaries, so a monochromatic line is at most as bright as the primary it maps to.
 */
export function spectrumToRGB(spd: SpectralSample[]): RGB {
  const rgb = xyzToLinearSRGB(spectrumToXYZ(spd)).map((c) => Math.max(0, c)) as [number, number, number]
  const max = Math.max(...rgb)
  if (max <= 0) return [0, 0, 0]
  return rgb.map((c) => encode(c / max)) as RGB
}

export const monochromeRGB = (wavelength: number): RGB => spectrumToRGB([{ wavelength, power: 1 }])

export const rgbToCss = ([r, g, b]: RGB, alpha = 1) =>
  alpha >= 1 ? `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})` : `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`

/** 0..255 byte tint for canvas painters. */
export const rgbToBytes = ([r, g, b]: RGB): [number, number, number] => [r * 255, g * 255, b * 255]
