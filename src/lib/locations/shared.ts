/**
 * ═════════════════════════════════════════════════════════════════════════
 * shared — the location scene toolkit
 * ═════════════════════════════════════════════════════════════════════════
 * Everything the seven locations have in common lives here: skies, terrain,
 * roads, foliage, street furniture, and the atmosphere systems (rain, snow,
 * dust, fog, volumetric shafts, smoke) that turn a pile of boxes into a place.
 *
 * Conventions (identical to the studio showroom):
 *   • the car sits at the origin, nose along +X, roof along +Y
 *   • ground level is y = 0
 *   • the scroll camera lives on the +Z side of the car between y 0.5 … 3.1,
 *     so the +Z half of the world is where detail pays off
 *
 * Design rules followed by every builder:
 *   • deterministic — one seed produces the same world for every visitor
 *   • zero image downloads — every map is noise or canvas-drawn at runtime
 *   • disposal-safe — geometry is always owned by the scene, materials that
 *     come from the shared cache are flagged and survive the teardown
 */

import * as THREE from 'three'
import {
  Field,
  cachedValue,
  clamp01,
  cloneMaterialWithRepeat,
  fieldToColorTexture,
  fieldToNormalTexture,
  lerp,
  mulberry32,
  smoothstep,
  type Rng,
} from '@/lib/procedural/field'
import { canvasTexture, haloTexture, makeCanvas, rainTexture, smokeTexture } from '@/lib/procedural/materials'

export type Ctx = {
  mobile: boolean
  /** texture resolution for hero surfaces (ground, road) */
  heroRes: number
  /** texture resolution for secondary props */
  propRes: number
}

export function makeCtx(mobile: boolean): Ctx {
  return {
    mobile,
    heroRes: mobile ? 256 : 1024,
    propRes: mobile ? 128 : 256,
  }
}

/** Collects per-frame callbacks so a scene can wire animation in one place. */
export class Ticks {
  private items: Array<(t: number, dt: number) => void> = []

  add(fn: (t: number, dt: number) => void): this {
    this.items.push(fn)
    return this
  }

  run = (t: number, dt: number) => {
    for (let i = 0; i < this.items.length; i++) this.items[i](t, dt)
  }
}

/* ══════════════════════════════════════════════════════════════════════
 * SKY — a full equirectangular dome painted with clouds, stars and haze.
 * The same texture is mirrored into scene.background *and* (PMREM'd) into
 * scene.environment, so the car's paint reflects the actual sky it is
 * parked under instead of a neutral studio probe.
 * ══════════════════════════════════════════════════════════════════════ */

export type SkyOptions = {
  seed?: number
  /** vertical gradient stops: 0 = zenith, 0.5 = horizon, 1 = nadir */
  stops: Array<[number, string]>
  sun?: { x: number; y: number; r: number; color: string; core?: string; halo?: number }
  moon?: { x: number; y: number; r: number }
  /** cloud cover 0..1, altitude 0..1, colour, optional its own seed */
  clouds?: { cover?: number; altitude?: number; color?: string; shadow?: string; softness?: number; seed?: number }
  stars?: { density?: number; brightness?: number }
  /** extra painter for far silhouettes (called with the horizon row) */
  silhouettes?: (ctx: CanvasRenderingContext2D, w: number, h: number, horizon: number) => void
  /** atmospheric haze band right above the horizon */
  haze?: { height?: number; color?: string }
  /** 0..1 — how much the horizon glow bleeds upward */
  bloom?: number
  width?: number
}

