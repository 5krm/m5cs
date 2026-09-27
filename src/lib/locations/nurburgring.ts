/**
 * ═════════════════════════════════════════════════════════════════════════
 * 1 · NÜRBURGRING — pit lane, dusk, twenty minutes after the rain stopped
 * ═════════════════════════════════════════════════════════════════════════
 * Layout, looking down the pit lane (car nose = +X, camera side = +Z):
 *
 *   z = −14   pit building: 18 garage boxes, lit from inside, rolling shutters
 *   z = −8    apron + pit equipment (tyre stacks, trolleys, cones, crates)
 *   z =  0    the car — wet pit-lane tarmac, puddles full of sky
 *   z = +5.4  pit wall, debris fence, timing pylon
 *   z = +9    the track itself, kerbs, cat's eyes
 *   z = +26   grandstand with a lit roof deck, Eifel forest behind it
 *
 * Logic running every frame: floodlights warming up with a mains shimmer, one
 * garage door flickering like a failing tube, mist creeping across the tarmac,
 * a car passing on the track with headlights sweeping the barriers, the pit
 * gantry boards blinking on the beat, and wet-floor reflections.
 */

import * as THREE from 'three'
import { asphaltSurface, concreteMaterial, corrugatedMetal, facadeMaterial, glassMaterial, hazardMaterial, metalMaterial, paintedMetal, signMaterial, snowMaterial } from '@/lib/procedural/materials'
import { Field, clamp01, lerp, mulberry32, smoothstep } from '@/lib/procedural/field'
import {
  Ctx,
  Ticks,
  catenary,
  chainFence,
  conifer,
  disposeGroup,
  flatGround,
  floodMast,
  fogBank,
  glowSprite,
  grandstand,
  guardRail,
  lampPost,
  makeSky,
  motes,
  puddleField,
  rainSystem,
  simpleCar,
  skyDome,
  terrain,
  trafficCone,
  trussTower,
  tyreStack,
  crate,
  barrel,
} from './shared'
import type { LocationScene } from './types'

