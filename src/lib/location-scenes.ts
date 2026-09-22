/**
 * ═════════════════════════════════════════════════════════════════════════
 * Location scenes — the car stays parked at the origin, the world changes
 * ═════════════════════════════════════════════════════════════════════════
 * Every environment here is 100 % procedural (canvas textures + primitive
 * geometry, zero image downloads) so it loads instantly and matches the
 * studio's "no asset" philosophy. Each scene returns:
 *
 *   group      — everything to add to the scene (removed + disposed on swap)
 *   background — a sky texture or flat colour for scene.background
 *   lighting   — how the shared key / rim / hemi rig, fog and exposure should
 *                be re-tuned while this location is active
 *   update(t)  — optional per-frame animation (flickering tubes, floodlights)
 *
 * World conventions (same as the studio): car nose = +X, ground = y 0,
 * the scroll camera lives on the +Z side of the car.
 */

import * as THREE from 'three'
import type { SceneId } from '@/types/configurator'

export type LocationLighting = {
  key: { color: number; intensity: number; position: [number, number, number] }
  rim: { color: number; intensity: number; position: [number, number, number] }
  hemi: { sky: number; ground: number; intensity: number }
  fog: { color: number; density: number }
  exposure: number
  environmentIntensity: number
  /** multiplier for the head/tail-light floor projections (daylight ≈ 0) */
  beamScale: number
  /** does this floor let the mirrored car double show through? */
  floorReflection: boolean
}

export type LocationScene = {
  id: SceneId
  group: THREE.Group
  background: THREE.Texture | THREE.Color
  lighting: LocationLighting
  update?: (t: number) => void
  dispose: () => void
}

/** The verified studio baseline — re-applied when returning to the studio. */
export const STUDIO_LIGHTING: LocationLighting = {
  key: { color: 0xfff1dd, intensity: 380, position: [7, 9, 5] },
  rim: { color: 0xbfd0e8, intensity: 1.6, position: [-8, 5, -6] },
  hemi: { sky: 0x39404e, ground: 0x0b0c10, intensity: 0.42 },
  fog: { color: 0x050608, density: 0.018 },
  exposure: 1.0,
  environmentIntensity: 1.0,
  beamScale: 1.0,
  floorReflection: true,
}

/* ══════════════════════════════════════════════════════════════════════
 * Small helpers
 * ══════════════════════════════════════════════════════════════════════ */

/** Deterministic PRNG so every visitor sees the same trees / stains */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!] as const
}

function srgbTexture(canvas: HTMLCanvasElement, repeat?: [number, number]): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(repeat[0], repeat[1])
  }
  tex.anisotropy = 4
  return tex
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

type SkyOptions = {
  /** vertical gradient stops, 0 = zenith, 0.5 = horizon, 1 = nadir */
  stops: Array<[number, string]>
  sun?: { x: number; y: number; r: number; color: string; core?: string }
  /** draw far silhouettes (mountains / trees) — called with the horizon row */
  silhouettes?: (ctx: CanvasRenderingContext2D, w: number, h: number, horizon: number) => void
}

/** 2:1 sky map for an inside-out sphere. Canvas top = zenith. */
function makeSkyTexture(o: SkyOptions): THREE.CanvasTexture {
  const w = 2048
  const h = 1024
  const [canvas, ctx] = makeCanvas(w, h)
  const g = ctx.createLinearGradient(0, 0, 0, h)
  for (const [p, c] of o.stops) g.addColorStop(p, c)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  if (o.sun) {
    const sx = o.sun.x * w
    const sy = o.sun.y * h
    const r = o.sun.r * h
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r)
    sg.addColorStop(0, o.sun.core ?? o.sun.color)
    sg.addColorStop(0.18, o.sun.color)
    sg.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = sg
    ctx.fillRect(0, 0, w, h)
  }
  o.silhouettes?.(ctx, w, h, h * 0.5)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.mapping = THREE.EquirectangularReflectionMapping
  return tex
}

function skyDome(tex: THREE.Texture): THREE.Mesh {
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(120, 48, 24),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }),
  )
  dome.renderOrder = -10
  return dome
}

/** Tileable asphalt / concrete grain */
function makeGroundTexture(seed: number, base: string, speck: string, speckAlpha: number, cracks: boolean): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(512, 512)
  const r = rng(seed)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, 512, 512)
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = speck
    ctx.globalAlpha = r() * speckAlpha
    ctx.fillRect(r() * 512, r() * 512, 1 + r() * 2, 1 + r() * 2)
  }
  ctx.globalAlpha = 1
  if (cracks) {
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.lineWidth = 1
    for (let i = 0; i < 6; i++) {
      ctx.beginPath()
      let x = r() * 512
      let y = r() * 512
      ctx.moveTo(x, y)
      for (let s = 0; s < 8; s++) {
        x += (r() - 0.5) * 60
        y += (r() - 0.5) * 60
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }
  return srgbTexture(canvas, [1, 1])
}

/** Soft round glow sprite for lamp halos */
function makeHaloTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128, 128)
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  return srgbTexture(canvas)
}

