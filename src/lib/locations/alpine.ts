/**
 * ═════════════════════════════════════════════════════════════════════════
 * 3 · ALPINE PASS — 2,140 m, 19:20, the last of the light on the north face
 * ═════════════════════════════════════════════════════════════════════════
 * A real pass: cut-and-fill roadway, W-beam guardrail on the valley side,
 * rock cut and snow netting on the mountain side, a chalet with one lit
 * window, avalanche poles, a stream dropping away, and the valley floor
 * disappearing into golden haze.
 *
 * Running logic: wind pushes the pines and the grass, clouds crawl across the
 * ridges, the sun flares whenever the camera looks into it, birds cross the
 * valley, a hay trailer crawls up the road with its headlights on, and a snow
 * patch drifts off the guardrail in the downdraft.
 */

import * as THREE from 'three'
import { grassMaterial, metalMaterial, paintedMetal, rockMaterial, signMaterial, snowMaterial, stonePavingMaterial, asphaltSurface, concreteMaterial } from '@/lib/procedural/materials'
import { clamp01, lerp, mulberry32, smoothstep } from '@/lib/procedural/field'
import {
  Ctx,
  Ticks,
  broadleaf,
  conifer,
  disposeGroup,
  flatGround,
  glowSprite,
  guardRail,
  makeSky,
  motes,
  ribbon,
  roadMarkings,
  skyDome,
  snowSystem,
  terrain,
  trussTower,
} from './shared'
import type { LocationScene } from './types'

/** The pass centre-line — a long right-hand sweep, then a hairpin shoulder. */
const ROAD_POINTS: Array<[number, number]> = [
  [-140, 12],
  [-96, 8],
  [-58, 4.6],
  [-22, 1.6],
  [12, 0.4],
  [46, 0.1],
  [82, 1.4],
  [116, 5.2],
  [140, 12],
]

const ROAD_HALF = 4.4

/** Height of the mountain wall on the −Z side of the pass. */
/**
 * Height of the carriageway bench. The pass is cut into the flank, so the road
 * climbs slightly towards the ends and undulates across the valley — verges
 * have to use the same function or they detach from the tarmac.
 */
function passBench(x: number) {
  return clamp01(Math.abs(x) / 150) * 1.4 + Math.sin(x * 0.02) * 0.35
}

function northFace(x: number, z: number) {
  const d = Math.max(0, -z - 7)
  const ridge = Math.sin(x * 0.021) * 9 + Math.sin(x * 0.047 + 2.1) * 4.5 + Math.sin(x * 0.009 + 0.4) * 14
  return d * 0.62 + Math.pow(d, 1.18) * 0.1 + ridge * smoothstep(0, 45, d)
}

/** Height of the valley floor on the +Z side. */
function valley(x: number, z: number) {
  const d = Math.max(0, z - 6.5)
  const drop = -Math.min(d * 0.42, 13) - Math.pow(d, 1.06) * 0.05
  const far = Math.max(0, z - 46)
  return drop + far * 0.35 + Math.sin(x * 0.017) * 5 * smoothstep(0, 40, d)
}

