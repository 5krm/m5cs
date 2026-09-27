/**
 * ═════════════════════════════════════════════════════════════════════════
 * 7 · CARGO DOCKS — container terminal, 01:10, drizzle and diesel
 * ═════════════════════════════════════════════════════════════════════════
 * Stacked 20/40 ft containers with corrugated skins and corner castings, a
 * gantry crane that actually works the yard (trolley travels, spreader
 * lowers, hoist light on), a container ship heaving gently against its
 * moorings, a warehouse with roller doors, floodlight masts, a forklift
 * doing laps of the apron, and steam venting off the plant across the water.
 *
 * Running logic: the gantry trolley and spreader cycle through a real pick
 * and place; the ship rides its mooring lines; the forklift drives a loop
 * with a load; beacons flash on the crane legs and mast tops; steam columns
 * drift; drizzle falls; and the puddles mirror the sodium floods.
 */

import * as THREE from 'three'
import {
  asphaltSurface,
  concreteMaterial,
  corrugatedMetal,
  hazardMaterial,
  metalMaterial,
  paintedMetal,
  signMaterial,
} from '@/lib/procedural/materials'
import { clamp01, lerp, mulberry32 } from '@/lib/procedural/field'
import {
  Ctx,
  Ticks,
  barrel,
  bollard,
  catenary,
  chainFence,
  crate,
  disposeGroup,
  dumpster,
  flatGround,
  floodMast,
  fogBank,
  glowSprite,
  makeSky,
  motes,
  palm,
  puddle,
  puddleField,
  rainSystem,
  simpleCar,
  skyDome,
  trafficCone,
  tyreStack,
  wetReflection,
  buildingBox,
} from './shared'
import type { LocationScene } from './types'

/** A shipping container: corrugated body, corner castings, doors, markings. */
function container(opts: { length: number; color: string; seed: number; res: number }): THREE.Group {
  const { length: L, color, seed, res } = opts
  const g = new THREE.Group()
  const skin = corrugatedMetal({ color, seed, res, ribs: Math.round(L * 5.2), depth: 0.85 })
  const frame = metalMaterial({ color: '#23252a', roughness: 0.55 })
  const body = new THREE.Mesh(new THREE.BoxGeometry(L, 2.6, 2.44), skin)
  body.position.y = 1.3
  body.castShadow = true
  body.receiveShadow = true
  g.add(body)
  // corner castings + end frames
  for (const x of [-L / 2, L / 2]) {
    for (const z of [-1.22, 1.22]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.62, 0.18), frame)
      post.position.set(x, 1.3, z)
      g.add(post)
    }
    const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 2.44), frame)
    topRail.position.set(x, 2.52, 0)
    g.add(topRail)
    const bottomRail = topRail.clone()
    bottomRail.position.y = 0.1
    g.add(bottomRail)
  }
  // door end with locking bars
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.3, 2.3), skin)
  door.position.set(L / 2 + 0.06, 1.28, 0)
  g.add(door)
  for (const dz of [-0.8, -0.27, 0.27, 0.8]) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.2, 6), frame)
    bar.position.set(L / 2 + 0.12, 1.28, dz)
    g.add(bar)
  }
  // painted reporting marks
  const { material: mark } = signMaterial({
    text: `MSKU ${seed}${(seed * 7) % 10}${(seed * 3) % 10}`,
    sub: '42G1 · 30 480 kg',
    bg: '#000000',
    fg: '#e8e6df',
    glow: '#000000',
    width: 512,
    height: 128,
    border: false,
  })
  const markMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), mark)
  markMesh.position.set(-L / 2 - 0.02, 1.7, 1.24)
  markMesh.rotation.y = -Math.PI / 2
  g.add(markMesh)
  return g
}