function halo(tex: THREE.Texture, color: number, size: number, opacity = 0.8): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  )
  s.scale.setScalar(size)
  return s
}

/** Low-poly pine forest as two instanced meshes (foliage + trunk) */
function makeForest(
  count: number,
  place: (r: () => number) => [number, number, number] | null,
  seed: number,
  foliageColor = 0x1d3a22,
): THREE.Group {
  const g = new THREE.Group()
  const r = rng(seed)
  const foliage = new THREE.InstancedMesh(
    new THREE.ConeGeometry(1, 3.2, 6),
    new THREE.MeshStandardMaterial({ color: foliageColor, roughness: 1, flatShading: true }),
    count,
  )
  const trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.12, 0.18, 1.1, 5),
    new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 1 }),
    count,
  )
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  const p = new THREE.Vector3()
  let placed = 0
  for (let i = 0; i < count * 4 && placed < count; i++) {
    const at = place(r)
    if (!at) continue
    const scale = 0.9 + r() * 1.2
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI)
    s.set(scale, scale, scale)
    p.set(at[0], at[1] + 1.6 * scale + 0.5, at[2])
    m.compose(p, q, s)
    foliage.setMatrixAt(placed, m)
    p.set(at[0], at[1] + 0.5 * scale, at[2])
    m.compose(p, q, s)
    trunk.setMatrixAt(placed, m)
    placed++
  }
  foliage.count = placed
  trunk.count = placed
  foliage.instanceMatrix.needsUpdate = true
  trunk.instanceMatrix.needsUpdate = true
  g.add(foliage, trunk)
  return g
}

function disposeGroup(group: THREE.Object3D) {
  group.traverse((obj) => {
    const o = obj as THREE.Mesh
    if (o.geometry) o.geometry.dispose()
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
    for (const mat of mats) {
      const withMaps = mat as THREE.Material & { map?: THREE.Texture | null; emissiveMap?: THREE.Texture | null }
      withMaps.map?.dispose()
      withMaps.emissiveMap?.dispose()
      mat.dispose()
    }
  })
}

/* ══════════════════════════════════════════════════════════════════════
 * 1. Nürburgring pit lane — dusk, floodlights coming on
 * ══════════════════════════════════════════════════════════════════════ */

