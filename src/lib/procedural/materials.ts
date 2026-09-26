/**
 * ═════════════════════════════════════════════════════════════════════════
 * materials — the surface library for the location scenes
 * ═════════════════════════════════════════════════════════════════════════
 * Every material here is forged from `Field` noise (see ./field.ts) and ships
 * a *set* of maps, not a single flat colour:
 *
 *   map          albedo, sRGB          — real colour variation + baked AO
 *   normalMap    tangent space         — the "3D" read under light
 *   roughnessMap ORM packed (R=AO unused, G=roughness, B=metalness)
 *
 * A note on `metalnessMap` + `roughnessMap` sharing one texture: three.js
 * samples .g for roughness and .b for metalness, so one ORM upload drives
 * both — half the VRAM of separate maps and zero extra bandwidth.
 *
 * All factories are wrapped in `cachedMaterial`, and cached materials are
 * flagged so the scene teardown never disposes something the next scene will
 * reuse. Costs are amortised across scene swaps: the first visit to a
 * location pays the noise cost, the second is free.
 */

import * as THREE from 'three'
import {
  Field,
  bakeSurface,
  cachedMaterial,
  cachedValue,
  clamp01,
  fieldToColorTexture,
  fieldToDataTexture,
  fieldToNormalTexture,
  lerp,
  mulberry32,
  seedFrom,
  smoothstep,
} from './field'

type RGB = [number, number, number]

/** hex string ➜ sRGB components in 0..1 (what an sRGB texture wants). */
function srgb(hex: string): RGB {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function mix(a: RGB, b: RGB, t: number): RGB {
  const k = clamp01(t)
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]
}

function scale(a: RGB, s: number): RGB {
  return [clamp01(a[0] * s), clamp01(a[1] * s), clamp01(a[2] * s)]
}

/** Assemble a MeshStandardMaterial from a baked map set. */
function standard(
  maps: { map: THREE.Texture; normalMap: THREE.Texture; ormMap: THREE.Texture },
  params: THREE.MeshStandardMaterialParameters,
  normalScale = 1,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: maps.map,
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(normalScale, normalScale),
    roughnessMap: maps.ormMap,
    metalnessMap: maps.ormMap,
    roughness: 1, // the map is the authority (multiplied by these)
    metalness: 1,
    ...params,
  })
}

/* ══════════════════════════════════════════════════════════════════════
 * ASPHALT — aggregate, tar seams, crazing, polished wheel tracks, puddles
 * ══════════════════════════════════════════════════════════════════════ */

export type AsphaltOptions = {
  seed?: number
  res?: number
  /** 0 = sun-bleached desert tarmac, 1 = fresh blacktop */
  freshness?: number
  /** 0 = dry, 1 = standing water everywhere */
  wet?: number
  /** World size (m) of one texture tile. */
  tile?: number
  /** Wheel-track polish bands (motorway/pit-lane look). */
  tracks?: boolean
}

export type AsphaltSurface = {
  material: THREE.MeshStandardMaterial
  /** Puddle mask — feed it to a reflective puddle overlay if you want one. */
  puddles: Field
}

export function asphaltSurface(opts: AsphaltOptions = {}): AsphaltSurface {
  const { seed = 11, res = 512, freshness = 0.5, wet = 0, tile = 4, tracks = true } = opts
  return cachedValue(`asphalt:${seed}:${res}:${freshness.toFixed(2)}:${wet.toFixed(2)}:${tile}:${tracks}`, () => {
    const rng = mulberry32(seed)

    // ── height: aggregate + tar seams + crazing ────────────────────────
    const height = new Field(res, res).fbm(seed, { freq: res > 256 ? 24 : 16, octaves: 4, gain: 0.55 })
    const aggregate = new Field(res, res).worley(seed + 3, res > 256 ? 64 : 40, 0.9)
    height.mul(aggregate, 0.85).blur(1)

    const seams = new Field(res, res)
    seams.cracks(seed + 17, res > 256 ? 16 : 9, { steps: 22, step: res / 22, width: 1.8, wander: 0.5 })
    seams.blur(1)
    height.add(seams, 0.55)

    // resurfacing patches — rectangular saw-cuts of fresher mix
    const patches = new Field(res, res)
    for (let i = 0; i < 4; i++) {
      const pw = Math.round(res * (0.12 + rng() * 0.2))
      const ph = Math.round(res * (0.1 + rng() * 0.18))
      patches.rect(Math.floor(rng() * res), Math.floor(rng() * res), pw, ph, 1)
    }
    patches.blur(2)
    height.mul(patches, -0.12)

    // polished wheel tracks
    const trackRough = new Field(res, res).fill(0.78)
    if (tracks) {
      for (const c of [0.32, 0.68]) {
        for (let y = 0; y < res; y++) {
          for (let x = 0; x < res; x++) {
            const band = 1 - smoothstep(0.03, 0.1, Math.abs(x / res - c))
            if (band > 0) {
              const i = y * res + x
              trackRough.data[i] = lerp(trackRough.data[i], 0.5, band * 0.75)
            }
          }
        }
      }
    }

    // ── puddle mask ────────────────────────────────────────────────────
    const pudRaw = new Field(res, res).fbm(seed + 91, { freq: 3, octaves: 4 })
    const puddles = pudRaw.clone().levels(0.46 + (1 - wet) * 0.34, 0.72, 0, 1).smoothBand(0.05, 0.75)
    const wetMask = pudRaw.clone().levels(0.34, 0.78, 0, 0.55)

    // ── roughness ──────────────────────────────────────────────────────
    const rough = new Field(res, res)
      .fill(lerp(0.72, 0.86, freshness))
      .add(height, 0.12)
      .mul(aggregate, 0.25)
      .mul(trackRough, 0.55)
      .add(seams, 0.1)
      .mul(patches, -0.06)
    rough.apply((v, x, y) => {
      const i = y * res + x
      const w = wetMask.data[i]
      const p = puddles.data[i]
      return clamp01(lerp(v, 0.16, w * (0.4 + wet * 0.6)) * (1 - p * 0.82))
    })

    // dry asphalt is a dielectric, standing water is a mirror
    const metal = new Field(res, res).fill(0.02).add(puddles, 0.06)

    // ── albedo ─────────────────────────────────────────────────────────
    const dark = mix(srgb('#1c1d20'), srgb('#3a3b3e'), freshness)
    const light = mix(srgb('#4a4c50'), srgb('#8d8f92'), 0.4 + freshness * 0.4)
    const tar = srgb('#0d0e10')
    const repaired = srgb('#2b2c2f')

    const maps = bakeSurface({
      color: height,
      height,
      roughness: rough,
      metalness: metal,
      normalStrength: 0.9,
      albedo: (v, x, y) => {
        const i = y * res + x
        const agg = aggregate.data[i]
        const seam = seams.data[i]
        const patch = patches.data[i]
        const pud = puddles.data[i]
        const wm = wetMask.data[i]
        const grain = height.data[i]
        let c = mix(dark, light, Math.pow(agg, 1.4) * 0.55 + grain * 0.25)
        c = mix(c, tar, clamp01(seam * 1.6))
        c = mix(c, repaired, clamp01(patch * 0.7))
        const edge = patch > 0.15 && patch < 0.55 ? 1 : 0 // saw-cut joint line
        c = mix(c, tar, edge * 0.35)
        // a wet film darkens and cools the surface (water absorbs red first)
        const wetAmount = clamp01(wm * (0.5 + wet * 0.5) + pud)
        c = mix(c, [c[0] * 0.45, c[1] * 0.5, c[2] * 0.62], wetAmount)
        const ao = lerp(1, 0.72, clamp01(1 - agg))
        return scale(c, ao)
      },
    })

    const material = standard(
      maps,
      { color: 0xffffff, envMapIntensity: wet > 0.35 ? 1.35 : 0.9 },
      1.1,
    )
    material.name = 'asphalt'
    material.userData.cached = true
    return { material, puddles }
  })
}

