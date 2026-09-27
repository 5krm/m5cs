/**
 * ═════════════════════════════════════════════════════════════════════════
 * 5 · DUBAI DESERT — Al Qudra road, 18:05, 41 °C, sand on the move
 * ═════════════════════════════════════════════════════════════════════════
 * Dune field with wind ripples, a two-lane desert highway with drifting
 * sand on the upwind shoulder, marker poles marching to the horizon, a
 * caravan camp with a flapping tent and a fire, and the city skyline
 * dissolving into dust haze 40 km away.
 *
 * Running logic: sand streams across the road in the crosswind, a dust devil
 * wanders the far dune, the camp fire flickers and its smoke column leans
 * with the gusts, dune shadows crawl as the sun sinks, and a supply truck
 * runs the highway every 30 s.
 */

import * as THREE from 'three'
import { asphaltSurface, gravelMaterial, hazardMaterial, metalMaterial, mudMaterial, paintedMetal, rockMaterial, sandMaterial, signMaterial } from '@/lib/procedural/materials'
import { clamp01, lerp, mulberry32, smoothstep } from '@/lib/procedural/field'
import {
  Ctx,
  Ticks,
  barrel,
  catenary,
  crate,
  disposeGroup,
  flatGround,
  glowSprite,
  guardRail,
  makeSky,
  motes,
  ribbon,
  roadMarkings,
  simpleCar,
  skyDome,
  snowSystem,
  terrain,
} from './shared'
import type { LocationScene } from './types'

const ROAD: Array<[number, number]> = [
  [-160, -6],
  [-90, -3.4],
  [-20, -1],
  [50, 0.6],
  [120, 3],
  [170, 7],
]