function buildNurburgring(mobile: boolean): LocationScene {
  const group = new THREE.Group()
  const haloTex = makeHaloTexture()

  const sky = makeSkyTexture({
    stops: [
      [0, '#05081c'],
      [0.28, '#1a1f4e'],
      [0.42, '#5d3d5c'],
      [0.48, '#c9713f'],
      [0.5, '#e69a52'],
      [0.52, '#3a2a2c'],
      [1, '#141114'],
    ],
    sun: { x: 0.74, y: 0.495, r: 0.22, color: 'rgba(255,160,80,0.45)', core: 'rgba(255,220,170,0.9)' },
    silhouettes: (ctx, w, h, horizon) => {
      // Eifel hills
      ctx.fillStyle = '#1d1a2c'
      ctx.beginPath()
      ctx.moveTo(0, horizon)
      const r = rng(11)
      for (let x = 0; x <= w; x += 64) ctx.lineTo(x, horizon - 12 - r() * 42 - Math.sin(x / 260) * 18)
      ctx.lineTo(w, horizon + 4)
      ctx.closePath()
      ctx.fill()
      // dense tree line
      ctx.fillStyle = '#0c0d14'
      const r2 = rng(23)
      for (let x = 0; x < w; x += 9) {
        const th = 10 + r2() * 26
        ctx.beginPath()
        ctx.moveTo(x, horizon + 2)
        ctx.lineTo(x + 5, horizon - th)
        ctx.lineTo(x + 10, horizon + 2)
        ctx.closePath()
        ctx.fill()
      }
      ctx.fillRect(0, horizon, w, h - horizon)
    },
  })
  group.add(skyDome(sky))

  // Asphalt — pit lane + track share one surface
  const asphaltTex = makeGroundTexture(3, '#1f2023', '#5a5c60', 0.35, true)
  asphaltTex.repeat.set(40, 40)
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(95, 64),
    new THREE.MeshStandardMaterial({ map: asphaltTex, color: 0x9a9a9a, roughness: 0.62, metalness: 0.08 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  group.add(ground)

  // Pit-lane markings (non-repeating overlay)
  {
    const [c, ctx] = makeCanvas(2048, 1024) // 64 × 32 world units
    const u = 2048 / 64
    ctx.strokeStyle = 'rgba(240,240,235,0.85)'
    ctx.lineWidth = 6
    // pit-lane inner + outer lines
    for (const z of [-4.6, 3.9]) {
      ctx.beginPath()
      ctx.moveTo(0, 512 + z * u)
      ctx.lineTo(2048, 512 + z * u)
      ctx.stroke()
    }
    // pit boxes
    ctx.strokeStyle = 'rgba(250,215,80,0.85)'
    ctx.lineWidth = 5
    for (let x = -30; x <= 30; x += 6) {
      ctx.strokeRect(1024 + (x - 2.5) * u, 512 + -4.6 * u, 5 * u, 3.1 * u)
    }
    // speed-limit line + "60" style hatch at the entry
    ctx.fillStyle = 'rgba(250,215,80,0.9)'
    ctx.fillRect(1024 + 26 * u, 512 - 4.6 * u, 0.35 * u, 8.5 * u)
    for (let i = 0; i < 6; i++) ctx.fillRect(1024 + (27 + i * 0.8) * u, 512 - 0.4 * u, 0.4 * u, 0.8 * u)
    const markTex = srgbTexture(c)
    const marks = new THREE.Mesh(
      new THREE.PlaneGeometry(64, 32),
      new THREE.MeshBasicMaterial({ map: markTex, transparent: true, depthWrite: false, opacity: 0.9 }),
    )
    marks.rotation.x = -Math.PI / 2
    marks.position.y = 0.012
    marks.renderOrder = 1
    group.add(marks)
  }

  // Pit building on the −Z side
  const concrete = new THREE.MeshStandardMaterial({ color: 0x2b2d33, roughness: 0.92 })
  const building = new THREE.Mesh(new THREE.BoxGeometry(64, 7.2, 7), concrete)
  building.position.set(0, 3.6, -11.5)
  group.add(building)
  const balcony = new THREE.Mesh(new THREE.BoxGeometry(64, 0.28, 1.6), new THREE.MeshStandardMaterial({ color: 0x1a1b20, roughness: 0.8 }))
  balcony.position.set(0, 4.25, -7.3)
  group.add(balcony)
  const rail = new THREE.Mesh(new THREE.BoxGeometry(64, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: 0x8a8f9a, metalness: 0.8, roughness: 0.3 }))
  rail.position.set(0, 5.3, -6.55)
  group.add(rail)

  // Lit garage boxes
  const [dc, dctx] = makeCanvas(256, 256)
  const dg = dctx.createLinearGradient(0, 0, 0, 256)
  dg.addColorStop(0, '#ffe9c8')
  dg.addColorStop(0.5, '#c98d55')
  dg.addColorStop(1, '#3a2418')
  dctx.fillStyle = dg
  dctx.fillRect(0, 0, 256, 256)
  dctx.fillStyle = 'rgba(255,255,255,0.9)'
  dctx.fillRect(20, 14, 216, 6)
  dctx.fillStyle = 'rgba(0,0,0,0.35)'
  dctx.fillRect(0, 200, 256, 56)
  const doorTex = srgbTexture(dc)
  const doorMats: THREE.MeshBasicMaterial[] = []
  for (let x = -27; x <= 27; x += 6) {
    const mat = new THREE.MeshBasicMaterial({ map: doorTex, fog: true })
    doorMats.push(mat)
    const door = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.7), mat)
    door.position.set(x, 1.85, -7.99)
    group.add(door)
    const frame = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.2, 0.2), new THREE.MeshStandardMaterial({ color: 0x0f1014 }))
    frame.position.set(x, 3.8, -7.9)
    group.add(frame)
    // tiny box number plate
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.35), new THREE.MeshBasicMaterial({ color: 0xffffff }))
    plate.position.set(x - 2.4, 3.4, -7.98)
    group.add(plate)
  }
  // Media-centre windows above the boxes
  const winMat = new THREE.MeshBasicMaterial({ color: 0x2c5f9a })
  for (let x = -28; x <= 28; x += 2.2) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.1), winMat)
    win.position.set(x, 5.9, -7.99)
    group.add(win)
  }
  // Two warm point lights spilling out of the nearest boxes
  for (const x of [-3, 3]) {
    const pl = new THREE.PointLight(0xffc48a, 60, 18, 2)
    pl.position.set(x, 2.4, -7.2)
    group.add(pl)
  }

  // Pit wall + fence on the +Z side, then curb, then track
  const pitWall = new THREE.Mesh(new THREE.BoxGeometry(70, 1.0, 0.36), new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: 0.85 }))
  pitWall.position.set(0, 0.5, 5.2)
  group.add(pitWall)
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x5a6068, metalness: 0.7, roughness: 0.4 })
  for (let x = -35; x <= 35; x += 3.5) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.2, 0.08), fenceMat)
    post.position.set(x, 2.6, 5.2)
    group.add(post)
  }
  for (const y of [2.2, 3.4, 4.2]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(70, 0.04, 0.04), fenceMat)
    bar.position.set(0, y, 5.2)
    group.add(bar)
  }
  {
    const [cc, cctx] = makeCanvas(256, 32)
    for (let i = 0; i < 16; i++) {
      cctx.fillStyle = i % 2 ? '#d61f2c' : '#f2f2ee'
      cctx.fillRect(i * 16, 0, 16, 32)
    }
    const curbTex = srgbTexture(cc, [30, 1])
    const curb = new THREE.Mesh(new THREE.BoxGeometry(80, 0.06, 0.7), new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.7 }))
    curb.position.set(0, 0.03, 8.4)
    group.add(curb)
  }

  // Grandstand across the track
  const standMat = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.9 })
  for (let i = 0; i < 6; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(70, 1.1, 1.8), standMat)
    step.position.set(0, 0.55 + i * 1.1, 26 + i * 1.8)
    group.add(step)
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(72, 0.3, 14), new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.7 }))
  roof.position.set(0, 9.2, 31)
  group.add(roof)
  const standLights = new THREE.MeshBasicMaterial({ color: 0xfff2d8 })
  for (let x = -30; x <= 30; x += 6) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.22), standLights)
    strip.position.set(x, 8.9, 24.2)
    group.add(strip)
    const sh = halo(haloTex, 0xffe0b0, 4.5, 0.45)
    sh.position.set(x, 8.9, 24.2)
    group.add(sh)
  }

  // Pit-lane floodlight masts
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3d45, metalness: 0.6, roughness: 0.5 })
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
  const lampHalos: THREE.Sprite[] = []
  for (const x of [-14, 0, 14]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 10, 8), poleMat)
    pole.position.set(x, 5, 5.9)
    group.add(pole)
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 2.2), poleMat)
    arm.position.set(x, 9.9, 4.9)
    group.add(arm)
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 0.5), lampMat)
    head.position.set(x, 9.8, 3.9)
    group.add(head)
    const hl = halo(haloTex, 0xfff4dc, 5, 0.7)
    hl.position.set(x, 9.7, 3.9)
    lampHalos.push(hl)
    group.add(hl)
  }

  // Forest behind everything
  group.add(
    makeForest(
      mobile ? 60 : 140,
      (r) => {
        const side = r() < 0.5 ? -1 : 1
        const x = (r() - 0.5) * 150
        const z = side < 0 ? -18 - r() * 30 : 40 + r() * 30
        return [x, 0, z]
      },
      7,
    ),
  )

  // Sun (low, from the +Z / track side) — broad fill for the buildings
  const sun = new THREE.DirectionalLight(0xffa864, 1.7)
  sun.position.set(-30, 10, 40)
  group.add(sun)

  const update = (t: number) => {
    // floodlights warming up: slow shimmer
    for (let i = 0; i < lampHalos.length; i++) {
      lampHalos[i].material.opacity = 0.62 + Math.sin(t * 3.1 + i * 1.7) * 0.06
    }
    // one garage's lighting flickers like a work lamp
    doorMats[4].color.setScalar(0.92 + Math.sin(t * 17) * Math.sin(t * 5.3) * 0.08)
  }

  return {
    id: 'nurburgring',
    group,
    background: sky,
    lighting: {
      key: { color: 0xffb877, intensity: 470, position: [-6, 5.5, 9] },
      rim: { color: 0x7a90ff, intensity: 2.4, position: [8, 6, -8] },
      hemi: { sky: 0x3b3f7c, ground: 0x2a1a14, intensity: 0.9 },
      fog: { color: 0x4a3541, density: 0.0105 },
      exposure: 1.05,
      environmentIntensity: 0.75,
      beamScale: 1.0,
      floorReflection: false,
    },
    update,
    dispose: () => {
      disposeGroup(group)
      sky.dispose()
      haloTex.dispose()
    },
  }
}