export function buildAlpine(ctx: Ctx): LocationScene {
  const { mobile, heroRes, propRes } = ctx
  const group = new THREE.Group()
  const ticks = new Ticks()
  const rng = mulberry32(3141)

  /* ── Sky: post-golden-hour, sun still on the west ridge ────────────── */
  const sky = makeSky({
    seed: 21,
    stops: [
      [0, '#1b4a93'],
      [0.22, '#3d78c4'],
      [0.4, '#8fb6dc'],
      [0.46, '#d6cbb0'],
      [0.485, '#f2d19a'],
      [0.5, '#f7dCaF'],
      [0.52, '#8f8f7e'],
      [0.78, '#4d5a45'],
      [1, '#39412f'],
    ],
    sun: { x: 0.82, y: 0.452, r: 0.16, color: 'rgba(255,214,150,0.55)', core: 'rgba(255,252,240,1)', halo: 5.4 },
    clouds: { cover: 0.55, altitude: 0.58, color: '#fff3dd', shadow: '#6d7c96', seed: 4 },
    haze: { height: 0.13, color: 'rgba(246,222,186,0.45)' },
    bloom: 0.85,
    silhouettes: (g, w, h, horizon) => {
      // far range with a snow line, then two darker nearer ranges
      const layers: Array<[string, number, number, number]> = [
        ['#9fb7d2', 52, 148, 11],
        ['#6f89a8', 30, 96, 23],
        ['#4d6580', 12, 56, 37],
      ]
      for (const [color, minH, maxH, seed] of layers) {
        const r = mulberry32(seed)
        g.fillStyle = color
        g.beginPath()
        g.moveTo(0, horizon + 6)
        let y = horizon - minH
        for (let x = 0; x <= w; x += 20) {
          y += (r() - 0.5) * 46
          y = Math.min(horizon - minH, Math.max(horizon - maxH, y))
          g.lineTo(x, y)
        }
        g.lineTo(w, horizon + 8)
        g.closePath()
        g.fill()
      }
      // snow caps on the highest ridge
      g.fillStyle = 'rgba(255,255,255,0.5)'
      const r = mulberry32(77)
      for (let x = 0; x < w; x += 40) {
        const y = horizon - 118 - r() * 44
        g.beginPath()
        g.moveTo(x, y + 16)
        g.lineTo(x + 16, y - 12)
        g.lineTo(x + 34, y + 18)
        g.closePath()
        g.fill()
      }
    },
  })
  group.add(skyDome(sky, 130))

  /* ── Terrain: mountain wall + valley floor, vertex-coloured by slope ── */
  const rockMat = rockMaterial({ seed: 88, res: propRes, tone: '#79736b' })
  const alpineMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.98,
    metalness: 0,
    map: null,
  })
  {
    const rock = new THREE.Color(0x6c6a63)
    const grass = new THREE.Color(0x415a2c)
    const grassDry = new THREE.Color(0x6d7040)
    const snow = new THREE.Color(0xe9eef4)
    const scree = new THREE.Color(0x8b8579)
    const land = terrain({
      size: 340,
      segments: mobile ? 96 : 180,
      material: alpineMat,
      tile: 12,
      height: (x, z) => (z < 0 ? northFace(x, z) : valley(x, z)),
      color: (x, z, y, slope) => {
        const c = new THREE.Color()
        const patchy = 0.5 + 0.5 * Math.sin(x * 0.13 + z * 0.09)
        c.copy(grass).lerp(grassDry, patchy * 0.6)
        c.lerp(rock, clamp01(slope * 1.35))
        c.lerp(scree, clamp01((y - 18) / 26) * 0.7)
        c.lerp(snow, clamp01((y - 34) / 20) * 0.85)
        // sunlit west faces are warmer
        c.lerp(new THREE.Color(0xd7b184), clamp01((x + 40) / 160) * 0.18)
        return c
      },
    })
    land.receiveShadow = true
    group.add(land)
    void rockMat
  }

  /* ── Rock cut, netting and a retaining wall on the mountain side ───── */
  {
    const cut = new THREE.Mesh(new THREE.BoxGeometry(300, 3.4, 1.2), rockMat)
    cut.position.set(0, 1.2, -7.6)
    cut.rotation.x = -0.12
    cut.castShadow = true
    group.add(cut)
    // rock bolts + wire mesh over the cut
    const netMat = metalMaterial({ color: '#8d9298', roughness: 0.5 })
    for (let x = -140; x <= 140; x += 4) {
      const anchor = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), netMat)
      anchor.rotation.x = Math.PI / 2
      anchor.position.set(x, 2.2 + rng() * 0.6, -7.1)
      group.add(anchor)
    }
    // drainage channel at the toe of the cut
    const channel = new THREE.Mesh(
      new THREE.BoxGeometry(300, 0.22, 0.5),
      concreteMaterial({ seed: 12, res: 128, kind: 'kerb', tone: '#8d8b84' }),
    )
    channel.position.set(0, 0.06, -6.9)
    group.add(channel)
  }

  /* ── Road: asphalt ribbon + markings + gravel shoulder ────────────── */
  {
    const asphalt = asphaltSurface({ seed: 9, res: heroRes, freshness: 0.45, wet: 0.05, tile: 7, tracks: true })
    const groundY = (_x: number, _z: number) => passBench(_x)
    const road = ribbon({
      points: ROAD_POINTS,
      width: ROAD_HALF * 2,
      material: asphalt.material,
      tile: 7,
      y: 0.02,
      yOf: groundY,
      camber: 0.06,
      name: 'passRoad',
    })
    group.add(road)
    group.add(
      roadMarkings({
        points: ROAD_POINTS,
        width: ROAD_HALF * 2,
        tile: 6,
        lanes: 2,
        y: 0.035,
      }),
    )
    // edge wear: a darker strip where tyres polish the surface
    const shoulder = ribbon({
      points: ROAD_POINTS,
      width: ROAD_HALF * 2 + 3.4,
      material: new THREE.MeshStandardMaterial({ color: 0x6f6a5e, roughness: 1, metalness: 0 }),
      tile: 10,
      y: 0.005,
      yOf: groundY,
      name: 'shoulder',
    })
    group.add(shoulder)
  }

  /* ── Guardrail on the valley side, following the curve ────────────── */
  {
    const railMetal = metalMaterial({ color: '#b6bac0', roughness: 0.35 })
    const postMetal = metalMaterial({ color: '#5f6367', roughness: 0.6 })
    const reflector = new THREE.MeshStandardMaterial({ color: 0xffd24a, roughness: 0.35, emissive: new THREE.Color(0x704e00), emissiveIntensity: 0.4 })
    for (let i = 0; i < ROAD_POINTS.length - 1; i++) {
      const [x0, z0] = ROAD_POINTS[i]
      const [x1, z1] = ROAD_POINTS[i + 1]
      const seg = guardRail({
        length: Math.hypot(x1 - x0, z1 - z0),
        spacing: 4,
        metal: railMetal,
        post: postMetal,
        reflector,
        height: 0.78,
      })
      seg.position.set((x0 + x1) / 2, 0.02, (z0 + z1) / 2 + ROAD_HALF - 0.35)
      seg.rotation.y = -Math.atan2(z1 - z0, x1 - x0)
      group.add(seg)
    }
    void railMetal
  }

  /* ── Avalanche poles, signs and a chalet with one warm window ─────── */
  {
    const poleMat = paintedMetal({ color: '#e8e6df', seed: 7, res: 64, gloss: 0.4 })
    const bandMat = new THREE.MeshStandardMaterial({ color: 0xd2332c, roughness: 0.5 })
    for (let x = -120; x <= 120; x += 11) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.9, 8), poleMat)
      pole.position.set(x, 0.95, -6.4)
      group.add(pole)
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.26, 8), bandMat)
      band.position.set(x, 1.66, -6.4)
      group.add(band)
    }
    // black-on-white chevron markers at the two tightest bends
    const chevron = signMaterial({ text: '◄', bg: '#101418', fg: '#ffffff', glow: '#ffffff', width: 256, height: 256, border: false })
    for (const [x, z] of [
      [82, ROAD_HALF + 0.6],
      [-58, ROAD_HALF + 0.6],
    ] as const) {
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), chevron.material)
      board.position.set(x, 1.35, z + 5.2)
      board.rotation.y = 0.18
      board.castShadow = true
      group.add(board)
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 0.08), metalMaterial({ color: '#3f4245', roughness: 0.6 }))
      post.position.set(x, 0.75, z + 5.2)
      group.add(post)
    }
    // "Alpine pass" place sign
    const place = signMaterial({ text: 'PASSHÖHE 2140 m', sub: 'Nordschleife des Südens · 12 %', bg: '#123a6b', fg: '#ffffff', glow: '#6fb3ff', width: 512, height: 224 })
    const placeMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.1), place.material)
    placeMesh.position.set(-34, 1.9, 6.1)
    placeMesh.rotation.y = -0.14
    group.add(placeMesh)
    for (const dx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.6, 0.09), metalMaterial({ color: '#5c6064', roughness: 0.5 }))
      leg.position.set(-34 + dx * 1.1, 1.3, 6.1)
      group.add(leg)
    }

    // chalet perched above the road on the mountain side
    const chalet = new THREE.Group()
    const wood = new THREE.MeshStandardMaterial({ color: 0x53381f, roughness: 0.92 })
    const stone = stonePavingMaterial({ seed: 3, res: 128, tone: '#8a8276', tiles: 4 })
    const base = new THREE.Mesh(new THREE.BoxGeometry(9, 3.4, 7), stone)
    base.position.y = 1.7
    base.castShadow = true
    chalet.add(base)
    const upper = new THREE.Mesh(new THREE.BoxGeometry(9.6, 2.6, 7.4), wood)
    upper.position.y = 4.6
    upper.castShadow = true
    chalet.add(upper)
    const roof = new THREE.Mesh(new THREE.BoxGeometry(11.4, 0.35, 9), new THREE.MeshStandardMaterial({ color: 0x2c2b28, roughness: 0.85 }))
    roof.position.y = 6.05
    roof.rotation.z = 0.06
    chalet.add(roof)
    const roof2 = roof.clone()
    roof2.rotation.z = -0.06
    roof2.position.y = 6.6
    roof2.scale.set(0.82, 1, 0.9)
    chalet.add(roof2)
    for (let i = 0; i < 3; i++) {
      const shutter = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.2, 0.1), paintedMetal({ color: '#7a2b23', seed: i, res: 64, gloss: 0.4 }))
      shutter.position.set(-3 + i * 3, 4.8, -3.7)
      chalet.add(shutter)
    }
    const litWindow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 1.0),
      new THREE.MeshBasicMaterial({ color: 0xffcf8a }),
    )
    litWindow.position.set(1.2, 3.9, -3.72)
    chalet.add(litWindow)
    const winGlow = glowSprite(0xffc27a, 6.5, 0.4)
    winGlow.position.set(1.2, 3.9, -4.3)
    chalet.add(winGlow)
    const winLight = new THREE.PointLight(0xffc27a, 9, 14, 2)
    winLight.position.set(1.2, 3.7, -5)
    chalet.add(winLight)
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.4, 0.9), stone)
    chimney.position.set(3.4, 6.4, 1.4)
    chalet.add(chimney)
    chalet.position.set(26, northFace(26, -12) - 1.4, -12)
    chalet.rotation.y = 0.35
    group.add(chalet)

    // wooden fence + hay bales along the bench
    const fenceMat = wood
    for (let i = 0; i < 12; i++) {
      const x = -18 + i * 1.9
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), fenceMat)
      post.position.set(x, 0.55, -6.1)
      group.add(post)
      if (i % 3 === 0) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(5.7, 0.1, 0.07), fenceMat)
        rail.position.set(x + 1.9, 0.92, -6.1)
        group.add(rail)
      }
    }
  }

  /* ── Trees: conifers on both flanks, a few broadleaf in the valley ── */
  const swayers: THREE.Object3D[] = []
  {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.95 })
    const needleA = new THREE.MeshStandardMaterial({ color: 0x1f3a24, roughness: 1, flatShading: true })
    const needleB = new THREE.MeshStandardMaterial({ color: 0x2c4a2c, roughness: 1, flatShading: true })
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x4c6b2c, roughness: 1, flatShading: true })
    const treeCount = mobile ? 90 : 240
    for (let i = 0; i < treeCount; i++) {
      const x = (rng() - 0.5) * 300
      const side = rng() < 0.62 ? -1 : 1
      const z = side < 0 ? -13 - rng() * 52 : 16 + rng() * 60
      const y = side < 0 ? northFace(x, z) : valley(x, z)
      if (y > 30) continue // above the tree line
      const isNeedle = !(side > 0 && rng() < 0.25)
      const tree = isNeedle
        ? conifer(rng, { trunk: trunkMat, foliage: rng() < 0.5 ? needleA : needleB }, 5 + rng() * 7)
        : broadleaf(rng, { trunk: trunkMat, foliage: leafMat }, 4 + rng() * 3)
      tree.position.set(x, y - 0.4, z)
      tree.rotation.y = rng() * Math.PI * 2
      tree.userData.phase = rng() * Math.PI * 2
      group.add(tree)
      if (swayers.length < 90) swayers.push(tree)
    }
  }

  /* ── Grass tufts along the verge + snow patches against the cut ───── */
  {
    const grassMat = grassMaterial({ seed: 44, res: propRes, tone: '#59632f', dry: 0.45 })
    // verge turf on the valley side — an offset ribbon, so it follows the pass
    // instead of hovering over the drop as a flat plate
    group.add(
      ribbon({
        points: ROAD_POINTS,
        width: 5.2,
        material: grassMat,
        tile: 5,
        y: 0.012,
        offset: ROAD_HALF + 2.4,
        camber: -0.05,
        yOf: (x) => passBench(x),
        name: 'valleyVerge',
      }),
    )
    const snowMat = snowMaterial({ seed: 5, res: propRes })
    // ploughed snow pushed against the rock cut on the mountain side
    group.add(
      ribbon({
        points: ROAD_POINTS,
        width: 3.6,
        material: snowMat,
        tile: 5,
        y: 0.03,
        offset: -(ROAD_HALF + 1.9),
        camber: 0.09,
        yOf: (x) => passBench(x),
        name: 'snowBank',
      }),
    )
    for (let i = 0; i < (mobile ? 5 : 11); i++) {
      const s = flatGround({ radius: 3 + rng() * 6, material: snowMat, tile: 7, y: 0.025 })
      s.position.set(-120 + rng() * 240, 0, -5.2 - rng() * 1.4)
      group.add(s)
    }
  }

  /* ── Atmosphere: valley haze, low cloud, snow spindrift, birds ─────── */
  const haze = motes({ count: mobile ? 60 : 150, area: 120, height: 26, color: 0xffe6c0, size: 0.22, opacity: 0.22 })
  haze.points.position.y = 1
  group.add(haze.points)
  ticks.add(haze.tick)

  const spindrift = snowSystem({ count: mobile ? 180 : 420, area: 90, height: 14, size: 0.09, color: 0xf4f8ff, opacity: 0.4 })
  group.add(spindrift.points)
  ticks.add(spindrift.tick)

  const birds = new THREE.Group()
  for (let i = 0; i < 5; i++) {
    const bird = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.22),
      new THREE.MeshBasicMaterial({ color: 0x1c1d20, side: THREE.DoubleSide, transparent: true, opacity: 0.75 }),
    )
    bird.userData.phase = rng() * Math.PI * 2
    bird.userData.radius = 26 + rng() * 24
    bird.userData.height = 14 + rng() * 9
    birds.add(bird)
  }
  group.add(birds)
  ticks.add((t) => {
    for (const bird of birds.children) {
      const ph = bird.userData.phase as number
      const radius = bird.userData.radius as number
      const a = t * 0.09 + ph
      bird.position.set(Math.cos(a) * radius, (bird.userData.height as number) + Math.sin(t * 0.4 + ph) * 1.2, Math.sin(a) * radius * 0.6 - 10)
      bird.rotation.y = -a
      bird.scale.y = 1 + Math.sin(t * 6 + ph) * 0.7
    }
  })

  /* ── The trailer crawling up the pass ─────────────────────────────── */
  const trailer = new THREE.Group()
  {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.3, 2.3), paintedMetal({ color: '#2f5e34', seed: 4, res: propRes, gloss: 0.4 }))
    cab.position.set(1.6, 1.35, 0)
    trailer.add(cab)
    const bed = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.4, 2.3), paintedMetal({ color: '#4a4d52', seed: 6, res: propRes, gloss: 0.3 }))
    bed.position.set(-0.9, 0.9, 0)
    trailer.add(bed)
    for (let i = 0; i < 5; i++) {
      const bale = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.0, 12), new THREE.MeshStandardMaterial({ color: 0xbfa457, roughness: 0.95 }))
      bale.rotation.z = Math.PI / 2
      bale.position.set(-2.4 + i, 1.6, 0)
      trailer.add(bale)
    }
    for (const [x, z] of [
      [1.6, 1.15],
      [1.6, -1.15],
      [-1.4, 1.15],
      [-1.4, -1.15],
    ] as const) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.3, 12), new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.95 }))
      wheel.rotation.x = Math.PI / 2
      wheel.position.set(x, 0.44, z)
      trailer.add(wheel)
    }
    const head = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.2), new THREE.MeshBasicMaterial({ color: 0xfff0cf }))
    head.position.set(2.82, 1.1, 0.75)
    head.rotation.y = Math.PI / 2
    trailer.add(head)
    const head2 = head.clone()
    head2.position.z = -0.75
    trailer.add(head2)
    const beam = glowSprite(0xffeec6, 6, 0.3)
    beam.position.set(3.2, 1.1, 0)
    trailer.add(beam)
    trailer.scale.setScalar(0.92)
  }
  group.add(trailer)
  ticks.add((t) => {
    const cycle = 26
    const k = (t % cycle) / cycle
    const x = lerp(-58, 54, k)
    trailer.position.set(x, 0.05 + Math.sin(x * 0.02) * 0.35, ROAD_HALF - 2.6)
    trailer.rotation.z = Math.sin(x * 0.02) * 0.02
    trailer.visible = k < 0.985
  })

  /* ── Wind: trees and grass lean with the gust, snow lifts off ─────── */
  const sunSprite = glowSprite(0xffe3ae, 60, 0.34)
  sunSprite.position.set(96, 34, 46)
  group.add(sunSprite)

  ticks.add((t) => {
    const gust = Math.sin(t * 0.31) * 0.5 + Math.sin(t * 0.87 + 1.2) * 0.3 + 0.6
    for (let i = 0; i < swayers.length; i++) {
      const tree = swayers[i]
      const ph = tree.userData.phase as number
      tree.rotation.z = Math.sin(t * 1.4 + ph) * 0.022 * gust
      tree.rotation.x = Math.cos(t * 1.1 + ph * 1.7) * 0.012 * gust
    }
    const sun = sunSprite.material as THREE.SpriteMaterial
    sun.opacity = 0.3 + Math.sin(t * 0.5) * 0.04
    haze.points.position.y = 1 + Math.sin(t * 0.12) * 0.8
  })

  /* ── Lighting: warm sun + cool alpine bounce ──────────────────────── */
  const sun = new THREE.DirectionalLight(0xffcf8f, 2.5)
  sun.position.set(70, 26, 40)
  sun.castShadow = true
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048)
  sun.shadow.camera.near = 2
  sun.shadow.camera.far = 90
  sun.shadow.camera.left = -22
  sun.shadow.camera.right = 22
  sun.shadow.camera.top = 22
  sun.shadow.camera.bottom = -22
  sun.shadow.bias = -0.0009
  sun.shadow.normalBias = 0.03
  group.add(sun)
  const bounce = new THREE.HemisphereLight(0x9dc2ea, 0x5a5236, 0.75)
  group.add(bounce)

  void trussTower

  return {
    id: 'alpine',
    group,
    background: sky,
    environment: sky,
    lighting: {
      key: { color: 0xffd39a, intensity: 520, position: [11, 5.4, 7] },
      rim: { color: 0x9fc4ff, intensity: 2.4, position: [-9, 5, -7] },
      hemi: { sky: 0x93b8e2, ground: 0x4b472f, intensity: 0.6 },
      fog: { color: 0xc3d1e0, density: 0.0052 },
      exposure: 1.02,
      environmentIntensity: 0.95,
      beamScale: 0.25,
      floorReflection: false,
      shadow: { far: 70, near: 2, angle: 0.8, penumbra: 0.5, focus: [0, 0.7, 0] },
    },
    facts: [
      { label: 'Altitude', value: '2,140 m' },
      { label: 'Air', value: '6 °C · gusting 34 km/h' },
      { label: 'Surface', value: 'Dry tarmac, cold' },
    ],
    update: (frame) => ticks.run(frame.time, frame.dt),
    dispose: () => {
      disposeGroup(group)
      sky.dispose()
    },
  }
}