export function makeSky(o: SkyOptions): THREE.CanvasTexture {
  const w = o.width ?? (o.stars ? 2048 : 2048)
  const h = w / 2
  const [canvas, ctx] = makeCanvas(w, h)
  const horizon = h * 0.5

  // ── vertical gradient ────────────────────────────────────────────────
  const g = ctx.createLinearGradient(0, 0, 0, h)
  for (const [p, c] of o.stops) g.addColorStop(p, c)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  // ── stars (before the sun so they never outshine it) ─────────────────
  if (o.stars) {
    const density = o.stars.density ?? 0.0006
    const brightness = o.stars.brightness ?? 1
    const r = mulberry32(o.seed ?? 5)
    const count = Math.round(w * h * density * 0.5)
    for (let i = 0; i < count; i++) {
      const x = r() * w
      const y = r() * horizon * 0.92
      const fade = 1 - y / (horizon * 0.95) // fewer stars near the horizon
      const mag = Math.pow(r(), 2.4)
      const alpha = clamp01((0.15 + mag) * fade * brightness)
      const size = mag > 0.82 ? 2 : 1
      ctx.fillStyle = `rgba(${200 + Math.round(r() * 55)},${205 + Math.round(r() * 50)},255,${alpha})`
      ctx.fillRect(x, y, size, size)
    }
    // milky way band
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const band = ctx.createLinearGradient(0, horizon * 0.15, w, horizon * 0.75)
    band.addColorStop(0, 'rgba(80,90,140,0)')
    band.addColorStop(0.5, 'rgba(120,130,180,0.10)')
    band.addColorStop(1, 'rgba(80,90,140,0)')
    ctx.fillStyle = band
    ctx.fillRect(0, 0, w, horizon)
    ctx.restore()
  }

  // ── horizon haze band ────────────────────────────────────────────────
  if (o.haze) {
    const hh = (o.haze.height ?? 0.1) * h
    const hg = ctx.createLinearGradient(0, horizon - hh, 0, horizon + hh * 0.4)
    hg.addColorStop(0, 'rgba(255,255,255,0)')
    hg.addColorStop(1, o.haze.color ?? 'rgba(255,255,255,0.25)')
    ctx.fillStyle = hg
    ctx.fillRect(0, horizon - hh, w, hh * 1.4)
  }

  // ── sun / moon glow ──────────────────────────────────────────────────
  if (o.sun) {
    const sx = o.sun.x * w
    const sy = o.sun.y * h
    const r = o.sun.r * h
    const halo = o.sun.halo ?? 3.4
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * halo)
    sg.addColorStop(0, o.sun.core ?? 'rgba(255,255,255,0.95)')
    sg.addColorStop(0.1, o.sun.color)
    sg.addColorStop(0.35, o.sun.color.replace(/[\d.]+\)$/, '0.18)'))
    sg.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = sg
    ctx.fillRect(sx - r * halo, sy - r * halo, r * halo * 2, r * halo * 2)
    ctx.restore()
  }
  if (o.moon) {
    const mx = o.moon.x * w
    const my = o.moon.y * h
    const mr = o.moon.r * h
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const mg = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 5)
    mg.addColorStop(0, 'rgba(225,235,255,0.95)')
    mg.addColorStop(0.14, 'rgba(190,210,245,0.6)')
    mg.addColorStop(1, 'rgba(120,150,200,0)')
    ctx.fillStyle = mg
    ctx.fillRect(mx - mr * 5, my - mr * 5, mr * 10, mr * 10)
    // a couple of maria so it isn't a flat disc
    ctx.fillStyle = 'rgba(150,168,200,0.5)'
    ctx.beginPath()
    ctx.arc(mx - mr * 0.3, my + mr * 0.2, mr * 0.32, 0, Math.PI * 2)
    ctx.arc(mx + mr * 0.35, my - mr * 0.25, mr * 0.22, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // ── clouds: two fBm layers warped by a third, composited as soft bands ─
  if (o.clouds) {
    const cover = o.clouds.cover ?? 0.5
    const altitude = o.clouds.altitude ?? 0.42
    const color = o.clouds.color ?? '#ffffff'
    const shadow = o.clouds.shadow ?? '#8a93a8'
    const softness = o.clouds.softness ?? 1
    const cw = 512
    const chh = 256
    const base = new Field(cw, chh).fbm(o.clouds.seed ?? (o.seed ?? 17), { freq: 5, octaves: 5, gain: 0.55 })
    // stretch vertically so clouds read as a band near the horizon
    const stretched = new Field(cw, chh)
    for (let y = 0; y < chh; y++) {
      const src = Math.min(chh - 1, Math.round(Math.pow(y / chh, 0.62) * (chh - 1)))
      for (let x = 0; x < cw; x++) stretched.data[y * cw + x] = base.data[src * cw + x]
    }
    const detail = new Field(cw, chh).fbm((o.clouds.seed ?? (o.seed ?? 17)) + 5, { freq: 18, octaves: 4 })
    stretched.mul(detail, 0.55)

    const [cloudCanvas, cloudCtx] = makeCanvas(cw, chh)
    const img = cloudCtx.createImageData(cw, chh)
    for (let y = 0; y < chh; y++) {
      for (let x = 0; x < cw; x++) {
        const i = (y * cw + x) * 4
        const v = stretched.data[y * cw + x]
        const a = smoothstep(0.52 - cover * 0.3, 0.75, v) * 0.95
        const shade = lerp(0.5, 1, smoothstep(0.5, 0.86, v))
        const [r, g, b] = parseColor(mixHex(shadow, color, shade))
        img.data[i] = r * 255
        img.data[i + 1] = g * 255
        img.data[i + 2] = b * 255
        img.data[i + 3] = a * 255
      }
    }
    cloudCtx.putImageData(img, 0, 0)
    const top = horizon - h * altitude * 0.85
    const bottom = horizon + h * 0.03
    ctx.save()
    ctx.globalAlpha = 0.92
    ctx.drawImage(cloudCanvas, 0, 0, cw, chh, -w * 0.02, top, w * 1.04, bottom - top)
    ctx.globalAlpha = 1
    ctx.restore()
  }

  // ── horizon bloom bleed ──────────────────────────────────────────────
  if (o.bloom && o.bloom > 0) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const bg = ctx.createLinearGradient(0, horizon - h * 0.24 * o.bloom, 0, horizon)
    bg.addColorStop(0, 'rgba(255,240,220,0)')
    bg.addColorStop(1, `rgba(255,240,220,${0.16 * o.bloom})`)
    ctx.fillStyle = bg
    ctx.fillRect(0, horizon - h * 0.24 * o.bloom, w, h * 0.24 * o.bloom)
    ctx.restore()
  }

  // ── far silhouettes + ground falloff ────────────────────────────────
  o.silhouettes?.(ctx, w, h, horizon)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.anisotropy = 4
  return tex
}

/** An inside-out sky sphere. Sits inside the camera far plane (camera far = 160). */
export function skyDome(tex: THREE.Texture, radius = 130): THREE.Mesh {
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 48, 32),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }),
  )
  dome.renderOrder = -10
  dome.name = 'skyDome'
  return dome
}