/* ══════════════════════════════════════════════════════════════════════
 * 2. Munich underground garage — level P2, wet concrete, fluorescent hum
 * ══════════════════════════════════════════════════════════════════════ */

function buildGarage(mobile: boolean): LocationScene {
  const group = new THREE.Group()
  const haloTex = makeHaloTexture()
  const SIZE = 56
  const CEIL = 3.7

  const concreteTex = makeGroundTexture(5, '#3a3b3e', '#8a8b8e', 0.28, true)
  concreteTex.repeat.set(24, 24)
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE, SIZE),
    new THREE.MeshStandardMaterial({
      map: concreteTex,
      color: 0x8c8c8c,
      roughness: 0.3,
      metalness: 0.38,
      envMapIntensity: 0.55,
      transparent: true,
      opacity: 0.9, // lets the mirrored car show through as a wet-floor reflection
    }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  group.add(floor)

  // Bay markings + lane arrows + level text
  {
    const [c, ctx] = makeCanvas(2048, 2048) // 56 × 56 units
    const u = 2048 / SIZE
    const cx = 1024
    ctx.strokeStyle = 'rgba(235,235,230,0.8)'
    ctx.lineWidth = 5
    for (const side of [-1, 1]) {
      const z0 = side * 4.6
      const z1 = side * 9.8
      for (let x = -26; x <= 26; x += 2.9) {
        ctx.beginPath()
        ctx.moveTo(cx + x * u, cx + z0 * u)
        ctx.lineTo(cx + x * u, cx + z1 * u)
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.moveTo(cx - 26 * u, cx + z1 * u)
      ctx.lineTo(cx + 26 * u, cx + z1 * u)
      ctx.stroke()
    }
    // drive-lane arrows
    ctx.fillStyle = 'rgba(235,235,230,0.7)'
    for (const x of [-16, -8, 8, 16]) {
      ctx.beginPath()
      ctx.moveTo(cx + (x + 1.6) * u, cx)
      ctx.lineTo(cx + (x - 0.4) * u, cx - 0.9 * u)
      ctx.lineTo(cx + (x - 0.4) * u, cx - 0.3 * u)
      ctx.lineTo(cx + (x - 2.2) * u, cx - 0.3 * u)
      ctx.lineTo(cx + (x - 2.2) * u, cx + 0.3 * u)
      ctx.lineTo(cx + (x - 0.4) * u, cx + 0.3 * u)
      ctx.lineTo(cx + (x - 0.4) * u, cx + 0.9 * u)
      ctx.closePath()
      ctx.fill()
    }
    // oil stains
    const r = rng(9)
    for (let i = 0; i < 14; i++) {
      const sx = cx + (r() - 0.5) * 50 * u
      const sz = cx + (r() - 0.5) * 50 * u
      const sr = (0.4 + r() * 1.2) * u
      const sg = ctx.createRadialGradient(sx, sz, 0, sx, sz, sr)
      sg.addColorStop(0, 'rgba(5,5,8,0.55)')
      sg.addColorStop(1, 'rgba(5,5,8,0)')
      ctx.fillStyle = sg
      ctx.fillRect(sx - sr, sz - sr, sr * 2, sr * 2)
    }
    const markTex = srgbTexture(c)
    const marks = new THREE.Mesh(
      new THREE.PlaneGeometry(SIZE, SIZE),
      new THREE.MeshBasicMaterial({ map: markTex, transparent: true, depthWrite: false }),
    )
    marks.rotation.x = -Math.PI / 2
    marks.position.y = 0.012
    marks.renderOrder = 1
    group.add(marks)
  }

  // Ceiling slab with beams
  const slabMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.95 })
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), slabMat)
  ceiling.rotation.x = Math.PI / 2
  ceiling.position.y = CEIL
  group.add(ceiling)
  for (let z = -24; z <= 24; z += 8) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(SIZE, 0.55, 0.7), slabMat)
    beam.position.set(0, CEIL - 0.27, z)
    group.add(beam)
  }

  // Walls with a level marker
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x33353a, roughness: 0.95 })
  const wallGeo = new THREE.PlaneGeometry(SIZE, CEIL)
  const walls: Array<[number, number, number, number]> = [
    [0, -SIZE / 2, 0, 1],
    [0, SIZE / 2, Math.PI, 1],
    [-SIZE / 2, 0, Math.PI / 2, 1],
    [SIZE / 2, 0, -Math.PI / 2, 1],
  ]
  for (const [x, z, ry] of walls) {
    const w = new THREE.Mesh(wallGeo, wallMat)
    w.position.set(x, CEIL / 2, z)
    w.rotation.y = ry
    group.add(w)
  }
  {
    const [c, ctx] = makeCanvas(512, 256)
    ctx.fillStyle = '#e8e6df'
    ctx.fillRect(0, 0, 512, 256)
    ctx.fillStyle = '#1c69d4'
    ctx.fillRect(0, 0, 512, 44)
    ctx.fillStyle = '#111318'
    ctx.font = 'bold 170px Inter, Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('P2', 256, 150)
    const tex = srgbTexture(c)
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshBasicMaterial({ map: tex }))
    sign.position.set(-4, 1.9, -SIZE / 2 + 0.05)
    group.add(sign)
    // exit sign: green box with white arrow pictogram
    const [ec, ectx] = makeCanvas(256, 96)
    ectx.fillStyle = '#0f8a3a'
    ectx.fillRect(0, 0, 256, 96)
    ectx.fillStyle = '#ffffff'
    ectx.beginPath()
    ectx.moveTo(30, 48)
    ectx.lineTo(80, 18)
    ectx.lineTo(80, 36)
    ectx.lineTo(150, 36)
    ectx.lineTo(150, 60)
    ectx.lineTo(80, 60)
    ectx.lineTo(80, 78)
    ectx.closePath()
    ectx.fill()
    ectx.fillRect(170, 22, 14, 52)
    ectx.fillRect(196, 22, 14, 52)
    ectx.fillRect(222, 22, 14, 52)
    const exitTex = srgbTexture(ec)
    const exitSign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.52), new THREE.MeshBasicMaterial({ map: exitTex }))
    exitSign.position.set(14, CEIL - 0.9, -SIZE / 2 + 0.06)
    group.add(exitSign)
    const g = halo(haloTex, 0x3cff7a, 2.4, 0.35)
    g.position.copy(exitSign.position)
    group.add(g)
  }

  // Columns with hazard stripes
  const colMat = new THREE.MeshStandardMaterial({ color: 0x45474d, roughness: 0.9 })
  const [sc, sctx] = makeCanvas(128, 128)
  sctx.fillStyle = '#e6b400'
  sctx.fillRect(0, 0, 128, 128)
  sctx.fillStyle = '#111'
  for (let i = -4; i < 8; i++) {
    sctx.beginPath()
    sctx.moveTo(i * 32, 128)
    sctx.lineTo(i * 32 + 32, 128)
    sctx.lineTo(i * 32 + 64, 0)
    sctx.lineTo(i * 32 + 32, 0)
    sctx.closePath()
    sctx.fill()
  }
  const stripeMat = new THREE.MeshStandardMaterial({ map: srgbTexture(sc, [1, 1]), roughness: 0.6 })
  for (const x of [-21, -13, -5, 5, 13, 21]) {
    for (const z of [-11.5, -4.2, 4.2, 11.5, 19]) {
      if (Math.abs(x) < 6 && Math.abs(z) < 5) continue
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.7, CEIL, 0.7), colMat)
      col.position.set(x, CEIL / 2, z)
      group.add(col)
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.9, 0.76), stripeMat)
      base.position.set(x, 0.45, z)
      group.add(base)
    }
  }

  // Pipes and conduit along the ceiling
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x6d7078, metalness: 0.6, roughness: 0.4 })
  const redPipe = new THREE.MeshStandardMaterial({ color: 0x9c2020, metalness: 0.4, roughness: 0.5 })
  for (const [z, mat, r] of [
    [-2.4, pipeMat, 0.09],
    [-2.75, redPipe, 0.06],
    [3.1, pipeMat, 0.12],
  ] as const) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, SIZE, 10), mat)
    pipe.rotation.z = Math.PI / 2
    pipe.position.set(0, CEIL - 0.45, z)
    group.add(pipe)
  }

  // Fluorescent tubes (two rows) + halos; one flickers
  const tubeMat = new THREE.MeshBasicMaterial({ color: 0xe6eef8 })
  const flickerMat = new THREE.MeshBasicMaterial({ color: 0xe6eef8 })
  const tubeHalos: THREE.Sprite[] = []
  let flickerHalo: THREE.Sprite | null = null
  let flickerIdx = 0
  for (const z of [-3.6, 3.6]) {
    for (let x = -24; x <= 24; x += 4) {
      flickerIdx++
      const isFlicker = flickerIdx === 9
      const housing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.22), new THREE.MeshStandardMaterial({ color: 0x1a1c20 }))
      housing.position.set(x, CEIL - 0.06, z)
      group.add(housing)
      const tube = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 0.12), isFlicker ? flickerMat : tubeMat)
      tube.rotation.x = Math.PI / 2
      tube.position.set(x, CEIL - 0.11, z)
      group.add(tube)
      const h = halo(haloTex, 0xdfe9f7, 2.2, 0.28)
      h.position.set(x, CEIL - 0.2, z)
      group.add(h)
      if (isFlicker) flickerHalo = h
      else tubeHalos.push(h)
    }
  }
  // Real fill from the tubes nearest the car
  for (const [x, z] of [
    [-3, -3.6],
    [3, 3.6],
  ]) {
    const pl = new THREE.PointLight(0xd6e2f2, 28, 16, 2)
    pl.position.set(x, CEIL - 0.4, z)
    group.add(pl)
  }
  if (!mobile) {
    const glint = new THREE.PointLight(0xffffff, 10, 9, 2)
    glint.position.set(0, CEIL - 0.6, 0)
    group.add(glint)
  }

  const update = (t: number) => {
    if (!flickerHalo) return
    const on = Math.sin(t * 23) * Math.sin(t * 7.3) + Math.sin(t * 1.7) > -0.15
    const v = on ? 1 : 0.15
    flickerMat.color.setScalar(v)
    flickerHalo.material.opacity = on ? 0.28 : 0.03
  }

  return {
    id: 'garage',
    group,
    background: new THREE.Color(0x0a0b0e),
    lighting: {
      key: { color: 0xdde6f2, intensity: 260, position: [2, 6.5, 2.5] },
      rim: { color: 0x8aa3c8, intensity: 0.8, position: [-8, 3, -6] },
      hemi: { sky: 0x7c8797, ground: 0x1e1f23, intensity: 0.38 },
      fog: { color: 0x0b0c10, density: 0.03 },
      exposure: 0.9,
      environmentIntensity: 0.6,
      beamScale: 1.25,
      floorReflection: true,
    },
    update,
    dispose: () => {
      disposeGroup(group)
      haloTex.dispose()
    },
  }
}

