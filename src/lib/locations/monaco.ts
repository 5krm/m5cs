/**
 * ═════════════════════════════════════════════════════════════════════════
 * 6 · MONACO MARINA — Port Hercule, 20:35, the last of the blue hour
 * ═════════════════════════════════════════════════════════════════════════
 * Water with real moving swell, a dozen moored yachts that bob on it, the
 * quay with its cut-stone paving and mooring bollards, the hill city stacked
 * behind with lit windows, palms along the quay, and the Grand Prix circuit
 * running past — barriers, kerbs, a grandstand over the water.
 *
 * Running logic: the water normals slide and the yachts ride them; channel
 * buoys blink out of phase; the lighthouse sweeps a beam across the harbour;
 * a fireworks shell goes up every ~35 s; gulls cross; flags stream; and the
 * rigging of each yacht rings against its mast in the swell.
 */

import * as THREE from 'three'
import {
  asphaltSurface,
  concreteMaterial,
  facadeMaterial,
  glassMaterial,
  hazardMaterial,
  metalMaterial,
  paintedMetal,
  signMaterial,
  stonePavingMaterial,
  waterSurface,
} from '@/lib/procedural/materials'
import { clamp01, lerp, mulberry32, smoothstep } from '@/lib/procedural/field'
import {
  Ctx,
  Ticks,
  bollard,
  catenary,
  disposeGroup,
  flatGround,
  glowSprite,
  guardRail,
  makeSky,
  motes,
  palm,
  puddle,
  simpleCar,
  skyDome,
  terrain,
  wetReflection,
} from './shared'
import type { LocationScene } from './types'

/** A procedural motor yacht: hull, superstructure, mast, rails, flag. */
function yacht(opts: {
  length: number
  hull: THREE.Material
  deck: THREE.Material
  glass: THREE.Material
  metal: THREE.Material
}): { group: THREE.Group; bob: (t: number, phase: number) => void } {
  const { length: L, hull, deck, glass, metal } = opts
  const g = new THREE.Group()
  const bez = new THREE.CubicBezierCurve3(
    new THREE.Vector3(-L / 2, 0, 0),
    new THREE.Vector3(-L * 0.2, -L * 0.075, 0),
    new THREE.Vector3(L * 0.3, -L * 0.06, 0),
    new THREE.Vector3(L / 2, L * 0.07, 0),
  )
  const pts = bez.getPoints(18)
  const shape = new THREE.Shape()
  shape.moveTo(-L / 2, 0)
  for (const p of pts) shape.lineTo(p.x, p.y)
  shape.lineTo(L / 2, L * 0.055)
  shape.lineTo(L / 2 - 0.2, L * 0.05)
  shape.lineTo(-L / 2 + 0.1, 0.02)
  shape.closePath()
  const hullMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: L * 0.22, bevelEnabled: false }), hull)
  hullMesh.rotation.y = Math.PI / 2
  hullMesh.position.z = (-L * 0.22) / 2
  hullMesh.castShadow = true
  g.add(hullMesh)
  // waterline stripe
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(L * 0.98, 0.05, L * 0.225), paintedMetal({ color: '#12213a', seed: 3, res: 32, gloss: 0.4 }))
  stripe.position.y = 0.06
  g.add(stripe)
  // superstructure + glass band
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(L * 0.44, L * 0.1, L * 0.17), deck)
  cabin.position.set(-L * 0.06, L * 0.11, 0)
  cabin.castShadow = true
  g.add(cabin)
  const glassBand = new THREE.Mesh(new THREE.BoxGeometry(L * 0.42, L * 0.045, L * 0.175), glass)
  glassBand.position.set(-L * 0.06, L * 0.12, 0)
  g.add(glassBand)
  const upper = new THREE.Mesh(new THREE.BoxGeometry(L * 0.26, L * 0.07, L * 0.13), deck)
  upper.position.set(-L * 0.12, L * 0.19, 0)
  g.add(upper)
  // mast, boom and rigging
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, L * 0.26, 8), metal)
  mast.position.set(-L * 0.04, L * 0.3, 0)
  g.add(mast)
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, L * 0.2, 6), metal)
  boom.rotation.z = Math.PI / 2
  boom.position.set(-L * 0.13, L * 0.24, 0)
  g.add(boom)
  g.add(catenary(new THREE.Vector3(-L * 0.04, L * 0.42, 0), new THREE.Vector3(L * 0.48, L * 0.08, 0), 0.08, 0.012, metal))
  g.add(catenary(new THREE.Vector3(-L * 0.04, L * 0.42, 0), new THREE.Vector3(-L * 0.48, L * 0.08, 0), 0.08, 0.012, metal))
  // bow rail
  for (const dz of [-L * 0.1, L * 0.1]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, L * 0.5, 6), metal)
    rail.rotation.z = Math.PI / 2
    rail.position.set(L * 0.2, L * 0.11, dz)
    g.add(rail)
  }
  // portholes + deck lights
  for (let i = 0; i < 4; i++) {
    const port = new THREE.Mesh(
      new THREE.CircleGeometry(L * 0.018, 10),
      new THREE.MeshStandardMaterial({ color: 0x0b1016, emissive: new THREE.Color('#ffd9a0'), emissiveIntensity: 0.5, roughness: 0.2 }),
    )
    port.position.set(-L * 0.3 + i * L * 0.14, L * 0.03, L * 0.115)
    g.add(port)
  }
  const deckGlow = glowSprite(0xffd9a0, L * 0.5, 0.22)
  deckGlow.position.set(-L * 0.06, L * 0.14, 0)
  g.add(deckGlow)
  // stern flag
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(L * 0.05, L * 0.03),
    new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.8 }),
  )
  flag.position.set(-L * 0.5, L * 0.12, 0)
  flag.rotation.z = -0.2
  g.add(flag)

  const bob = (t: number, phase: number) => {
    g.position.y = Math.sin(t * 0.85 + phase) * 0.09
    g.rotation.z = Math.sin(t * 0.62 + phase) * 0.028
    g.rotation.x = Math.cos(t * 0.71 + phase * 1.3) * 0.02
    flag.rotation.y = Math.sin(t * 3.1 + phase) * 0.5
  }
  return { group: g, bob }
}