/* ══════════════════════════════════════════════════════════════════════
 * CONCRETE — slab joints, formwork, tie holes, staining, spalling
 * ══════════════════════════════════════════════════════════════════════ */

export type ConcreteKind = 'slab' | 'wall' | 'kerb' | 'rough' | 'floor'

export function concreteMaterial(opts: { seed?: number; res?: number; kind?: ConcreteKind; tone?: string; joints?: number } = {}): THREE.MeshStandardMaterial {
  const { seed = 21, res = 512, kind = 'wall', tone = '#8f8d88', joints = 0 } = opts
  return cachedMaterial(`concrete:${seed}:${res}:${kind}:${tone}:${joints}`, () => {
    const base = srgb(tone)
    const height = new Field(res, res).fbm(seed, { freq: kind === 'rough' ? 14 : 26, octaves: 5, gain: 0.55 })
    height.add(new Field(res, res).worley(seed + 5, res > 256 ? 48 : 30, 0.95).mulConst(0.5), 0.75).blur(1)

    // air pockets / pitting
    const pits = new Field(res, res).speckle(seed + 9, res > 256 ? 420 : 220, 0.6, 2.4, 1, 'mul')
    height.mul(pits, 0.7)

    // formwork board seams + tie holes for walls
    const seams = new Field(res, res)
    if (kind === 'wall') {
      seams.grooves(Math.round(res / 6), 2, 1, 'y')
      const tieRng = mulberry32(seed + 33)
      for (let i = 0; i < 10; i++) seams.dot(tieRng() * res, (Math.floor(tieRng() * 6) + 0.5) * (res / 6), 3.2, 1)
    }
    if (kind === 'slab' || kind === 'floor') {
      seams.grooves(Math.round(res / 2), 2, 1, 'both')
      if (joints > 0) seams.grooves(Math.round(res / joints), 2, 1, 'x')
    }
    if (kind === 'kerb') seams.grooves(6, 1, 0.7, 'x')
    height.add(seams, 0.5)

    // long drip / efflorescence streaks
    const streak = new Field(res, res)
    const sr = mulberry32(seed + 61)
    for (let i = 0; i < 14; i++) {
      const x = sr() * res
      streak.line(x, 0, x + (sr() - 0.5) * 8, res, 2 + sr() * 5, 0.3 + sr() * 0.4)
    }
    streak.blur(4)
    height.add(streak, 0.12)

    const rough = new Field(res, res).fill(kind === 'floor' ? 0.62 : 0.9)
      .add(height, 0.12)
      .add(seams, -0.12)
      .mul(streak, -0.15)
    const metal = new Field(res, res).fill(0)

    const dark = scale(base, 0.45)
    const dirt = srgb('#3b3630')
    const efflorescence = srgb('#c9c6bb')

    const maps = bakeSurface({
      height,
      color: height,
      roughness: rough,
      metalness: metal,
      normalStrength: kind === 'rough' ? 1.4 : 0.85,
      albedo: (v, x, y) => {
        const i = y * res + x
        const grain = height.data[i]
        const s = streak.data[i]
        const seam = seams.data[i]
        const pit = 1 - pits.data[i]
        let c = mix(base, dark, clamp01((1 - grain) * 0.45))
        c = mix(c, [c[0] * 1.06, c[1] * 1.03, c[2] * 0.98], grain * 0.5) // warm aggregate
        c = mix(c, dirt, clamp01(pit * 1.5))
        c = mix(c, efflorescence, clamp01(s * 0.55))
        c = mix(c, scale(base, 0.35), clamp01(seam * 0.8))
        const ao = lerp(1, 0.7, clamp01(pit + seam * 0.5))
        return scale(c, ao)
      },
    })
    const mat = standard(maps, { envMapIntensity: 0.8 }, 1)
    mat.name = `concrete-${kind}`
    return mat
  })
}