export function buildDubai(ctx: Ctx): LocationScene {
  const { mobile, heroRes, propRes } = ctx
  const group = new THREE.Group()
  const ticks = new Ticks()
  const rng = mulberry32(5041)

  /* ── Sky: sand-thick sunset ───────────────────────────────────────── */
  const sky = makeSky({
    seed: 51,
    stops: [
      [0, '#243a72'],
      [0.2, '#5d6ba0'],
      [0.36, '#b98da0'],
      [0.44, '#e08a5b'],
      [0.48, '#f2a25c'],
      [0.5, '#f6c07c'],
      [0.53, '#8a5a3c'],
      [0.66, '#4a3220'],
      [1, '#2a1c12'],
    ],
    sun: { x: 0.5, y: 0.462, r: 0.13, color: 'rgba(255,196,120,0.6)', core: 'rgba(255,246,226,1)', halo: 6.5 },
    clouds: { cover: 0.34, altitude: 0.4, color: '#ffcaa0', shadow: '#5b4436', seed: 6 },
    haze: { height: 0.16, color: 'rgba(240,178,116,0.55)' },
    bloom: 1,
    silhouettes: (g, w, h, horizon) => {
      // distant skyline, half-eaten by dust: Downtown Dubai on the horizon
      const r = mulberry32(91)
      for (let i = 0; i < 26; i++) {
        const bw = 8 + r() * 26
        const bh = 14 + r() * 74
        const bx = w * 0.55 + (i / 26) * w * 0.4 + (r() - 0.5) * 12
        g.fillStyle = `rgba(150,110,86,${0.5 - (i / 26) * 0.24})`
        g.fillRect(bx, horizon - bh, bw, bh)
      }
      // the one tall spike
      const tx = w * 0.72
      g.fillStyle = 'rgba(158,118,94,0.42)'
      g.beginPath()
      g.moveTo(tx - 13, horizon)
      g.lineTo(tx - 4, horizon - 150)
      g.lineTo(tx, horizon - 232)
      g.lineTo(tx + 4, horizon - 150)
      g.lineTo(tx + 13, horizon)
      g.closePath()
      g.fill()
      g.fillStyle = 'rgba(120,86,64,0.3)'
      g.fillRect(0, horizon - 6, w, 10)
      g.fillStyle = '#3a2717'
      g.fillRect(0, horizon, w, h - horizon)
    },
  })
  group.add(skyDome(sky, 130))

  /* ── Dune field ───────────────────────────────────────────────────── */
  const sand = sandMaterial({ seed: 71, res: heroRes, tone: '#c99a5b', ripples: true })
  const duneHeight = (x: number, z: number) => {
    const long = Math.sin(x * 0.028 + z * 0.011) * 3.6
    const cross = Math.sin(z * 0.055 - x * 0.014 + 1.3) * 1.9
    const fine = Math.sin(x * 0.11 + z * 0.07) * 0.5
    // the road corridor is graded flat
    const roadDist = Math.abs(z * 0.92 + x * 0.06 + 1)
    const flatten = smoothstep(6, 26, roadDist)
    return (long + cross + fine) * flatten
  }
  {
    const duneMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: sand.map, normalMap: sand.normalMap, roughnessMap: sand.roughnessMap, metalnessMap: sand.metalnessMap, roughness: 1, metalness: 1, envMapIntensity: 0.85 })
    const dunes = terrain({
      size: 520,
      segments: mobile ? 110 : 200,
      material: duneMat,
      tile: 12,
      height: duneHeight,
      color: (x, z, y, slope) => {
        const c = new THREE.Color(0xd2a267)
        c.lerp(new THREE.Color(0xb07f45), clamp01(slope * 1.5))
        c.lerp(new THREE.Color(0xf0cd9a), clamp01((y + 1) / 8))
        // windward faces catch the low sun
        c.lerp(new THREE.Color(0xffd9a6), clamp01(Math.sin(x * 0.02) * 0.4 + 0.4) * 0.35)
        void z
        return c
      },
    })
    group.add(dunes)
  }

  /* ── The road: asphalt, blown-sand edges, drifted shoulders ───────── */
  {
    const asphalt = asphaltSurface({ seed: 77, res: heroRes, freshness: 0.15, wet: 0, tile: 8, tracks: true })
    const groundY = (x: number, z: number) => duneHeight(x, z) + 0.02
    group.add(
      ribbon({
        points: ROAD,
        width: 7.4,
        material: asphalt.material,
        tile: 8,
        y: 0,
        yOf: groundY,
        camber: 0.1,
        name: 'desertRoad',
      }),
    )
    group.add(roadMarkings({ points: ROAD, width: 7.4, tile: 7, lanes: 2, y: 0.02 }))
    // sand creeping over both shoulders in wind-shaped tongues
    const sandDrift = new THREE.MeshStandardMaterial({
      map: sand.map,
      normalMap: sand.normalMap,
      roughnessMap: sand.roughnessMap,
      metalnessMap: sand.metalnessMap,
      roughness: 1,
      metalness: 1,
    })
    /* The blown-sand shoulders: offset ribbons that ride the same graded
     * corridor as the tarmac instead of flat plates (a flat plate large
     * enough to read as sand is also large enough to bury the road). */
    for (const side of [-1, 1]) {
      group.add(
        ribbon({
          points: ROAD,
          width: 5.8,
          material: sandDrift,
          tile: 6,
          y: 0.03,
          offset: side * (3.7 + 2.9),
          camber: -side * 0.06,
          yOf: groundY,
          name: `sandDrift${side > 0 ? 'Far' : 'Near'}`,
        }),
      )
      // flakes of loose grain feathering off the drift onto the tarmac edge
      for (let i = 0; i < (mobile ? 7 : 16); i++) {
        const tongue = flatGround({ radius: 1.3 + rng() * 2.6, material: sandDrift, tile: 6, y: 0.032 })
        tongue.position.set(-130 + rng() * 260, 0.032, 0)
        // discs are rotated flat, so the world-Z extent lives on scale.y
        tongue.scale.set(1.5 + rng() * 0.9, 0.34 + rng() * 0.3, 1)
        tongue.rotation.y = rng() * Math.PI
        tongue.position.z = side * (3.4 + rng() * 1.9)
        group.add(tongue)
      }
    }
    // tyre tracks pressed into the sand, running beside the carriageway
    const tracks = new THREE.MeshStandardMaterial({ color: 0x9c7444, roughness: 1 })
    for (const offset of [-10.4, -9.3, 9.1, 10.2]) {
      group.add(
        ribbon({ points: ROAD, width: 0.36, material: tracks, tile: 6, y: 0.022, offset, yOf: groundY, name: `sandTrack${offset}` }),
      )
    }
    void guardRail
  }

  /* ── Marker poles marching to the horizon ────────────────────────── */
  {
    const white = paintedMetal({ color: '#e9e6dd', seed: 2, res: 64, gloss: 0.35 })
    const black = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 })
    for (let i = -26; i < 26; i++) {
      const x = i * 6.4
      const z = -5.4 - Math.sin(x * 0.02) * 1.2
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 0.12), white)
      pole.position.set(x, duneHeight(x, z) + 0.75, z)
      group.add(pole)
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.14), black)
      cap.position.set(x, duneHeight(x, z) + 1.62, z)
      group.add(cap)
      // reflective stud
      const stud = new THREE.Mesh(
        new THREE.PlaneGeometry(0.1, 0.16),
        new THREE.MeshBasicMaterial({ color: 0xfff0c0 }),
      )
      stud.position.set(x, duneHeight(x, z) + 1.28, z + 0.07)
      group.add(stud)
      if (i % 8 === 0) {
        const halo = glowSprite(0xffe1a0, 1.6, 0.14)
        halo.position.set(x, duneHeight(x, z) + 1.3, z + 0.2)
        group.add(halo)
      }
    }
    // camel-crossing sign, complete with silhouettes
    const crossing = signMaterial({ text: 'CAMELS', sub: 'next 12 km', bg: '#e8e6de', fg: '#141414', glow: '#ffd48a', width: 512, height: 256 })
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.15), crossing.material)
    board.position.set(-16, 2.7, -6.4)
    board.rotation.y = Math.PI * 0.08
    group.add(board)
    for (const dx of [-0.9, 0.9]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8), metalMaterial({ color: '#6d7076', roughness: 0.5 }))
      leg.position.set(-16 + dx, 1.2, -6.4)
      group.add(leg)
    }
    // camel silhouettes on the far dune
    for (let i = 0; i < 4; i++) {
      const camel = new THREE.Group()
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, 0.6), new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.95 }))
      body.position.y = 1.5
      camel.add(body)
      const hump = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 6), new THREE.MeshStandardMaterial({ color: 0x5d3f22, roughness: 0.95 }))
      hump.position.set(-0.2, 2.0, 0)
      camel.add(hump)
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 1.1, 8), new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.95 }))
      neck.rotation.z = -0.5
      neck.position.set(0.85, 2.0, 0)
      camel.add(neck)
      for (const [lx, lz] of [
        [0.5, 0.22],
        [0.5, -0.22],
        [-0.5, 0.22],
        [-0.5, -0.22],
      ] as const) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 1.2, 6), new THREE.MeshStandardMaterial({ color: 0x5d3f22, roughness: 0.95 }))
        leg.position.set(lx, 0.6, lz)
        camel.add(leg)
      }
      camel.position.set(38 + i * 2.6, duneHeight(38 + i * 2.6, -26) - 0.1, -26 + i * 0.6)
      camel.rotation.y = -0.4
      camel.scale.setScalar(0.95)
      group.add(camel)
    }
  }

  /* ── Desert camp: tent, fire, 4x4, crates ─────────────────────────── */
  const fireLight = new THREE.PointLight(0xff8a3a, 16, 16, 2)
  let flameRef: THREE.Mesh | null = null
  {
    const camp = new THREE.Group()
    const canvasMat = new THREE.MeshStandardMaterial({ color: 0x7d5a35, roughness: 0.92, side: THREE.DoubleSide })
    for (const dx of [-2.4, 2.4]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.0), canvasMat)
      wall.position.set(dx > 0 ? 1.6 : -1.6, 1.0, dx > 0 ? 0 : 0)
      wall.rotation.y = dx > 0 ? -0.9 : 0.9
      camp.add(wall)
    }
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 5.2), canvasMat)
    roof.rotation.x = Math.PI / 2.2
    roof.position.set(0, 2.1, 0)
    camp.add(roof)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 8), metalMaterial({ color: '#7c6a4e', roughness: 0.7 }))
    pole.position.set(0, 1.2, 2.4)
    camp.add(pole)
    const fire = new THREE.Group()
    const logMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.95 })
    for (let i = 0; i < 5; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.9, 7), logMat)
      log.rotation.set(Math.PI / 2.4, (i / 5) * Math.PI, 0)
      log.position.y = 0.12 + i * 0.04
      fire.add(log)
    }
    const flames = new THREE.Mesh(
      new THREE.ConeGeometry(0.42, 1.1, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    )
    flames.position.y = 0.6
    fire.add(flames)
    const emberGlow = glowSprite(0xff7a2a, 4, 0.55)
    emberGlow.position.y = 0.8
    fire.add(emberGlow)
    fireLight.position.set(0, 0.8, 0)
    fire.add(fireLight)
    fire.position.set(-14, duneHeight(-14, 12), 12)
    camp.add(fire)
    flameRef = flames
    // 4x4 with a sand-blasted roof rack
    const truck = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.5, 2), paintedMetal({ color: '#c8b48f', seed: 5, res: propRes, gloss: 0.35 }))
    body.position.y = 1.1
    truck.add(body)
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 1.9), paintedMetal({ color: '#b8a37e', seed: 6, res: propRes, gloss: 0.4 }))
    cabin.position.set(0.7, 2.1, 0)
    truck.add(cabin)
    const rack = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 1.8), metalMaterial({ color: '#8d8574', roughness: 0.5 }))
    rack.position.set(-0.6, 1.95, 0)
    truck.add(rack)
    for (const [x, z] of [
      [1.4, 1],
      [1.4, -1],
      [-1.4, 1],
      [-1.4, -1],
    ] as const) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.34, 12), new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.95 }))
      wheel.rotation.x = Math.PI / 2
      wheel.position.set(x, 0.5, z)
      truck.add(wheel)
    }
    truck.position.set(-22, duneHeight(-22, 8), 8)
    truck.rotation.y = 0.6
    camp.add(truck)
    for (let i = 0; i < 3; i++) {
      const c = crate(0.8, paintedMetal({ color: '#6f6a5c', seed: i, res: 64, gloss: 0.3 }))
      c.position.set(-12 + i * 1.2, duneHeight(-12 + i * 1.2, 10) + 0.3, 10)
      camp.add(c)
      const b = barrel(paintedMetal({ color: '#5a6b3f', seed: i, res: 64 }), metalMaterial({ color: '#8c8f94', roughness: 0.5 }))
      b.position.set(-6 + i * 1.1, duneHeight(-6 + i * 1.1, 13), 13)
      camp.add(b)
    }
    group.add(camp)

    // smoke column that leans with the gust
    const smoke = motes({ count: mobile ? 50 : 140, area: 6, height: 9, color: 0xb9a894, size: 0.85, opacity: 0.28 })
    smoke.points.position.set(-14, duneHeight(-14, 12) + 1, 12)
    group.add(smoke.points)
    ticks.add((t, dt) => {
      smoke.tick(t, dt)
      // the column walks downwind as it rises
      const arr = smoke.points.geometry.attributes.position.array as Float32Array
      const count = arr.length / 3
      for (let i = 0; i < count; i++) {
        if (arr[i * 3 + 1] > 0.5) arr[i * 3] += dt * 0.55
      }
      smoke.points.geometry.attributes.position.needsUpdate = true
    })
  }

  /* ── Blowing sand, dust devil, heat shimmer ──────────────────────── */
  const blowing = snowSystem({ count: mobile ? 400 : 1100, area: 120, height: 12, size: 0.14, color: 0xe0bb86, opacity: 0.4 })
  blowing.points.position.y = 0.4
  group.add(blowing.points)
  ticks.add((t, dt) => {
    blowing.tick(t, dt)
    const arr = blowing.points.geometry.attributes.position.array as Float32Array
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] += dt * 4.2 // crosswind
      if (arr[i] > 60) arr[i] -= 120
    }
    blowing.points.geometry.attributes.position.needsUpdate = true
  })

  const devil = new THREE.Group()
  {
    const column = motes({ count: mobile ? 60 : 160, area: 3.4, height: 9, color: 0xd9b183, size: 0.5, opacity: 0.34 })
    devil.add(column.points)
    group.add(devil)
    ticks.add((t, dt) => {
      column.tick(t, dt)
      const arr = column.points.geometry.attributes.position.array as Float32Array
      for (let i = 0; i < arr.length; i += 3) {
        const y = arr[i + 1]
        const ang = y * 0.8 + t * 2.4
        arr[i] += (-Math.sin(ang)) * 0.09
        arr[i + 2] += Math.cos(ang) * 0.09
      }
      column.points.geometry.attributes.position.needsUpdate = true
      const x = -40 + Math.sin(t * 0.05) * 46
      const z = 34 + Math.cos(t * 0.037) * 22
      devil.position.set(x, duneHeight(x, z), z)
      void dt
    })
  }

  const shimmer = motes({ count: mobile ? 40 : 120, area: 60, height: 6, color: 0xffe4bb, size: 0.4, opacity: 0.14 })
  shimmer.points.position.set(0, 1, -20)
  group.add(shimmer.points)
  ticks.add(shimmer.tick)

  /* ── Supply truck running the highway ────────────────────────────── */
  const truck = simpleCar({ body: 0xd8d3c4, headlight: 0xfff2cf, taillight: 0xff2a18, scale: 1.35 })
  group.add(truck)
  ticks.add((t) => {
    const cycle = 30
    const k = (t % cycle) / cycle
    const x = lerp(-90, 120, k)
    const z = -3.2 + Math.sin(x * 0.02) * 0.5
    truck.position.set(x, duneHeight(x, z) + 0.05 + Math.sin(x * 0.02) * 0.3, z)
    truck.visible = k < 0.985
  })

  /* ── The sun sinking: light, shadow, exposure ────────────────────── */
  const sun = new THREE.DirectionalLight(0xffbe7a, 3.1)
  sun.position.set(38, 12, 30)
  sun.castShadow = true
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048)
  sun.shadow.camera.near = 2
  sun.shadow.camera.far = 90
  sun.shadow.camera.left = -20
  sun.shadow.camera.right = 20
  sun.shadow.camera.top = 20
  sun.shadow.camera.bottom = -20
  sun.shadow.bias = -0.0008
  group.add(sun)
  const dustBounce = new THREE.HemisphereLight(0xffd7a0, 0x8a5a2c, 0.62)
  group.add(dustBounce)

  const sunSprite = glowSprite(0xffe0a8, 90, 0.42)
  sunSprite.position.set(120, 16, 40)
  group.add(sunSprite)

  const mirage = motes({ count: mobile ? 30 : 90, area: 80, height: 1.6, color: 0xfff2d8, size: 0.9, opacity: 0.1 })
  mirage.points.position.set(0, 0.2, -40)
  group.add(mirage.points)
  ticks.add(mirage.tick)

  ticks.add((t) => {
    // the camp fire breathes and gutters
    fireLight.intensity = 14 + Math.sin(t * 9.3) * 3.4 + Math.sin(t * 21.7) * 1.6
    if (flameRef) {
      flameRef.scale.set(1 + Math.sin(t * 12) * 0.12, 1 + Math.sin(t * 8.4) * 0.2, 1 + Math.cos(t * 11) * 0.12)
      flameRef.rotation.y = t * 1.4
    }
    // the sun settles: a touch lower, a touch redder
    const progress = (t % 240) / 240
    sun.position.set(38 - progress * 8, 12 - progress * 3.4, 30 + progress * 2)
    sun.intensity = 3.1 - progress * 0.5
    sunSprite.position.y = 16 - progress * 3.4
    ;(sunSprite.material as THREE.SpriteMaterial).opacity = 0.42 - progress * 0.1
    void lerp
    void clamp01
    void gravelMaterial
    void rockMaterial
    void mudMaterial
    void hazardMaterial
    void catenary
  })

  return {
    id: 'dubai',
    group,
    background: sky,
    environment: sky,
    lighting: {
      key: { color: 0xffc284, intensity: 520, position: [14, 6, 10] },
      rim: { color: 0x9fc0ff, intensity: 1.9, position: [-10, 5, -8] },
      hemi: { sky: 0xe0b98a, ground: 0x6d4426, intensity: 0.75 },
      fog: { color: 0xd9a877, density: 0.0135 },
      exposure: 1.02,
      environmentIntensity: 0.9,
      beamScale: 0.15,
      floorReflection: false,
      shadow: { far: 70, near: 2, angle: 0.85, penumbra: 0.55, focus: [0, 0.7, 0] },
    },
    facts: [
      { label: 'Air', value: '41 °C · dust haze' },
      { label: 'Wind', value: 'Crosswind 28 km/h' },
      { label: 'Surface', value: 'Sand over tarmac' },
    ],
    update: (frame) => ticks.run(frame.time, frame.dt),
    dispose: () => {
      disposeGroup(group)
      sky.dispose()
    },
  }
}