export function buildDocks(ctx: Ctx): LocationScene {
  const { mobile, heroRes, propRes } = ctx
  const group = new THREE.Group()
  const ticks = new Ticks()
  const rng = mulberry32(8811)

  /* ── Sky: sodium-lit overcast, harbour haze, light drizzle ───────── */
  const sky = makeSky({
    seed: 71,
    stops: [
      [0, '#03060d'],
      [0.3, '#081020'],
      [0.42, '#122032'],
      [0.47, '#2a3a4c'],
      [0.5, '#3d4a55'],
      [0.52, '#1a222c'],
      [1, '#05070c'],
    ],
    stars: { density: 0.00012, brightness: 0.5 },
    clouds: { cover: 0.9, altitude: 0.36, color: '#5f6b78', shadow: '#131922', seed: 15 },
    haze: { height: 0.12, color: 'rgba(196,214,232,0.32)' },
    bloom: 0.45,
    silhouettes: (g, w, h, horizon) => {
      const r = mulberry32(42)
      // ship-to-shore gantry cranes on the skyline
      for (const cx of [w * 0.22, w * 0.68]) {
        g.fillStyle = '#0b141d'
        g.beginPath()
        g.moveTo(cx - 42, horizon)
        g.lineTo(cx - 16, horizon - 128)
        g.lineTo(cx + 16, horizon - 128)
        g.lineTo(cx + 42, horizon)
        g.closePath()
        g.fill()
        g.fillRect(cx - 74, horizon - 120, 180, 11)
        g.fillRect(cx - 11, horizon - 168, 22, 48)
        g.fillStyle = '#ef4444'
        g.fillRect(cx - 2, horizon - 172, 4, 4)
      }
      // refinery + warehouses
      for (let i = 0; i < 26; i++) {
        const tw = 22 + r() * 52
        const th = 14 + r() * 52
        g.fillStyle = i % 4 === 0 ? '#0d1620' : '#101923'
        g.fillRect((i / 26) * w, horizon - th, tw, th)
      }
      // stacks venting
      for (const sx of [w * 0.12, w * 0.45, w * 0.86]) {
        g.fillStyle = '#141d27'
        g.fillRect(sx, horizon - 92, 9, 92)
        g.fillStyle = 'rgba(200,214,228,0.12)'
        g.beginPath()
        g.ellipse(sx + 26, horizon - 108, 44, 16, 0.2, 0, Math.PI * 2)
        g.fill()
      }
      g.fillStyle = '#070b11'
      g.fillRect(0, horizon, w, h - horizon)
    },
  })
  group.add(skyDome(sky, 130))

  /* ── Apron: rain-slicked industrial concrete ────────────────────── */
  const apron = concreteMaterial({ seed: 101, res: heroRes, kind: 'slab', tone: '#83868c' })
  const apronMat = apron.clone() as THREE.MeshStandardMaterial
  apronMat.transparent = true
  apronMat.opacity = 0.94 // lets the mirror rig read through as wet sheen
  apronMat.roughness = 0.92
  apronMat.envMapIntensity = 1.2
  group.add(flatGround({ size: 150, circle: false, material: apronMat, tile: 9, name: 'apron' }))

  // the wetness pattern: industrial puddles plus standing water in the wheel ruts
  const wet = asphaltSurface({ seed: 121, res: mobile ? 128 : 256, freshness: 0.2, wet: 0.95, tile: 8, tracks: false })
  group.add(puddleField(wet.puddles, { count: mobile ? 12 : 30, area: 70, min: 1, max: 5, threshold: 0.28, seed: 13 }))

  /* ── Yard markings: bay boxes, hazard lanes, stencils ───────────── */
  {
    const px = 2048
    const [canvas, c2d] = (() => {
      const c = document.createElement('canvas')
      c.width = c.height = px
      return [c, c.getContext('2d')!] as const
    })()
    const u = px / 80
    const mid = px / 2
    // expansion joints
    c2d.strokeStyle = 'rgba(8,10,14,0.55)'
    c2d.lineWidth = 3
    for (let i = 0; i <= 8; i++) {
      c2d.beginPath()
      c2d.moveTo(i * (px / 8), 0)
      c2d.lineTo(i * (px / 8), px)
      c2d.stroke()
      c2d.beginPath()
      c2d.moveTo(0, i * (px / 8))
      c2d.lineTo(px, i * (px / 8))
      c2d.stroke()
    }
    // container bay boxes
    c2d.lineWidth = 4
    for (let i = -3; i <= 3; i++) {
      c2d.strokeStyle = 'rgba(235,235,228,0.5)'
      c2d.strokeRect(mid + (i * 9 - 4) * u, mid - 3.4 * u, 8 * u, 12 * u)
      c2d.fillStyle = 'rgba(235,235,228,0.45)'
      c2d.font = `700 ${Math.round(0.9 * u)}px Inter, Arial, sans-serif`
      c2d.fillText(`BAY ${String(Math.abs(i) + 1).padStart(2, '0')}`, mid + (i * 9 - 3.6) * u, mid - 2.2 * u)
    }
    // hazard-striped traffic lanes
    for (const z of [-8.5, 8.5]) {
      c2d.fillStyle = '#0b0d12'
      c2d.fillRect(0, mid + z * u, px, 0.6 * u)
      c2d.fillStyle = '#eab308'
      for (let x = -40; x < px; x += 1.4 * u) {
        c2d.beginPath()
        c2d.moveTo(x, mid + (z + 0.6) * u)
        c2d.lineTo(x + 0.7 * u, mid + (z + 0.6) * u)
        c2d.lineTo(x + 1.4 * u, mid + z * u)
        c2d.lineTo(x + 0.7 * u, mid + z * u)
        c2d.closePath()
        c2d.fill()
      }
    }
    // stencilled handling notes + a huge M
    c2d.fillStyle = 'rgba(230,232,236,0.5)'
    c2d.font = `700 ${Math.round(1.5 * u)}px Inter, Arial, sans-serif`
    c2d.fillText('REACH STACKER  ·  KEEP CLEAR', mid - 26 * u, mid + 14 * u)
    c2d.font = `700 ${Math.round(4.4 * u)}px Inter, Arial, sans-serif`
    c2d.fillStyle = 'rgba(28,105,212,0.5)'
    c2d.fillText('M', mid + 22 * u, mid - 10 * u)
    // oil + hydraulic stains
    for (let i = 0; i < 30; i++) {
      const cx = rng() * px
      const cy = mid + (rng() - 0.5) * 24 * u
      const r = (0.4 + rng() * 1.5) * u
      const grad = c2d.createRadialGradient(cx, cy, 0, cx, cy, r)
      grad.addColorStop(0, 'rgba(6,7,10,0.5)')
      grad.addColorStop(1, 'rgba(6,7,10,0)')
      c2d.fillStyle = grad
      c2d.fillRect(cx - r, cy - r, r * 2, r * 2)
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    const marks = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.85 }),
    )
    marks.rotation.x = -Math.PI / 2
    marks.position.y = 0.02
    marks.renderOrder = 2
    group.add(marks)
  }

  /* ── Container yard: real stacks in real bay boxes ──────────────── */
  const beaconLights: THREE.Sprite[] = []
  {
    const palette = ['#1d3557', '#c1440e', '#2a9d8f', '#2b2d42', '#8a6d3b', '#4a6b3a', '#7d2a2a', '#5a6b7a']
    const rows = mobile ? 3 : 5
    for (let r = 0; r < rows; r++) {
      const z = -12 - r * 6.2
      for (let b = -3; b <= 2; b++) {
        const x = b * 9 + 2
        const stackHeight = 1 + Math.floor(rng() * 3)
        const long = rng() < 0.6
        const len = long ? 12 : 6.1
        for (let s = 0; s < stackHeight; s++) {
          const box = container({
            length: len,
            color: palette[Math.floor(rng() * palette.length)],
            seed: 100 + Math.floor(rng() * 899),
            res: propRes,
          })
          box.position.set(x, s * 2.62, z)
          box.rotation.y = long ? 0 : Math.PI / 2
          group.add(box)
        }
        // a couple of grounded boxes float in the open bay
        if (rng() < 0.3) {
          const loose = container({
            length: 6.1,
            color: palette[Math.floor(rng() * palette.length)],
            seed: 300 + Math.floor(rng() * 699),
            res: propRes,
          })
          loose.position.set(x + 4.6, 0, z + 3.2)
          loose.rotation.y = Math.PI / 2
          group.add(loose)
        }
      }
    }
  }

  /* ── Gantry crane with a working trolley, hoist and spreader ────── */
  const craneLights: Array<{ light: THREE.PointLight; halo: THREE.Sprite }> = []
  const trolley = new THREE.Group()
  const spreader = new THREE.Group()
  {
    const steel = metalMaterial({ color: '#8d949c', roughness: 0.42 })
    const dark = metalMaterial({ color: '#3b4046', roughness: 0.55 })
    const craneBase = new THREE.Group()
    // four legs on bogies
    for (const x of [-9, 9]) {
      for (const z of [-2.4, 2.4]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.85, 22, 0.85), steel)
        leg.position.set(x, 11, z)
        leg.castShadow = true
        craneBase.add(leg)
        const bogie = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 3.6), dark)
        bogie.position.set(x, 0.55, z)
        craneBase.add(bogie)
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 3.2, 10), dark)
        wheel.rotation.x = Math.PI / 2
        wheel.position.set(x, 0.42, z)
        craneBase.add(wheel)
      }
      // portal bracing between the legs
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 5.2), steel)
      brace.position.set(x, 8.4, 0)
      craneBase.add(brace)
    }
    // top girder + cantilever over the quay
    const girder = new THREE.Mesh(new THREE.BoxGeometry(46, 1.5, 1.6), steel)
    girder.position.set(-4, 22.4, 0)
    girder.castShadow = true
    craneBase.add(girder)
    const topChord = new THREE.Mesh(new THREE.BoxGeometry(46, 0.4, 0.5), steel)
    topChord.position.set(-4, 24.6, 0)
    craneBase.add(topChord)
    for (let x = -27; x <= 19; x += 2.2) {
      const diag = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.2, 0.16), steel)
      diag.position.set(x, 23.5, 0.7)
      diag.rotation.z = 0.5
      craneBase.add(diag)
      const diag2 = diag.clone()
      diag2.position.z = -0.7
      diag2.rotation.z = -0.5
      craneBase.add(diag2)
    }
    // operator cab
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.2), paintedMetal({ color: '#1c69d4', seed: 5, res: propRes, gloss: 0.4 }))
    cab.position.set(9, 19.4, 0)
    craneBase.add(cab)
    const cabGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(2.1, 1.5),
      new THREE.MeshStandardMaterial({ color: 0x0a1016, emissive: new THREE.Color('#8fd0ff'), emissiveIntensity: 0.6, roughness: 0.2 }),
    )
    cabGlass.position.set(9.01, 19.7, 1.12)
    craneBase.add(cabGlass)
    for (const x of [8.6, 9.4]) {
      const legLight = new THREE.PointLight(0xbfd9ff, 9, 14, 2)
      legLight.position.set(x, 20.6, 1.2)
      craneBase.add(legLight)
      const halo = glowSprite(0xbfd9ff, 2.6, 0.5)
      halo.position.set(x, 20.6, 1.2)
      craneBase.add(halo)
      craneLights.push({ light: legLight, halo })
    }
    // leg beacons
    for (const x of [-9, 9]) {
      const beacon = glowSprite(0xff3b30, 2.2, 0.9)
      beacon.position.set(x, 22.6, 0)
      craneBase.add(beacon)
      beaconLights.push(beacon)
    }
    group.add(craneBase)

    // trolley rides the girder
    const trolleyBody = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.6, 2.6), dark)
    trolley.add(trolleyBody)
    const trolleyWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 10), steel)
    trolleyWheel.rotation.x = Math.PI / 2
    for (const dx of [-1.4, 1.4]) {
      const wheel = trolleyWheel.clone()
      wheel.position.set(dx, 0.85, 1.3)
      trolley.add(wheel)
      const wheel2 = wheel.clone()
      wheel2.position.z = -1.3
      trolley.add(wheel2)
    }
    trolley.position.set(4, 21.4, 0)
    group.add(trolley)

    // spreader hangs from the trolley on four ropes
    const spreaderBar = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.5, 2.8), paintedMetal({ color: '#e0b400', seed: 7, res: propRes, gloss: 0.45 }))
    spreader.add(spreaderBar)
    for (const dx of [-2.9, 2.9]) {
      for (const dz of [-1.2, 1.2]) {
        const corner = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 0.3), dark)
        corner.position.set(dx, -0.4, dz)
        spreader.add(corner)
      }
    }
    const hoist = glowSprite(0xffe6a8, 5, 0.5)
    hoist.position.y = -1
    spreader.add(hoist)
    const workLight = new THREE.PointLight(0xffe0a0, 14, 16, 2)
    workLight.position.y = -1.2
    spreader.add(workLight)
    spreader.position.set(4, 20.4, 0)
    group.add(spreader)

    const ropes: THREE.Mesh[] = []
    for (const dx of [-2.9, 2.9]) {
      for (const dz of [-1.2, 1.2]) {
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 5), dark)
        group.add(rope)
        rope.userData.dx = dx
        rope.userData.dz = dz
        ropes.push(rope)
      }
    }

    ticks.add((t) => {
      // 22 s cycle: travel out, lower, dwell, lift, return
      const cycle = 22
      const k = (t % cycle) / cycle
      const travel = Math.sin(k * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5
      const x = lerp(-20, 14, travel)
      trolley.position.x = x
      spreader.position.x = x
      // hoist profile: high while travelling, down during the pick window
      const pick = clamp01(1 - Math.abs(((k + 0.5) % 1) * 2 - 1) * 3.4)
      spreader.position.y = 20.4 - pick * 17.2
      for (const rope of ropes) {
        const dx = rope.userData.dx as number
        const dz = rope.userData.dz as number
        const y0 = 21.4 - 0.8
        const y1 = spreader.position.y
        rope.position.set(x + dx, (y0 + y1) / 2, dz)
        rope.scale.y = Math.max(0.1, y0 - y1)
      }
      for (const entry of craneLights) {
        entry.light.intensity = 8 + Math.sin(t * 3.2) * 1.4
      }
    })
  }

  /* ── Container ship heaving against its moorings ─────────────────── */
  const ship = new THREE.Group()
  {
    const hullMat = paintedMetal({ color: '#5c1f22', seed: 9, res: propRes, gloss: 0.35 })
    const hull = new THREE.Mesh(new THREE.BoxGeometry(74, 5.4, 15), hullMat)
    hull.position.y = 1.6
    hull.castShadow = true
    ship.add(hull)
    // bulbous bow + stern ramp
    const bow = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 2.2, 16.4, 14), hullMat)
    bow.rotation.z = Math.PI / 2
    bow.rotation.y = Math.PI / 2
    bow.position.set(37, 1.4, 0)
    ship.add(bow)
    // deck + container stacks on top
    const deck = new THREE.Mesh(new THREE.BoxGeometry(74, 0.4, 15), paintedMetal({ color: '#2f3a3f', seed: 10, res: propRes, gloss: 0.4 }))
    deck.position.y = 4.3
    ship.add(deck)
    const palette = ['#1d3557', '#c1440e', '#2a9d8f', '#8a6d3b', '#4a6b3a', '#7d2a2a']
    for (let i = 0; i < 9; i++) {
      for (let j = -1; j <= 1; j += 2) {
        const stack = 1 + Math.floor(rng() * 3)
        for (let s = 0; s < stack; s++) {
          const box = container({
            length: 8.4,
            color: palette[Math.floor(rng() * palette.length)],
            seed: 500 + Math.floor(rng() * 499),
            res: 128,
          })
          box.position.set(-30 + i * 8.6, 4.5 + s * 2.62, j * 4.4)
          ship.add(box)
        }
      }
    }
    // bridge + funnel + accommodation
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(9, 8, 11), paintedMetal({ color: '#e8e6df', seed: 11, res: propRes, gloss: 0.35 }))
    bridge.position.set(-30, 9.4, 0)
    bridge.castShadow = true
    ship.add(bridge)
    const bridgeGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x0a1016, emissive: new THREE.Color('#cfe6ff'), emissiveIntensity: 0.55, roughness: 0.2 }),
    )
    bridgeGlass.position.set(-25.5, 11.6, 0)
    bridgeGlass.rotation.y = Math.PI / 2
    ship.add(bridgeGlass)
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.8, 5, 12), paintedMetal({ color: '#1c69d4', seed: 12, res: propRes, gloss: 0.4 }))
    funnel.position.set(-32, 16, 0)
    ship.add(funnel)
    const funnelBand = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.7, 1.1, 12), paintedMetal({ color: '#e0b400', seed: 13, res: 64, gloss: 0.4 }))
    funnelBand.position.set(-32, 17.4, 0)
    ship.add(funnelBand)
    // mast with navigation lights
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 8, 8), metalMaterial({ color: '#c9ced6', roughness: 0.4 }))
    mast.position.set(-24, 17, 0)
    ship.add(mast)
    for (const [dx, color] of [
      [-1.4, 0x35d07f],
      [1.4, 0xff3b30],
    ] as const) {
      const nav = glowSprite(color, 1.8, 0.85)
      nav.position.set(-24 + dx, 20.4, 0)
      ship.add(nav)
      beaconLights.push(nav)
    }
    // mooring lines to the quay bollards
    for (const x of [-30, -10, 12, 30]) {
      ship.add(
        catenary(
          new THREE.Vector3(x * 0.9, 4.4, 7.6),
          new THREE.Vector3(x * 1.1, 1.0, 18),
          1.4,
          0.07,
          new THREE.MeshStandardMaterial({ color: 0x6f6a58, roughness: 0.95 }),
        ),
      )
    }
    ship.position.set(0, -0.6, 34)
    group.add(ship)
    // funnel smoke
    const funnelSmoke = motes({ count: mobile ? 30 : 80, area: 4, height: 16, color: 0x8b949e, size: 1.1, opacity: 0.22 })
    funnelSmoke.points.position.set(-32, 18, 34)
    group.add(funnelSmoke.points)
    ticks.add((t, dt) => {
      funnelSmoke.tick(t, dt)
      const arr = funnelSmoke.points.geometry.attributes.position.array as Float32Array
      for (let i = 0; i < arr.length; i += 3) arr[i] += dt * 1.4
      funnelSmoke.points.geometry.attributes.position.needsUpdate = true
    })
  }

  /* ── Quay edge, bollards, fenders, gangway, fence ───────────────── */
  {
    const quayWall = new THREE.Mesh(
      new THREE.BoxGeometry(150, 1.4, 1.2),
      concreteMaterial({ seed: 33, res: propRes, kind: 'kerb', tone: '#b5b2a9' }),
    )
    quayWall.position.set(0, 0.7, 22.6)
    group.add(quayWall)
    const fenderMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.92 })
    for (let x = -70; x <= 70; x += 6) {
      const fender = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.6, 10), fenderMat)
      fender.rotation.z = Math.PI / 2
      fender.position.set(x, 0.5, 21.9)
      group.add(fender)
    }
    const steel = metalMaterial({ color: '#8f959d', roughness: 0.45 })
    for (let x = -60; x <= 60; x += 12) {
      const b = bollard(steel, paintedMetal({ color: '#c9a227', seed: 3, res: 64, gloss: 0.5 }))
      b.position.set(x, 0.02, 21.4)
      group.add(b)
    }
    // wire fence behind the apron
    const fence = chainFence({ length: 120, height: 2.6, metal: steel, postSpacing: 3 })
    fence.position.set(0, 0, -26)
    group.add(fence)
    const barbed = new THREE.Mesh(new THREE.BoxGeometry(120, 0.06, 0.06), steel)
    barbed.position.set(0, 2.9, -26)
    group.add(barbed)
    for (let x = -58; x <= 58; x += 2.4) {
      const barb = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4), steel)
      barb.position.set(x, 2.75, -26)
      group.add(barb)
    }
    // gangway up to the ship
    const gangway = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.16, 9), paintedMetal({ color: '#4f6b3f', seed: 4, res: propRes, gloss: 0.4 }))
    gangway.position.set(6, 2.2, 26)
    gangway.rotation.x = -0.24
    group.add(gangway)
    for (const dx of [-0.8, 0.8]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 9, 6), steel)
      rail.rotation.x = Math.PI / 2 - 0.24
      rail.position.set(6 + dx, 3.2, 26)
      group.add(rail)
    }
  }

  /* ── Warehouse, offices, flood masts ────────────────────────────── */
  {
    const shell = concreteMaterial({ seed: 55, res: propRes, kind: 'wall', tone: '#7b7e84' })
    const warehouse = buildingBox({
      w: 44,
      h: 8,
      d: 16,
      material: shell,
      roof: metalMaterial({ color: '#5b6068', roughness: 0.55 }),
    })
    warehouse.position.set(-30, 0, -34)
    group.add(warehouse)
    // roller doors with warm interior light
    const shutter = corrugatedMetal({ color: '#565b62', seed: 21, res: propRes, ribs: 30, depth: 0.7 })
    for (let i = 0; i < 4; i++) {
      const door = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.2), shutter)
      door.position.set(-46 + i * 11, 2.1, -25.9)
      group.add(door)
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(4.6, 0.16, 0.3),
        new THREE.MeshBasicMaterial({ color: 0xffe7bd }),
      )
      strip.position.set(-46 + i * 11, 4.3, -25.7)
      group.add(strip)
      const spill = new THREE.PointLight(0xffd9a0, 12, 12, 2)
      spill.position.set(-46 + i * 11, 3.4, -24.6)
      group.add(spill)
    }
    const { material: dockSign } = signMaterial({ text: 'TERMINAL 4', sub: 'M Performance Logistics', bg: '#0b0f16', fg: '#ffffff', glow: '#4fc3f7', width: 512, height: 224 })
    const board = new THREE.Mesh(new THREE.PlaneGeometry(10, 4.4), dockSign)
    board.position.set(-30, 6.4, -25.8)
    group.add(board)
    group.add(wetReflection(board, { opacity: 0.16, stretch: 3 }))

    // flood masts lighting the yard
    const mastMetal = metalMaterial({ color: '#6a7078', roughness: 0.45 })
    for (const [x, z] of [
      [-50, 12],
      [4, 12],
      [52, 12],
    ] as const) {
      const mast = floodMast({ height: 22, color: 0xffeec6, metal: mastMetal, heads: 4 })
      mast.group.position.set(x, 0, z)
      group.add(mast.group)
      beaconLights.push(...mast.halos)
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(20, 26, 22, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xffe6bc,
          transparent: true,
          opacity: 0.05,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      )
      cone.position.set(x - 2, 20, z - 1)
      cone.rotation.z = 0.1
      group.add(cone)
    }
    // terminal office with a lit window strip
    const office = buildingBox({
      w: 10,
      h: 4.6,
      d: 7,
      material: concreteMaterial({ seed: 66, res: propRes, kind: 'wall', tone: '#8a8d93' }),
      roof: metalMaterial({ color: '#4d5158', roughness: 0.6 }),
    })
    office.position.set(30, 0, -32)
    group.add(office)
    const windowStrip = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 1.5),
      new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: new THREE.Color('#fff0cc'), emissiveIntensity: 1.1, roughness: 0.3 }),
    )
    windowStrip.position.set(30, 3.2, -28.45)
    group.add(windowStrip)
  }

  /* ── Reach stacker, forklift, clutter ──────────────────────────── */
  const forklift = new THREE.Group()
  {
    const yellow = paintedMetal({ color: '#d9a400', seed: 15, res: propRes, gloss: 0.45 })
    const dark = metalMaterial({ color: '#2c2f34', roughness: 0.6 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 1.6), yellow)
    body.position.y = 1.2
    forklift.add(body)
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.5, 1.5), yellow)
    cab.position.set(-0.6, 2.4, 0)
    forklift.add(cab)
    const cabGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x0a1016, emissive: new THREE.Color('#8fd0ff'), emissiveIntensity: 0.4, roughness: 0.2 }),
    )
    cabGlass.position.set(-0.6, 2.5, 0.76)
    forklift.add(cabGlass)
    const mastRail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.2, 1.2), dark)
    mastRail.position.set(1.4, 2.1, 0)
    forklift.add(mastRail)
    const fork = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.16), dark)
    fork.position.set(2.1, 0.5, 0.42)
    forklift.add(fork)
    const fork2 = fork.clone()
    fork2.position.z = -0.42
    forklift.add(fork2)
    for (const [x, z] of [
      [0.9, 0.8],
      [0.9, -0.8],
      [-1, 0.8],
      [-1, -0.8],
    ] as const) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 10), dark)
      wheel.rotation.x = Math.PI / 2
      wheel.position.set(x, 0.4, z)
      forklift.add(wheel)
    }
    const headlight = glowSprite(0xfff0cc, 3.4, 0.5)
    headlight.position.set(1.7, 1.2, 0.5)
    forklift.add(headlight)
    // a pallet riding the forks
    const load = crate(1.1, new THREE.MeshStandardMaterial({ color: 0x7d6242, roughness: 0.9 }))
    load.position.set(1.9, 1.05, 0)
    forklift.add(load)
    group.add(forklift)

    ticks.add((t) => {
      // a lazy oval patrol of the apron with the load bobbing
      const k = t * 0.055
      const x = Math.cos(k) * 26
      const z = Math.sin(k * 1.4) * 7 + 4
      forklift.position.set(x, 0.02, z)
      forklift.rotation.y = -k + Math.PI / 2
      load.position.y = 1.05 + Math.sin(t * 5.2) * 0.05
      load.rotation.z = Math.sin(t * 4.1) * 0.03
    })

    // reach stacker parked with a container on the spreader
    const stacker = new THREE.Group()
    const frame = paintedMetal({ color: '#1f6f4a', seed: 18, res: propRes, gloss: 0.4 })
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(7, 1.6, 3.2), frame)
    chassis.position.y = 1.3
    stacker.add(chassis)
    const tower = new THREE.Mesh(new THREE.BoxGeometry(1.6, 8, 2.6), frame)
    tower.position.set(-3, 5, 0)
    stacker.add(tower)
    const boom = new THREE.Mesh(new THREE.BoxGeometry(9, 0.7, 1.2), frame)
    boom.position.set(1.6, 9, 0)
    stacker.add(boom)
    const lifted = container({ length: 6.1, color: '#2a9d8f', seed: 777, res: 128 })
    lifted.position.set(2.4, 3.6, 0)
    stacker.add(lifted)
    for (const x of [-2.6, 2.6]) {
      for (const z of [-1.4, 1.4]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.4, 12), dark)
        wheel.rotation.x = Math.PI / 2
        wheel.position.set(x, 0.62, z)
        stacker.add(wheel)
      }
    }
    stacker.position.set(24, 0, -6)
    stacker.rotation.y = -0.4
    group.add(stacker)

    // yard clutter
    const rubber = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.95 })
    for (let i = 0; i < 6; i++) {
      const stack = tyreStack(2 + Math.floor(rng() * 3), rubber)
      stack.position.set(-16 + i * 7 + rng(), 0, 16 + rng() * 3)
      group.add(stack)
    }
    for (let i = 0; i < 5; i++) {
      const b = barrel(paintedMetal({ color: i % 2 === 0 ? '#3a4a5a' : '#7a4a2a', seed: i, res: 64, gloss: 0.35 }), metalMaterial({ color: '#8d9096', roughness: 0.5 }))
      b.position.set(-40 + i * 3.4, 0, -20 + rng())
      group.add(b)
    }
    const bin = dumpster(paintedMetal({ color: '#2b4a2f', seed: 5, res: propRes, gloss: 0.4 }), metalMaterial({ color: '#3a3f46', roughness: 0.5 }))
    bin.position.set(12, 0, -24)
    group.add(bin)
    for (let i = 0; i < 4; i++) {
      const c = trafficCone()
      c.position.set(-8 + i * 3.4, 0, 18.6)
      group.add(c)
    }
    const palletMat = new THREE.MeshStandardMaterial({ color: 0x6b5236, roughness: 0.92 })
    for (let i = 0; i < 8; i++) {
      const pallet = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.14, 0.9), palletMat)
      pallet.position.set(-52 + i * 1.3, 0.07 + Math.floor(i / 4) * 0.16, -22)
      group.add(pallet)
    }
    void palm
    void simpleCar
    void hazardMaterial
  }

  /* ── Atmosphere: drizzle, mist bands, steam, sodium haze ───────── */
  const drizzle = rainSystem({
    count: mobile ? 320 : 800,
    area: 80,
    height: 22,
    speed: 15,
    wind: 1.8,
    color: 0xa9c2da,
    opacity: 0.2,
    length: 1.2,
  })
  group.add(drizzle.group)
  ticks.add(drizzle.tick)

  const mist = fogBank({ count: mobile ? 8 : 16, area: 90, y: 1.4, color: 0xa8b4c4, size: 44, opacity: 0.09, speed: 0.4 })
  group.add(mist)
  ticks.add((t, dt) => (mist.userData.tick as (a: number, b: number) => void)(t, dt))

  const steam = motes({ count: mobile ? 60 : 170, area: 26, height: 18, color: 0xd8e2ee, size: 0.7, opacity: 0.2 })
  steam.points.position.set(-34, 4, -34)
  group.add(steam.points)
  ticks.add((t, dt) => {
    steam.tick(t, dt)
    const arr = steam.points.geometry.attributes.position.array as Float32Array
    for (let i = 0; i < arr.length; i += 3) arr[i] += dt * 2.2
    steam.points.geometry.attributes.position.needsUpdate = true
  })

  const haze = motes({ count: mobile ? 40 : 120, area: 80, height: 10, color: 0xffd9a0, size: 0.5, opacity: 0.12 })
  haze.points.position.set(0, 2, 10)
  group.add(haze.points)
  ticks.add(haze.tick)

  // a puddle right under the ship's cargo light
  const p = puddle({ radius: 3.4, opacity: 0.8 })
  p.position.set(6, 0.014, 14)
  group.add(p)

  /* ── Logic: ship heave, beacons, mooring strain ─────────────────── */
  ticks.add((t) => {
    ship.position.y = -0.6 + Math.sin(t * 0.42) * 0.1
    ship.rotation.z = Math.sin(t * 0.31) * 0.006
    ship.rotation.x = Math.cos(t * 0.27) * 0.004
    const flash = Math.sin(t * 2.2) > 0
    for (let i = 0; i < beaconLights.length; i++) {
      const sprite = beaconLights[i]
      const on = i % 2 === 0 ? flash : !flash
      sprite.material.opacity = on ? 0.85 : 0.06
    }
    void lerp
  })

  /* ── Lighting rig for the car ────────────────────────────────────── */
  const keyFill = new THREE.SpotLight(0xffe3b4, 120, 42, 0.75, 0.65, 2)
  keyFill.position.set(-3, 22.4, 7)
  keyFill.target.position.set(0, 0.5, 0)
  group.add(keyFill, keyFill.target)
  const bounce = new THREE.HemisphereLight(0x46596e, 0x14181e, 0.5)
  group.add(bounce)

  return {
    id: 'docks',
    group,
    background: sky,
    environment: sky,
    lighting: {
      key: { color: 0xd8e8fa, intensity: 300, position: [-6, 12, 10] },
      rim: { color: 0xf59e0b, intensity: 2.8, position: [10, 6, -12] },
      hemi: { sky: 0x2b3c50, ground: 0x121820, intensity: 0.5 },
      fog: { color: 0x0b141d, density: 0.019 },
      exposure: 0.98,
      environmentIntensity: 0.7,
      beamScale: 1.4,
      floorReflection: true,
      shadow: { far: 70, near: 2, angle: 0.9, penumbra: 0.7, focus: [0, 0.5, 0] },
    },
    facts: [
      { label: 'Berth', value: 'Terminal 4 · 01:10' },
      { label: 'Air', value: '9 °C · drizzle' },
      { label: 'Cargo', value: '2,140 TEU working' },
    ],
    update: (frame) => ticks.run(frame.time, frame.dt),
    dispose: () => {
      disposeGroup(group)
      sky.dispose()
    },
  }
}