/* ══════════════════════════════════════════════════════════════════════
 * METALS
 * ══════════════════════════════════════════════════════════════════════ */

/** Brushed / galvanised steel with directional micro-scratches. */
export function metalMaterial(opts: { color?: string; seed?: number; res?: number; roughness?: number; brushed?: boolean; name?: string } = {}): THREE.MeshStandardMaterial {
  const { color = '#9aa2ac', seed = 31, res = 512, roughness = 0.35, brushed = true, name = 'metal' } = opts
  return cachedMaterial(`metal:${color}:${seed}:${res}:${roughness}:${brushed}`, () => {
    const base = srgb(color)
    const height = new Field(res, res).fbm(seed, { freq: 48, octaves: 3, gain: 0.6 })
    if (brushed) {
      // directional streaks: long bright/dark lines along u (the brush)
      const lines = new Field(res, res)
      const lr = mulberry32(seed + 7)
      for (let i = 0; i < 220; i++) {
        const y = Math.floor(lr() * res)
        lines.rect(0, y, res, 1, 0.3 + lr() * 0.7)
      }
      height.mul(lines, 0.55).blur(1)
    }
    const scratches = new Field(res, res).cracks(seed + 13, 26, { steps: 10, step: res / 8, width: 0.7, wander: 0.25 })
    height.add(scratches, 0.18)

    const rough = new Field(res, res).fill(roughness)
      .add(height, 0.16)
      .add(scratches, -0.14)
    const metal = new Field(res, res).fill(1)
    const grime = new Field(res, res).fbm(seed + 71, { freq: 5, octaves: 4 })
    rough.add(grime, 0.18)
    metal.mul(grime.clone().levels(0.35, 0.8, 0.82, 1), 0.6)

    const dirt = srgb('#4b4741')
    const maps = bakeSurface({
      height,
      color: height,
      roughness: rough,
      metalness: metal,
      normalStrength: brushed ? 0.35 : 0.6,
      albedo: (v, x, y) => {
        const g = grime.data[y * res + x]
        let c = mix(base, scale(base, 0.7), clamp01(1 - v))
        c = mix(c, dirt, clamp01((g - 0.5) * 0.9))
        return scale(c, lerp(0.85, 1.02, v))
      },
    })
    const mat = standard(maps, {
      color: 0xffffff,
      envMapIntensity: 1.25,
      side: THREE.FrontSide,
    }, 1)
    mat.name = name
    return mat
  })
}

/** Painted metal: orange-peel paint, chipped edges, dust film. */
export function paintedMetal(opts: { color?: string; seed?: number; res?: number; gloss?: number; chipped?: boolean; name?: string } = {}): THREE.MeshStandardMaterial {
  const { color = '#c62b2b', seed = 41, res = 512, gloss = 0.32, chipped = true, name = 'painted' } = opts
  return cachedMaterial(`painted:${color}:${seed}:${res}:${gloss}:${chipped}`, () => {
    const base = srgb(color)
    const orangePeel = new Field(res, res).fbm(seed, { freq: 64, octaves: 3 }).blur(1)
    const chips = new Field(res, res).speckle(seed + 5, chipped ? (res > 256 ? 260 : 130) : 0, 0.8, 3.4, 1)
      .cracks(seed + 6, 8, { steps: 8, step: res / 10, width: 1.1, wander: 0.4 })
      .blur(1)
    const dust = new Field(res, res).fbm(seed + 9, { freq: 7, octaves: 4 })
    dust.levels(0.45, 0.85, 0, 1)

    const height = orangePeel.clone().mul(chips, 0.8).add(dust, 0.1)
    const rough = new Field(res, res).fill(gloss).add(orangePeel, 0.05).add(dust, 0.35).add(chips, 0.3)
    const metal = new Field(res, res).fill(0.05).add(chips, 0.35)

    const maps = bakeSurface({
      height,
      color: height,
      roughness: rough,
      metalness: metal,
      normalStrength: 0.7,
      albedo: (v, x, y) => {
        const i = y * res + x
        const chip = chips.data[i]
        const d = dust.data[i]
        let c = base
        c = mix(c, scale(base, 0.75), clamp01(1 - orangePeel.data[i]) * 0.5) // curvature shading
        c = mix(c, [0.34, 0.32, 0.3], clamp01(chip * 1.5)) // primer / bare steel
        c = mix(c, srgb('#5a5348'), d * 0.22)
        const ao = lerp(1, 0.75, clamp01(chip))
        return scale(c, ao)
      },
    })
    const mat = standard(maps, { envMapIntensity: 1.1 }, 1)
    mat.name = name
    return mat
  })
}

