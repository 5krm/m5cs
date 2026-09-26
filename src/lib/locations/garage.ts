/**
 * ═════════════════════════════════════════════════════════════════════════
 * 2 · MUNICH GARAGE P2 — underground parking, 03:40, sprinkler drip
 * ═════════════════════════════════════════════════════════════════════════
 * A real car park is mostly *services*: cable trays, sprinkler mains, conduits,
 * junction boxes, drainage channels, level signage, CCTV, ramps. All of that
 * is modelled here, on top of a poured-concrete slab with its own control
 * joints and a wet film that mirrors the fluorescent rows.
 *
 * Running logic: the lane lights wake in sequence ahead of the car and sleep
 * behind it, fixture 9 has a failing ballast, the CCTV LED pulses, the exit
 * signs breathe, water drips from the slab and rings out in a puddle, and the
 * ramp mouth spills daylight down the wall.
 */

import * as THREE from 'three'
import {
  concreteMaterial,
  glassMaterial,
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
  crate,
  disposeGroup,
  dumpster,
  flatGround,
  glowSprite,
  motes,
  puddle,
  smokePlume,
  trafficCone,
  tyreStack,
  wetReflection,
} from './shared'
import type { LocationScene } from './types'

const SIZE = 60
const CEIL = 3.65

export function buildGarage(ctx: Ctx): LocationScene {
  const { mobile, heroRes, propRes } = ctx
  const group = new THREE.Group()
  const ticks = new Ticks()
  const rng = mulberry32(2604)

  /* ── Slab floor: poured concrete with control joints and a wet film ── */
  const concrete = concreteMaterial({ seed: 205, res: heroRes, kind: 'floor', tone: '#7e7f80' })
  const floorMat = concrete.clone()
  const std = floorMat as THREE.MeshStandardMaterial
  std.roughness = 0.9
  std.metalness = 0.02
  std.envMapIntensity = 1.15
  std.transparent = true
  std.opacity = 0.93 // the mirrored car reads through as a wet reflection
  group.add(flatGround({ size: SIZE, circle: false, material: floorMat, tile: 8, name: 'slab' }))

  /* ── Bay markings, arrows, level stencils, scuffs and oil ──────────── */
  {
    const px = 2048
    const [canvas, c2d] = (() => {
      const c = document.createElement('canvas')
      c.width = c.height = px
      return [c, c.getContext('2d')!] as const
    })()
    const u = px / SIZE
    const mid = px / 2
    c2d.lineWidth = 5
    // parking bay grid on both sides of the drive lane
    for (const side of [-1, 1]) {
      c2d.strokeStyle = 'rgba(232,232,226,0.72)'
      const z0 = side * 4.4
      const z1 = side * 10.2
      for (let x = -26; x <= 26; x += 2.6) {
        c2d.beginPath()
        c2d.moveTo(mid + x * u, mid + z0 * u)
        c2d.lineTo(mid + x * u, mid + z1 * u)
        c2d.stroke()
      }
      c2d.beginPath()
      c2d.moveTo(mid - 26 * u, mid + z1 * u)
      c2d.lineTo(mid + 26 * u, mid + z1 * u)
      c2d.stroke()
      c2d.beginPath()
      c2d.moveTo(mid - 26 * u, mid + z0 * u)
      c2d.lineTo(mid + 26 * u, mid + z0 * u)
      c2d.stroke()
    }
    // bay numbers
    c2d.fillStyle = 'rgba(232,232,226,0.55)'
    c2d.font = `600 ${Math.round(0.55 * u)}px Inter, Arial, sans-serif`
    for (let i = 0; i < 20; i++) {
      const x = -25 + i * 2.6
      c2d.fillText(String(210 + i), mid + x * u + 8, mid + 5.3 * u)
      c2d.fillText(String(310 + i), mid + x * u + 8, mid - 4.9 * u)
    }
    // drive-lane arrows
    c2d.fillStyle = 'rgba(232,232,226,0.6)'
    for (const x of [-18, -6, 6, 18]) {
      c2d.beginPath()
      c2d.moveTo(mid + (x + 1.5) * u, mid)
      c2d.lineTo(mid + (x - 0.5) * u, mid - 0.85 * u)
      c2d.lineTo(mid + (x - 0.5) * u, mid - 0.28 * u)
      c2d.lineTo(mid + (x - 2.1) * u, mid - 0.28 * u)
      c2d.lineTo(mid + (x - 2.1) * u, mid + 0.28 * u)
      c2d.lineTo(mid + (x - 0.5) * u, mid + 0.28 * u)
      c2d.lineTo(mid + (x - 0.5) * u, mid + 0.85 * u)
      c2d.closePath()
      c2d.fill()
    }
    // level stencil
    c2d.save()
    c2d.translate(mid - 12 * u, mid + 12 * u)
    c2d.fillStyle = 'rgba(28,105,212,0.75)'
    c2d.fillRect(-2.4 * u, -1.3 * u, 4.8 * u, 2.6 * u)
    c2d.fillStyle = '#ffffff'
    c2d.font = `700 ${Math.round(2.1 * u)}px Inter, Arial, sans-serif`
    c2d.textAlign = 'center'
    c2d.textBaseline = 'middle'
    c2d.fillText('P2', 0, 0)
    c2d.restore()
    // tyre scuffs + oil drips
    for (let i = 0; i < 40; i++) {
      const cx = rng() * px
      const cy = mid + (rng() - 0.5) * 16 * u
      const grad = c2d.createRadialGradient(cx, cy, 0, cx, cy, (0.3 + rng() * 1.2) * u)
      grad.addColorStop(0, `rgba(12,12,14,${0.25 + rng() * 0.35})`)
      grad.addColorStop(1, 'rgba(12,12,14,0)')
      c2d.fillStyle = grad
      c2d.fillRect(cx - 2 * u, cy - 2 * u, 4 * u, 4 * u)
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    const marks = new THREE.Mesh(
      new THREE.PlaneGeometry(SIZE, SIZE),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.95 }),
    )
    marks.rotation.x = -Math.PI / 2
    marks.position.y = 0.02
    marks.renderOrder = 2
    group.add(marks)
  }

  /* ── Standing water: puddles + the dripping ring that grows in one ─── */
  const wetSpots: THREE.Mesh[] = []
  for (let i = 0; i < (mobile ? 7 : 16); i++) {
    const mesh = puddle({ radius: 0.7 + rng() * 2.3, opacity: 0.85 })
    mesh.position.set((rng() - 0.5) * 30, 0.014, -12 + rng() * 24)
    mesh.rotation.z = rng() * Math.PI
    group.add(mesh)
    wetSpots.push(mesh)
  }
  // a drain channel with a grate down the lane
  {
    const trench = new THREE.Mesh(
      new THREE.BoxGeometry(44, 0.06, 0.4),
      metalMaterial({ color: '#4a4e55', roughness: 0.6 }),
    )
    trench.position.set(0, 0.03, 3.1)
    group.add(trench)
    for (let x = -22; x <= 22; x += 0.6) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.36), metalMaterial({ color: '#2b2e33', roughness: 0.7 }))
      bar.position.set(x, 0.065, 3.1)
      group.add(bar)
    }
  }
  // drip ripple: an expanding ring decal in the puddle under the leak
  const ripple = (() => {
    const [cv, c2d] = (() => {
      const c = document.createElement('canvas')
      c.width = c.height = 128
      return [c, c.getContext('2d')!] as const
    })()
    const g = c2d.createRadialGradient(64, 64, 20, 64, 64, 62)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.72, 'rgba(255,255,255,0)')
    g.addColorStop(0.86, 'rgba(255,255,255,0.55)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    c2d.fillStyle = g
    c2d.fillRect(0, 0, 128, 128)
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.NoColorSpace
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 3.2),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }),
    )
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(-3.4, 0.02, -2.2)
    mesh.renderOrder = 3
    return mesh
  })()
  group.add(ripple)

  /* ── Ceiling slab, beams, trays, sprinkler main, ducts ─────────────── */
  const ceilingMat = concreteMaterial({ seed: 311, res: propRes, kind: 'wall', tone: '#4b4d52' })
  {
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), ceilingMat)
    ceiling.rotation.x = Math.PI / 2
    ceiling.position.y = CEIL
    group.add(ceiling)
    for (let z = -26; z <= 26; z += 7.5) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(SIZE, 0.62, 0.7), ceilingMat)
      beam.position.set(0, CEIL - 0.31, z)
      beam.castShadow = true
      group.add(beam)
    }
    const trayMat = metalMaterial({ color: '#8a8f96', roughness: 0.42 })
    const pipeMat = metalMaterial({ color: '#9aa0a8', roughness: 0.3 })
    const redPipe = paintedMetal({ color: '#a52020', seed: 22, res: propRes, gloss: 0.35 })
    // ladder cable tray with cables inside
    const tray = new THREE.Mesh(new THREE.BoxGeometry(SIZE, 0.1, 0.5), trayMat)
    tray.position.set(0, CEIL - 0.78, -3.2)
    group.add(tray)
    for (let x = -28; x <= 28; x += 1.2) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.46), trayMat)
      rung.position.set(x, CEIL - 0.82, -3.2)
      group.add(rung)
    }
    for (const [dz, color] of [
      [-0.12, 0x2f4c8a],
      [0.0, 0x1f1f22],
      [0.12, 0x8a2a2a],
    ] as const) {
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, SIZE, 6), new THREE.MeshStandardMaterial({ color, roughness: 0.7 }))
      cable.rotation.z = Math.PI / 2
      cable.position.set(0, CEIL - 0.74, -3.2 + dz)
      group.add(cable)
    }
    // sprinkler main with drops and heads
    const main = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, SIZE, 10), redPipe)
    main.rotation.z = Math.PI / 2
    main.position.set(0, CEIL - 0.55, 1.6)
    group.add(main)
    for (let x = -27; x <= 27; x += 4.5) {
      const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.32, 8), redPipe)
      drop.position.set(x, CEIL - 0.4, 1.6)
      group.add(drop)
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.07, 10), metalMaterial({ color: '#c9ccd2', roughness: 0.35 }))
      head.position.set(x, CEIL - 0.25, 1.6)
      group.add(head)
      const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.22), trayMat)
      clamp.position.set(x, CEIL - 0.55, 1.6)
      group.add(clamp)
    }
    // ventilation duct with grilles
    const ductMat = metalMaterial({ color: '#a7adb5', roughness: 0.5 })
    const duct = new THREE.Mesh(new THREE.BoxGeometry(SIZE, 0.55, 0.9), ductMat)
    duct.position.set(0, CEIL - 1.05, 9.4)
    group.add(duct)
    for (let x = -24; x <= 24; x += 6) {
      const grille = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.94), metalMaterial({ color: '#5c6167', roughness: 0.55 }))
      grille.position.set(x, CEIL - 1.35, 9.4)
      group.add(grille)
    }
    // conduit runs along the wall with junction boxes
    for (let i = 0; i < 3; i++) {
      const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, SIZE, 8), metalMaterial({ color: '#b7bcc3', roughness: 0.4 }))
      conduit.rotation.z = Math.PI / 2
      conduit.position.set(0, 2.2 + i * 0.16, -SIZE / 2 + 0.12)
      group.add(conduit)
    }
    for (const x of [-18, -6, 8, 20]) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.22), metalMaterial({ color: '#9ea4ab', roughness: 0.45 }))
      box.position.set(x, 2.05, -SIZE / 2 + 0.16)
      group.add(box)
    }
  }

  /* ── Walls: corrugated shutters, P2 sign, exit signs, CCTV ─────────── */
  const wallMat = concreteMaterial({ seed: 401, res: propRes, kind: 'wall', tone: '#595b60' })
  {
    const walls: Array<[number, number, number]> = [
      [0, -SIZE / 2, 0],
      [0, SIZE / 2, Math.PI],
      [-SIZE / 2, 0, Math.PI / 2],
      [SIZE / 2, 0, -Math.PI / 2],
    ]
    for (const [x, z, ry] of walls) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, CEIL), wallMat)
      w.position.set(x, CEIL / 2, z)
      w.rotation.y = ry
      w.receiveShadow = true
      group.add(w)
    }
    // skirting band (the classic 1 m painted dado)
    for (const [x, z, ry] of walls) {
      const skirt = new THREE.Mesh(
        new THREE.PlaneGeometry(SIZE, 1.05),
        paintedMetal({ color: '#3f4a56', seed: 5, res: propRes, gloss: 0.45 }),
      )
      skirt.position.set(x, 0.52, z)
      skirt.rotation.y = ry
      skirt.translateZ(0.012)
      group.add(skirt)
    }

    // P2 level sign hung from the ceiling
    const p2 = signMaterial({ text: 'P2', sub: 'EBENE · LEVEL · NIVEAU', bg: '#e9e7e0', fg: '#1c69d4', glow: '#1c69d4', width: 512, height: 256 })
    const p2Mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.7), p2.material)
    p2Mesh.position.set(-6, 2.9, -SIZE / 2 + 0.08)
    group.add(p2Mesh)
    const p2Back = p2Mesh.clone()
    p2Back.rotation.y = Math.PI
    p2Back.position.z = -SIZE / 2 - 0.08
    group.add(p2Back)
    for (const x of [-7.4, -4.6]) {
      const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.75, 0.05), metalMaterial({ color: '#8b9098', roughness: 0.4 }))
      hanger.position.set(x, CEIL - 0.4, -SIZE / 2 + 0.08)
      group.add(hanger)
    }

    // exit signs on both long walls, with a green wash on the concrete
    const exit = signMaterial({ text: 'AUSGANG', sub: 'EXIT', bg: '#0f7a37', fg: '#ffffff', glow: '#7cffb0', width: 384, height: 160, arrow: true })
    for (const [x, z, ry] of [
      [16, -SIZE / 2 + 0.06, 0],
      [-16, SIZE / 2 - 0.06, Math.PI],
    ] as const) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.7), exit.material)
      sign.position.set(x, CEIL - 0.85, z)
      sign.rotation.y = ry
      group.add(sign)
      const halo = glowSprite(0x54ff9a, 3.2, 0.32)
      halo.position.set(x, CEIL - 0.85, z + (ry === 0 ? 0.3 : -0.3))
      group.add(halo)
    }

    // fire hose cabinet + extinguishers
    const cabinet = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.1, 0.28), paintedMetal({ color: '#b7271f', seed: 9, res: propRes, gloss: 0.4 }))
    cabinet.position.set(-12.5, 1.35, -SIZE / 2 + 0.24)
    group.add(cabinet)
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.7), glassMaterial({ tint: '#9fb4c4', opacity: 0.45 }))
    glass.position.set(-12.5, 1.42, -SIZE / 2 + 0.39)
    group.add(glass)
    for (const x of [22.5, 22.9]) {
      const ext = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.55, 12), paintedMetal({ color: '#c22a1e', seed: 3, res: 64, gloss: 0.5 }))
      ext.position.set(x, 0.28, -SIZE / 2 + 0.3)
      group.add(ext)
    }

    // CCTV camera with a pulsing LED
    const cctv = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.5), metalMaterial({ color: '#d5d8dd', roughness: 0.4 }))
    cctv.add(body)
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 12), new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.2, metalness: 0.4 }))
    lens.rotation.x = Math.PI / 2
    lens.position.z = 0.3
    cctv.add(lens)
    cctv.position.set(-6, CEIL - 0.55, -SIZE / 2 + 0.5)
    cctv.rotation.y = -0.5
    group.add(cctv)
    const led = glowSprite(0xff2a2a, 0.3, 0.9)
    led.position.set(-6.1, CEIL - 0.6, -SIZE / 2 + 0.72)
    group.add(led)
    ticks.add((t) => {
      led.material.opacity = Math.sin(t * 3.1) > 0 ? 0.95 : 0.08
    })

    // height-limit warning bar at the ramp mouth
    const limitBar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 7), hazardMaterial({ a: '#e0b400', b: '#141414', size: 64 }))
    limitBar.position.set(SIZE / 2 - 1.2, 2.1, 0)
    group.add(limitBar)
    for (const z of [-3.6, 3.6]) {
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6), metalMaterial({ color: '#8d939b', roughness: 0.4 }))
      chain.position.set(SIZE / 2 - 1.2, 2.36, z)
      group.add(chain)
    }
  }

  /* ── Columns with hazard chevrons and big level numbers ────────────── */
  {
    const colMat = concreteMaterial({ seed: 505, res: propRes, kind: 'wall', tone: '#63656a' })
    const stripe = hazardMaterial({ a: '#e6b400', b: '#1a1a1a', size: 128 })
    for (const x of [-22, -14, -6, 6, 14, 22]) {
      for (const z of [-13, -4.6, 4.6, 13, 21]) {
        if (Math.abs(x) < 5 && Math.abs(z) < 6) continue
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.85, CEIL, 0.85), colMat)
        col.position.set(x, CEIL / 2, z)
        col.castShadow = true
        group.add(col)
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.15, 0.9), stripe)
        base.position.set(x, 0.58, z)
        group.add(base)
        // column number (reversed on garage columns so drivers read them)
        const label = signMaterial({ text: String(Math.abs(x) + Math.abs(z)), bg: '#e6b400', fg: '#141414', glow: '#e6b400', width: 128, height: 128, border: false })
        for (const [dx, dz, ry] of [
          [0, 0.44, 0],
          [0, -0.44, Math.PI],
        ] as const) {
          const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), label.material)
          plate.position.set(x + dx, 2.9, z + dz)
          plate.rotation.y = ry
          group.add(plate)
        }
      }
    }
  }

  /* ── Fluorescent rows: fixtures, housings, halos, one bad ballast ──── */
  const fixtures: Array<{ lampMat: THREE.MeshStandardMaterial; halo: THREE.Sprite; light?: THREE.PointLight; index: number }> = []
  {
    const housingMat = metalMaterial({ color: '#c9ccd1', roughness: 0.45 })
    let index = 0
    for (const z of [-2.6, 2.6]) {
      for (let x = mobile ? -18 : -26; x <= (mobile ? 18 : 26); x += 3.6) {
        const y = CEIL - 0.12
        const housing = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.1, 0.32), housingMat)
        housing.position.set(x, y, z)
        group.add(housing)
        const lampMat = new THREE.MeshStandardMaterial({
          color: 0xdfe8f4,
          emissive: new THREE.Color('#e8f1ff'),
          emissiveIntensity: 1.2,
          roughness: 0.4,
        })
        const tube = new THREE.Mesh(new THREE.PlaneGeometry(1.92, 0.2), lampMat)
        tube.rotation.x = Math.PI / 2
        tube.position.set(x, y - 0.06, z)
        group.add(tube)
        const halo = glowSprite(0xdfe9f7, 3, 0.16)
        halo.position.set(x, y - 0.16, z)
        group.add(halo)
        let light: THREE.PointLight | undefined
        if (index % 3 === 0 && fixtures.length < (mobile ? 5 : 10)) {
          light = new THREE.PointLight(0xd8e4f4, 22, 13, 2)
          light.position.set(x, CEIL - 0.55, z)
          group.add(light)
        }
        fixtures.push({ lampMat, halo, light, index })
        index++
      }
    }
  }

  /* ── Parked-world props: racks, machines, trolleys, clutter ────────── */
  const glowProps: THREE.Mesh[] = []
  {
    const steel = metalMaterial({ color: '#9aa1a9', roughness: 0.4 })
    const rubber = new THREE.MeshStandardMaterial({ color: 0x131316, roughness: 0.95 })
    const plastic = paintedMetal({ color: '#2f3a48', seed: 14, res: propRes, gloss: 0.5 })
    const wood = new THREE.MeshStandardMaterial({ color: 0x7d6242, roughness: 0.9 })

    // tyre rack on the far wall
    const rack = new THREE.Group()
    for (const dx of [-1.5, 1.5]) {
      const upright = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.4, 0.1), steel)
      upright.position.set(dx, 1.2, 0)
      rack.add(upright)
    }
    for (let i = 0; i < 3; i++) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 1.1), steel)
      shelf.position.set(0, 0.55 + i * 0.8, 0)
      rack.add(shelf)
      for (let t = 0; t < 2; t++) {
        const stack = tyreStack(1 + Math.floor(rng() * 2), rubber)
        stack.position.set(-0.8 + t * 1.6, 0.6 + i * 0.8, 0)
        rack.add(stack)
      }
    }
    rack.position.set(-24, 0, -22)
    group.add(rack)

    // vending machine with an emissive front
    const vending = new THREE.Group()
    const shell = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.75), paintedMetal({ color: '#b7202a', seed: 2, res: propRes, gloss: 0.5 }))
    shell.position.y = 0.95
    vending.add(shell)
    const vendingEmissive = (() => {
      const [cv, c2d] = (() => {
        const c = document.createElement('canvas')
        c.width = 256
        c.height = 448
        return [c, c.getContext('2d')!] as const
      })()
      c2d.fillStyle = '#000000'
      c2d.fillRect(0, 0, 256, 448)
      c2d.fillStyle = '#ffffff'
      c2d.fillRect(12, 14, 232, 120)
      c2d.fillStyle = '#cccccc'
      for (let r = 0; r < 4; r++) {
        for (let cc = 0; cc < 3; cc++) c2d.fillRect(28 + cc * 72, 160 + r * 62, 52, 46)
      }
      const t = new THREE.CanvasTexture(cv)
      t.colorSpace = THREE.SRGBColorSpace
      return t
    })()
    const front = new THREE.Mesh(
      new THREE.PlaneGeometry(0.94, 1.6),
      new THREE.MeshStandardMaterial({
        map: (() => {
          const [cv, c2d] = (() => {
            const c = document.createElement('canvas')
            c.width = 256
            c.height = 448
            return [c, c.getContext('2d')!] as const
          })()
          c2d.fillStyle = '#0b0c10'
          c2d.fillRect(0, 0, 256, 448)
          c2d.fillStyle = '#f4f6f8'
          c2d.fillRect(12, 14, 232, 120)
          c2d.fillStyle = '#b7202a'
          c2d.font = '700 54px Inter, Arial, sans-serif'
          c2d.textAlign = 'center'
          c2d.fillText('M-POWER', 128, 74)
          c2d.fillStyle = '#1c69d4'
          c2d.font = '500 26px Inter, Arial, sans-serif'
          c2d.fillText('COLD DRINKS', 128, 112)
          for (let r = 0; r < 4; r++) {
            for (let cc = 0; cc < 3; cc++) {
              c2d.fillStyle = `hsl(${(r * 3 + cc) * 34}, 70%, 55%)`
              c2d.fillRect(28 + cc * 72, 160 + r * 62, 52, 46)
            }
          }
          const t = new THREE.CanvasTexture(cv)
          t.colorSpace = THREE.SRGBColorSpace
          return t
        })(),
        emissiveMap: vendingEmissive,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.75,
        roughness: 0.35,
        metalness: 0.1,
      }),
    )
    front.position.set(0, 1.05, 0.38)
    vending.add(front)
    vending.position.set(-21.6, 0, -SIZE / 2 + 0.9)
    vending.rotation.y = 0.12
    group.add(vending)
    const vendingGlow = new THREE.PointLight(0xffd9b0, 6, 6, 2)
    vendingGlow.position.set(-21.6, 1.2, -SIZE / 2 + 1.6)
    group.add(vendingGlow)
    glowProps.push(front)

    // recycling bins + dumpster
    const bin = dumpster(paintedMetal({ color: '#2b4a2f', seed: 6, res: propRes, gloss: 0.4 }), metalMaterial({ color: '#3a3f46', roughness: 0.5 }))
    bin.position.set(19, 0, -SIZE / 2 + 1.4)
    bin.rotation.y = -0.2
    group.add(bin)
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 0.95, 14), paintedMetal({ color: i === 0 ? '#1c69d4' : i === 1 ? '#b7202a' : '#e0b400', seed: i, res: 64, gloss: 0.5 }))
      b.position.set(15.5 + i * 0.9, 0.48, -SIZE / 2 + 1.1)
      group.add(b)
    }

    // trolley with a jack and tyres mid-job
    const trolley = new THREE.Group()
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 2.2), steel)
    deck.position.y = 0.42
    trolley.add(deck)
    for (const [dx, dz] of [
      [-0.5, 0.95],
      [0.5, 0.95],
      [-0.5, -0.95],
      [0.5, -0.95],
    ]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 10), rubber)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(dx, 0.1, dz)
      trolley.add(wheel)
    }
    for (let i = 0; i < 4; i++) {
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.12, 8, 18), rubber)
      tyre.rotation.x = Math.PI / 2
      tyre.position.set(i % 2 === 0 ? -0.28 : 0.28, 0.6, -0.7 + Math.floor(i / 2) * 0.5)
      tyre.castShadow = true
      trolley.add(tyre)
    }
    trolley.position.set(-11, 0, -7.4)
    trolley.rotation.y = 0.5
    group.add(trolley)

    // pallets, crates and a oil drum cluster
    for (let i = 0; i < 6; i++) {
      const c = crate(0.9, plastic)
      c.position.set(-20 + i * 3.4 + rng(), 0.36, -SIZE / 2 + 1.6 + rng() * 0.6)
      c.rotation.y = rng() * 0.4
      group.add(c)
      if (rng() < 0.5) {
        const top = crate(0.8, wood)
        top.position.set(c.position.x, 1.03, c.position.z)
        top.rotation.y = rng() * 0.4
        group.add(top)
      }
    }
    for (const x of [-26.5, -26.1, -25.7]) {
      const b = barrel(paintedMetal({ color: '#4d5a3a', seed: 11, res: 64, gloss: 0.35 }), steel)
      b.position.set(x + rng() * 0.4, 0, -6 + rng() * 4)
      group.add(b)
    }
    // a couple of cones near the ramp
    for (let i = 0; i < 3; i++) {
      const cone = trafficCone()
      cone.position.set(SIZE / 2 - 3.2 - i * 1.4, 0, -2 + i * 0.9)
      group.add(cone)
    }
  }

  /* ── Exhaust haze + dust in the light ──────────────────────────────── */
  const dust = motes({ count: mobile ? 110 : 260, area: 26, height: CEIL - 0.3, color: 0xdfe8f8, size: 0.055, opacity: 0.34 })
  dust.points.position.y = 0.2
  group.add(dust.points)
  ticks.add(dust.tick)

  const haze = smokePlume({
    position: new THREE.Vector3(-2.2, 0.15, -0.4),
    color: 0xb9c4d4,
    scale: 0.5,
    rate: 0.35,
    opacity: 0.1,
  })
  group.add(haze)
  ticks.add((t, dt) => (haze.userData.tick as (a: number, b: number) => void)(t, dt))

  /* ── The ramp mouth spilling daylight (and a little rain) ──────────── */
  {
    const mouth = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 3.2),
      new THREE.MeshBasicMaterial({ color: 0xb9cbe0, transparent: true, opacity: 0.5, fog: true }),
    )
    mouth.position.set(SIZE / 2 - 0.06, 1.7, 0)
    mouth.rotation.y = -Math.PI / 2
    group.add(mouth)
    const shaft = new THREE.Mesh(
      new THREE.ConeGeometry(5.2, 12, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xa9c2dd,
        transparent: true,
        opacity: 0.05,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    shaft.rotation.z = Math.PI / 2
    shaft.position.set(SIZE / 2 - 7, 1.6, 0)
    group.add(shaft)
    // ramp walls so the opening reads as a portal, not a hole in the wall
    const rampWall = concreteMaterial({ seed: 707, res: propRes, kind: 'rough', tone: '#5a5c60' })
    for (const z of [-3.6, 3.6]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(9, 3.6, 0.4), rampWall)
      w.position.set(SIZE / 2 + 4, 1.8, z)
      group.add(w)
    }
    const ramp = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 7.2),
      new THREE.MeshStandardMaterial({ color: 0x5e6166, roughness: 0.85, metalness: 0.05 }),
    )
    ramp.rotation.x = -Math.PI / 2
    ramp.rotation.z = 0
    ramp.position.set(SIZE / 2 + 4, 0.02, 0)
    ramp.rotation.y = 0
    group.add(ramp)
    const slope = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 7.2),
      new THREE.MeshStandardMaterial({ color: 0x606368, roughness: 0.8 }),
    )
    slope.position.set(SIZE / 2 - 0.4, 1.6, 0)
    slope.rotation.y = Math.PI / 2
    slope.rotation.x = 0
    group.add(slope)
    ticks.add((t) => {
      // faint daylight breathing as traffic passes outside
      const k = 0.45 + Math.max(0, Math.sin(t * 0.22)) * 0.22
      ;(mouth.material as THREE.MeshBasicMaterial).opacity = k
      ;(shaft.material as THREE.MeshBasicMaterial).opacity = 0.03 + k * 0.05
    })
  }

  /* ── Reflected tube light in the wet floor ─────────────────────────── */
  for (const z of [-2.6, 2.6]) {
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(52, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xd8e6f8, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    strip.rotation.x = -Math.PI / 2
    strip.position.set(0, 0.018, z + (z > 0 ? 5.2 : 5.2))
    group.add(strip)
  }
  /* ── Logic: lane lights wake ahead of the car, sleep behind it ─────── */
  ticks.add((t) => {
    void t
    for (const fx of fixtures) {
      const isBad = fx.index === 9
      const flicker = isBad ? (Math.sin(t * 23) * Math.sin(t * 7.3) + Math.sin(t * 1.7) > -0.15 ? 1 : 0.12) : 1
      // a slow wave of "motion detected" wake-ups rolling down the lane
      const wave = 0.86 + 0.14 * Math.sin(t * 0.7 - fx.index * 0.55)
      fx.lampMat.emissiveIntensity = 1.15 * flicker * wave
      fx.halo.material.opacity = 0.16 * flicker * wave
      if (fx.light) fx.light.intensity = 22 * flicker * wave
    }
    // drip → ring out every 3.1 s
    const phase = (t % 3.1) / 3.1
    const scale = 0.5 + phase * 1.9
    ripple.scale.setScalar(scale)
    ;(ripple.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - phase)
    // puddles tremble very slightly (surface tension + vibration)
    for (let i = 0; i < wetSpots.length; i++) {
      wetSpots[i].scale.setScalar(1 + Math.sin(t * 0.9 + i) * 0.006)
    }
    for (const p of glowProps) {
      const m = p.material as THREE.MeshStandardMaterial
      m.emissiveIntensity = 0.85 + Math.sin(t * 11) * 0.04
    }
  })

  /* ── Lighting rig for the car ──────────────────────────────────────── */
  for (const [x, z] of [
    [-3, -2.6],
    [3, 2.6],
  ] as const) {
    const pl = new THREE.PointLight(0xd8e4f4, 18, 14, 2)
    pl.position.set(x, CEIL - 0.5, z)
    group.add(pl)
  }
  const glint = new THREE.PointLight(0xffffff, 8, 9, 2)
  glint.position.set(0, CEIL - 0.7, 0)
  group.add(glint)

  return {
    id: 'garage',
    group,
    background: new THREE.Color(0x07080b),
    environment: null,
    lighting: {
      key: { color: 0xdde6f2, intensity: 240, position: [2, 6.2, 2.5] },
      rim: { color: 0x8aa3c8, intensity: 0.9, position: [-8, 3, -6] },
      hemi: { sky: 0x78849a, ground: 0x1c1d21, intensity: 0.34 },
      fog: { color: 0x0b0c10, density: 0.028 },
      exposure: 0.92,
      environmentIntensity: 0.5,
      beamScale: 1.3,
      floorReflection: true,
      shadow: { far: 34, near: 2, angle: 0.85, penumbra: 0.7, focus: [0, 0.6, 0] },
    },
    facts: [
      { label: 'Level', value: 'P2 · 3.65 m clear' },
      { label: 'Air', value: '14 °C · still' },
      { label: 'Floor', value: 'Wet polished slab' },
    ],
    update: (frame) => ticks.run(frame.time, frame.dt),
    dispose: () => disposeGroup(group),
  }
}