function parseColor(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = parseColor(a)
  const [r2, g2, b2] = parseColor(b)
  const c = (x: number, y: number) => Math.round(lerp(x, y, clamp01(t)) * 255)
  return `#${[c(r1, r2), c(g1, g2), c(b1, b2)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/* ══════════════════════════════════════════════════════════════════════
 * GROUND — flat plates, displaced terrain
 * ══════════════════════════════════════════════════════════════════════ */

export function flatGround(opts: {
  radius?: number
  size?: number
  material: THREE.Material
  /** world size (m) covered by one texture tile */
  tile?: number
  y?: number
  circle?: boolean
  name?: string
}): THREE.Mesh {
  const { radius = 95, size = 200, material, tile = 4, y = 0, circle = true, name = 'ground' } = opts
  const geo = circle
    ? new THREE.CircleGeometry(radius, 96)
    : new THREE.PlaneGeometry(size, size)
  const uvSize = circle ? radius * 2 : size
  // a clone so this plate can tile its own way without disturbing the cache
  const mesh = new THREE.Mesh(geo, cloneMaterialWithRepeat(material, uvSize / tile))
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = y
  mesh.receiveShadow = true
  mesh.name = name
  return mesh
}

export type TerrainOptions = {
  size: number
  segments: number
  /** height in metres for a world x/z pair */
  height: (x: number, z: number) => number
  /** vertex colour for a world x/z pair + height + slope 0..1 */
  color: (x: number, z: number, y: number, slope: number) => THREE.Color
  material: THREE.Material
  /** world size (m) per texture tile */
  tile?: number
  receiveShadow?: boolean
}

/** A displaced, vertex-coloured landscape plate. */
export function terrain(opts: TerrainOptions): THREE.Mesh {
  const { size, segments, height, color, material, tile = 8 } = opts
  const geo = new THREE.PlaneGeometry(size, size, segments, segments)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = -pos.getY(i) // the plate is rotated −90° about X below
    const y = height(x, z)
    pos.setZ(i, y)
    colors[i * 3] = x
    colors[i * 3 + 1] = z
    colors[i * 3 + 2] = y
  }
  // normals from the displaced surface, then vertex colours from the slope
  geo.computeVertexNormals()
  const nrm = geo.attributes.normal as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = colors[i * 3]
    const z = colors[i * 3 + 1]
    const y = colors[i * 3 + 2]
    const slope = 1 - clamp01(nrm.getZ(i))
    c.copy(color(x, z, y, slope))
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const mesh = new THREE.Mesh(geo, cloneMaterialWithRepeat(material, size / tile))
  mesh.rotation.x = -Math.PI / 2
  mesh.receiveShadow = opts.receiveShadow ?? true
  mesh.name = 'terrain'
  return mesh
}

/* ══════════════════════════════════════════════════════════════════════
 * ROADS — straight strips and curved ribbons (expressways, alpine passes)
 * ══════════════════════════════════════════════════════════════════════ */

export type RibbonOptions = {
  /** centre-line points in world space (x, z); y comes from `yOf` */
  points: Array<[number, number]>
  width: number
  material: THREE.Material
  /** world size (m) per texture tile across the ribbon */
  tile?: number
  y?: number
  yOf?: (x: number, z: number) => number
  /** bank the outer edge by this many metres (superelevation) */
  camber?: number
  /**
   * Shift the whole ribbon sideways along its left normal (metres). Lets a
   * shoulder, snow bank or sand drift hug a road without re-authoring the
   * centre-line points.
   */
  offset?: number
  name?: string
}

/**
 * Builds a road/rail ribbon by sweeping a quad strip along a polyline. UVs run
 * with the ribbon (v along the road, u across it) so the texture stretches the
 * way real asphalt does — and the repeat is computed from the arc length, not
 * guessed, so lane markings never look squashed on a curve.
 */
export function ribbon(opts: RibbonOptions): THREE.Mesh {
  const { points, width, material, tile = 4, y = 0, camber = 0, offset = 0, name = 'ribbon' } = opts
  const yOf = opts.yOf ?? (() => 0)
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false,
    'catmullrom',
    0.35,
  )
  const segs = Math.max(24, Math.min(320, Math.round(curve.getLength() / 2.2)))
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const up = new THREE.Vector3(0, 1, 0)
  const tangent = new THREE.Vector3()
  const side = new THREE.Vector3()
  let travelled = 0
  const prev = new THREE.Vector3()
  for (let i = 0; i <= segs; i++) {
    const t = i / segs
    const p = curve.getPoint(t)
    curve.getTangent(t, tangent)
    tangent.y = 0
    tangent.normalize()
    side.crossVectors(up, tangent).normalize()
    if (i > 0) travelled += p.distanceTo(prev)
    prev.copy(p)
    const half = width / 2
    const left = p.clone().addScaledVector(side, half + offset)
    const right = p.clone().addScaledVector(side, -half + offset)
    positions.push(left.x, yOf(left.x, left.z) + y + camber, left.z)
    positions.push(right.x, yOf(right.x, right.z) + y, right.z)
    uvs.push(0, travelled / tile, 1, travelled / tile)
    if (i < segs) {
      const a = i * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  // u spans the ribbon width, v is arc length in metres
  const mesh = new THREE.Mesh(geo, cloneMaterialWithRepeat(material, [width / tile, 1]))
  mesh.receiveShadow = true
  mesh.name = name
  return mesh
}

/**
 * Lane markings painted onto a decal plate that follows a ribbon. Returned as
 * a separate transparent mesh so the asphalt below keeps its own material.
 */
export function roadMarkings(opts: {
  points: Array<[number, number]>
  width: number
  /** world metres per texture tile */
  tile: number
  lanes?: number
  y?: number
  dash?: boolean
}): THREE.Mesh {
  const { points, width, tile, lanes = 2, y = 0.012, dash = true } = opts
  const px = 1024
  const py = 512
  const [canvas, ctx] = makeCanvas(px, py)
  ctx.clearRect(0, 0, px, py)
  const metres = tile * (py / px) // vertical metres covered by the canvas
  const u = px / tile // px per metre across
  const v = py / metres // px per metre along
  void v
  const centre = px / 2
  // edge lines
  ctx.fillStyle = 'rgba(238,238,232,0.85)'
  ctx.fillRect(centre - (width / 2) * u + 3, 0, 5, py)
  ctx.fillRect(centre + (width / 2) * u - 8, 0, 5, py)
  // dashed lane dividers
  const laneW = width / lanes
  for (let l = 1; l < lanes; l++) {
    const x = centre - (width / 2) * u + laneW * l * u
    if (dash) {
      for (let yy = 0; yy < py; yy += 120) ctx.fillRect(x - 3, yy, 6, 56)
    } else {
      ctx.fillRect(x - 3, 0, 6, py)
    }
  }
  const tex = canvasTexture(canvas)
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.RepeatWrapping
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.92 })
  const mesh = ribbon({ points, width: width + 0.05, material: mat, tile, y, name: 'markings' })
  mat.map = tex
  mesh.renderOrder = 2
  return mesh
}

/* ══════════════════════════════════════════════════════════════════════
 * SOFT OBJECTS — glow sprites, fog banks, light shafts
 * ══════════════════════════════════════════════════════════════════════ */

export function glowSprite(color: number, size: number, opacity = 0.8, tex?: THREE.Texture): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex ?? haloTexture(),
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  )
  sprite.scale.setScalar(size)
  return sprite
}

/** A god-ray / lamp shaft: a cone of additive haze with a soft vertical falloff. */
export function lightShaft(opts: {
  height: number
  radiusTop: number
  radiusBottom: number
  color: number
  opacity?: number
  segments?: number
}): THREE.Mesh {
  const { height, radiusTop, radiusBottom, color, opacity = 0.22, segments = 24 } = opts
  const [canvas, ctx] = makeCanvas(8, 128)
  const g = ctx.createLinearGradient(0, 0, 0, 128)
  g.addColorStop(0, 'rgba(255,255,255,0.95)')
  g.addColorStop(0.45, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 8, 128)
  const tex = canvasTexture(canvas, { srgb: false })
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  })
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1, true), mat)
  mesh.position.y = height / 2
  mesh.name = 'lightShaft'
  return mesh
}

export type FogBankOptions = {
  count?: number
  area?: number
  y?: number
  color?: number
  size?: number
  opacity?: number
  speed?: number
}

/** Drifting ground fog — flat soft quads that slide across the floor. */
export function fogBank(opts: FogBankOptions = {}): THREE.Group {
  const { count = 14, area = 90, y = 1.1, color = 0xbfc7d6, size = 34, opacity = 0.12, speed = 0.35 } = opts
  const group = new THREE.Group()
  const tex = smokeTexture(23)
  const rng = mulberry32(303)
  const quads: THREE.Mesh[] = []
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    fog: true,
  })
  for (let i = 0; i < count; i++) {
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.45), mat)
    quad.rotation.x = -Math.PI / 2
    quad.position.set((rng() - 0.5) * area, y + rng() * 2.4, (rng() - 0.5) * area)
    quad.userData.speed = speed * (0.5 + rng())
    quad.userData.phase = rng() * 100
    group.add(quad)
    quads.push(quad)
  }
  group.name = 'fogBank'
  group.userData.tick = (t: number) => {
    for (let i = 0; i < quads.length; i++) {
      const q = quads[i]
      const s = q.userData.speed as number
      const ph = q.userData.phase as number
      q.position.x += Math.sin(t * 0.07 + ph) * 0.004 * s * 60
      q.position.z += Math.cos(t * 0.05 + ph * 1.3) * 0.003 * s * 60
      const m = q.material as THREE.MeshBasicMaterial
      m.opacity = opacity * (0.7 + Math.sin(t * 0.25 + ph) * 0.28)
      q.scale.setScalar(0.9 + Math.sin(t * 0.11 + ph) * 0.12)
    }
  }
  return group
}

/* ══════════════════════════════════════════════════════════════════════
 * PARTICLES — rain, snow, dust, embers
 * ══════════════════════════════════════════════════════════════════════ */

export type RainOptions = {
  count?: number
  area?: number
  height?: number
  speed?: number
  wind?: number
  color?: number
  opacity?: number
  /** streak length in metres */
  length?: number
  /** camera position provider, for billboarding */
  camera?: () => THREE.Camera
}

/**
 * Rain as CPU-stepped billboards. Points can't be stretched into streaks, so
 * each drop is a thin quad kept facing the camera — the whole field shares one
 * yaw per frame (the camera barely moves between frames), which keeps the cost
 * at one matrix compose per drop.
 */
export function rainSystem(opts: RainOptions = {}): { group: THREE.Group; tick: (t: number, dt: number) => void } {
  const {
    count = 900,
    area = 120,
    height = 24,
    speed = 17,
    wind = 1.6,
    color = 0xa9c6e8,
    opacity = 0.32,
    length = 1.6,
    camera,
  } = opts
  const geo = new THREE.PlaneGeometry(1, 1)
  const mat = new THREE.MeshBasicMaterial({
    map: rainTexture(),
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  })
  const mesh = new THREE.InstancedMesh(geo, mat, count)
  mesh.frustumCulled = false
  mesh.name = 'rain'

  const rng = mulberry32(919)
  const px = new Float32Array(count)
  const pz = new Float32Array(count)
  const py = new Float32Array(count)
  const vy = new Float32Array(count)
  const stretch = new Float32Array(count)
  const m = new THREE.Matrix4()
  const p = new THREE.Vector3()
  const scaleVec = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const euler = new THREE.Euler()
  for (let i = 0; i < count; i++) {
    px[i] = (rng() - 0.5) * area
    pz[i] = (rng() - 0.5) * area
    py[i] = rng() * height
    vy[i] = speed * (0.75 + rng() * 0.5)
    stretch[i] = length * (0.65 + rng() * 0.7)
  }

  const group = new THREE.Group()
  group.name = 'rainSystem'
  group.add(mesh)

  // One shared orientation per frame: face the camera, then lean into the wind.
  const tick = (t: number, dt: number) => {
    const cam = camera?.()
    const yaw = cam ? Math.atan2(cam.position.x, cam.position.z) : 0
    euler.set(0, yaw, -0.14, 'YXZ')
    q.setFromEuler(euler)
    const step = Math.min(0.05, dt)
    for (let i = 0; i < count; i++) {
      py[i] -= vy[i] * step
      if (py[i] < 0) py[i] += height
      px[i] += wind * step
      if (px[i] > area / 2) px[i] -= area
      if (px[i] < -area / 2) px[i] += area
      p.set(px[i] + Math.sin(t * 0.6 + i) * 0.25, py[i], pz[i])
      scaleVec.set(0.035, stretch[i], 1)
      m.compose(p, q, scaleVec)
      mesh.setMatrixAt(i, m)
    }
    mesh.instanceMatrix.needsUpdate = true
  }
  return { group, tick }
}

export type SnowOptions = { count?: number; area?: number; height?: number; size?: number; color?: number; opacity?: number }

/** Snow / ash / floating dust — soft round points with lazy drift. */
export function snowSystem(opts: SnowOptions = {}): { points: THREE.Points; tick: (t: number, dt: number) => void } {
  const { count = 1400, area = 140, height = 30, size = 0.16, color = 0xffffff, opacity = 0.85 } = opts
  const geo = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)
  const rng = mulberry32(77)
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (rng() - 0.5) * area
    positions[i * 3 + 1] = rng() * height
    positions[i * 3 + 2] = (rng() - 0.5) * area
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const mat = new THREE.PointsMaterial({
    map: smokeTexture(3),
    color,
    size,
    sizeAttenuation: true,
    transparent: true,
    opacity,
    depthWrite: false,
    alphaTest: 0.02,
    blending: THREE.NormalBlending,
    fog: true,
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  points.name = 'snow'
  const speeds = new Float32Array(count)
  for (let i = 0; i < count; i++) speeds[i] = 0.5 + rng() * 1.6
  const tick = (t: number, dt: number) => {
    const step = Math.min(0.05, dt)
    const pos = geo.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    for (let i = 0; i < count; i++) {
      const iy = i * 3 + 1
      arr[iy] -= speeds[i] * step
      arr[i * 3] += Math.sin(t * 0.6 + i * 0.7) * 0.006 + step * 0.35
      arr[i * 3 + 2] += Math.cos(t * 0.45 + i * 0.3) * 0.005
      if (arr[iy] < 0) arr[iy] += height
      if (arr[i * 3] > area / 2) arr[i * 3] -= area
      if (arr[i * 3 + 2] > area / 2) arr[i * 3 + 2] -= area
    }
    pos.needsUpdate = true
  }
  return { points, tick }
}

/** Warm drifting motes — dust in a light shaft, sparks off a grinder. */
export function motes(opts: { count?: number; area?: number; height?: number; color?: number; size?: number; opacity?: number } = {}): { points: THREE.Points; tick: (t: number, dt: number) => void } {
  const { count = 260, area = 34, height = 8, color = 0xffd9a0, size = 0.07, opacity = 0.6 } = opts
  const geo = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)
  const rng = mulberry32(51)
  const phases = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (rng() - 0.5) * area
    positions[i * 3 + 1] = rng() * height
    positions[i * 3 + 2] = (rng() - 0.5) * area
    phases[i] = rng() * Math.PI * 2
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const mat = new THREE.PointsMaterial({
    map: haloTexture(),
    color,
    size,
    sizeAttenuation: true,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  points.name = 'motes'
  const base = positions.slice()
  const tick = (t: number) => {
    const arr = geo.attributes.position.array as Float32Array
    for (let i = 0; i < count; i++) {
      const ph = phases[i]
      arr[i * 3] = base[i * 3] + Math.sin(t * 0.21 + ph) * 1.1
      arr[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 0.13 + ph * 2) * 0.5
      arr[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.17 + ph) * 1.1
    }
    geo.attributes.position.needsUpdate = true
  }
  return { points, tick }
}

/** A rising smoke/steam plume built from a small pool of billboards. */
export function smokePlume(opts: { position: THREE.Vector3; color?: number; scale?: number; rate?: number; opacity?: number }): THREE.Group {
  const { position, color = 0x9aa3ad, scale = 1, rate = 1, opacity = 0.3 } = opts
  const group = new THREE.Group()
  group.position.copy(position)
  const count = 16
  const tex = smokeTexture(11)
  const rng = mulberry32(171)
  const puffs: Array<{ sprite: THREE.Sprite; life: number; speed: number; drift: THREE.Vector3 }> = []
  for (let i = 0; i < count; i++) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity: 0, depthWrite: false, fog: true }),
    )
    sprite.scale.setScalar(scale * (2 + rng() * 2))
    group.add(sprite)
    puffs.push({
      sprite,
      life: rng(),
      speed: (0.7 + rng() * 0.7) * rate,
      drift: new THREE.Vector3((rng() - 0.5) * 0.5, 0, (rng() - 0.5) * 0.5),
    })
  }
  group.userData.tick = (t: number, dt: number) => {
    for (const puff of puffs) {
      puff.life += dt * puff.speed * 0.16
      if (puff.life > 1) puff.life -= 1
      const k = puff.life
      puff.sprite.position.set(puff.drift.x * k * 6 + Math.sin(t * 0.3 + k * 6) * 0.4, k * scale * 9, puff.drift.z * k * 6)
      puff.sprite.scale.setScalar(scale * (1.4 + k * 5.5))
      const mat = puff.sprite.material as THREE.SpriteMaterial
      mat.opacity = opacity * Math.sin(k * Math.PI) * (1 - k * 0.35)
      mat.rotation = k * 0.6
    }
  }
  return group
}

/* ══════════════════════════════════════════════════════════════════════
 * FOLIAGE
 * ══════════════════════════════════════════════════════════════════════ */

export type TreeMaterials = { trunk: THREE.Material; foliage: THREE.Material }

/** Low-poly conifer: tapered trunk + stacked cones with a jittered spin. */
export function conifer(rng: Rng, mats: TreeMaterials, height = 6): THREE.Group {
  const g = new THREE.Group()
  const h = height * (0.75 + rng() * 0.5)
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.018, h * 0.032, h * 0.34, 6), mats.trunk)
  trunk.position.y = h * 0.17
  g.add(trunk)
  const layers = 3 + Math.floor(rng() * 3)
  for (let i = 0; i < layers; i++) {
    const t = i / layers
    const r = h * (0.2 - t * 0.1) * (0.85 + rng() * 0.3)
    const lh = h * (0.34 - t * 0.06)
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, lh, 7), mats.foliage)
    cone.position.y = h * (0.22 + t * 0.24) + lh * 0.35
    cone.rotation.y = rng() * Math.PI
    cone.castShadow = true
    g.add(cone)
  }
  return g
}

/** Broadleaf tree: trunk + a few overlapping icosahedron canopies. */
export function broadleaf(rng: Rng, mats: TreeMaterials, height = 7): THREE.Group {
  const g = new THREE.Group()
  const h = height * (0.8 + rng() * 0.5)
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.02, h * 0.045, h * 0.5, 7), mats.trunk)
  trunk.position.y = h * 0.25
  trunk.rotation.z = (rng() - 0.5) * 0.12
  g.add(trunk)
  const clumps = 4 + Math.floor(rng() * 3)
  for (let i = 0; i < clumps; i++) {
    const r = h * (0.16 + rng() * 0.14)
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mats.foliage)
    blob.position.set((rng() - 0.5) * h * 0.3, h * (0.55 + rng() * 0.3), (rng() - 0.5) * h * 0.3)
    blob.rotation.set(rng() * 3, rng() * 3, rng() * 3)
    blob.castShadow = true
    g.add(blob)
  }
  return g
}

/** Palm: leaning trunk + drooping fronds made from bent planes. */
export function palm(rng: Rng, opts: { trunk: THREE.Material; frond: THREE.Material; height?: number }): THREE.Group {
  const { trunk, frond, height = 8 } = opts
  const g = new THREE.Group()
  const h = height * (0.8 + rng() * 0.45)
  const segments = 7
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    pts.push(new THREE.Vector3(Math.sin(t * 1.1) * h * 0.09, t * h, Math.sin(t * 0.7) * h * 0.03))
  }
  const curve = new THREE.CatmullRomCurve3(pts)
  const trunkMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, h * 0.024, 7, false), trunk)
  trunkMesh.castShadow = true
  g.add(trunkMesh)
  const top = curve.getPoint(1)
  const crowns = 9 + Math.floor(rng() * 4)
  for (let i = 0; i < crowns; i++) {
    const ang = (i / crowns) * Math.PI * 2 + rng() * 0.2
    const len = h * (0.36 + rng() * 0.16)
    const frondGeo = new THREE.PlaneGeometry(len, len * 0.22, 6, 1)
    const pos = frondGeo.attributes.position as THREE.BufferAttribute
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v)
      const t = x / len + 0.5
      pos.setZ(v, -Math.pow(t, 2) * len * 0.42) // droop
      pos.setY(v, pos.getY(v) * (1 - t * 0.55)) // taper
    }
    frondGeo.computeVertexNormals()
    const leaf = new THREE.Mesh(frondGeo, frond)
    leaf.position.copy(top)
    leaf.rotation.y = ang
    leaf.rotation.z = -0.32
    leaf.translateX(len * 0.42)
    leaf.castShadow = true
    g.add(leaf)
  }
  return g
}

/* ══════════════════════════════════════════════════════════════════════
 * STREET FURNITURE + ARCHITECTURE
 * ══════════════════════════════════════════════════════════════════════ */

/** Armco guardrail: W-profile beam swept along X with posts and reflectors. */
export function guardRail(opts: {
  length: number
  spacing?: number
  z?: number
  x?: number
  metal: THREE.Material
  post?: THREE.Material
  reflector?: THREE.Material
  height?: number
  curveAt?: (x: number) => number
}): THREE.Group {
  const { length, spacing = 4, z = 0, x = 0, metal, height = 0.75 } = opts
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  const postMat = opts.post ?? metal
  const reflectorMat = opts.reflector ?? metal
  const shape = new THREE.Shape()
  // a W-beam cross-section in the local (y, thickness) plane
  const prof: Array<[number, number]> = [
    [0.02, 0.0],
    [0.06, 0.035],
    [0.02, 0.075],
    [-0.05, 0.115],
    [-0.05, 0.15],
    [0.02, 0.19],
    [0.06, 0.225],
    [0.02, 0.26],
    [-0.03, 0.26],
    [-0.03, 0.0],
  ]
  shape.moveTo(prof[0][0], prof[0][1])
  for (let i = 1; i < prof.length; i++) shape.lineTo(prof[i][0], prof[i][1])
  shape.closePath()
  const beamGeo = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, curveSegments: 1 })
  beamGeo.rotateY(Math.PI / 2) // extrude along +X
  beamGeo.translate(-length / 2, 0, 0)
  const beam = new THREE.Mesh(beamGeo, metal)
  beam.position.y = height
  beam.castShadow = true
  group.add(beam)

  const postGeo = new THREE.BoxGeometry(0.12, height + 0.22, 0.14)
  const posts = Math.max(2, Math.round(length / spacing))
  for (let i = 0; i <= posts; i++) {
    const px = -length / 2 + (length / posts) * i
    const post = new THREE.Mesh(postGeo, postMat)
    post.position.set(px, (height + 0.22) / 2, 0)
    post.castShadow = true
    group.add(post)
    const refl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.03), reflectorMat)
    refl.position.set(px, height + 0.3, -0.09)
    group.add(refl)
  }
  group.name = 'guardRail'
  return group
}

/** Roadside lamp post with a curved arm, emissive head and a soft halo. */
export function lampPost(opts: { height?: number; arm?: number; color?: number; intensity?: number; metal: THREE.Material; castShadow?: boolean }): THREE.Group {
  const { height = 8, arm = 1.6, color = 0xffd9a8, intensity = 1, metal } = opts
  const group = new THREE.Group()
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, height, 10), metal)
  pole.position.y = height / 2
  pole.castShadow = opts.castShadow ?? true
  group.add(pole)
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.3, 10), metal)
  base.position.y = 0.15
  group.add(base)
  const armCurve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, height - 0.2, 0),
    new THREE.Vector3(0, height + 0.5, arm * 0.55),
    new THREE.Vector3(arm, height + 0.35, arm),
  )
  const armMesh = new THREE.Mesh(new THREE.TubeGeometry(armCurve, 12, 0.06, 8, false), metal)
  group.add(armMesh)
  // head
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.14, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.6 }),
  )
  head.position.set(arm + 0.1, height + 0.28, 0)
  head.rotation.z = -0.18
  group.add(head)
  const lens = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.22),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }),
  )
  lens.rotation.x = Math.PI / 2
  lens.position.set(arm + 0.1, height + 0.2, 0)
  group.add(lens)
  const halo = glowSprite(color, 3.4, 0.5)
  halo.position.set(arm + 0.1, height + 0.1, 0)
  group.add(halo)
  const shaft = lightShaft({ height: height * 0.82, radiusTop: 0.6, radiusBottom: 5.2, color, opacity: 0.085 * intensity })
  shaft.position.x = arm + 0.2
  shaft.position.z = 0
  shaft.position.y = height * 0.59 + 0.2
  shaft.rotation.z = -0.1
  group.add(shaft)
  group.name = 'lampPost'
  return group
}

/** Floodlight mast — four-head lamp with halos, used for pit lanes & stadiums. */
export function floodMast(opts: { height?: number; color?: number; metal: THREE.Material; heads?: number }): { group: THREE.Group; halos: THREE.Sprite[] } {
  const { height = 14, color = 0xfff0cf, metal, heads = 4 } = opts
  const group = new THREE.Group()
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.26, height, 10), metal)
  pole.position.y = height / 2
  pole.castShadow = true
  group.add(pole)
  // lattice cross bracing on the lower half
  for (let i = 0; i < 6; i++) {
    const y = 1 + i * (height * 0.36) / 6
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.9), metal)
    brace.position.set(0, y, 0)
    brace.rotation.x = i % 2 === 0 ? 0.6 : -0.6
    group.add(brace)
  }
  const rig = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 2.6), metal)
  rig.position.y = height + 0.1
  group.add(rig)
  const halos: THREE.Sprite[] = []
  for (let i = 0; i < heads; i++) {
    const t = heads === 1 ? 0.5 : i / (heads - 1)
    const z = lerp(-1.05, 1.05, t)
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.34, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.4, metalness: 0.7, emissive: new THREE.Color(color), emissiveIntensity: 0.9 }),
    )
    lamp.position.set(-0.22, height + 0.22, z)
    group.add(lamp)
    const halo = glowSprite(color, 4.4, 0.62)
    halo.position.set(-0.36, height + 0.2, z)
    halos.push(halo)
    group.add(halo)
  }
  group.name = 'floodMast'
  return { group, halos }
}

/** Lattice pylon / crane leg: instanced struts, no external assets. */
export function trussTower(opts: { height?: number; width?: number; metal: THREE.Material; color?: number; beacon?: boolean }): THREE.Group {
  const { height = 30, width = 2.4, metal, beacon = true } = opts
  const group = new THREE.Group()
  const legGeo = new THREE.BoxGeometry(0.16, height, 0.16)
  const offset = width / 2
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const leg = new THREE.Mesh(legGeo, metal)
    leg.position.set(sx * offset, height / 2, sz * offset)
    group.add(leg)
  }
  const bays = Math.max(3, Math.round(height / 3))
  const braceGeo = new THREE.BoxGeometry(0.08, 0.08, Math.hypot(width, width))
  for (let i = 0; i < bays; i++) {
    const y = (height / bays) * (i + 0.5)
    for (let s = 0; s < 4; s++) {
      const brace = new THREE.Mesh(braceGeo, metal)
      brace.position.set(0, y, 0)
      brace.rotation.y = (s * Math.PI) / 2
      brace.rotation.x = i % 2 === 0 ? 0.75 : -0.75
      if (s % 2 === 1) brace.position.x = s === 1 ? offset : -offset
      else brace.position.z = s === 0 ? offset : -offset
      group.add(brace)
    }
    const ring = new THREE.Mesh(new THREE.BoxGeometry(width, 0.1, 0.1), metal)
    ring.position.y = y + height / bays / 2
    group.add(ring)
  }
  if (beacon) {
    const red = glowSprite(0xff3b30, 2.4, 0.8)
    red.position.y = height + 0.4
    group.add(red)
    group.userData.beacon = red
  }
  group.name = 'trussTower'
  return group
}

/** Chain-link fence panel with alpha-tested wire texture. */
export function chainFence(opts: { length: number; height?: number; metal: THREE.Material; postSpacing?: number }): THREE.Group {
  const { length, height = 2.4, metal, postSpacing = 3 } = opts
  const group = new THREE.Group()
  const wire = cachedValue('chainfence-texture', () => {
    const [canvas, ctx] = makeCanvas(128, 128)
    ctx.clearRect(0, 0, 128, 128)
    ctx.strokeStyle = 'rgba(190,196,205,0.9)'
    ctx.lineWidth = 2
    for (let i = -4; i < 9; i++) {
      ctx.beginPath()
      ctx.moveTo(i * 16, 0)
      ctx.lineTo(i * 16 + 64, 128)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(i * 16 + 64, 0)
      ctx.lineTo(i * 16, 128)
      ctx.stroke()
    }
    const tex = canvasTexture(canvas)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    return tex
  })
  const mat = new THREE.MeshStandardMaterial({
    map: wire,
    transparent: true,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    metalness: 0.7,
    roughness: 0.45,
    color: 0xd7dde6,
  })
  wire.repeat.set(length / 2.4, height / 2.4)
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(length, height), mat)
  panel.position.y = height / 2
  group.add(panel)
  const postGeo = new THREE.CylinderGeometry(0.055, 0.055, height + 0.15, 8)
  const count = Math.max(2, Math.round(length / postSpacing))
  for (let i = 0; i <= count; i++) {
    const post = new THREE.Mesh(postGeo, metal)
    post.position.set(-length / 2 + (length / count) * i, (height + 0.15) / 2, 0)
    group.add(post)
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.06, 0.06), metal)
  rail.position.set(0, height, 0)
  group.add(rail)
  group.name = 'chainFence'
  return group
}

/** Slack catenary (power line, mooring rope, zipline). */
export function catenary(from: THREE.Vector3, to: THREE.Vector3, sag: number, radius: number, material: THREE.Material): THREE.Mesh {
  const mid = from.clone().lerp(to, 0.5)
  mid.y -= sag
  const curve = new THREE.QuadraticBezierCurve3(from, mid, to)
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 18, radius, 5, false), material)
  mesh.name = 'catenary'
  return mesh
}

/** A block building with a lit facade, roof parapet and optional neon sign. */
export function buildingBox(opts: {
  w: number
  h: number
  d: number
  material: THREE.Material
  roof?: THREE.Material
  /** emissive strip colour for a rooftop sign band */
  signColor?: number
  signTexture?: THREE.Texture
}): THREE.Group {
  const { w, h, d, material, roof } = opts
  const group = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  body.position.y = h / 2
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)
  if (roof) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w * 1.03, 0.3, d * 1.03), roof)
    slab.position.y = h + 0.15
    group.add(slab)
    const parapet = new THREE.Mesh(new THREE.BoxGeometry(w * 1.03, 0.7, 0.16), roof)
    parapet.position.set(0, h + 0.5, d / 2)
    group.add(parapet)
    const parapet2 = parapet.clone()
    parapet2.position.z = -d / 2
    group.add(parapet2)
    const ac = new THREE.Mesh(new THREE.BoxGeometry(w * 0.18, 0.7, d * 0.2), roof)
    ac.position.set(w * 0.2, h + 0.6, -d * 0.2)
    group.add(ac)
  }
  if (opts.signTexture && opts.signColor) {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.62, Math.min(2.2, h * 0.14)),
      new THREE.MeshStandardMaterial({
        map: opts.signTexture,
        emissiveMap: opts.signTexture,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 1.5,
        roughness: 0.4,
      }),
    )
    sign.position.set(0, h * 0.72, d / 2 + 0.02)
    group.add(sign)
  }
  group.name = 'building'
  return group
}


/**
 * Scatter soft reflective puddles wherever the asphalt's own puddle mask says
 * water would gather — the decals share the wetness pattern of the ground they
 * sit on, so they never look sprinkled on at random.
 */
export function puddleField(
  mask: Field,
  opts: { count?: number; area?: number; min?: number; max?: number; threshold?: number; y?: number; seed?: number },
): THREE.Group {
  const { count = 22, area = 44, min = 0.9, max = 3.4, threshold = 0.42, y = 0.014, seed = 5 } = opts
  const group = new THREE.Group()
  group.name = 'puddles'
  const rng = mulberry32(seed)
  let placed = 0
  for (let attempt = 0; attempt < count * 24 && placed < count; attempt++) {
    const u = rng()
    const v = rng()
    const value = mask.at(Math.floor(u * mask.w), Math.floor(v * mask.h))
    if (value < threshold) continue
    const radius = lerp(min, max, clamp01((value - threshold) / (1 - threshold)))
    const mesh = puddle({ radius })
    mesh.position.set((u - 0.5) * area, y, (v - 0.5) * area)
    mesh.rotation.z = rng() * Math.PI * 2
    group.add(mesh)
    placed++
  }
  return group
}

/**
 * A deliberately simple silhouette car used for traffic: something to carry
 * headlights and taillights past the hero car without stealing the frame.
 */
export function simpleCar(opts: { body: number; headlight?: number; taillight?: number; scale?: number; glow?: boolean }): THREE.Group {
  const { body, headlight = 0xfff4d6, taillight = 0xff2b1a, scale = 1, glow = true } = opts
  const group = new THREE.Group()
  const paint = new THREE.MeshStandardMaterial({ color: body, roughness: 0.28, metalness: 0.6, envMapIntensity: 1.2 })
  const glass = new THREE.MeshStandardMaterial({ color: 0x0a0f16, roughness: 0.12, metalness: 0.5, envMapIntensity: 1.6 })
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.92 })
  const lower = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.55, 1.86), paint)
  lower.position.y = 0.62
  group.add(lower)
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 1.7), paint)
  hood.position.set(1.45, 0.95, 0)
  group.add(hood)
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.62, 1.6), glass)
  cabin.position.set(-0.15, 1.18, 0)
  group.add(cabin)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 1.5), paint)
  roof.position.set(-0.25, 1.52, 0)
  group.add(roof)
  for (const [x, z] of [
    [1.35, 0.82],
    [1.35, -0.82],
    [-1.35, 0.82],
    [-1.35, -0.82],
  ]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12), rubber)
    wheel.rotation.x = Math.PI / 2
    wheel.position.set(x, 0.34, z)
    group.add(wheel)
  }
  const headMat = new THREE.MeshBasicMaterial({ color: headlight })
  const tailMat = new THREE.MeshBasicMaterial({ color: taillight })
  for (const z of [-0.66, 0.66]) {
    const lamp = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.16), headMat)
    lamp.position.set(2.16, 0.82, z)
    lamp.rotation.y = Math.PI / 2
    group.add(lamp)
    const tail = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.14), tailMat)
    tail.position.set(-2.16, 0.86, z)
    tail.rotation.y = -Math.PI / 2
    group.add(tail)
  }
  if (glow) {
    for (const z of [-0.66, 0.66]) {
      const h = glowSprite(headlight, 3.6, 0.55)
      h.position.set(2.5, 0.8, z)
      group.add(h)
      const t = glowSprite(taillight, 2.4, 0.45)
      t.position.set(-2.4, 0.85, z)
      group.add(t)
    }
  }
  group.scale.setScalar(scale)
  group.name = 'trafficCar'
  return group
}

/** Grandstand seating: stepped rows with a roof, railings and floodlight strips. */
export function grandstand(opts: {
  length: number
  rows?: number
  seat?: THREE.Material
  structure?: THREE.Material
  roof?: THREE.Material
  step?: number
}): THREE.Group {
  const { length, rows = 9, seat, structure, roof, step = 0.92 } = opts
  const group = new THREE.Group()
  for (let i = 0; i < rows; i++) {
    const tier = new THREE.Mesh(new THREE.BoxGeometry(length, 0.9, 1.9), structure!)
    tier.position.set(0, 0.45 + i * step, i * 1.9)
    tier.receiveShadow = true
    group.add(tier)
    if (seat) {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(length * 0.98, 0.14, 0.42), seat)
      bench.position.set(0, 0.97 + i * step, i * 1.9 - 0.6)
      group.add(bench)
    }
    // row-front railing every third tier
    if (i % 3 === 0) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.06, 0.06), structure!)
      rail.position.set(0, 1.6 + i * step, i * 1.9 - 0.95)
      group.add(rail)
    }
  }
  const depth = rows * 1.9
  if (roof) {
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(length * 1.02, 0.28, depth * 1.25), roof)
    canopy.position.set(0, rows * step + 3.4, depth * 0.4)
    canopy.castShadow = true
    group.add(canopy)
    for (let x = -length / 2; x <= length / 2; x += length / 6) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.22, rows * step + 3.4, 0.22), structure!)
      pillar.position.set(x, (rows * step + 3.4) / 2, depth * 0.94)
      group.add(pillar)
    }
  }
  group.name = 'grandstand'
  return group
}

/* ══════════════════════════════════════════════════════════════════════
 * WET-WEATHER DECALS
 * ══════════════════════════════════════════════════════════════════════ */

/** A soft-edged reflective puddle. Uses the scene environment for the mirror. */
export function puddle(opts: { radius: number; color?: number; opacity?: number; seed?: number }): THREE.Mesh {
  const { radius, color = 0x0b1015, opacity = 0.9 } = opts
  const tex = cachedValue('puddle-alpha', () => {
    const [canvas, ctx] = makeCanvas(128, 128)
    const f = new Field(64, 64).fbm(9, { freq: 4, octaves: 4 })
    const img = ctx.createImageData(128, 128)
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const n = f.at(Math.floor((x / 128) * 64), Math.floor((y / 128) * 64))
        const dx = x / 128 - 0.5
        const dy = y / 128 - 0.5
        const r = Math.hypot(dx, dy) * 2
        const edge = 1 - smoothstep(0.68, 1, r)
        const a = clamp01((n * 0.8 + 0.5) * edge * 1.35)
        const i = (y * 128 + x) * 4
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
        img.data[i + 3] = a * 255
      }
    }
    ctx.putImageData(img, 0, 0)
    return canvasTexture(canvas, { srgb: false })
  })
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.03,
    metalness: 0.65,
    transparent: true,
    opacity,
    alphaMap: tex,
    envMapIntensity: 2.2,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  })
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0.014
  mesh.renderOrder = 1
  mesh.name = 'puddle'
  return mesh
}

/**
 * Mirrored, dimmed copy of an emitter — the classic wet-street reflection.
 * Feed it a sign/light mesh standing above `groundY`; the returned mesh is
 * flipped through the ground plane and streaked vertically so it reads as a
 * reflection on wet asphalt rather than a mirrored duplicate.
 */
export function wetReflection(source: THREE.Mesh, opts: { groundY?: number; opacity?: number; stretch?: number } = {}): THREE.Mesh {
  const { groundY = 0, opacity = 0.32, stretch = 2.1 } = opts
  source.updateWorldMatrix(true, false)
  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  source.matrixWorld.decompose(pos, quat, scale)
  const mat = (Array.isArray(source.material) ? source.material[0] : source.material).clone() as THREE.MeshStandardMaterial
  mat.transparent = true
  mat.opacity = opacity
  mat.side = THREE.DoubleSide
  mat.depthWrite = false
  mat.fog = true
  if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity *= 0.75
  const clone = new THREE.Mesh(source.geometry, mat)
  clone.position.set(pos.x, groundY - (pos.y - groundY), pos.z)
  clone.quaternion.copy(quat)
  clone.scale.set(scale.x, -scale.y * stretch, scale.z)
  clone.renderOrder = 1
  clone.name = 'wetReflection'
  return clone
}

/* ══════════════════════════════════════════════════════════════════════
 * SMALL PROPS — crates, barrels, cones, tyre stacks, bollards, dumpsters
 * ══════════════════════════════════════════════════════════════════════ */

export function crate(size: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.8, size * 0.9), material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

export function barrel(material: THREE.Material, ringMaterial: THREE.Material): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.9, 14), material)
  body.position.y = 0.45
  body.castShadow = true
  g.add(body)
  for (const y of [0.28, 0.62]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.335, 0.335, 0.06, 14), ringMaterial)
    ring.position.y = y
    g.add(ring)
  }
  return g
}

export function trafficCone(color = 0xf26522): THREE.Group {
  const g = new THREE.Group()
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.62, 10),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 }),
  )
  cone.position.y = 0.34
  cone.castShadow = true
  g.add(cone)
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.125, 0.1, 10),
    new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.5 }),
  )
  band.position.y = 0.4
  g.add(band)
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.04, 0.34),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
  )
  base.position.y = 0.02
  g.add(base)
  return g
}

export function tyreStack(count: number, material: THREE.Material): THREE.Group {
  const g = new THREE.Group()
  for (let i = 0; i < count; i++) {
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.13, 8, 18), material)
    tyre.rotation.x = Math.PI / 2
    tyre.position.y = 0.13 + i * 0.24
    tyre.castShadow = true
    g.add(tyre)
  }
  return g
}

export function bollard(material: THREE.Material, capMaterial?: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.95, 12), material)
  mesh.position.y = 0.475
  mesh.castShadow = true
  if (capMaterial) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), capMaterial)
    cap.position.y = 0.98
    mesh.add(cap)
  }
  return mesh
}

export function dumpster(bodyMaterial: THREE.Material, lidMaterial: THREE.Material): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.1, 1.1), bodyMaterial)
  body.position.y = 0.62
  body.castShadow = true
  g.add(body)
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.08, 1.15), lidMaterial)
  lid.position.y = 1.2
  lid.rotation.z = -0.06
  g.add(lid)
  for (const x of [-0.7, 0.7]) {
    for (const z of [-0.42, 0.42]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 10), lidMaterial)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(x, 0.12, z)
      g.add(wheel)
    }
  }
  return g
}

/* ══════════════════════════════════════════════════════════════════════
 * DISPOSAL
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Deep dispose: geometry always, materials + every texture they reference
 * unless the material came from the shared cache (those are reused by the
 * next location and must survive).
 */
export function disposeGroup(root: THREE.Object3D) {
  const seenMats = new Set<THREE.Material>()
  root.traverse((obj) => {
    const asMesh = obj as THREE.Mesh
    if (asMesh.geometry && !asMesh.geometry.userData.cached) asMesh.geometry.dispose()
    const mats = Array.isArray(asMesh.material) ? asMesh.material : asMesh.material ? [asMesh.material] : []
    for (const mat of mats) {
      if (mat.userData.cached || seenMats.has(mat)) continue
      seenMats.add(mat)
      const record = mat as unknown as Record<string, unknown>
      for (const key of Object.keys(record)) {
        const value = record[key]
        if (value instanceof THREE.Texture) value.dispose()
      }
      mat.dispose()
    }
  })
}