export function buildNurburgring(ctx: Ctx): LocationScene {
  const { mobile, heroRes, propRes } = ctx
  const group = new THREE.Group()
  const ticks = new Ticks()
  const rng = mulberry32(1907)

  /* ── Sky: sun already below the Eifel, cold blue above warm haze ───── */
  const sky = makeSky({
    seed: 11,
    width: 2048,
    stops: [
      [0, '#050817'],
      [0.22, '#131a41'],
      [0.36, '#3a3468'],
      [0.44, '#7a4a63'],
      [0.48, '#c9743f'],
      [0.5, '#e9a25b'],
      [0.53, '#2e2126'],
      [0.72, '#12111a'],
      [1, '#0a0a0e'],
    ],
    sun: { x: 0.735, y: 0.487, r: 0.19, color: 'rgba(255,158,80,0.5)', core: 'rgba(255,238,205,0.98)', halo: 4.6 },
    clouds: { cover: 0.62, altitude: 0.34, color: '#f0b98a', shadow: '#2a2438', seed: 8 },
    haze: { height: 0.09, color: 'rgba(233,162,91,0.4)' },
    bloom: 0.75,
    silhouettes: (g, w, h, horizon) => {
      // Eifel ridgelines, three depths
      const layers: Array<[string, number, number, number]> = [
        ['#2a2740', 16, 54, 3],
        ['#1b1930', 10, 34, 9],
        ['#101020', 6, 22, 17],
      ]
      for (const [color, minH, maxH, seed] of layers) {
        const r = mulberry32(seed)
        g.fillStyle = color
        g.beginPath()
        g.moveTo(0, horizon + 2)
        let y = horizon - minH
        for (let x = 0; x <= w; x += 48) {
          y += (r() - 0.5) * 46
          y = Math.min(horizon - minH, Math.max(horizon - maxH, y))
          g.lineTo(x, y)
        }
        g.lineTo(w, horizon + 6)
        g.closePath()
        g.fill()
      }
      // tree line
      g.fillStyle = '#0a0c14'
      const r = mulberry32(23)
      for (let x = 0; x < w; x += 7) {
        const th = 8 + r() * 22
        g.beginPath()
        g.moveTo(x, horizon + 2)
        g.lineTo(x + 4, horizon - th)
        g.lineTo(x + 8, horizon + 2)
        g.closePath()
        g.fill()
      }
      g.fillStyle = '#0a0c14'
      g.fillRect(0, horizon, w, h - horizon)
    },
  })
  group.add(skyDome(sky, 130))

  /* ── Wet tarmac ────────────────────────────────────────────────────── */
  const asphalt = asphaltSurface({ seed: 3, res: heroRes, freshness: 0.34, wet: 0.55, tile: 6 })
  group.add(flatGround({ radius: 120, material: asphalt.material, tile: 6, name: 'pitTarmac' }))
  group.add(puddleField(asphalt.puddles, { count: mobile ? 10 : 26, area: 46, min: 1, max: 4.2, threshold: 0.36, seed: 4 }))

  /* ── Pit-lane markings: boxes, apron lines, "60" pit speed marks ───── */
  {
    const size = 72
    const px = 1536
    const [canvas, c2d] = (() => {
      const c = document.createElement('canvas')
      c.width = px
      c.height = px
      return [c, c.getContext('2d')!] as const
    })()
    const u = px / size // px per metre
    const cyPx = px / 2
    c2d.lineWidth = Math.max(2, 0.12 * u)
    c2d.strokeStyle = 'rgba(242,242,236,0.82)'
    // apron white lines
    for (const z of [-5.6, 4.8]) {
      c2d.beginPath()
      c2d.moveTo(0, cyPx + z * u)
      c2d.lineTo(px, cyPx + z * u)
      c2d.stroke()
    }
    // pit boxes, box numbers and team stripes
    const boxes = mobile ? 8 : 14
    for (let i = 0; i < boxes; i++) {
      const x = -size / 2 + 2.5 + i * (size / boxes)
      c2d.strokeStyle = 'rgba(249,214,74,0.75)'
      c2d.strokeRect((x + size / 2) * u, cyPx - 5.6 * u, (size / boxes - 0.6) * u, 10.4 * u)
      c2d.fillStyle = 'rgba(249,214,74,0.85)'
      c2d.font = `700 ${Math.round(0.8 * u)}px Inter, Arial, sans-serif`
      c2d.fillText(String(i + 1).padStart(2, '0'), (x + size / 2 + 0.7) * u, cyPx - 4.3 * u)
      c2d.fillStyle = i % 2 === 0 ? 'rgba(214,31,44,0.5)' : 'rgba(30,60,140,0.45)'
      c2d.fillRect((x + size / 2) * u, cyPx + 4.5 * u, 0.35 * u, 0.9 * u)
    }
    // "60" pit-limit roundels
    for (const bx of [-18, 12]) {
      const cx = (bx + size / 2) * u
      const cy = cyPx + 2.6 * u
      c2d.strokeStyle = 'rgba(240,240,235,0.85)'
      c2d.lineWidth = Math.max(2, 0.1 * u)
      c2d.beginPath()
      c2d.arc(cx, cy, 0.95 * u, 0, Math.PI * 2)
      c2d.stroke()
      c2d.fillStyle = 'rgba(240,240,235,0.85)'
      c2d.font = `700 ${Math.round(1.05 * u)}px Inter, Arial, sans-serif`
      c2d.textBaseline = 'middle'
      c2d.textAlign = 'center'
      c2d.fillText('60', cx, cy)
      c2d.textAlign = 'left'
      c2d.textBaseline = 'alphabetic'
    }
    // oil / coolant spill patches near a box
    for (let i = 0; i < 9; i++) {
      const cx = rng() * px
      const cy = cyPx + (rng() - 0.5) * 8 * u
      const r = (0.4 + rng() * 1.3) * u
      const grad = c2d.createRadialGradient(cx, cy, 0, cx, cy, r)
      grad.addColorStop(0, 'rgba(8,8,12,0.55)')
      grad.addColorStop(1, 'rgba(8,8,12,0)')
      c2d.fillStyle = grad
      c2d.fillRect(cx - r, cy - r, r * 2, r * 2)
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    const marks = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.9 }),
    )
    marks.rotation.x = -Math.PI / 2
    marks.position.y = 0.02
    marks.renderOrder = 2
    group.add(marks)
  }

  /* ── Kerbs at the track edge ───────────────────────────────────────── */
  {
    const kerbMat = new THREE.MeshStandardMaterial({
      map: (() => {
        const c = document.createElement('canvas')
        c.width = 256
        c.height = 32
        const g = c.getContext('2d')!
        for (let i = 0; i < 16; i++) {
          g.fillStyle = i % 2 ? '#c8202c' : '#eceae4'
          g.fillRect(i * 16, 0, 16, 32)
        }
        const t = new THREE.CanvasTexture(c)
        t.colorSpace = THREE.SRGBColorSpace
        t.wrapS = t.wrapT = THREE.RepeatWrapping
        t.repeat.set(60, 1)
        return t
      })(),
      roughness: 0.55,
      metalness: 0.05,
    })
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(140, 0.07, 0.9), kerbMat)
    kerb.position.set(0, 0.035, 9.6)
    kerb.receiveShadow = true
    group.add(kerb)
    // cat's eyes down the lane line
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffc247 })
    for (let x = -70; x <= 70; x += 6) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.22), eyeMat)
      eye.position.set(x, 0.045, 6.4)
      group.add(eye)
    }
  }

  /* ── Pit building: 18 lit boxes under a concrete apron ─────────────── */
  const doorMaterials: THREE.MeshStandardMaterial[] = []
  const interiorLights: THREE.PointLight[] = []
  const doorPanels: THREE.Mesh[] = []
  {
    const shell = concreteMaterial({ seed: 42, res: propRes, kind: 'wall', tone: '#3a3c42' })
    const building = new THREE.Mesh(new THREE.BoxGeometry(96, 8.4, 12), shell)
    building.position.set(0, 4.2, -15)
    building.castShadow = true
    building.receiveShadow = true
    group.add(building)
    // level-1 cantilevered slab over the garages
    const slab = new THREE.Mesh(new THREE.BoxGeometry(96.4, 0.5, 3.4), shell)
    slab.position.set(0, 4.5, -10.2)
    slab.castShadow = true
    group.add(slab)
    const rail = new THREE.Mesh(new THREE.BoxGeometry(96, 0.09, 0.09), metalMaterial({ color: '#8d949e', roughness: 0.4 }))
    rail.position.set(0, 5.5, -8.7)
    group.add(rail)
    for (let x = -47; x <= 47; x += 3.1) {
      const baluster = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1, 0.06), metalMaterial({ color: '#8d949e', roughness: 0.45 }))
      baluster.position.set(x, 5, -8.7)
      group.add(baluster)
    }

    // Garage boxes: interior shell, shutter, warm spill light and a puddle mirror
    const interior = new THREE.MeshStandardMaterial({ color: 0x9aa2ad, roughness: 0.75 })
    const shutterTex = corrugatedMetal({ color: '#5a6068', seed: 5, res: propRes, ribs: 34, depth: 0.75 })
    const boxes = mobile ? 8 : 14
    const totalW = 92
    const boxW = totalW / boxes
    for (let i = 0; i < boxes; i++) {
      const x = -totalW / 2 + boxW * (i + 0.5)
      const lit = i % 3 !== 1 // two of three boxes are open and lit
      // recessed interior
      const back = new THREE.Mesh(new THREE.PlaneGeometry(boxW - 1.1, 3.6), interior)
      back.position.set(x, 1.9, -10.5)
      group.add(back)
      const sideL = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.6), shell)
      sideL.rotation.y = Math.PI / 2
      sideL.position.set(x - boxW / 2 + 0.55, 1.9, -12.2)
      group.add(sideL)
      const sideR = sideL.clone()
      sideR.position.x = x + boxW / 2 - 0.55
      group.add(sideR)
      const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(boxW - 1.1, 3.6), interior)
      ceiling.rotation.x = Math.PI / 2
      ceiling.position.set(x, 3.7, -12.2)
      group.add(ceiling)

      const doorMat = shutterTex.clone()
      doorMat.color = new THREE.Color(lit ? 0xf2f2ee : 0x4c525a)
      doorMat.emissive = new THREE.Color(lit ? '#ffdfae' : '#000000')
      doorMat.emissiveIntensity = lit ? 0.55 : 0
      const door = new THREE.Mesh(new THREE.PlaneGeometry(boxW - 1.1, 3.6), doorMat)
      door.position.set(x, 1.9, -9.9)
      group.add(door)
      doorPanels.push(door)

      // interior strip lights + the light that actually spills onto the apron
      if (lit) {
        const strip = new THREE.Mesh(
          new THREE.PlaneGeometry(boxW - 1.6, 0.22),
          new THREE.MeshBasicMaterial({ color: 0xfff0d0 }),
        )
        strip.rotation.x = Math.PI / 2
        strip.position.set(x, 3.62, -12.1)
        group.add(strip)
        if (i % 2 === 0) {
          const pl = new THREE.PointLight(0xffc98a, 26, 20, 2)
          pl.position.set(x, 2.6, -10.6)
          group.add(pl)
          interiorLights.push(pl)
        }
        // the wet apron catches the box light
        const spill = new THREE.Mesh(
          new THREE.PlaneGeometry(boxW - 0.8, 7),
          new THREE.MeshBasicMaterial({
            color: 0xffc98a,
            transparent: true,
            opacity: 0.06,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        )
        spill.rotation.x = -Math.PI / 2
        spill.position.set(x, 0.03, -6.3)
        group.add(spill)
      }
      doorMaterials.push(doorMat)

      // box number plate above the shutter
      const plate = signMaterial({
        text: String(i + 1).padStart(2, '0'),
        bg: '#101319',
        fg: '#f2f2ee',
        glow: '#7ec8ff',
        width: 128,
        height: 96,
        border: false,
      })
      const plateMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.6), plate.material)
      plateMesh.position.set(x - boxW / 2 + 0.75, 4.05, -9.86)
      group.add(plateMesh)
    }

    // Team banners on the upper level
    const banner = signMaterial({ text: 'M POWER', sub: 'PIT LANE  ·  BOX 07', bg: '#0d0f14', fg: '#dfe6f0', glow: '#3b7bff', width: 512, height: 256 })
    const bannerMesh = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), banner.material)
    bannerMesh.position.set(-26, 6.6, -8.94)
    group.add(bannerMesh)
    const banner2 = signMaterial({ text: 'NÜRBURGRING', sub: 'Nordschleife · 20.832 km', bg: '#0d0f14', fg: '#ffd88a', glow: '#ff8a3b', width: 512, height: 256 })
    const banner2Mesh = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), banner2.material)
    banner2Mesh.position.set(24, 6.6, -8.94)
    group.add(banner2Mesh)
  }

  /* ── Pit wall, timing pylon, debris fence, gantry ──────────────────── */
  {
    const wallMat = concreteMaterial({ seed: 77, res: propRes, kind: 'kerb', tone: '#c9c7bf' })
    const wall = new THREE.Mesh(new THREE.BoxGeometry(120, 1.05, 0.42), wallMat)
    wall.position.set(0, 0.52, 5.4)
    wall.castShadow = true
    group.add(wall)
    // sponsor panels along the wall
    const panel = signMaterial({ text: 'M5 CS', sub: '627 HP · 4.4L V8', bg: '#0b0d12', fg: '#ffffff', glow: '#d81f2a', width: 512, height: 192 })
    for (let x = -50; x <= 50; x += 20) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(9, 0.9), panel.material)
      p.position.set(x, 0.58, 5.62)
      group.add(p)
    }
    /* A 3.4 m debris fence here would stand between the camera (z ≈ +7.4) and
     * the car, filling the hero frame. Keep it as the low catch fencing that
     * actually sits on top of a pit wall — it frames the car instead. */
    const fence = chainFence({ length: 120, height: 1.15, metal: metalMaterial({ color: '#7d838c', roughness: 0.45 }), postSpacing: 3.4 })
    fence.position.set(0, 1.62, 5.55)
    group.add(fence)

    // timing pylon with a live-looking leaderboard
    const tower = trussTower({ height: 12, width: 1.6, metal: metalMaterial({ color: '#4d5158', roughness: 0.55 }) })
    tower.position.set(-30, 0, 6.4)
    group.add(tower)
    const board = signMaterial({ text: 'P1  1:54.238', sub: '#7  ·  M5 CS  ·  LAP 42', bg: '#05070c', fg: '#ffd24a', glow: '#ffd24a', width: 512, height: 256 })
    const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 3.2), board.material)
    boardMesh.position.set(-30, 8.4, 6.4)
    boardMesh.rotation.y = Math.PI * 0.06
    group.add(boardMesh)
    ticks.add((t) => {
      // the leaderboard re-times every few seconds
      const phase = Math.floor(t / 4) % 3
      boardMesh.rotation.z = phase === 0 ? 0 : Math.sin(t * 8) * 0.004
      ;(board.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.4 + Math.sin(t * 12) * 0.06
    })

    // start/finish gantry over the track
    const gantryMat = metalMaterial({ color: '#3f434a', roughness: 0.5 })
    const span = 18
    for (const z of [9.5, 15.5]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9, 0.5), gantryMat)
      leg.position.set(-14, 4.5, z)
      group.add(leg)
      const leg2 = leg.clone()
      leg2.position.x = 14
      group.add(leg2)
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(29, 0.7, 7), gantryMat)
    beam.position.set(0, 9, 12.5)
    beam.castShadow = true
    group.add(beam)
    // light boards under the gantry
    const boardMat = new THREE.MeshStandardMaterial({
      color: 0x0a0d12,
      emissive: new THREE.Color('#ff3131'),
      emissiveIntensity: 1.6,
      roughness: 0.4,
    })
    const lightRow: THREE.Mesh[] = []
    for (let i = 0; i < 5; i++) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.28, 0.5), boardMat)
      lamp.position.set(-8 + i * 4, 8.5, 9.6)
      group.add(lamp)
      lightRow.push(lamp)
      const halo = glowSprite(0xff4040, 4.2, 0.5)
      halo.position.copy(lamp.position)
      group.add(halo)
    }
    ticks.add((t) => {
      // start lights climbing the tree, then the pack is away
      const cycle = t % 9
      const lit = clamp01((cycle - 1) / 4)
      lightRow.forEach((lamp, i) => {
        const on = i / lightRow.length < lit && cycle < 8.4
        ;(lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 2.2 : 0.05
      })
    })
  }

  /* ── Floodlight masts with volumetric cones and mains shimmer ──────── */
  const mastHalos: THREE.Sprite[] = []
  const shaftMaterials: THREE.MeshBasicMaterial[] = []
  {
    const mastMetal = metalMaterial({ color: '#5c6169', roughness: 0.45 })
    for (const x of mobile ? [-34, 6] : [-34, -14, 6, 26]) {
      const mast = floodMast({ height: 16, color: 0xfff1d2, metal: mastMetal, heads: 4 })
      mast.group.position.set(x, 0, 8.2)
      mast.group.rotation.y = Math.PI * 0.85
      group.add(mast.group)
      mastHalos.push(...mast.halos)
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(15, 20, 24, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xffe6bc,
          transparent: true,
          opacity: 0.045,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      )
      cone.position.set(x - 1.6, 15.2, 7.2)
      cone.rotation.z = 0.12
      group.add(cone)
      shaftMaterials.push(cone.material as THREE.MeshBasicMaterial)
    }
    // a couple of low lamps lighting the apron
    for (const x of [-20, 18]) {
      const lamp = lampPost({ height: 9, arm: 1.8, color: 0xffdcae, metal: mastMetal })
      lamp.position.set(x, 0, -7.6)
      lamp.rotation.y = Math.PI
      group.add(lamp)
    }
  }

  /* ── Pit equipment scattered along the apron ───────────────────────── */
  {
    const rubber = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.95 })
    const crateMat = paintedMetal({ color: '#2f3a4a', seed: 8, res: propRes, gloss: 0.5 })
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b5236, roughness: 0.9 })
    const steel = metalMaterial({ color: '#8a919b', roughness: 0.38 })
    const hazard = hazardMaterial()
    const pits = mobile ? 5 : 9
    for (let i = 0; i < pits; i++) {
      const x = -42 + i * (84 / pits) + rng() * 2
      const stack = tyreStack(3 + Math.floor(rng() * 3), rubber)
      stack.position.set(x, 0, -8.4 - rng() * 0.6)
      group.add(stack)
      if (rng() < 0.6) {
        const c = crate(0.9, crateMat)
        c.position.set(x + 2.4, 0.36, -8.2)
        c.rotation.y = rng() * 0.6
        group.add(c)
      }
      if (rng() < 0.5) {
        const b = barrel(paintedMetal({ color: '#7a2b2b', seed: 12, res: 128 }), steel)
        b.position.set(x - 2.2, 0, -8.7)
        group.add(b)
      }
      if (rng() < 0.45) {
        const cone = trafficCone()
        cone.position.set(x + 1.1, 0, -6.9)
        group.add(cone)
      }
      if (rng() < 0.4) {
        // trolley with a wheel set
        const trolley = new THREE.Group()
        const platform = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 1.5), steel)
        platform.position.y = 0.75
        trolley.add(platform)
        for (const sx of [-0.2, 0.2]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.75, 0.06), steel)
          post.position.set(sx, 0.38, 0.6)
          trolley.add(post)
        }
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), steel)
        bar.rotation.z = Math.PI / 2
        bar.position.set(0, 0.78, 0.6)
        trolley.add(bar)
        const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.05, 6, 14), rubber)
        wheel.rotation.x = Math.PI / 2
        wheel.position.set(0, 0.16, 0)
        trolley.add(wheel)
        trolley.position.set(x - 3.4, 0, -7.6)
        trolley.rotation.y = rng() * 0.8
        group.add(trolley)
      }
      if (rng() < 0.35) {
        // wooden pallet
        const pallet = new THREE.Group()
        for (let s = 0; s < 5; s++) {
          const slat = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.03, 0.14), woodMat)
          slat.position.set(0, 0.12, -0.42 + s * 0.2)
          pallet.add(slat)
        }
        pallet.position.set(x + 3.2, 0, -8.9)
        pallet.rotation.y = rng() * 0.5
        group.add(pallet)
      }
    }
    // hazard-striped barrier boards at the pit exit
    for (let i = 0; i < 3; i++) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 0.12), hazard)
      board.position.set(4 + i * 2.7, 0.85, 7.2)
      group.add(board)
      const legA = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.85, 0.1), steel)
      legA.position.set(3.4 + i * 2.7, 0.42, 7.2)
      group.add(legA)
      const legB = legA.clone()
      legB.position.x = 4.6 + i * 2.7
      group.add(legB)
    }
  }

  /* ── Grandstand + forest + distant terrain ─────────────────────────── */
  {
    const stand = grandstand({
      length: mobile ? 60 : 96,
      rows: mobile ? 6 : 9,
      seat: new THREE.MeshStandardMaterial({ color: 0x1f2a38, roughness: 0.8 }),
      structure: concreteMaterial({ seed: 61, res: propRes, kind: 'rough', tone: '#4a4d55' }),
      roof: paintedMetal({ color: '#1b1f27', seed: 3, res: propRes, gloss: 0.4 }),
    })
    stand.position.set(0, 0, 20)
    group.add(stand) // tiers rise towards +Z, seats face the track at −Z
    /* The crowd has to sit ON the tiers: the stand's own frame runs z = 0 at
     * the front row to z = (rows−1)·1.9 under the canopy, so the phone
     * screens and the light spilling off the roof lip are placed there. */
    const rows = mobile ? 6 : 9
    const standStep = 0.92
    const crowd = new THREE.Group()
    const lipZ = -(rows * 1.9 * 0.225 + 0.6) // local: the canopy's front lip
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(90, 0.3), new THREE.MeshBasicMaterial({ color: 0xfff2d4 }))
    deck.position.set(0, rows * standStep + 2.7, lipZ)
    crowd.add(deck)
    for (let x = -44; x <= 44; x += 3.4) {
      const halo = glowSprite(0xffe7bd, 4.6, 0.32)
      halo.position.set(x, rows * standStep + 2.5, lipZ)
      crowd.add(halo)
      if (rng() < 0.5) {
        const row = Math.floor(rng() * rows)
        const phone = glowSprite(0xbfe3ff, 0.5, 0.8)
        phone.position.set(x + rng() * 2.6 - 1.3, 1.9 + row * standStep, row * 1.9 - 0.4)
        crowd.add(phone)
      }
    }
    stand.add(crowd)
  }

  {
    const forest = conifer.bind(null) as never // (kept for type clarity)
    void forest
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x33261c, roughness: 0.95 })
    const needleMat = new THREE.MeshStandardMaterial({ color: 0x1b3324, roughness: 1, flatShading: true })
    const needleMat2 = new THREE.MeshStandardMaterial({ color: 0x24402a, roughness: 1, flatShading: true })
    const trees = new THREE.Group()
    const count = mobile ? 40 : 110
    for (let i = 0; i < count; i++) {
      const side = rng() < 0.5
      const x = (rng() - 0.5) * 220
      const z = side ? 40 + rng() * 60 : -30 - rng() * 60
      const tree = conifer(rng, { trunk: trunkMat, foliage: rng() < 0.5 ? needleMat : needleMat2 }, 7 + rng() * 6)
      tree.position.set(x, 0, z)
      trees.add(tree)
    }
    group.add(trees)
    // Eifel hills far behind the pit building
    const hillMat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true, color: 0xffffff, vertexColors: true })
    const hills = terrain({
      size: 420,
      segments: mobile ? 60 : 110,
      material: hillMat,
      tile: 24,
      height: (x, z) => {
        const d = Math.max(0, Math.abs(z) - 60)
        const ridge = Math.sin(x * 0.014) * 6 + Math.sin(x * 0.031 + 1.7) * 3.4
        return d * 0.16 + ridge * smoothstep(0, 60, d) + Math.sin(z * 0.05) * 2
      },
      color: (x, z, y) => {
        const c = new THREE.Color()
        c.setHex(0x1b2233).lerp(new THREE.Color(0x2d3348), clamp01(y / 18))
        return c.lerp(new THREE.Color(0x101521), clamp01((Math.abs(z) - 120) / 120))
      },
    })
    hills.position.y = -0.4
    group.add(hills)
  }

  /* ── Atmosphere: mist, drizzle, motes, drifting fume ───────────────── */
  const fog = fogBank({ count: mobile ? 8 : 18, area: 80, y: 1.5, color: 0xc9cfe0, size: 40, opacity: 0.085, speed: 0.5 })
  group.add(fog)
  ticks.add((t, dt) => (fog.userData.tick as (a: number, b: number) => void)(t, dt))

  const drizzle = rainSystem({
    count: mobile ? 260 : 620,
    area: 70,
    height: 20,
    speed: 14,
    wind: 2.4,
    color: 0xbdd3ea,
    opacity: 0.16,
    length: 1.1,
  })
  group.add(drizzle.group)
  ticks.add(drizzle.tick)

  const lightMotes = motes({ count: mobile ? 90 : 220, area: 46, height: 12, color: 0xffd9a0, size: 0.075, opacity: 0.5 })
  lightMotes.points.position.set(0, 0, 0)
  group.add(lightMotes.points)
  ticks.add(lightMotes.tick)

  const exhaust = motes({ count: mobile ? 40 : 110, area: 12, height: 3.2, color: 0xc8d0dc, size: 0.11, opacity: 0.32 })
  exhaust.points.position.set(-2.4, 0.2, 0)
  group.add(exhaust.points)
  ticks.add(exhaust.tick)

  /* ── Traffic: a car on track every ~14 s, headlights sweeping ──────── */
  const passing = simpleCar({ body: 0x1a1c22, headlight: 0xfff1cf, taillight: 0xff2d18, scale: 1.05 })
  passing.position.set(-70, 0, 12.2)
  group.add(passing)
  const passingLight = new THREE.SpotLight(0xfff0d0, 220, 40, 0.5, 0.6, 2)
  passingLight.position.set(0, 0.9, 0)
  passingLight.target.position.set(14, 0, 0)
  passing.add(passingLight)
  passing.add(passingLight.target)
  const chased = simpleCar({ body: 0x2a2126, headlight: 0xfff1cf, taillight: 0xff2d18, scale: 1 })
  chased.position.set(-84, 0, 12.6)
  group.add(chased)

  ticks.add((t) => {
    const cycle = 14
    const k = (t % cycle) / cycle
    const x = lerp(-72, 78, k)
    passing.position.x = x
    chased.position.x = x - 13
    // the pair lift onto the racing line as they pass the pits
    const zBias = Math.sin(clamp01((x + 40) / 80) * Math.PI) * 1.2
    passing.position.z = 12.2 + zBias
    chased.position.z = 12.6 + zBias
    const visible = k < 0.97
    passing.visible = visible
    chased.visible = visible
    passingLight.intensity = visible ? 220 : 0
  })

  /* ── Lantern logic: floodlight shimmer + one failing garage tube ───── */
  ticks.add((t) => {
    for (let i = 0; i < mastHalos.length; i++) {
      const flicker = 0.62 + Math.sin(t * 2.6 + i * 1.9) * 0.05 + (Math.sin(t * 41 + i) > 0.985 ? -0.2 : 0)
      mastHalos[i].material.opacity = flicker
    }
    for (let i = 0; i < shaftMaterials.length; i++) {
      shaftMaterials[i].opacity = 0.042 + Math.sin(t * 1.7 + i) * 0.008
    }
    // box 6 has a dying tube
    if (doorMaterials[6]) {
      const bad = Math.sin(t * 27) * Math.sin(t * 6.1) + Math.sin(t * 2.3) > -0.2
      doorMaterials[6].emissiveIntensity = bad ? 0.55 : 0.06
      const light = interiorLights[3]
      if (light) light.intensity = bad ? 26 : 4
    }
    // engine fume off the idling car
    for (const light of interiorLights) light.intensity = light.intensity * 0.98 + 26 * 0.02
  })

  /* ── Lighting rig for the car ──────────────────────────────────────── */
  const sun = new THREE.DirectionalLight(0xff9f5c, 1.35)
  sun.position.set(-40, 12, 46)
  group.add(sun)
  const awning = new THREE.HemisphereLight(0x44507a, 0x1a1512, 0.5)
  group.add(awning)

  return {
    id: 'nurburgring',
    group,
    background: sky,
    environment: sky,
    lighting: {
      key: { color: 0xffb877, intensity: 420, position: [-9, 7.5, 12] },
      rim: { color: 0x7d95ff, intensity: 2.6, position: [10, 6, -9] },
      hemi: { sky: 0x3b3f7c, ground: 0x2a1a14, intensity: 0.75 },
      fog: { color: 0x46323e, density: 0.0105 },
      exposure: 1.06,
      environmentIntensity: 0.85,
      beamScale: 0.9,
      floorReflection: false,
      shadow: { far: 60, near: 2, angle: 0.72, penumbra: 0.6, focus: [0, 0.5, 0] },
    },
    facts: [
      { label: 'Surface', value: 'Wet tarmac' },
      { label: 'Air', value: '11 °C · drizzle' },
      { label: 'Nitrous', value: 'Pit lane closed' },
    ],
    update: (frame) => ticks.run(frame.time, frame.dt),
    dispose: () => {
      disposeGroup(group)
      sky.dispose()
      void lerp
      void smoothstep
      void Field
    },
  }
}
