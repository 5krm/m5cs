/**
 * ═════════════════════════════════════════════════════════════════════════
 * Field — a tiny procedural texture forge
 * ═════════════════════════════════════════════════════════════════════════
 * Everything the location scenes are made of (asphalt aggregate, concrete
 * pores, rust, corrugated steel ribs, dune ripples, rock strata) is authored
 * here as a floating point height/pattern field and then baked into real
 * three.js textures:
 *
 *   Field ──► albedo (DataTexture, sRGB)
 *         ──► normal map (tangent space, derived from the height with a Sobel
 *             kernel — this is what makes a surface read as "3D" under light)
 *         ──► ORM map (occlusion / roughness / metalness packed in one RGB)
 *
 * Why DataTexture instead of a 2D canvas?  Two reasons:
 *   1. Alignment. Canvas textures are uploaded with `flipY = true`, data
 *      textures with `flipY = false`. Mixing them for the same surface makes
 *      the normal map point the wrong way against the albedo. Baking every
 *      PBR channel from the same Field keeps the whole set in one space.
 *   2. Speed. A 512² fBm with 5 octaves is ~1.3 M evaluations; writing into a
 *      typed array avoids the per-pixel canvas API overhead entirely.
 *
 * All noise here is *tileable* (the lattice wraps at the octave period), so a
 * texture set can repeat across a 200 m road without a visible seam.
 */

import * as THREE from 'three'

export type Rng = () => number