/** Corrugated steel — shipping containers, cladding, shutters. */
export function corrugatedMetal(opts: { color?: string; seed?: number; res?: number; ribs?: number; depth?: number; name?: string } = {}): THREE.MeshStandardMaterial {
  const { color = '#1d3557', seed = 51, res = 512, ribs = 26, depth = 0.8, name = 'corrugated' } = opts
  return cachedMaterial(`corrugated:${color}:${seed}:${res}:${ribs}:${depth}`, () => {
    const base = srgb(color)
    const ribsField = new Field(res, res).fill(1).ribs(Math.round(res / ribs), depth, 'x')
    const dents = new Field(res, res).fbm(seed, { freq: 6, octaves: 4 }).levels(0.4, 0.85, 0, 1)
    const wear = new Field(res, res).fbm(seed + 3, { freq: 22, octaves: 4 })
    const rust = new Field(res, res).fbm(seed + 8, { freq: 9, octaves: 5 }).levels(0.55, 0.9, 0, 1).contrast(1.6)
    const drips = new Field(res, res)
    const dr = mulberry32(seed + 12)
    for (let i = 0; i < 18; i++) {
      const x = dr() * res
      drips.line(x, dr() * res * 0.5, x + (dr() - 0.5) * 4, res, 2, 0.5 + dr() * 0.5)
    }
    drips.blur(3)

    const height = ribsField.clone().mul(dents, 0.35).add(rust, 0.25).add(drips, 0.1)
    const rough = new Field(res, res).fill(0.42).add(wear, 0.2).add(rust, 0.45).add(dents, 0.08)
    const metal = new Field(res, res).fill(0.85).mul(rust.clone().levels(0, 1, 0.35, 1), 0.8)

    const rustColor = srgb('#6b3a1e')
    const maps = bakeSurface({
      height,
      color: height,
      roughness: rough,
      metalness: metal,
      normalStrength: 1.35,
      albedo: (v, x, y) => {
        const i = y * res + x
        const rib = ribsField.data[i]
        const r = rust.data[i]
        const d = dents.data[i]
        const drip = drips.data[i]
        let c = mix(base, scale(base, 0.62), clamp01(1 - rib) * 0.75) // rib shading (baked AO)
        c = mix(c, scale(base, 1.12), clamp01(rib - 0.7) * 0.6)
        c = mix(c, scale(base, 0.8), clamp01((1 - d) * 0.5))
        c = mix(c, rustColor, clamp01(r * 1.2))
        c = mix(c, srgb('#2a2420'), clamp01(drip * 0.4))
        return c
      },
    })
    const mat = standard(maps, { envMapIntensity: 1.15 }, 1.1)
    mat.name = name
    return mat
  })
}

/* ══════════════════════════════════════════════════════════════════════
 * GROUND FAMILIES — sand, rock, snow, grass, gravel, mud, stone paving
 * ══════════════════════════════════════════════════════════════════════ */

export function sandMaterial(opts: { seed?: number; res?: number; tone?: string; ripples?: boolean } = {}): THREE.MeshStandardMaterial {
  const { seed = 61, res = 512, tone = '#c99a5b', ripples = true } = opts
  return cachedMaterial(`sand:${seed}:${res}:${tone}:${ripples}`, () => {
    const base = srgb(tone)
    const grain = new Field(res, res).fbm(seed, { freq: res > 256 ? 90 : 60, octaves: 3, gain: 0.6 })
    const dunes = new Field(res, res).fbm(seed + 2, { freq: 4, octaves: 5 })
    const rip = new Field(res, res)
    if (ripples) {
      rip.fbm(seed + 4, { freq: 9, octaves: 3 })
      // stretch the noise into wind ripples then sharpen into crests
      for (let y = 0; y < res; y++) {
        for (let x = 0; x < res; x++) {
          const i = y * res + x
          const angled = (x * 0.94 + y * 0.34) / res
          rip.data[i] = clamp01(Math.sin((angled * 34 + rip.data[i] * 3) * Math.PI) * 0.5 + 0.5)
        }
      }
      rip.blur(1)
    }
    const height = grain.clone().mul(dunes, 0.5).add(rip, ripples ? 0.55 : 0)
    const rough = new Field(res, res).fill(0.86).add(grain, 0.1).mul(rip.clone().invert(), -0.08)
    const metal = new Field(res, res).fill(0)

    const dark = scale(base, 0.55)
    const light = scale(base, 1.16)
    const maps = bakeSurface({
      height,
      color: height,
      roughness: rough,
      metalness: metal,
      normalStrength: ripples ? 1.2 : 0.7,
      albedo: (v, x, y) => {
        const i = y * res + x
        const g = grain.data[i]
        const d = dunes.data[i]
        const r = rip.data[i]
        let c = mix(dark, light, clamp01(g * 0.6 + d * 0.5))
        c = mix(c, [c[0] * 1.05, c[1] * 0.98, c[2] * 0.9], 0.4) // warm crests
        const ao = lerp(1, 0.68, clamp01(1 - r) * (ripples ? 1 : 0))
        return scale(c, ao)
      },
    })
    const mat = standard(maps, { envMapIntensity: 0.7 }, 1)
    mat.name = 'sand'
    return mat
  })
}