export function buildMonaco(ctx: Ctx): LocationScene {
  const { mobile, heroRes, propRes } = ctx
  const group = new THREE.Group()
  const ticks = new Ticks()
  const rng = mulberry32(7703)

  /* ── Sky: blue hour with the last apricot band over the hill ──────── */
  const sky = makeSky({
    seed: 61,
    stops: [
      [0, '#08123a'],
      [0.24, '#123061'],
      [0.4, '#2f5b8c'],
      [0.47, '#7c86a2'],
      [0.5, '#d99a63'],
      [0.515, '#8a6a72'],
      [0.55, '#22293c'],
      [1, '#0a0d18'],
    ],
    sun: { x: 0.22, y: 0.482, r: 0.12, color: 'rgba(255,176,110,0.42)', core: 'rgba(255,236,206,0.9)', halo: 5 },
    stars: { density: 0.00035, brightness: 0.85 },
    clouds: { cover: 0.4, altitude: 0.44, color: '#f0b48f', shadow: '#2b3145', seed: 9 },
    haze: { height: 0.1, color: 'rgba(226,168,124,0.4)' },
    bloom: 0.8,
    silhouettes: (g, w, h, horizon) => {
      // the Rock: stacked Monaco with a lit crown
      const r = mulberry32(13)
      g.fillStyle = '#101420'
      g.beginPath()
      g.moveTo(0, horizon)
      g.lineTo(w * 0.06, horizon - 60)
      g.lineTo(w * 0.2, horizon - 86)
      g.lineTo(w * 0.34, horizon - 66)
      g.lineTo(w * 0.45, horizon - 110)
      g.lineTo(w * 0.58, horizon - 84)
      g.lineTo(w * 0.7, horizon - 126)
      g.lineTo(w * 0.86, horizon - 74)
      g.lineTo(w, horizon - 96)
      g.lineTo(w, horizon + 8)
      g.closePath()
      g.fill()
      // window field on the hillside
      for (let i = 0; i < 900; i++) {
        const x = r() * w
        const yBase = horizon - 40 - r() * 70
        if (yBase < horizon - 130) continue
        g.fillStyle = r() < 0.7 ? 'rgba(255,214,150,0.8)' : 'rgba(180,220,255,0.7)'
        g.fillRect(x, yBase, 2, 2)
      }
      // the palace silhouette on the crown
      g.fillStyle = '#161a26'
      g.fillRect(w * 0.68, horizon - 146, 26, 22)
      g.fillRect(w * 0.7, horizon - 156, 12, 12)
    },
  })
  group.add(skyDome(sky, 130))

  /* ── Harbour water ───────────────────────────────────────────────── */
  const water = waterSurface({ seed: 5, res: mobile ? 128 : 256, color: '#08161f', roughness: 0.05 })
  {
    const sea = flatGround({ size: 300, circle: false, material: water.material, tile: 12, y: -0.55, name: 'harbour' })
    group.add(sea)
    // the water plane is huge; give its normals a sane repeat
    const m = sea.material as THREE.MeshPhysicalMaterial
    m.normalMap?.repeat.set(26, 26)
  }

  /* ── Quay: cut stone paving, kerb, bollards, fenders, ropes ───────── */
  const paving = stonePavingMaterial({ seed: 17, res: heroRes, tone: '#8d8a82', tiles: 5 })
  {
    const quay = flatGround({ size: 90, circle: false, material: paving, tile: 4, y: 0, name: 'quay' })
    quay.scale.set(1, 0.92, 1) // flat plates: depth lives on scale.y
    group.add(quay)
    const kerb = new THREE.Mesh(
      new THREE.BoxGeometry(90, 0.26, 0.5),
      concreteMaterial({ seed: 33, res: propRes, kind: 'kerb', tone: '#c3c0b6' }),
    )
    kerb.position.set(0, 0.13, -10.4)
    group.add(kerb)
    // bollards along the edge with mooring lines running into the water
    const bollardMat = paintedMetal({ color: '#2b2f36', seed: 8, res: propRes, gloss: 0.45 })
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x6f6a58, roughness: 0.95 })
    for (let i = -4; i <= 4; i++) {
      const x = i * 9
      const b = bollard(bollardMat)
      b.position.set(x, 0, -9.8)
      group.add(b)
      const rope = catenary(
        new THREE.Vector3(x, 0.9, -9.9),
        new THREE.Vector3(x + 6 + rng() * 4, 0.1, -22 - rng() * 6),
        0.9,
        0.045,
        ropeMat,
      )
      group.add(rope)
    }
    // fenders hanging on the quay wall
    for (let i = -5; i <= 5; i++) {
      const fender = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.7, 10), new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 }))
      fender.position.set(i * 7.5, -0.35, -10.2)
      group.add(fender)
    }
  }

  /* ── Hill city: stacked buildings with lit facades ───────────────── */
  {
    const facades = [
      facadeMaterial({ seed: 21, cols: 6, rows: 10, lit: 0.5, tint: '#1a1a22', warm: '#ffd39a' }),
      facadeMaterial({ seed: 22, cols: 8, rows: 8, lit: 0.42, tint: '#1d1c26', warm: '#ffe0a8' }),
      facadeMaterial({ seed: 23, cols: 5, rows: 14, lit: 0.36, tint: '#181722', warm: '#cfe0ff' }),
    ]
    const shell = concreteMaterial({ seed: 44, res: 64, kind: 'wall', tone: '#8d8577' })
    const roofs = new THREE.MeshStandardMaterial({ color: 0x7a4a35, roughness: 0.9 })
    // the hill itself, so buildings stand on ground rather than a horizon
    const hill = terrain({
      size: 320,
      segments: mobile ? 60 : 120,
      material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }),
      tile: 20,
      height: (x, z) => {
        const d = Math.max(0, -z - 30)
        return d * 0.42 + Math.sin(x * 0.05) * 3 + Math.sin(x * 0.014 + 1) * 8
      },
      color: (x, z, y) => {
        const c = new THREE.Color(0x4c4437)
        c.lerp(new THREE.Color(0x6d6350), clamp01(y / 40))
        c.lerp(new THREE.Color(0x2b2a2c), clamp01((Math.abs(z) - 90) / 80))
        void x
        return c
      },
    })
    group.add(hill)

    for (let i = 0; i < (mobile ? 22 : 52); i++) {
      const x = (rng() - 0.5) * 190
      const z = -34 - rng() * 60
      const d = Math.max(0, -z - 30)
      const y = d * 0.42 + Math.sin(x * 0.05) * 3 + Math.sin(x * 0.014 + 1) * 8
      const w = 6 + rng() * 10
      const h = 7 + rng() * 16
      const dd = 6 + rng() * 9
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), [shell, shell, shell, shell, facades[i % 3], facades[i % 3]])
      body.position.set(x, y + h / 2 - 0.6, z)
      body.castShadow = true
      group.add(body)
      // roof: terracotta slab + AC units
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 1.06, 0.4, dd * 1.06), roofs)
      roof.position.set(x, y + h - 0.4, z)
      roof.rotation.z = (rng() - 0.5) * 0.03
      group.add(roof)
      for (let a = 0; a < 2; a++) {
        const ac = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.9), metalMaterial({ color: '#8b8f96', roughness: 0.6 }))
        ac.position.set(x + (rng() - 0.5) * w * 0.6, y + h - 0.1, z + (rng() - 0.5) * dd * 0.6)
        group.add(ac)
      }
      if (rng() < 0.3) {
        const { material } = signMaterial({
          text: rng() < 0.5 ? 'CASINO' : 'MONTE-CARLO',
          sub: 'Grand Prix 2026',
          bg: '#12070d',
          fg: '#ffd9a0',
          glow: '#ff5f8a',
          width: 512,
          height: 192,
        })
        const board = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, 2.4), material)
        board.position.set(x, y + h * 0.7, z + dd / 2 + 0.06)
        group.add(board)
        group.add(wetReflection(board, { groundY: -0.5, opacity: 0.2, stretch: 3.6 }))
      }
    }
  }

  /* ── Yachts moored on the water, gently riding the swell ─────────── */
  const bobbers: Array<{ bob: (t: number, phase: number) => void; phase: number }> = []
  {
    const hullA = paintedMetal({ color: '#f2f3f5', seed: 11, res: propRes, gloss: 0.2 })
    const hullB = paintedMetal({ color: '#1b2740', seed: 12, res: propRes, gloss: 0.22 })
    const deckTeak = new THREE.MeshStandardMaterial({ color: 0xa8845a, roughness: 0.62, metalness: 0.06 })
    const glass = glassMaterial({ tint: '#0e1720', opacity: 0.7, roughness: 0.06 })
    const metal = metalMaterial({ color: '#d6dbe2', roughness: 0.28 })
    const slots = mobile ? 5 : 9
    for (let i = 0; i < slots; i++) {
      const len = 12 + rng() * 16
      const craft = yacht({ length: len, hull: i % 2 === 0 ? hullA : hullB, deck: deckTeak, glass, metal })
      const x = -46 + i * (92 / slots) + rng() * 2
      const z = -19 - rng() * 9
      craft.group.position.set(x, -0.42, z)
      craft.group.rotation.y = (rng() - 0.5) * 0.16 + (z > -22 ? 0.05 : -0.05)
      group.add(craft.group)
      bobbers.push({ bob: craft.bob, phase: rng() * Math.PI * 2 })
    }
  }

  /* ── GP circuit furniture: barriers, kerbs, grandstand over water ── */
  {
    const concrete = concreteMaterial({ seed: 55, res: propRes, kind: 'slab', tone: '#b9b6ad' })
    for (let x = -44; x <= 44; x += 7.4) {
      const barrier = new THREE.Mesh(new THREE.BoxGeometry(7.2, 1.05, 0.6), concrete)
      barrier.position.set(x, 0.52, 12.4)
      barrier.castShadow = true
      group.add(barrier)
      // red/white paint blocks alternating along the wall
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(3.5, 0.9, 0.62),
        new THREE.MeshStandardMaterial({ color: Math.round((x + 44) / 7.4) % 2 === 0 ? 0xd42a2a : 0xf2f2ec, roughness: 0.6 }),
      )
      stripe.position.set(x - 1.8, 0.52, 12.4)
      group.add(stripe)
    }
    // sponsor panels
    const { material: sponsor } = signMaterial({ text: 'MONACO GP', sub: 'PORT HERCULE · 3.337 km', bg: '#0a0c12', fg: '#ffffff', glow: '#ffd24a', width: 512, height: 192 })
    for (const x of [-24, 0, 24]) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.0), sponsor)
      panel.position.set(x, 0.62, 12.72)
      group.add(panel)
    }
    // grandstand floating over the water on stilts
    const standMat = new THREE.MeshStandardMaterial({ color: 0x24303f, roughness: 0.85 })
    for (let i = 0; i < 8; i++) {
      const tier = new THREE.Mesh(new THREE.BoxGeometry(34, 0.95, 1.9), standMat)
      tier.position.set(0, 0.5 + i * 0.92, 26 + i * 1.9)
      group.add(tier)
      if (i % 2 === 0) {
        const bench = new THREE.Mesh(new THREE.BoxGeometry(33, 0.12, 0.4), new THREE.MeshStandardMaterial({ color: 0x1d2735, roughness: 0.7 }))
        bench.position.set(0, 1.02 + i * 0.92, 26 + i * 1.9 - 0.6)
        group.add(bench)
      }
    }
    for (let x = -16; x <= 16; x += 8) {
      const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 6, 10), metalMaterial({ color: '#5c6169', roughness: 0.6 }))
      pile.position.set(x, -2.6, 22)
      group.add(pile)
    }
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(36, 0.3, 14), paintedMetal({ color: '#e8e6e0', seed: 3, res: propRes, gloss: 0.4 }))
    canopy.position.set(0, 12, 32)
    canopy.rotation.x = -0.06
    group.add(canopy)
    const canopyGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 0.4),
      new THREE.MeshBasicMaterial({ color: 0xfff2d6, transparent: true, opacity: 0.9 }),
    )
    canopyGlow.position.set(0, 11.8, 25.4)
    canopyGlow.rotation.x = Math.PI / 2
    group.add(canopyGlow)
    // pit lane garages behind the stand
    const garageShell = concreteMaterial({ seed: 66, res: propRes, kind: 'wall', tone: '#6d7076' })
    for (let i = 0; i < 5; i++) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(7, 3.4, 6), garageShell)
      box.position.set(-14 + i * 7.2, 1.7, 40)
      group.add(box)
      const door = new THREE.Mesh(
        new THREE.PlaneGeometry(5.6, 2.6),
        new THREE.MeshStandardMaterial({ color: 0xf0efe9, emissive: new THREE.Color('#fff2d8'), emissiveIntensity: 0.8, roughness: 0.5 }),
      )
      door.position.set(-14 + i * 7.2, 1.5, 36.95)
      door.rotation.y = Math.PI
      group.add(door)
      const { material } = signMaterial({ text: String(i + 1), bg: '#d42a2a', fg: '#ffffff', glow: '#ffb0b0', width: 128, height: 128, border: false })
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), material)
      plate.position.set(-14 + i * 7.2, 3.0, 36.9)
      plate.rotation.y = Math.PI
      group.add(plate)
    }
    // palm trees along the quay
    const palmTrunk = new THREE.MeshStandardMaterial({ color: 0x6b5638, roughness: 0.95 })
    const frondMat = new THREE.MeshStandardMaterial({ color: 0x2e5a2c, roughness: 1, side: THREE.DoubleSide })
    for (let i = 0; i < (mobile ? 5 : 11); i++) {
      const x = -40 + i * 8 + rng() * 2
      const tree = palm(rng, { trunk: palmTrunk, frond: frondMat, height: 6 + rng() * 3 })
      tree.position.set(x, 0, -6 + rng() * 2.4)
      tree.rotation.y = rng() * Math.PI * 2
      tree.userData.phase = rng() * Math.PI * 2
      group.add(tree)
    }
    // asphalt pit lane strip
    const asphalt = asphaltSurface({ seed: 91, res: heroRes, freshness: 0.5, wet: 0.12, tile: 6, tracks: false })
    const lane = flatGround({ size: 60, circle: false, material: asphalt.material, tile: 6, y: 0.01 })
    lane.scale.set(1, 0.5, 1)
    lane.position.set(0, 0.01, 18)
    group.add(lane)
  }

  /* ── Channel buoys, lighthouse sweep, fireworks, gulls ───────────── */
  const buoyLights: THREE.Sprite[] = []
  {
    for (let i = 0; i < 5; i++) {
      const buoy = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.1, 10), paintedMetal({ color: i % 2 === 0 ? '#d43a2a' : '#2a8ad4', seed: i, res: 64, gloss: 0.4 }))
      const x = -50 + i * 26
      const z = -34 - rng() * 10
      buoy.position.set(x, -0.3, z)
      group.add(buoy)
      const light = glowSprite(i % 2 === 0 ? 0xff4d3d : 0x6fd0ff, 3.4, 0.8)
      light.position.set(x, 0.7, z)
      group.add(light)
      buoyLights.push(light)
    }
    // the lighthouse on the far point
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.5, 14, 14), concreteMaterial({ seed: 77, res: propRes, kind: 'wall', tone: '#e2e0d8' }))
    tower.position.set(-74, 6, -48)
    group.add(tower)
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.16, 1.24, 2.2, 14), paintedMetal({ color: '#d43a2a', seed: 4, res: 64, gloss: 0.4 }))
    band.position.set(-74, 8.4, -48)
    group.add(band)
    const lampRoom = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.2, 12), glassMaterial({ tint: '#9fd8ff', opacity: 0.6 }))
    lampRoom.position.set(-74, 13.4, -48)
    group.add(lampRoom)
    const lamp = glowSprite(0xfff2d0, 9, 0.85)
    lamp.position.set(-74, 13.4, -48)
    group.add(lamp)
    // the sweep: a long thin cone of light rotating around the lighthouse
    const sweep = new THREE.Mesh(
      new THREE.ConeGeometry(9, 42, 18, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff0cc, transparent: true, opacity: 0.055, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    )
    sweep.rotation.z = Math.PI / 2
    sweep.position.set(-74 + 21, 13.4, -48)
    group.add(sweep)
    ticks.add((t) => {
      sweep.position.set(-74 + Math.cos(t * 0.35) * 21, 13.4, -48 + Math.sin(t * 0.35) * 21)
      sweep.rotation.y = -t * 0.35
      lamp.material.opacity = 0.7 + Math.sin(t * 1.6) * 0.12
    })
  }

  // fireworks shells bursting over the harbour
  const shells: Array<{ points: THREE.Points; life: number }> = []
  {
    const count = mobile ? 3 : 5
    for (let i = 0; i < count; i++) {
      const particles = 90
      const geo = new THREE.BufferGeometry()
      const positions = new Float32Array(particles * 3)
      const dirs: THREE.Vector3[] = []
      for (let p = 0; p < particles; p++) {
        const v = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize().multiplyScalar(4 + rng() * 14)
        dirs.push(v)
      }
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const mat = new THREE.PointsMaterial({
        color: new THREE.Color().setHSL(rng(), 0.85, 0.62),
        size: 0.4,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        map: undefined,
      })
      const points = new THREE.Points(geo, mat)
      points.frustumCulled = false
      points.userData.dirs = dirs
      points.visible = false
      group.add(points)
      shells.push({ points, life: rng() })
    }
    ticks.add((t, dt) => {
      void t
      for (const shell of shells) {
        shell.life += dt / 5.2
        if (shell.life > 1.6) shell.life = -Math.abs(shell.life - 1.6) - Math.random() * 4
        const active = shell.life > 0 && shell.life < 1
        shell.points.visible = active
        if (!active) continue
        const k = shell.life
        const dirs = shell.points.userData.dirs as THREE.Vector3[]
        const arr = shell.points.geometry.attributes.position.array as Float32Array
        for (let i = 0; i < dirs.length; i++) {
          const spread = 0.35 + k * 1.6
          const gravity = -6 * k * k
          arr[i * 3] = dirs[i].x * spread
          arr[i * 3 + 1] = 26 + dirs[i].y * spread + gravity
          arr[i * 3 + 2] = dirs[i].z * spread
        }
        shell.points.position.set(-30 + (dirs.length % 5) * 12, 0, -30 - (dirs.length % 3) * 6)
        shell.points.geometry.attributes.position.needsUpdate = true
        const mat = shell.points.material as THREE.PointsMaterial
        mat.opacity = Math.sin(k * Math.PI) * 0.95
        mat.size = 0.5 * (1 - k * 0.4)
      }
    })
  }

  // gulls
  const gulls = new THREE.Group()
  for (let i = 0; i < 4; i++) {
    const gull = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.24),
      new THREE.MeshBasicMaterial({ color: 0xe8e9ea, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
    )
    gull.userData.phase = rng() * Math.PI * 2
    gull.userData.radius = 20 + rng() * 26
    gulls.add(gull)
  }
  group.add(gulls)
  ticks.add((t) => {
    for (const gull of gulls.children) {
      const ph = gull.userData.phase as number
      const r = gull.userData.radius as number
      const a = t * 0.12 + ph
      gull.position.set(Math.cos(a) * r, 7 + Math.sin(t * 0.5 + ph) * 1.6, -18 + Math.sin(a) * r * 0.5)
      gull.rotation.y = -a
      gull.scale.y = 1 + Math.sin(t * 5.5 + ph) * 0.8
    }
  })

  /* ── A safety car doing a slow lap of the pit lane ───────────────── */
  {
    const car = simpleCar({ body: 0xd8d8d2, headlight: 0xfff2d0, taillight: 0xff3a22, scale: 1 })
    group.add(car)
    ticks.add((t) => {
      const k = (t % 40) / 40
      car.position.set(lerp(-30, 30, k), 0.02, 17.4 + Math.sin(k * Math.PI * 2) * 0.6)
      car.rotation.y = Math.sin(k * Math.PI * 2) * 0.04
      car.visible = k < 0.97
    })
  }

  /* ── Quay clutter: crates, trolley, chains, a single puddle ─────── */
  {
    for (let i = 0; i < 6; i++) {
      const crateStack = new THREE.Mesh(
        new THREE.BoxGeometry(1.0, 0.9, 1.0),
        paintedMetal({ color: i % 2 === 0 ? '#3f4a55' : '#6b5a3f', seed: i, res: 128, gloss: 0.4 }),
      )
      crateStack.position.set(-20 + i * 7 + rng(), 0.45, 8 + rng() * 2)
      crateStack.rotation.y = rng()
      crateStack.castShadow = true
      group.add(crateStack)
    }
    const p = puddle({ radius: 2.4, opacity: 0.75 })
    p.position.set(9, 0.014, 6)
    group.add(p)
  }

  /* ── Logic: swell drives the boats, buoys blink, sails flap ─────── */
  const sailFlags: THREE.Object3D[] = []
  group.traverse((o) => {
    if (o.name === 'catenary') sailFlags.push(o)
  })
  ticks.add((t, dt) => {
    water.tick(t)
    for (const bobber of bobbers) bobber.bob(t, bobber.phase)
    for (let i = 0; i < buoyLights.length; i++) {
      const on = Math.sin(t * 1.1 + i * 1.9) > 0
      buoyLights[i].material.opacity = on ? 0.9 : 0.08
    }
    void dt
    void smoothstep
  })

  const moonlight = new THREE.DirectionalLight(0xa8c4ff, 0.85)
  moonlight.position.set(-40, 30, -30)
  group.add(moonlight)
  const quayLights = new THREE.HemisphereLight(0x8fa8d8, 0x1a1c24, 0.55)
  group.add(quayLights)

  void motes
  void hazardMaterial
  void guardRail
  void simpleCar

  return {
    id: 'monaco',
    group,
    background: sky,
    environment: sky,
    lighting: {
      key: { color: 0xffcf9a, intensity: 340, position: [-6, 6.6, 11] },
      rim: { color: 0x7ea8ff, intensity: 2.4, position: [10, 5, -14] },
      hemi: { sky: 0x40507a, ground: 0x161a22, intensity: 0.55 },
      fog: { color: 0x1c2433, density: 0.0125 },
      exposure: 1.0,
      environmentIntensity: 1.0,
      beamScale: 0.8,
      floorReflection: false,
      shadow: { far: 46, near: 2, angle: 0.85, penumbra: 0.6, focus: [0, 0.5, 0] },
    },
    facts: [
      { label: 'Port', value: 'Port Hercule · 20:35' },
      { label: 'Air', value: '21 °C · calm' },
      { label: 'Water', value: 'Swell 0.4 m' },
    ],
    update: (frame) => ticks.run(frame.time, frame.dt),
    dispose: () => {
      disposeGroup(group)
      sky.dispose()
    },
  }
}