/** Deterministic PRNG — every visitor gets the same trees, stains and puddles. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Hash a string into a 32 bit seed so callers can use readable names. */
export function seedFrom(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
const fade = (t: number) => t * t * (3 - 2 * t)

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export function smoothstep(a: number, b: number, x: number): number {
  if (a === b) return x < a ? 0 : 1
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** Tileable value noise. `period` = lattice cells across the unit square. */
export function valueNoise(x: number, y: number, period: number, seed: number): number {
  const px = x * period
  const py = y * period
  const x0 = Math.floor(px)
  const y0 = Math.floor(py)
  const fx = fade(px - x0)
  const fy = fade(py - y0)
  const wrap = (v: number) => ((v % period) + period) % period
  const x0w = wrap(x0)
  const x1w = wrap(x0 + 1)
  const y0w = wrap(y0)
  const y1w = wrap(y0 + 1)
  const a = hash2(x0w, y0w, seed)
  const b = hash2(x1w, y0w, seed)
  const c = hash2(x0w, y1w, seed)
  const d = hash2(x1w, y1w, seed)
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy)
}

/** Tileable gradient (Perlin-ish) noise — smoother than value noise. */
export function gradientNoise(x: number, y: number, period: number, seed: number): number {
  const px = x * period
  const py = y * period
  const x0 = Math.floor(px)
  const y0 = Math.floor(py)
  const wrap = (v: number) => ((v % period) + period) % period
  const grad = (ix: number, iy: number, dx: number, dy: number) => {
    const a = hash2(wrap(ix), wrap(iy), seed) * Math.PI * 2
    return Math.cos(a) * dx + Math.sin(a) * dy
  }
  const dx = px - x0
  const dy = py - y0
  const u = smootherstep(dx)
  const v = smootherstep(dy)
  const n00 = grad(x0, y0, dx, dy)
  const n10 = grad(x0 + 1, y0, dx - 1, dy)
  const n01 = grad(x0, y0 + 1, dx, dy - 1)
  const n11 = grad(x0 + 1, y0 + 1, dx - 1, dy - 1)
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 0.5 + 0.5
}

/**
 * A scalar field in [0,1] — the intermediate representation every texture
 * goes through. Indexing is `y * w + x` with y = 0 as texture row 0 (which is
 * v = 0 for a DataTexture, i.e. the *bottom* of the surface).
 */
export class Field {
  readonly w: number
  readonly h: number
  readonly data: Float32Array

  constructor(w: number, h: number, data?: Float32Array) {
    this.w = w
    this.h = h
    this.data = data ?? new Float32Array(w * h)
  }

  static of(w: number, h: number, fn: (x: number, y: number, u: number, v: number) => number): Field {
    const f = new Field(w, h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) f.data[y * w + x] = fn(x, y, x / w, y / h)
    }
    return f
  }

  at(x: number, y: number): number {
    return this.data[this.idx(x, y)]
  }

  idx(x: number, y: number): number {
    const xi = ((x % this.w) + this.w) % this.w
    const yi = ((y % this.h) + this.h) % this.h
    return yi * this.w + xi
  }

  clone(): Field {
    return new Field(this.w, this.h, this.data.slice())
  }

  fill(v: number): this {
    this.data.fill(v)
    return this
  }

  /** Per-cell transform. */
  apply(fn: (v: number, x: number, y: number) => number): this {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x
        this.data[i] = fn(this.data[i], x, y)
      }
    }
    return this
  }

  /** Fractal Brownian motion — the workhorse for organic surfaces. */
  fbm(seed: number, opts: { freq?: number; octaves?: number; gain?: number; lacunarity?: number; ridged?: boolean } = {}): this {
    const { freq = 4, octaves = 5, gain = 0.5, lacunarity = 2, ridged = false } = opts
    const w = this.w
    const h = this.h
    for (let y = 0; y < h; y++) {
      const v = y / h
      for (let x = 0; x < w; x++) {
        const u = x / w
        let amp = 1
        let sum = 0
        let norm = 0
        let f = freq
        for (let o = 0; o < octaves; o++) {
          const p = Math.max(1, Math.round(f))
          let n = gradientNoise(u, v, p, seed + o * 7919)
          if (ridged) n = 1 - Math.abs(n * 2 - 1)
          sum += n * amp
          norm += amp
          amp *= gain
          f *= lacunarity
        }
        this.data[y * w + x] = clamp01(sum / norm)
      }
    }
    return this
  }

  /** Warp this field with another one — turns fBm into smoke, rust, clouds. */
  warp(bx: Field, by: Field, amount: number): this {
    const src = this.data.slice()
    const w = this.w
    const h = this.h
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const dx = Math.round((bx.data[i] - 0.5) * amount * w)
        const dy = Math.round((by.data[i] - 0.5) * amount * h)
        this.data[i] = src[this.idx(x + dx, y + dy)]
      }
    }
    return this
  }

  /** Worley / cellular noise: F1 distance to the nearest jittered cell point. */
  worley(seed: number, cells: number, jitter = 0.85): this {
    const rng = mulberry32(seed)
    const pts: Array<[number, number]> = []
    for (let i = 0; i < cells * cells; i++) pts.push([rng(), rng()])
    for (let y = 0; y < this.h; y++) {
      const v = y / this.h
      for (let x = 0; x < this.w; x++) {
        const u = x / this.w
        let best = 9
        for (let gi = 0; gi < cells; gi++) {
          for (let gj = 0; gj < cells; gj++) {
            const [ox, oy] = pts[gi * cells + gj]
            let dx = gi / cells + ox / cells + (0.5 / cells) * (1 - jitter) - u
            let dy = gj / cells + oy / cells + (0.5 / cells) * (1 - jitter) - v
            dx -= Math.round(dx)
            dy -= Math.round(dy)
            const d = Math.hypot(dx, dy) * cells
            if (d < best) best = d
          }
        }
        this.data[y * this.w + x] = clamp01(1 - best)
      }
    }
    return this
  }

  /** Add / multiply / power / remap — chainable field math. */
  add(o: Field, scale = 1): this {
    for (let i = 0; i < this.data.length; i++) this.data[i] = clamp01(this.data[i] + o.data[i] * scale)
    return this
  }

  mul(o: Field, mix = 1): this {
    for (let i = 0; i < this.data.length; i++) this.data[i] = clamp01(lerp(this.data[i], this.data[i] * o.data[i], mix))
    return this
  }

  addConst(v: number): this {
    for (let i = 0; i < this.data.length; i++) this.data[i] = clamp01(this.data[i] + v)
    return this
  }

  mulConst(v: number): this {
    for (let i = 0; i < this.data.length; i++) this.data[i] = clamp01(this.data[i] * v)
    return this
  }

  invert(): this {
    for (let i = 0; i < this.data.length; i++) this.data[i] = 1 - this.data[i]
    return this
  }

  /** S-curve contrast around 0.5. */
  contrast(power: number): this {
    for (let i = 0; i < this.data.length; i++) {
      const v = this.data[i]
      this.data[i] = clamp01(v < 0.5 ? 0.5 * Math.pow(v * 2, power) : 1 - 0.5 * Math.pow((1 - v) * 2, power))
    }
    return this
  }

  /** Remap an input window onto [outMin, outMax]. */
  levels(inMin: number, inMax: number, outMin = 0, outMax = 1): this {
    const span = inMax - inMin || 1
    for (let i = 0; i < this.data.length; i++) {
      this.data[i] = lerp(outMin, outMax, clamp01((this.data[i] - inMin) / span))
    }
    return this
  }

  smoothBand(a: number, b: number): this {
    return this.apply((v) => smoothstep(a, b, v))
  }

  /** Separable box blur with wraparound — cheap height softening. */
  blur(radius = 1): this {
    if (radius < 1) return this
    const r = Math.max(1, Math.round(radius))
    const w = this.w
    const h = this.h
    const tmp = new Float32Array(this.data.length)
    const d = this.data
    const wrap = (v: number, m: number) => ((v % m) + m) % m
    for (let y = 0; y < h; y++) {
      const row = y * w
      for (let x = 0; x < w; x++) {
        let sum = 0
        for (let k = -r; k <= r; k++) sum += d[row + wrap(x + k, w)]
        tmp[row + x] = sum / (2 * r + 1)
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0
        for (let k = -r; k <= r; k++) sum += tmp[wrap(y + k, h) * w + x]
        d[y * w + x] = sum / (2 * r + 1)
      }
    }
    return this
  }

  /** Offset a copy of this field on top of itself (tileable). */
  stamp(other: Field, offsetX: number, offsetY: number, scale = 1, mode: 'add' | 'mul' | 'max' = 'add'): this {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const o = other.at(x + offsetX, y + offsetY)
        const i = y * this.w + x
        if (mode === 'add') this.data[i] = clamp01(this.data[i] + o * scale)
        else if (mode === 'mul') this.data[i] = clamp01(this.data[i] * lerp(1, o, scale))
        else this.data[i] = Math.max(this.data[i], o * scale)
      }
    }
    return this
  }

  /** Filled rectangle in pixel space (wraps at the edges so textures tile). */
  rect(x0: number, y0: number, rw: number, rh: number, value: number, mode: 'set' | 'add' | 'mul' = 'set'): this {
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const i = this.idx(x0 + x, y0 + y)
        this.data[i] = mode === 'set' ? value : mode === 'add' ? clamp01(this.data[i] + value) : clamp01(this.data[i] * value)
      }
    }
    return this
  }

  /** Anti-aliased stroke between two points (pixel space, wraps). */
  line(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    width: number,
    value: number,
    mode: 'set' | 'add' | 'mul' = 'set',
  ): this {
    const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5))
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      this.dot(lerp(x0, x1, t), lerp(y0, y1, t), width, value, mode)
    }
    return this
  }

  /** Soft round brush. */
  dot(cx: number, cy: number, radius: number, value: number, mode: 'set' | 'add' | 'mul' = 'set'): this {
    const r = Math.max(1, Math.ceil(radius))
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const d = Math.hypot(x, y)
        if (d > radius) continue
        const falloff = smoothstep(radius, radius * 0.35, d)
        const i = this.idx(Math.round(cx + x), Math.round(cy + y))
        const add = value * falloff
        this.data[i] = mode === 'set' ? lerp(this.data[i], value, falloff) : mode === 'add' ? clamp01(this.data[i] + add) : clamp01(this.data[i] * lerp(1, value, falloff))
      }
    }
    return this
  }

  /** Soft ring — puddle rims, oil stains, water marks. */
  ring(cx: number, cy: number, radius: number, width: number, value: number): this {
    const r = Math.ceil(radius + width)
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const d = Math.hypot(x, y)
        const band = smoothstep(radius - width, radius, d) * (1 - smoothstep(radius, radius + width, d))
        if (band <= 0) continue
        const i = this.idx(Math.round(cx + x), Math.round(cy + y))
        this.data[i] = clamp01(this.data[i] + value * band)
      }
    }
    return this
  }

  /** Scatter `count` soft blobs — gravel, specks, moss, spalling. */
  speckle(seed: number, count: number, minR: number, maxR: number, value: number, mode: 'add' | 'mul' = 'add'): this {
    const rng = mulberry32(seed)
    for (let i = 0; i < count; i++) {
      this.dot(rng() * this.w, rng() * this.h, lerp(minR, maxR, rng() * rng()), value * (0.4 + rng() * 0.6), mode)
    }
    return this
  }

  /** Random-walk fractures with a soft taper — asphalt crazing, rock cracks. */
  cracks(seed: number, count: number, opts: { steps?: number; step?: number; width?: number; value?: number; wander?: number } = {}): this {
    const { steps = 14, step = 18, width = 1.4, value = 1, wander = 0.9 } = opts
    const rng = mulberry32(seed)
    for (let c = 0; c < count; c++) {
      let x = rng() * this.w
      let y = rng() * this.h
      let ang = rng() * Math.PI * 2
      for (let s = 0; s < steps; s++) {
        ang += (rng() - 0.5) * wander
        const nx = x + Math.cos(ang) * step
        const ny = y + Math.sin(ang) * step
        const w = width * (1 - s / steps) + 0.35
        this.line(x, y, nx, ny, w, value)
        // hairline branches
        if (rng() < 0.28 && s > 2) {
          const ba = ang + (rng() - 0.5) * 1.8
          this.line(nx, ny, nx + Math.cos(ba) * step * 1.2, ny + Math.sin(ba) * step * 1.2, w * 0.55, value)
        }
        x = nx
        y = ny
      }
    }
    return this
  }

  /** Periodic grid of grooves / joints. */
  grooves(spacing: number, width: number, value: number, axis: 'x' | 'y' | 'both' = 'both', offset = 0): this {
    const period = Math.max(2, Math.round(spacing))
    if (axis !== 'y') {
      for (let x = offset % period; x < this.w; x += period) this.rect(Math.round(x), 0, Math.max(1, Math.round(width)), this.h, value, 'set')
    }
    if (axis !== 'x') {
      for (let y = offset % period; y < this.h; y += period) this.rect(0, Math.round(y), this.w, Math.max(1, Math.round(width)), value, 'set')
    }
    return this
  }

  /** Repeating ribs (container corrugation, industrial cladding). */
  ribs(spacing: number, depth: number, axis: 'x' | 'y' = 'x'): this {
    const period = Math.max(3, Math.round(spacing))
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const t = ((axis === 'x' ? x : y) % period) / period
        const shape = Math.abs(Math.sin(t * Math.PI)) // rounded rib profile
        const i = y * this.w + x
        this.data[i] = clamp01(this.data[i] * (1 - depth) + shape * depth)
      }
    }
    return this
  }

  /** Any 1-D profile applied along u (or v) — road crowns, kerbs, dune ripples. */
  profile(axis: 'x' | 'y', fn: (t: number) => number, mix = 1): this {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const t = axis === 'x' ? x / this.w : y / this.h
        const i = y * this.w + x
        this.data[i] = clamp01(lerp(this.data[i], fn(t), mix))
      }
    }
    return this
  }

  /** Signed height for vertex displacement (returns values in [-1,1] * amp). */
  heightAt(u: number, v: number): number {
    return (this.at(Math.floor(u * this.w), Math.floor(v * this.h)) - 0.5) * 2
  }
}