/* ══════════════════════════════════════════════════════════════════════
 * 3. Alpine pass — golden hour at 2,100 m, guardrail, low-poly peaks
 * ══════════════════════════════════════════════════════════════════════ */

function buildAlpine(mobile: boolean): LocationScene {
  const group = new THREE.Group()

  const sky = makeSkyTexture({
    stops: [
      [0, '#1f4f9a'],
      [0.25, '#5b95d6'],
      [0.42, '#bcd0e6'],
      [0.485, '#f1d7ac'],
      [0.5, '#f6dfb4'],
      [0.53, '#a9a48e'],
      [1, '#5c6656'],
    ],
    sun: { x: 0.82, y: 0.465, r: 0.2, color: 'rgba(255,225,170,0.6)', core: 'rgba(255,250,235,1)' },
    silhouettes: (ctx, w, h, horizon) => {
      const layers: Array<[string, number, number, number]> = [
        ['#93a9c6', 60, 170, 31],
        ['#6e88a8', 40, 120, 47],
        ['#4f6580', 20, 70, 59],
      ]
      for (const [color, minH, maxH, seed] of layers) {
        const r = rng(seed)
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.moveTo(0, horizon + 6)
        let y = horizon - minH
        for (let x = 0; x <= w; x += 24) {
          y += (r() - 0.5) * 40
          y = Math.min(horizon - minH, Math.max(horizon - maxH, y))
          ctx.lineTo(x, y)
        }
        ctx.lineTo(w, horizon + 6)
        ctx.closePath()
        ctx.fill()
      }
      // snow line on the far range
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      const r = rng(77)
      for (let x = 0; x < w; x += 48) {
        const y = horizon - 110 - r() * 50
        ctx.beginPath()
        ctx.moveTo(x, y + 12)
        ctx.lineTo(x + 18, y - 10)
        ctx.lineTo(x + 36, y + 14)
        ctx.closePath()
        ctx.fill()
      }
    },
  })
  group.add(skyDome(sky))

  // Terrain — displaced plane: mountain wall on −Z, valley drop on +Z
  const seg = mobile ? 70 : 120
  const terrainGeo = new THREE.PlaneGeometry(280, 280, seg, seg)
  const pos = terrainGeo.attributes.position as THREE.BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  const noise = (x: number, z: number) =>
    0.5 +
    0.25 * Math.sin(x * 0.11 + z * 0.07) +
    0.15 * Math.sin(x * 0.031 - z * 0.052 + 1.7) +
    0.1 * Math.sin((x + z) * 0.19)
  const grass = new THREE.Color(0x3f5a2c)
  const grass2 = new THREE.Color(0x5c6e33)
  const rock = new THREE.Color(0x6f6c68)
  const snow = new THREE.Color(0xeef2f5)
  const tmp = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = -pos.getY(i) // plane is rotated −90° about X afterwards
    const n = noise(x, z)
    let h = -0.06
    if (z < -7) {
      const d = -7 - z
      h = d * 0.5 + Math.pow(d, 1.4) * 0.09 * (0.55 + n)
    } else if (z > 6.5) {
      const d = z - 6.5
      h = -Math.min(d * 0.5, 16)
      if (z > 42) h += (z - 42) * 0.85 * (0.5 + n)
    }
    const ax = Math.abs(x)
    if (ax > 60) h += (ax - 60) * 0.55 * (0.5 + n)
    if (Math.abs(z) > 8 && h > -15.9) h += (n - 0.5) * 2.4
    pos.setZ(i, h)
    const rockMix = smoothstep(8, 22, h) * 0.9 + smoothstep(-16, -6, -Math.abs(z) + 6) * 0
    const snowMix = smoothstep(26, 40, h)
    tmp.copy(grass).lerp(grass2, n).lerp(rock, rockMix).lerp(snow, snowMix)
    colors[i * 3] = tmp.r
    colors[i * 3 + 1] = tmp.g
    colors[i * 3 + 2] = tmp.b
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  terrainGeo.computeVertexNormals()
  const terrain = new THREE.Mesh(
    terrainGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 }),
  )
  terrain.rotation.x = -Math.PI / 2
  terrain.receiveShadow = true
  group.add(terrain)

  // Road + gravel shoulder
  const asphaltTex = makeGroundTexture(13, '#2a2b2e', '#6d6e70', 0.32, false)
  asphaltTex.repeat.set(60, 3)
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(280, 9.4),
    new THREE.MeshStandardMaterial({ map: asphaltTex, color: 0x707174, roughness: 0.82, metalness: 0.02 }),
  )
  road.rotation.x = -Math.PI / 2
  road.receiveShadow = true
  group.add(road)
  const gravel = new THREE.Mesh(
    new THREE.PlaneGeometry(280, 13),
    new THREE.MeshStandardMaterial({ color: 0x8a7f6c, roughness: 1 }),
  )
  gravel.rotation.x = -Math.PI / 2
  gravel.position.y = -0.03
  gravel.receiveShadow = true
  group.add(gravel)
  {
    const [c, ctx] = makeCanvas(2048, 128) // 280 × 9.4 units → ≈7.3 px per unit
    const u = 2048 / 280
    ctx.fillStyle = 'rgba(245,245,240,0.85)'
    ctx.fillRect(0, 8, 2048, 3)
    ctx.fillRect(0, 117, 2048, 3)
    for (let x = 0; x < 2048; x += 6 * u) ctx.fillRect(x, 62, 3 * u, 4)
    const tex = srgbTexture(c)
    const marks = new THREE.Mesh(new THREE.PlaneGeometry(280, 9.4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }))
    marks.rotation.x = -Math.PI / 2
    marks.position.y = 0.012
    marks.renderOrder = 1
    group.add(marks)
  }

  // Guardrail on the valley side
  const railMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.85, roughness: 0.35 })
  const postMat = new THREE.MeshStandardMaterial({ color: 0x5a5d62, metalness: 0.6, roughness: 0.6 })
  for (let x = -120; x <= 120; x += 2.6) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.8, 0.14), postMat)
    post.position.set(x, 0.4, 5.6)
    group.add(post)
  }
  const wBeam = new THREE.Mesh(new THREE.BoxGeometry(240, 0.32, 0.08), railMat)
  wBeam.position.set(0, 0.62, 5.62)
  group.add(wBeam)
  // Rock face retaining wall on the mountain side
  const rockWall = new THREE.Mesh(
    new THREE.BoxGeometry(240, 1.6, 0.6),
    new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 1, flatShading: true }),
  )
  rockWall.position.set(0, 0.7, -7.2)
  group.add(rockWall)
  // Snow poles / delineators
  const delinMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6 })
  const delinRed = new THREE.MeshStandardMaterial({ color: 0xd42a2a, roughness: 0.6 })
  for (let x = -100; x <= 100; x += 12) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), delinMat)
    pole.position.set(x, 0.7, -6.6)
    group.add(pole)
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.2, 6), delinRed)
    band.position.set(x, 1.25, -6.6)
    group.add(band)
  }

  // Pines: scattered on the slopes, thinning with altitude
  group.add(
    makeForest(
      mobile ? 70 : 170,
      (r) => {
        const x = (r() - 0.5) * 220
        const side = r() < 0.45 ? -1 : 1
        const z = side < 0 ? -12 - r() * 26 : 12 + r() * 40
        const n = noise(x, z)
        let h = -0.06
        if (z < -7) {
          const d = -7 - z
          h = d * 0.5 + Math.pow(d, 1.4) * 0.09 * (0.55 + n)
        } else if (z > 6.5) {
          const d = z - 6.5
          h = -Math.min(d * 0.5, 16)
          if (z > 42) h += (z - 42) * 0.85 * (0.5 + n)
        }
        if (Math.abs(x) > 60) h += (Math.abs(x) - 60) * 0.55 * (0.5 + n)
        if (h > 24) return null
        return [x, h - 0.3, z]
      },
      21,
      0x22452a,
    ),
  )

  const sun = new THREE.DirectionalLight(0xffd9a3, 2.6)
  sun.position.set(45, 22, 30)
  group.add(sun)

  return {
    id: 'alpine',
    group,
    background: sky,
    lighting: {
      key: { color: 0xffd9a0, intensity: 560, position: [10, 4.2, 6] },
      rim: { color: 0x9fc4ff, intensity: 2.2, position: [-8, 5, -6] },
      hemi: { sky: 0x8fb4e0, ground: 0x4e4a34, intensity: 0.62 },
      fog: { color: 0xc6d2dd, density: 0.0058 },
      exposure: 1.0,
      environmentIntensity: 0.9,
      beamScale: 0.3,
      floorReflection: false,
    },
    dispose: () => {
      disposeGroup(group)
      sky.dispose()
    },
  }
}

/* ══════════════════════════════════════════════════════════════════════ */

export function buildLocationScene(id: SceneId, opts: { mobile: boolean }): LocationScene | null {
  switch (id) {
    case 'nurburgring':
      return buildNurburgring(opts.mobile)
    case 'garage':
      return buildGarage(opts.mobile)
    case 'alpine':
      return buildAlpine(opts.mobile)
    default:
      return null
  }
}