export function rockMaterial(opts: { seed?: number; res?: number; tone?: string } = {}): THREE.MeshStandardMaterial {
  const { seed = 71, res = 512, tone = '#6d675f' } = opts
  return cachedMaterial(`rock:${seed}:${res}:${tone}`, () => {
    const base = srgb(tone)
    // strata: horizontal bands compressed along y
    const strata = new Field(res, res).fbm(seed, { freq: 4, octaves: 4, ridged: true })
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const i = y * res + x
        strata.data[i] = clamp01(strata.data[i] * 0.55 + Math.sin(y * 0.32 + strata.data[i] * 5) * 0.28 + 0.5)
      }
    }
    const cracks = new Field(res, res).cracks(seed + 5, 24, { steps: 16, step: res / 16, width: 1.6, wander: 1.4 })
    const grit = new Field(res, res).fbm(seed + 9, { freq: 70, octaves: 3 })
    const height = strata.clone().mul(grit, 0.4).add(cracks, 0.75)
    const rough = new Field(res, res).fill(0.92).add(grit, 0.08).add(cracks, -0.12)
    const metal = new Field(res, res).fill(0)

    const moss = new Field(res, res).fbm(seed + 14, { freq: 6, octaves: 4 }).levels(0.62, 0.95, 0, 1)
    const maps = bakeSurface({
      height,
      color: height,
      roughness: rough,
      metalness: metal,
      normalStrength: 1.5,
      albedo: (v, x, y) => {
        const i = y * res + x
        const s = strata.data[i]
        const c0 = cracks.data[i]
        const g = grit.data[i]
        const m = moss.data[i]
        let c = mix(scale(base, 0.6), scale(base, 1.15), clamp01(s))
        c = mix(c, scale(base, 0.35), clamp01(c0 * 1.4))
        c = mix(c, srgb('#3f5233'), m * 0.45)
        const ao = lerp(1, 0.6, clamp01(c0))
        return scale(scale(c, ao), 0.9 + g * 0.2)
      },
    })
    const mat = standard(maps, { envMapIntensity: 0.6 }, 1)
    mat.name = 'rock'
    return mat
  })
}

export function snowMaterial(opts: { seed?: number; res?: number } = {}): THREE.MeshStandardMaterial {
  const { seed = 81, res = 512 } = opts
  return cachedMaterial(`snow:${seed}:${res}`, () => {
    const wind = new Field(res, res).fbm(seed, { freq: 10, octaves: 4 })
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const i = y * res + x
        wind.data[i] = clamp01(wind.data[i] * 0.5 + Math.sin((x * 0.6 + y * 0.15) * 0.35 + wind.data[i] * 4) * 0.3 + 0.35)
      }
    }
    const crust = new Field(res, res).fbm(seed + 3, { freq: 44, octaves: 3 })
    const height = wind.clone().mul(crust, 0.35)
    const rough = new Field(res, res).fill(0.55).add(crust, 0.18).add(wind, 0.12)
    const metal = new Field(res, res).fill(0)
    const maps = bakeSurface({
      height,
      color: height,
      roughness: rough,
      metalness: metal,
      normalStrength: 1.1,
      albedo: (v, x, y) => {
        const i = y * res + x
        const w = wind.data[i]
        const c = crust.data[i]
        let col: RGB = [0.92, 0.94, 0.98]
        col = mix(col, [0.72, 0.78, 0.88], clamp01(1 - w))
        col = mix(col, [0.98, 0.99, 1], clamp01(c - 0.6))
        return col
      },
    })
    const mat = standard(maps, { envMapIntensity: 1.1 }, 1)
    mat.name = 'snow'
    return mat
  })
}

export function grassMaterial(opts: { seed?: number; res?: number; tone?: string; dry?: number } = {}): THREE.MeshStandardMaterial {
  const { seed = 91, res = 512, tone = '#4a5f2c', dry = 0 } = opts
  return cachedMaterial(`grass:${seed}:${res}:${tone}:${dry}`, () => {
    const base = srgb(tone)
    const clumps = new Field(res, res).fbm(seed, { freq: 16, octaves: 4 })
    const blades = new Field(res, res).fbm(seed + 4, { freq: 100, octaves: 3 })
    const dirt = new Field(res, res).fbm(seed + 8, { freq: 5, octaves: 4 }).levels(0.55, 0.85, 0, 1)
    const height = clumps.clone().mul(blades, 0.6).add(dirt, 0.2)
    const rough = new Field(res, res).fill(0.9).add(blades, 0.08)
    const metal = new Field(res, res).fill(0)
    const maps = bakeSurface({
      height,
      color: height,
      roughness: rough,
      metalness: metal,
      normalStrength: 1.3,
      albedo: (v, x, y) => {
        const i = y * res + x
        const c = clumps.data[i]
        const b = blades.data[i]
        const d = dirt.data[i]
        let col = mix(scale(base, 0.6), scale(base, 1.25), clamp01(c))
        col = mix(col, [0.62, 0.55, 0.3], dry * 0.6) // summer grass
        col = mix(col, [0.28, 0.22, 0.15], clamp01(d * 0.8))
        return scale(col, 0.85 + b * 0.3)
      },
    })
    const mat = standard(maps, { envMapIntensity: 0.7 }, 1)
    mat.name = 'grass'
    return mat
  })
}

export function gravelMaterial(opts: { seed?: number; res?: number; tone?: string } = {}): THREE.MeshStandardMaterial {
  const { seed = 101, res = 512, tone = '#7d7a72' } = opts
  return cachedMaterial(`gravel:${seed}:${res}:${tone}`, () => {
    const base = srgb(tone)
    const stones = new Field(res, res).worley(seed, res > 256 ? 46 : 30, 0.95)
    const stones2 = new Field(res, res).worley(seed + 2, res > 256 ? 92 : 60, 0.95)
    const height = stones.clone().levels(0, 1, 0.15, 1).mul(stones2.clone().levels(0, 1, 0.5, 1), 0.6).blur(1)
    const rough = new Field(res, res).fill(0.85).add(height, 0.1)
    const metal = new Field(res, res).fill(0.01)
    const maps = bakeSurface({
      height,
      color: height,
      roughness: rough,
      metalness: metal,
      normalStrength: 1.8,
      albedo: (v, x, y) => {
        const i = y * res + x
        const s = stones.data[i]
        const s2 = stones2.data[i]
        let c = mix(scale(base, 0.5), scale(base, 1.3), clamp01(s))
        c = mix(c, scale(base, 0.75), clamp01(s2 * 0.6))
        return scale(c, lerp(0.7, 1.05, s))
      },
    })
    const mat = standard(maps, { envMapIntensity: 0.7 }, 1.2)
    mat.name = 'gravel'
    return mat
  })
}