/* ══════════════════════════════════════════════════════════════════════
 * Baking — Field ➜ three.js textures
 * ══════════════════════════════════════════════════════════════════════ */

type ColorFn = (v: number, x: number, y: number, u: number, vv: number) => [number, number, number]

function newTexture(w: number, h: number, data: Uint8Array, colorSpace: string, repeat?: number | [number, number]): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType)
  tex.colorSpace = colorSpace as THREE.ColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.flipY = false
  if (typeof repeat === 'number') tex.repeat.set(repeat, repeat)
  else if (repeat) tex.repeat.set(repeat[0], repeat[1])
  tex.anisotropy = 8
  tex.needsUpdate = true
  return tex
}

/** Bake a colour ramp: `colorFn` maps field value ➜ linear-ish sRGB colour. */
export function fieldToColorTexture(field: Field, colorFn: ColorFn, repeat?: number | [number, number]): THREE.DataTexture {
  const { w, h } = field
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const [r, g, b] = colorFn(field.data[i], x, y, x / w, y / h)
      out[i * 4] = clamp01(r) * 255
      out[i * 4 + 1] = clamp01(g) * 255
      out[i * 4 + 2] = clamp01(b) * 255
      out[i * 4 + 3] = 255
    }
  }
  return newTexture(w, h, out, THREE.SRGBColorSpace, repeat)
}

/** Bake a scalar field as a data map (roughness, AO, emissive mask, …). */
export function fieldToDataTexture(
  field: Field,
  opts: { repeat?: number | [number, number]; srgb?: boolean } = {},
): THREE.DataTexture {
  const { w, h } = field
  const out = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const v = clamp01(field.data[i]) * 255
    out[i * 4] = v
    out[i * 4 + 1] = v
    out[i * 4 + 2] = v
    out[i * 4 + 3] = 255
  }
  return newTexture(w, h, out, opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace, opts.repeat)
}

/** Pack occlusion / roughness / metalness into one ORM texture (R/G/B). */
export function packORM(
  ao: Field | null,
  roughness: Field,
  metalness: Field | null,
  repeat?: number | [number, number],
): THREE.DataTexture {
  const w = roughness.w
  const h = roughness.h
  const out = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = (ao ? clamp01(ao.data[i]) : 1) * 255
    out[i * 4 + 1] = clamp01(roughness.data[i]) * 255
    out[i * 4 + 2] = (metalness ? clamp01(metalness.data[i]) : 0) * 255
    out[i * 4 + 3] = 255
  }
  return newTexture(w, h, out, THREE.NoColorSpace, repeat)
}

export type NormalOptions = {
  /** Height units per texel — bigger = deeper dents. 1 is a good default. */
  strength?: number
  /** Set true if the source field is a *deep* pattern (pits, grooves). */
  invert?: boolean
}