export function stonePavingMaterial(opts: { seed?: number; res?: number; tone?: string; tiles?: number } = {}): THREE.MeshStandardMaterial {
  const { seed = 111, res = 512, tone = '#8a8780', tiles = 6 } = opts
  return cachedMaterial(`paving:${seed}:${res}:${tone}:${tiles}`, () => {
    const base = srgb(tone)
    const per = Math.round(res / tiles)
    const rng = mulberry32(seed)
    const height = new Field(res, res).fill(0.82)
    const toneField = new Field(res, res).fill(0.5)
    // cut stone slabs with slightly irregular tone
    for (let gy = 0; gy < tiles; gy++) {
      for (let gx = 0; gx < tiles; gx++) {
        const shade = 0.35 + rng() * 0.5
        for (let y = 0; y < per - 2; y++) {
          for (let x = 0; x < per - 2; x++) {
            const i = ((gy * per + y) % res) * res + ((gx * per + x) % res)
            toneField.data[i] = shade
          }
        }
      }
    }
    toneField.blur(2)
    // joints
    const joints = new Field(res, res).grooves(per, 2, 1, 'both')
    const grain = new Field(res, res).fbm(seed + 3, { freq: 60, octaves: 4 })
    const wear = new Field(res, res).fbm(seed + 7, { freq: 12, octaves: 4 })
    height.mul(grain, 0.25).add(joints, 0.8).mul(wear, 0.25)
    const rough = new Field(res, res).fill(0.55).add(grain, 0.18).add(wear, 0.2).mul(joints.clone().invert(), -0.1)
    const metal = new Field(res, res).fill(0.02)
    const maps = bakeSurface({
      height,
      color: height,
      roughness: rough,
      metalness: metal,
      normalStrength: 1,
      albedo: (v, x, y) => {
        const i = y * res + x
        const t = toneField.data[i]
        const g = grain.data[i]
        const j = joints.data[i]
        let c = mix(scale(base, 0.7), scale(base, 1.15), t)
        c = mix(c, scale(base, 0.5), clamp01(j))
        c = mix(c, scale(base, 1.05), clamp01(g - 0.5))
        const ao = lerp(1, 0.68, clamp01(j))
        return scale(c, ao)
      },
    })
    const mat = standard(maps, { envMapIntensity: 1 }, 1)
    mat.name = 'paving'
    return mat
  })
}

export function mudMaterial(opts: { seed?: number; res?: number } = {}): THREE.MeshStandardMaterial {
  const { seed = 121, res = 512 } = opts
  return cachedMaterial(`mud:${seed}:${res}`, () => {
    const base = srgb('#4a3b2c')
    const lumps = new Field(res, res).fbm(seed, { freq: 18, octaves: 4 })
    const cracks = new Field(res, res).cracks(seed + 3, 30, { steps: 12, step: res / 12, width: 2.2, wander: 1.1 })
    const puddles = new Field(res, res).fbm(seed + 9, { freq: 6, octaves: 3 }).levels(0.6, 0.85, 0, 1)
    const height = lumps.clone().add(cracks, 0.6).mul(puddles.clone().invert().levels(0.4, 1, 0.85, 1), 0.8)
    const rough = new Field(res, res).fill(0.9).add(cracks, -0.2).add(puddles, -0.6)
    const metal = new Field(res, res).fill(0.02).add(puddles, 0.05)
    const maps = bakeSurface({
      height,
      color: height,
      roughness: rough,
      metalness: metal,
      normalStrength: 1.4,
      albedo: (v, x, y) => {
        const i = y * res + x
        const l = lumps.data[i]
        const c = cracks.data[i]
        const p = puddles.data[i]
        let col = mix(scale(base, 0.6), scale(base, 1.3), clamp01(l))
        col = mix(col, srgb('#241c14'), clamp01(c))
        col = mix(col, srgb('#2b2418'), clamp01(p * 0.8))
        return scale(col, lerp(1, 0.7, clamp01(c)))
      },
    })
    const mat = standard(maps, { envMapIntensity: 0.8 }, 1)
    mat.name = 'mud'
    return mat
  })
}

/* ══════════════════════════════════════════════════════════════════════
 * WATER — animated dual normal maps on a physical material
 * ══════════════════════════════════════════════════════════════════════ */

export type WaterSurface = { material: THREE.MeshPhysicalMaterial; tick: (t: number) => void }

export function waterSurface(opts: { seed?: number; res?: number; color?: string; roughness?: number } = {}): WaterSurface {
  const { seed = 131, res = 256, color = '#0a1a22', roughness = 0.06 } = opts
  return cachedValue(`water:${seed}:${res}:${color}:${roughness}`, () => {
    const makeNormal = (s: number, strength: number) => {
      const swell = new Field(res, res).fbm(s, { freq: 5, octaves: 5, gain: 0.55 })
      const chop = new Field(res, res).fbm(s + 4, { freq: 26, octaves: 4 })
      const height = swell.clone().mul(chop, 0.45)
      const tex = fieldToNormalTexture(height, { strength }, 1)
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      return tex
    }
    // two normal layers sliding in different directions = moving swell + chop
    const a = makeNormal(seed, 1.5)
    const b = makeNormal(seed + 61, 0.8)

    const material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(color),
      roughness,
      metalness: 0.15,
      normalMap: a,
      normalScale: new THREE.Vector2(0.55, 0.55),
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.8,
      transparent: true,
      opacity: 0.94,
    })
    material.name = 'water'
    material.userData.cached = true

    // Offset uniforms only — no re-upload per frame.
    const tick = (t: number) => {
      a.offset.set(t * 0.008, t * 0.012)
      b.offset.set(-t * 0.011, t * 0.007)
    }
    return { material, tick }
  })
}