/**
 * Tangent-space normal map from a height field.
 *
 * dH/du is taken along +u and dH/dv along +v; the surface normal is
 * `normalize(-dH/du, -dH/dv, 1)` which is the OpenGL/three.js convention
 * (green = +v). Wrapping neighbours are used so the map tiles seamlessly.
 */
export function fieldToNormalTexture(field: Field, opts: NormalOptions = {}, repeat?: number | [number, number]): THREE.DataTexture {
  const { w, h } = field
  const strength = (opts.strength ?? 1) * (opts.invert ? -1 : 1)
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = field.at(x - 1, y)
      const r = field.at(x + 1, y)
      const d = field.at(x, y - 1)
      const u = field.at(x, y + 1)
      let nx = -(r - l) * 0.5 * strength
      let ny = -(u - d) * 0.5 * strength
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1)
      nx *= inv
      ny *= inv
      const i = (y * w + x) * 4
      out[i] = (nx * 0.5 + 0.5) * 255
      out[i + 1] = (ny * 0.5 + 0.5) * 255
      out[i + 2] = (inv * 0.5 + 0.5) * 255
      out[i + 3] = 255
    }
  }
  return newTexture(w, h, out, THREE.NoColorSpace, repeat)
}

/**
 * Build all three maps for one surface in a single call and keep the texture
 * repeats in sync. `scale` is the texture repeat in world units (metres).
 */
export function bakeSurface(opts: {
  /** Colour ramp — receives the albedo field value plus pixel coords. */
  albedo: (v: number, x: number, y: number, u: number, vv: number) => [number, number, number]
  /** Height field driving the normal map. */
  height: Field
  /** Colour driver (defaults to the height field). */
  color?: Field
  ao?: Field | null
  roughness?: Field | null
  metalness?: Field | null
  normalStrength?: number
  /** Texture repeat (either a number or [u, v]). */
  repeat?: number | [number, number]
}): SurfaceMaps {
  const colorField = opts.color ?? opts.height
  const rough = opts.roughness ?? new Field(opts.height.w, opts.height.h).fill(0.6)
  const metal = opts.metalness ?? new Field(opts.height.w, opts.height.h).fill(0)
  const maps: SurfaceMaps = {
    map: fieldToColorTexture(colorField, opts.albedo, opts.repeat),
    normalMap: fieldToNormalTexture(opts.height, { strength: opts.normalStrength ?? 1 }, opts.repeat),
    ormMap: packORM(opts.ao ?? null, rough, metal, opts.repeat),
  }
  return maps
}

export type SurfaceMaps = {
  map: THREE.DataTexture
  normalMap: THREE.DataTexture
  ormMap: THREE.DataTexture
}

/** Per-frame anisotropic repeat helper: repeat = worldSize / tileSize. */
export function repeats(worldSize: number, tileSize: number): number {
  return Math.max(0.001, worldSize / tileSize)
}

/* ══════════════════════════════════════════════════════════════════════
 * Material cache — building a 512² PBR set costs ~20 ms, so a material that
 * has already been forged is reused (and never disposed) across scene swaps.
 * ══════════════════════════════════════════════════════════════════════ */

const MATERIAL_CACHE = new Map<string, unknown>()

export function cachedMaterial<T extends THREE.Material>(key: string, build: () => T): T {
  const hit = MATERIAL_CACHE.get(key)
  if (hit) return hit as T
  const mat = build()
  mat.userData.cached = true // disposeGroup() honours this flag
  MATERIAL_CACHE.set(key, mat)
  return mat
}

/**
 * Cache *any* derived object (a surface bundle of material + masks, a shared
 * geometry, …) by key. Same contract as `cachedMaterial`: build once, reuse
 * forever, never disposed by a scene swap.
 */
export function cachedValue<T>(key: string, build: () => T): T {
  const hit = MATERIAL_CACHE.get(key)
  if (hit) return hit as T
  const value = build()
  if (value instanceof THREE.Material || value instanceof THREE.Texture) {
    ;(value.userData as Record<string, unknown>).cached = true
  }
  MATERIAL_CACHE.set(key, value)
  return value
}

const TEXTURED_KEYS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'alphaMap',
  'aoMap',
  'bumpMap',
  'displacementMap',
  'clearcoatMap',
  'clearcoatNormalMap',
] as const

/**
 * Clone a (possibly shared) material and give every one of its maps its own
 * repeat — the fix for "one asphalt material, two plates of different sizes".
 *
 * The clones share the underlying `texture.source`, so three.js still uploads
 * each image exactly once; only the sampler state (repeat/offset) is per-mesh.
 * Clones are *not* flagged as cached, so `disposeGroup` frees them (and the
 * source survives because other users keep their reference counts).
 */
export function cloneMaterialWithRepeat<T extends THREE.Material>(material: T, repeat: number | [number, number]): T {
  const [ru, rv] = typeof repeat === 'number' ? [repeat, repeat] : repeat
  const clone = material.clone()
  // the clone owns its textures now — do not let it inherit the "shared" flag
  clone.userData = { ...material.userData, cached: false }
  const record = clone as unknown as Record<string, unknown>
  for (const key of TEXTURED_KEYS) {
    const tex = record[key] as THREE.Texture | undefined
    if (!tex) continue
    const cloned = tex.clone()
    cloned.repeat.set(ru, rv)
    cloned.wrapS = THREE.RepeatWrapping
    cloned.wrapT = THREE.RepeatWrapping
    cloned.needsUpdate = true
    record[key] = cloned
  }
  return clone as T
}

/** Free everything the cache holds (only used on full teardown). */
export function clearMaterialCache() {
  for (const value of MATERIAL_CACHE.values()) {
    if (value instanceof THREE.Material) {
      const m = value as THREE.Material & Record<string, unknown>
      for (const entry of Object.values(m)) {
        if (entry instanceof THREE.Texture) entry.dispose()
      }
      value.dispose()
    }
  }
  MATERIAL_CACHE.clear()
}