/* ══════════════════════════════════════════════════════════════════════
 * GLASS / WINDOWS / SIGNAGE
 * ══════════════════════════════════════════════════════════════════════ */

export function glassMaterial(opts: { tint?: string; roughness?: number; opacity?: number } = {}): THREE.MeshPhysicalMaterial {
  const { tint = '#0d1a20', roughness = 0.05, opacity = 0.55 } = opts
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(tint),
    roughness,
    metalness: 0.1,
    transparent: true,
    opacity,
    envMapIntensity: 2,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    side: THREE.DoubleSide,
  })
}

/** A lit building facade: dark glass grid with randomly lit windows. */
export function facadeMaterial(opts: { seed?: number; cols?: number; rows?: number; lit?: number; tint?: string; warm?: string } = {}): THREE.MeshStandardMaterial {
  const { seed = 141, cols = 8, rows = 14, lit = 0.35, tint = '#141821', warm = '#ffca7a' } = opts
  return cachedMaterial(`facade:${seed}:${cols}:${rows}:${lit}:${tint}:${warm}`, () => {
    const w = 256
    const h = 512
    const glass = srgb(tint)
    const glow = srgb(warm)
    const rng = mulberry32(seed)
    const cosy = srgb('#8fd0ff')
    const colTex = new Field(w, h)
    const emiTex = new Field(w, h)
    const cw = w / cols
    const ch = h / rows
    // value encoding: <0.10 dark glass · 0.10–0.50 cool light · >0.50 warm light
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const on = rng() < lit
        const x0 = Math.round(c * cw + cw * 0.16)
        const y0 = Math.round(r * ch + ch * 0.2)
        const ww = Math.round(cw * 0.68)
        const hh = Math.round(ch * 0.6)
        const warm = rng() < 0.68
        const brightness = 0.35 + rng() * 0.65
        const value = on ? (warm ? 0.52 + brightness * 0.46 : 0.12 + brightness * 0.36) : 0.03 + rng() * 0.05
        for (let y = 0; y < hh; y++) {
          for (let x = 0; x < ww; x++) {
            const i = ((y0 + y) % h) * w + ((x0 + x) % w)
            colTex.data[i] = value
            emiTex.data[i] = on ? brightness : 0
          }
        }
        // a few windows are half-shut by blinds
        if (on && rng() < 0.25) {
          const blinds = Math.round(hh * (0.3 + rng() * 0.4))
          for (let y = 0; y < blinds; y++) {
            for (let x = 0; x < ww; x++) {
              const i = ((y0 + y) % h) * w + ((x0 + x) % w)
              emiTex.data[i] *= 0.35
            }
          }
        }
      }
    }
    // slab bands between floors + mullions
    for (let r = 0; r < rows; r++) colTex.rect(0, Math.round(r * ch), w, 3, 0.02)
    for (let c = 0; c <= cols; c++) colTex.rect(Math.round(c * cw), 0, 2, h, 0.02)

    const map = fieldToColorTexture(colTex, (v) => {
      if (v >= 0.5) return scale(glow, lerp(0.6, 1.25, (v - 0.5) * 2))
      if (v >= 0.1) return scale(cosy, lerp(0.45, 1.15, (v - 0.1) / 0.4))
      return mix(scale(glass, 0.4), glass, v * 10)
    })
    const emissiveMap = fieldToDataTexture(emiTex, { srgb: true })
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping
    const mat = new THREE.MeshStandardMaterial({
      map,
      emissiveMap,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 1.35,
      roughness: 0.22,
      metalness: 0.55,
      envMapIntensity: 0.9,
    })
    mat.name = 'facade'
    return mat
  })
}

/* ══════════════════════════════════════════════════════════════════════
 * SPEED-RUN HELPERS — canvas based (skies, signs, decals, sprites)
 * ══════════════════════════════════════════════════════════════════════ */

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!]
}

export function canvasTexture(canvas: HTMLCanvasElement, opts: { srgb?: boolean; repeat?: number | [number, number]; anisotropy?: number } = {}): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace
  if (opts.repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    if (typeof opts.repeat === 'number') tex.repeat.set(opts.repeat, opts.repeat)
    else tex.repeat.set(opts.repeat[0], opts.repeat[1])
  }
  tex.anisotropy = opts.anisotropy ?? 8
  return tex
}

/** Soft round glow — lamp halos, embers, bokeh (one shared singleton). */
export function haloTexture(): THREE.CanvasTexture {
  return cachedValue('tex:halo', () => {
    const [c, ctx] = makeCanvas(128, 128)
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.22, 'rgba(255,255,255,0.55)')
    g.addColorStop(0.55, 'rgba(255,255,255,0.14)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
    return canvasTexture(c)
  })
}

/** Streak used for rain / blowing sand (one shared singleton). */
export function rainTexture(): THREE.CanvasTexture {
  return cachedValue('tex:rain', () => {
    const [c, ctx] = makeCanvas(16, 64)
    const g = ctx.createLinearGradient(0, 0, 0, 64)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.35, 'rgba(255,255,255,0.75)')
    g.addColorStop(0.85, 'rgba(255,255,255,0.9)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(6, 0, 4, 64)
    return canvasTexture(c, { srgb: false })
  })
}

/** Fluffy sprite for smoke / dust plumes / fog banks (cached per seed). */
export function smokeTexture(seed = 7): THREE.CanvasTexture {
  return cachedValue(`tex:smoke:${seed}`, () => {
    const size = 128
    const [c, ctx] = makeCanvas(size, size)
    const f = new Field(64, 64).fbm(seed, { freq: 4, octaves: 4 })
    const img = ctx.createImageData(size, size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = f.at(Math.floor((x / size) * 64), Math.floor((y / size) * 64))
        const dx = x / size - 0.5
        const dy = y / size - 0.5
        const radial = clamp01(1 - Math.hypot(dx, dy) * 2.3)
        const a = clamp01(v * radial * 1.7) * 255
        const i = (y * size + x) * 4
        img.data[i] = 255
        img.data[i + 1] = 255
        img.data[i + 2] = 255
        img.data[i + 3] = a
      }
    }
    ctx.putImageData(img, 0, 0)
    return canvasTexture(c)
  })
}

/** Dry-brush streak sprite for wet-road highlight smears. */
export function streakTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 256)
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.85)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(20, 0, 24, 256)
  ctx.filter = 'blur(6px)'
  ctx.drawImage(c, 0, 0)
  ctx.filter = 'none'
  return canvasTexture(c)
}

/**
 * Emissive sign panel — the single biggest "this looks real" cue in a night
 * scene. Draws framed text with an optional neon tube glow and returns a
 * material pair: the panel + a soft glow sprite you can position behind it.
 */
export function signMaterial(opts: {
  text: string
  sub?: string
  bg?: string
  fg?: string
  glow?: string
  font?: string
  width?: number
  height?: number
  vertical?: boolean
  arrow?: boolean
  border?: boolean
}): { material: THREE.MeshStandardMaterial; map: THREE.CanvasTexture } {
  const {
    text,
    sub,
    bg = '#0b0f18',
    fg = '#ff4d6d',
    glow = '#ff4d6d',
    font = 'Inter, "Hiragino Sans", "Noto Sans JP", Arial, sans-serif',
    width = 512,
    height = 256,
    vertical = false,
    arrow = false,
    border = true,
  } = opts

  const [c, ctx] = makeCanvas(width, height)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)
  if (border) {
    ctx.strokeStyle = glow
    ctx.lineWidth = 8
    ctx.strokeRect(6, 6, width - 12, height - 12)
  }
  ctx.shadowColor = glow
  ctx.shadowBlur = 26
  ctx.fillStyle = fg
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (vertical) {
    const chars = [...text]
    const step = height / (chars.length + 0.4)
    const size = Math.min(width * 0.62, step * 0.82)
    ctx.font = `700 ${Math.round(size)}px ${font}`
    chars.forEach((ch, i) => ctx.fillText(ch, width / 2, step * (i + 0.7)))
  } else {
    const size = sub ? height * 0.42 : height * 0.5
    ctx.font = `700 ${Math.round(size)}px ${font}`
    ctx.fillText(text, width / 2, sub ? height * 0.42 : height * 0.52, width * 0.88)
    if (sub) {
      ctx.font = `500 ${Math.round(height * 0.16)}px ${font}`
      ctx.globalAlpha = 0.85
      ctx.fillText(sub, width / 2, height * 0.76, width * 0.88)
      ctx.globalAlpha = 1
    }
  }
  if (arrow) {
    ctx.beginPath()
    ctx.moveTo(width * 0.12, height * 0.5)
    ctx.lineTo(width * 0.24, height * 0.28)
    ctx.lineTo(width * 0.24, height * 0.42)
    ctx.lineTo(width * 0.34, height * 0.42)
    ctx.lineTo(width * 0.34, height * 0.58)
    ctx.lineTo(width * 0.24, height * 0.58)
    ctx.lineTo(width * 0.24, height * 0.72)
    ctx.closePath()
    ctx.fill()
  }
  ctx.shadowBlur = 0

  const map = canvasTexture(c)
  const material = new THREE.MeshStandardMaterial({
    map,
    emissiveMap: map,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 1.6,
    roughness: 0.4,
    metalness: 0.1,
    toneMapped: true,
  })
  material.name = `sign:${text}`
  return { material, map }
}

/** Diagonal hazard chevrons (barriers, kerbs, machine edges). */
export function hazardMaterial(opts: { a?: string; b?: string; size?: number } = {}): THREE.MeshStandardMaterial {
  const { a = '#e0b400', b = '#141414', size = 128 } = opts
  return cachedMaterial(`hazard:${a}:${b}:${size}`, () => {
    const [c, ctx] = makeCanvas(size, size)
    ctx.fillStyle = a
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = b
    for (let i = -2; i < 6; i++) {
      ctx.beginPath()
      ctx.moveTo(i * (size / 4), size)
      ctx.lineTo(i * (size / 4) + size / 4, size)
      ctx.lineTo(i * (size / 4) + size / 2, 0)
      ctx.lineTo(i * (size / 4) + size / 4, 0)
      ctx.closePath()
      ctx.fill()
    }
    const mat = new THREE.MeshStandardMaterial({
      map: canvasTexture(c, { repeat: 1 }),
      roughness: 0.55,
      metalness: 0.15,
      envMapIntensity: 0.9,
    })
    mat.name = 'hazard'
    return mat
  })
}

/* ══════════════════════════════════════════════════════════════════════
 * Internals
 * ══════════════════════════════════════════════════════════════════════ */

export { seedFrom }
export { cachedValue }
