/**
 * ═════════════════════════════════════════════════════════════════════════
 * 4 · TOKYO NIGHT — Shuto C1 loop, 23:48, heavy rain
 * ═════════════════════════════════════════════════════════════════════════
 * The hero shot of the whole set: an elevated expressway deck with sound
 * barriers, gantry signage and cat's eyes, wet asphalt that mirrors every
 * neon sign on the buildings above, traffic streaming past in both
 * directions, utility poles with transformer cans and sagging wires, a
 * convenience store glowing on the corner, vending machines, and rain.
 *
 * Running logic: seven vehicles (with headlights, taillights and spray)
 * circulate; signs flicker and buzz independently; a monorail crosses the
 * skyline every ~40 s; the rain strengthens and eases; puddles ripple; and
 * every neon emitters' reflection is mirrored onto the road as a second,
 * stretched mesh so the wet asphalt reads as genuinely wet.
 */

import * as THREE from 'three'
import {
  asphaltSurface,
  concreteMaterial,
  facadeMaterial,
  glassMaterial,
  gravelMaterial,
  hazardMaterial,
  metalMaterial,
  paintedMetal,
  signMaterial,
  stonePavingMaterial,
} from '@/lib/procedural/materials'
import { clamp01, lerp, mulberry32, smoothstep } from '@/lib/procedural/field'
import {
  Ctx,
  Ticks,
  catenary,
  chainFence,
  disposeGroup,
  flatGround,
  glowSprite,
  guardRail,
  lightShaft,
  motes,
  puddle,
  puddleField,
  rainSystem,
  simpleCar,
  skyDome,
  trafficCone,
  wetReflection,
  makeSky,
} from './shared'
import type { LocationScene } from './types'

/** A vertical neon kanji column — the Tokyo shorthand. */
function neoTower(text: string, color: string, height: number, width = 0.9): THREE.Group {
  const g = new THREE.Group()
  const { material } = signMaterial({
    text,
    bg: '#07080c',
    fg: color,
    glow: color,
    vertical: true,
    width: 128,
    height: 512,
  })
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material)
  g.add(panel)
  const back = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material)
  back.rotation.y = Math.PI
  back.position.z = -0.06
  g.add(back)
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(width * 1.12, height * 1.02, 0.1),
    metalMaterial({ color: '#2a2c30', roughness: 0.6 }),
  )
  frame.position.z = -0.03
  g.add(frame)
  return g
}

export function buildTokyo(ctx: Ctx): LocationScene {
  const { mobile, heroRes, propRes } = ctx
  const group = new THREE.Group()
  const ticks = new Ticks()
  const rng = mulberry32(2049)

  /* ── Sky: low cloud lit from underneath by 23 million people ───────── */
  const sky = makeSky({
    seed: 31,
    stops: [
      [0, '#040611'],
      [0.26, '#0a0f24'],
      [0.4, '#1d1330'],
      [0.46, '#4a1c3a'],
      [0.5, '#7a2e3c'],
      [0.53, '#2a1526'],
      [1, '#070810'],
    ],
    clouds: { cover: 0.85, altitude: 0.3, color: '#c25f6a', shadow: '#2a1a30', seed: 12 },
    haze: { height: 0.1, color: 'rgba(214,120,130,0.35)' },
    bloom: 0.6,
    silhouettes: (g, w, h, horizon) => {
      // Shinjuku-style tower field with window grids
      const r = mulberry32(77)
      g.fillStyle = '#0b0e19'
      for (let i = 0; i < 44; i++) {
        const bw = 22 + r() * 62
        const bh = 40 + r() * 150
        const bx = (i / 44) * w + (r() - 0.5) * 44
        g.fillStyle = '#0b0e19'
        g.fillRect(bx, horizon - bh, bw, bh + 4)
        const rows = Math.floor(bh / 6)
        const cols = Math.floor(bw / 7)
        for (let row = 1; row < rows; row++) {
          for (let col = 1; col < cols; col++) {
            if (r() < 0.34) {
              g.fillStyle = r() < 0.62 ? 'rgba(255,222,168,0.8)' : 'rgba(140,220,255,0.75)'
              g.fillRect(bx + col * 7, horizon - bh + row * 6, 2.6, 2.6)
            }
          }
        }
        // rooftop aviation light
        g.fillStyle = 'rgba(255,60,60,0.9)'
        g.fillRect(bx + bw / 2, horizon - bh - 3, 2, 2)
      }
      // Tokyo Tower lattice
      const tx = w * 0.7
      g.fillStyle = '#3a0f18'
      g.beginPath()
      g.moveTo(tx - 34, horizon)
      g.lineTo(tx - 13, horizon - 84)
      g.lineTo(tx - 4, horizon - 146)
      g.lineTo(tx, horizon - 186)
      g.lineTo(tx + 4, horizon - 146)
      g.lineTo(tx + 13, horizon - 84)
      g.lineTo(tx + 34, horizon)
      g.closePath()
      g.fill()
      g.fillStyle = 'rgba(255,72,48,0.9)'
      g.fillRect(tx - 15, horizon - 88, 30, 5)
      g.fillRect(tx - 6, horizon - 148, 12, 4)
      g.fillRect(tx - 1.5, horizon - 186, 3, 26)
      // elevated viaduct band + rain haze under the horizon
      g.fillStyle = '#0a0d16'
      g.fillRect(0, horizon - 12, w, 16)
      for (let x = 0; x < w; x += 120) g.fillRect(x + 18, horizon - 12, 14, 18)
    },
  })
  group.add(skyDome(sky, 130))

  /* ── The deck: wet asphalt, kerbs, drainage stains ────────────────── */
  const asphalt = asphaltSurface({ seed: 61, res: heroRes, freshness: 0.42, wet: 0.85, tile: 5 })
  group.add(flatGround({ size: 130, circle: false, material: asphalt.material, tile: 5, name: 'deck' }))
  group.add(puddleField(asphalt.puddles, { count: mobile ? 14 : 34, area: 52, min: 0.8, max: 4.6, threshold: 0.3, seed: 9 }))

  /* ── Lane markings: two carriageways, cat's eyes, arrows ──────────── */
  {
    const px = 2048
    const [canvas, c2d] = (() => {
      const c = document.createElement('canvas')
      c.width = px
      c.height = px
      return [c, c.getContext('2d')!] as const
    })()
    const u = px / 70 // 70 m span
    const mid = px / 2
    // carriageway separation wall shadow line
    c2d.fillStyle = 'rgba(10,12,18,0.35)'
    c2d.fillRect(0, mid - 0.3 * u, px, 0.6 * u)

    const lane = (z: number, solid: boolean) => {
      c2d.fillStyle = 'rgba(238,238,232,0.8)'
      if (solid) c2d.fillRect(0, mid + z * u, px, 0.16 * u)
      else for (let x = 0; x < px; x += 5 * u) c2d.fillRect(x, mid + z * u, 2.6 * u, 0.16 * u)
    }
    for (const z of [-5.4, -1.9, 1.9, 5.4]) lane(z, Math.abs(z) === 5.4)
    // shoulder edge lines
    c2d.fillStyle = 'rgba(240,240,235,0.7)'
    c2d.fillRect(0, mid - 6.6 * u, px, 0.14 * u)
    c2d.fillRect(0, mid + 6.6 * u, px, 0.14 * u)
    // cat's eyes (raised reflectors) on every dash
    for (let x = 0; x < px; x += 2 * u) {
      c2d.fillStyle = 'rgba(255,190,60,0.95)'
      c2d.fillRect(x, mid - 2.02 * u, 0.14 * u, 0.26 * u)
      c2d.fillRect(x, mid + 1.94 * u, 0.14 * u, 0.26 * u)
    }
    // "60" roundel + 速度落とせ road text
    const roundel = (cx: number, cy: number) => {
      c2d.strokeStyle = 'rgba(226,74,66,0.9)'
      c2d.lineWidth = 0.3 * u
      c2d.beginPath()
      c2d.arc(cx, cy, 1.3 * u, 0, Math.PI * 2)
      c2d.stroke()
      c2d.fillStyle = 'rgba(238,238,232,0.9)'
      c2d.font = `700 ${Math.round(1.4 * u)}px Inter, Arial, sans-serif`
      c2d.textAlign = 'center'
      c2d.textBaseline = 'middle'
      c2d.fillText('60', cx, cy)
    }
    roundel(mid + 9 * u, mid + 3.6 * u)
    roundel(mid - 15 * u, mid - 3.6 * u)
    c2d.fillStyle = 'rgba(238,238,232,0.8)'
    c2d.font = `700 ${Math.round(1.1 * u)}px "Hiragino Sans", "Noto Sans JP", sans-serif`
    c2d.textAlign = 'center'
    c2d.fillText('速度落とせ', mid + 2 * u, mid - 3.4 * u)
    // chevrons before the merge
    c2d.fillStyle = 'rgba(240,240,235,0.75)'
    for (let i = 0; i < 6; i++) {
      const bx = mid + (18 + i * 1.4) * u
      c2d.beginPath()
      c2d.moveTo(bx, mid + 1.4 * u)
      c2d.lineTo(bx + 0.9 * u, mid + 2.1 * u)
      c2d.lineTo(bx + 0.45 * u, mid + 2.1 * u)
      c2d.lineTo(bx + 0.45 * u, mid + 2.8 * u)
      c2d.lineTo(bx - 0.45 * u, mid + 2.8 * u)
      c2d.lineTo(bx - 0.45 * u, mid + 2.1 * u)
      c2d.lineTo(bx - 0.9 * u, mid + 2.1 * u)
      c2d.closePath()
      c2d.fill()
    }
    // oil sheen streaks
    for (let i = 0; i < 26; i++) {
      const cx = rng() * px
      const cy = mid + (rng() - 0.5) * 13 * u
      const r = (0.5 + rng() * 1.6) * u
      const grad = c2d.createRadialGradient(cx, cy, 0, cx, cy, r)
      grad.addColorStop(0, 'rgba(20,16,28,0.5)')
      grad.addColorStop(1, 'rgba(20,16,28,0)')
      c2d.fillStyle = grad
      c2d.fillRect(cx - r, cy - r, r * 2, r * 2)
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    const marks = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 130),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.92 }),
    )
    marks.rotation.x = -Math.PI / 2
    marks.rotation.z = Math.PI / 2
    marks.position.y = 0.02
    marks.renderOrder = 2
    group.add(marks)
  }

  /* ── Barriers: Jersey wall between carriageways, sound walls outside ─ */
  {
    const jersey = concreteMaterial({ seed: 21, res: propRes, kind: 'kerb', tone: '#b9b7ae' })
    const wallA = new THREE.Mesh(new THREE.BoxGeometry(130, 1.05, 0.5), jersey)
    wallA.position.set(0, 0.52, 0)
    wallA.castShadow = true
    group.add(wallA)
    const cap = new THREE.Mesh(new THREE.BoxGeometry(130, 0.1, 0.62), metalMaterial({ color: '#8b9096', roughness: 0.5 }))
    cap.position.set(0, 1.09, 0)
    group.add(cap)

    const railMetal = metalMaterial({ color: '#aab0b8', roughness: 0.42 })
    const postMetal = metalMaterial({ color: '#595d63', roughness: 0.6 })
    for (const z of [-7.6, 7.6]) {
      const rail = guardRail({ length: 130, spacing: 3.4, metal: railMetal, post: postMetal, height: 0.72 })
      rail.position.set(0, 0, z)
      group.add(rail)
      // sound barrier: frosted acrylic panels in steel frames
      const frame = metalMaterial({ color: '#3d4148', roughness: 0.5 })
      const acrylic = glassMaterial({ tint: '#6f8fa8', opacity: 0.24, roughness: 0.12 })
      for (let x = -62; x <= 62; x += 4.2) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.1, 0.16), frame)
        post.position.set(x, 1.85, z + (z > 0 ? 0.5 : -0.5))
        group.add(post)
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(4.1, 2.7), acrylic)
        panel.position.set(x + 2.05, 1.9, z + (z > 0 ? 0.5 : -0.5))
        group.add(panel)
      }
      const topRail = new THREE.Mesh(new THREE.BoxGeometry(130, 0.12, 0.2), frame)
      topRail.position.set(0, 3.3, z + (z > 0 ? 0.5 : -0.5))
      group.add(topRail)
    }
  }

  /* ── Gantry signage, tunnel mouth, deck lighting ───────────────────── */
  const signGlowRefs: THREE.Mesh[] = []
  {
    const gantryMat = metalMaterial({ color: '#3a3e45', roughness: 0.5 })
    for (const gx of [-26, 20]) {
      const legA = new THREE.Mesh(new THREE.BoxGeometry(0.36, 7.6, 0.36), gantryMat)
      legA.position.set(gx, 3.8, -7.4)
      group.add(legA)
      const legB = legA.clone()
      legB.position.z = 7.4
      group.add(legB)
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 15.4), gantryMat)
      beam.position.set(gx, 7.4, 0)
      group.add(beam)
      // green Japanese direction sign
      const { material } = signMaterial({
        text: '渋谷  Shibuya',
        sub: 'C1 Loop · 1.2 km  ↑',
        bg: '#0f5c33',
        fg: '#f4f7f5',
        glow: '#7cffb0',
        width: 512,
        height: 256,
      })
      const board = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.8), material)
      board.position.set(gx + 0.3, 5.6, -2.4)
      board.rotation.y = -Math.PI / 2
      group.add(board)
      signGlowRefs.push(board)
      const halo = glowSprite(0x7cffb0, 9, 0.16)
      halo.position.set(gx + 0.6, 5.6, -2.4)
      group.add(halo)
    }

    // tunnel mouth at the west end
    const tunnelMat = concreteMaterial({ seed: 88, res: propRes, kind: 'wall', tone: '#4a4c52' })
    const tunnel = new THREE.Mesh(new THREE.BoxGeometry(12, 8, 16), tunnelMat)
    tunnel.position.set(-72, 4, 0)
    group.add(tunnel)
    const portal = new THREE.Mesh(
      new THREE.PlaneGeometry(13, 6.4),
      new THREE.MeshBasicMaterial({ color: 0x05060a, fog: true }),
    )
    portal.position.set(-66.2, 3.2, 0)
    portal.rotation.y = Math.PI / 2
    group.add(portal)
    for (let i = 0; i < 5; i++) {
      const light = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.2),
        new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
      )
      light.position.set(-64, 5.4, -5 + i * 2.5)
      light.rotation.y = Math.PI / 2
      group.add(light)
      const halo = glowSprite(0xffd9a0, 3, 0.35)
      halo.position.set(-63.4, 5.4, -5 + i * 2.5)
      group.add(halo)
    }

    // deck street lighting
    const poleMetal = metalMaterial({ color: '#8a9099', roughness: 0.45 })
    for (const x of mobile ? [-30, 8] : [-52, -20, 12, 44]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 9, 10), poleMetal)
      pole.position.set(x, 4.5, 8.6)
      group.add(pole)
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8), poleMetal)
      arm.rotation.z = Math.PI / 2.2
      arm.position.set(x - 1.1, 9.3, 8.2)
      group.add(arm)
      const head = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.16, 0.36),
        new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.5, metalness: 0.6, emissive: new THREE.Color('#ffe9c4'), emissiveIntensity: 0.9 }),
      )
      head.position.set(x - 2.2, 9.6, 8.2)
      group.add(head)
      const halo = glowSprite(0xffe3b4, 5.2, 0.3)
      halo.position.set(x - 2.2, 9.5, 8.2)
      group.add(halo)
      const shaft = lightShaft({ height: 9.4, radiusTop: 0.7, radiusBottom: 6.5, color: 0xffe0b0, opacity: 0.075 })
      shaft.position.set(x - 2.2, 0, 8.2)
      group.add(shaft)
    }
  }

  /* ── City: buildings with lit windows, neon columns, corner store ──── */
  const neonMeshes: THREE.Mesh[] = []
  {
    const shellMat = concreteMaterial({ seed: 55, res: propRes, kind: 'wall', tone: '#31343c' })
    const facades = [
      facadeMaterial({ seed: 1, cols: 7, rows: 16, lit: 0.34, tint: '#121722', warm: '#ffca7a' }),
      facadeMaterial({ seed: 2, cols: 9, rows: 12, lit: 0.44, tint: '#141a26', warm: '#a8dcff' }),
      facadeMaterial({ seed: 3, cols: 6, rows: 20, lit: 0.28, tint: '#0f141d', warm: '#ffb066' }),
    ]
    const neonColors = ['#ff3d6e', '#22d3ee', '#f59e0b', '#a855f7', '#f43f5e', '#34d399']
    const neonWords = ['ラーメン', 'カラオケ', '居酒屋', 'パチンコ', '寿司', 'ホテル', '麻雀', '焼肉']
    const buildings = mobile ? 10 : 22
    for (let i = 0; i < buildings; i++) {
      const side = i % 2 === 0 ? -1 : 1
      const z = side * (16 + rng() * 26)
      const x = -70 + rng() * 140
      const w = 8 + rng() * 12
      const h = 12 + rng() * 26
      const d = 8 + rng() * 10
      const facade = facades[i % facades.length]
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [shellMat, shellMat, shellMat, shellMat, facade, facade])
      body.position.set(x, h / 2 - 0.4, z)
      body.castShadow = true
      body.receiveShadow = true
      group.add(body)
      // roof clutter: water tank, AC, stair head
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.16, w * 0.16, 2.2, 10), metalMaterial({ color: '#6b7079', roughness: 0.6 }))
      tank.position.set(x + w * 0.15, h + 0.9, z)
      group.add(tank)
      for (let a = 0; a < 2; a++) {
        const ac = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 1.1), metalMaterial({ color: '#8b9099', roughness: 0.65 }))
        ac.position.set(x - w * 0.25 + a * 1.4, h + 0.3, z + (rng() - 0.5) * 3)
        group.add(ac)
      }
      // vertical neon column on the street corner
      const tower = neoTower(neonWords[i % neonWords.length], neonColors[i % neonColors.length], 6 + rng() * 9, 0.85)
      tower.position.set(x + (w / 2 + 0.9) * (side < 0 ? 1 : -1), h * 0.55, z)
      tower.rotation.y = side < 0 ? 0.25 : -0.25
      group.add(tower)
      // the road mirrors it
      const panel = tower.children[0] as THREE.Mesh
      group.add(wetReflection(panel, { opacity: 0.22, stretch: 2.6 }))
      neonMeshes.push(panel)

      // billboard on a few roofs
      if (rng() < 0.4) {
        const { material } = signMaterial({
          text: rng() < 0.5 ? 'TOKYO' : 'M5 CS',
          sub: rng() < 0.5 ? 'SHUTO EXPRESSWAY' : 'TWINPOWER TURBO',
          bg: '#080a10',
          fg: '#ffffff',
          glow: '#ff4d8d',
          width: 512,
          height: 256,
        })
        const board = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, 3), material)
        board.position.set(x, h + 2.4, z + (side < 0 ? d / 2 : -d / 2))
        board.rotation.y = side < 0 ? 0 : Math.PI
        group.add(board)
        neonMeshes.push(board)
      }
    }

    // convenience store with a bright, warm interior at street level
    const store = new THREE.Group()
    const storeShell = new THREE.Mesh(new THREE.BoxGeometry(11, 3.4, 8), shellMat)
    storeShell.position.y = 1.7
    store.add(storeShell)
    const shopFront = new THREE.Mesh(
      new THREE.PlaneGeometry(9.6, 2.2),
      new THREE.MeshStandardMaterial({
        color: 0xfff4dc,
        emissive: new THREE.Color('#fff1d4'),
        emissiveIntensity: 1.5,
        roughness: 0.3,
      }),
    )
    shopFront.position.set(0, 1.5, 4.02)
    store.add(shopFront)
    const { material: storeSign } = signMaterial({ text: '24H', sub: 'セブン · OPEN', bg: '#0b3d91', fg: '#ffffff', glow: '#7fd4ff', width: 512, height: 192 })
    const storeBoard = new THREE.Mesh(new THREE.PlaneGeometry(8, 0.9), storeSign)
    storeBoard.position.set(0, 3.1, 4.05)
    store.add(storeBoard)
    const storeLight = new THREE.PointLight(0xfff0d4, 40, 22, 2)
    storeLight.position.set(0, 2.2, 6)
    store.add(storeLight)
    const spill = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff0d4, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    spill.rotation.x = -Math.PI / 2
    spill.position.set(0, 0.03, 8)
    store.add(spill)
    store.position.set(-8, 0, -16)
    store.rotation.y = 0.1
    group.add(store)
    group.add(wetReflection(shopFront, { opacity: 0.3, stretch: 3.2 }))
    neonMeshes.push(shopFront)

    // vending machines against a wall
    for (let i = 0; i < 3; i++) {
      const { material } = signMaterial({
        text: 'COLD',
        sub: i === 1 ? 'HOT' : '¥130',
        bg: i === 0 ? '#c2185b' : i === 1 ? '#1a73c9' : '#2e7d32',
        fg: '#ffffff',
        glow: '#ffd9a0',
        width: 256,
        height: 384,
      })
      const vm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.8), paintedMetal({ color: '#2b2f37', seed: i, res: 64, gloss: 0.5 }))
      vm.position.set(14 + i * 1.3, 0.95, -13.2)
      group.add(vm)
      const front = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.7), material)
      front.position.set(14 + i * 1.3, 1.0, -12.78)
      group.add(front)
      neonMeshes.push(front)
      const glow = new THREE.PointLight(0xffcf9a, 3.4, 5, 2)
      glow.position.set(14 + i * 1.3, 1.2, -12.2)
      group.add(glow)
    }

    // utility poles with transformer cans and sagging wires
    const poleMat = concreteMaterial({ seed: 71, res: 64, kind: 'rough', tone: '#6e6a63' })
    const wireMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 })
    const poleXs = [-40, -22, -4, 14, 32, 50]
    for (let i = 0; i < poleXs.length; i++) {
      const x = poleXs[i]
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 11, 10), poleMat)
      pole.position.set(x, 5.5, -19.5)
      group.add(pole)
      for (let a = 0; a < 3; a++) {
        const cross = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 2.6), wireMat)
        cross.position.set(x, 9.6 - a * 0.6, -19.5)
        group.add(cross)
      }
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.7, 10), metalMaterial({ color: '#9aa0a8', roughness: 0.5 }))
      can.position.set(x + 0.42, 8.2, -19.5)
      group.add(can)
      if (i < poleXs.length - 1) {
        const next = poleXs[i + 1]
        for (let w = 0; w < 3; w++) {
          const offset = -1.1 + w * 1.1
          group.add(
            catenary(
              new THREE.Vector3(x, 9.6 - w * 0.6, -19.5 + 1.1),
              new THREE.Vector3(next, 9.6 - w * 0.6, -19.5 + 1.1),
              0.6,
              0.028,
              wireMat,
            ),
          )
          group.add(
            catenary(
              new THREE.Vector3(x, 9.6 - w * 0.6, -19.5 - 1.1),
              new THREE.Vector3(next, 9.6 - w * 0.6, -19.5 - 1.1),
              0.62,
              0.028,
              wireMat,
            ),
          )
          void offset
        }
      }
    }
  }

  /* ── Elevated tracks: a monorail crossing the skyline ─────────────── */
  const monorail = new THREE.Group()
  {
    const beamPole = metalMaterial({ color: '#54585f', roughness: 0.55 })
    const beamPole2 = concreteMaterial({ seed: 91, res: 64, kind: 'rough', tone: '#5a5c60' })
    for (const z of [-30, 34]) {
      for (let x = -70; x <= 70; x += 20) {
        const pier = new THREE.Mesh(new THREE.BoxGeometry(1.3, 13, 1.3), beamPole2)
        pier.position.set(x, 6.5, z)
        group.add(pier)
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(150, 1.5, 2.6), beamPole)
      beam.position.set(0, 13.6, z)
      group.add(beam)
    }
    const shell = paintedMetal({ color: '#d8dde4', seed: 3, res: propRes, gloss: 0.35 })
    const band = paintedMetal({ color: '#1c69d4', seed: 4, res: 64, gloss: 0.4 })
    for (let c = 0; c < 4; c++) {
      const car = new THREE.Group()
      const body = new THREE.Mesh(new THREE.BoxGeometry(14, 2.6, 2.5), shell)
      body.position.y = 1.4
      car.add(body)
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(14.1, 0.5, 2.55), band)
      stripe.position.y = 0.9
      car.add(stripe)
      for (let w = 0; w < 7; w++) {
        const win = new THREE.Mesh(
          new THREE.PlaneGeometry(1.5, 1.0),
          new THREE.MeshStandardMaterial({ color: 0x11161f, emissive: new THREE.Color('#cfe6ff'), emissiveIntensity: 0.35, roughness: 0.2 }),
        )
        win.position.set(-5.4 + w * 1.9, 1.8, 1.28)
        car.add(win)
        const win2 = win.clone()
        win2.position.z = -1.28
        win2.rotation.y = Math.PI
        car.add(win2)
      }
      car.position.x = -c * 14.4 + 30
      car.userData.offset = -c * 14.4 + 30
      monorail.add(car)
    }
    monorail.position.set(0, 13.6, -30)
    group.add(monorail)
    void beamPole
  }

  /* ── Traffic: three lanes each way, headlights + spray ────────────── */
  const traffic: Array<{ car: THREE.Group; lane: number; speed: number; dir: number; offset: number }> = []
  {
    const colors = [0x1b1e24, 0x8e9299, 0x222a38, 0xb6bcc4, 0x3a2226, 0x14313a, 0xd8d8d2]
    const count = mobile ? 6 : 12
    for (let i = 0; i < count; i++) {
      const dir = i % 2 === 0 ? 1 : -1
      const car = simpleCar({
        body: colors[i % colors.length],
        headlight: 0xfff3d6,
        taillight: 0xff2a18,
        scale: 1,
      })
      if (dir < 0) car.rotation.y = Math.PI
      const plume = glowSprite(0xcfe0f2, 3.4, 0.2)
      plume.name = 'carSpray'
      plume.position.set(-2.6, 0.4, 0)
      car.add(plume)
      // two carriageways either side of the Jersey wall
      const lane = dir > 0 ? -4.6 + (i % 3) * 1.6 : 4.6 - (i % 3) * 1.6
      car.position.set(-70 + ((i * 137) % 140), 0, lane)
      group.add(car)
      traffic.push({ car, lane, speed: 22 + (i % 4) * 3.2, dir, offset: (i * 137) % 140 })
    }
  }

  /* ── Atmosphere: rain, spray, mist, neon haze ─────────────────────── */
  const rain = rainSystem({
    count: mobile ? 500 : 1300,
    area: 90,
    height: 26,
    speed: 22,
    wind: 3.4,
    color: 0xbcd4ee,
    opacity: 0.3,
    length: 1.9,
  })
  group.add(rain.group)
  ticks.add(rain.tick)

  const spray = motes({ count: mobile ? 90 : 240, area: 60, height: 6, color: 0xcfe0f2, size: 0.16, opacity: 0.34 })
  spray.points.position.set(0, 0.3, 0)
  group.add(spray.points)
  ticks.add(spray.tick)

  const steam = motes({ count: mobile ? 40 : 120, area: 40, height: 12, color: 0xffb27a, size: 0.3, opacity: 0.16 })
  steam.points.position.set(10, 2, 6)
  group.add(steam.points)
  ticks.add(steam.tick)

  /* ── Logic: traffic, neon buzz, monorail, rain swells ─────────────── */
  const puddles: THREE.Mesh[] = []
  group.traverse((o) => {
    if (o.name === 'puddle') puddles.push(o as THREE.Mesh)
  })

  ticks.add((t, dt) => {
    for (const entry of traffic) {
      const span = 150
      const k = ((t * entry.speed + entry.offset) % span) / span
      const x = entry.dir > 0 ? lerp(-70, 74, k) : lerp(74, -70, k)
      entry.car.position.x = x
      entry.car.position.z = entry.lane + Math.sin(t * 0.7 + entry.offset) * 0.08
      entry.car.visible = k < 0.99
      // spray kicked up behind the rear axle
      const plume = entry.car.children.find((c) => c.name === 'carSpray')
      if (plume) {
        const mat = (plume as THREE.Sprite).material as THREE.SpriteMaterial
        mat.opacity = 0.16 + Math.abs(Math.sin(t * 6 + entry.offset)) * 0.1
      }
    }
    // monorail crossing every 40 s
    const monoT = (t % 40) / 40
    const monoX = lerp(-90, 90, monoT * 1.1 - 0.05)
    monorail.position.x = monoX
    monorail.visible = monoT > 0.02 && monoT < 0.96
    // neon flicker per sign
    for (let i = 0; i < neonMeshes.length; i++) {
      const m = neonMeshes[i].material as THREE.MeshStandardMaterial
      if (!m.emissiveIntensity) continue
      const seed = i * 1.7
      const buzz = Math.sin(t * 3.1 + seed) > -0.92 ? 1 : 0.35
      const pulse = 1 + Math.sin(t * 0.8 + seed) * 0.06
      m.emissiveIntensity = 1.5 * buzz * pulse
    }
    // rain swells over ~30 s
    const swell = 0.75 + Math.sin(t * 0.21) * 0.25
    for (const p of puddles) {
      p.scale.setScalar(1 + Math.sin(t * 1.3 + p.position.x) * 0.01 * swell)
    }
    // neon reflections shimmer with the rain
    for (const mesh of neonMeshes) void mesh
    void dt
    void clamp01
    void smoothstep
  })

  /* ── Puddle mirrors: a stretched copy of every bright emitter ─────── */
  for (const board of signGlowRefs) {
    group.add(wetReflection(board, { opacity: 0.18, stretch: 3.4 }))
  }
  group.add(
    (() => {
      const namePlate = signMaterial({ text: 'C1', sub: 'SHUTO EXPWY', bg: '#0b0d13', fg: '#ffffff', glow: '#ffd24a', width: 256, height: 256 })
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), namePlate.material)
      plate.position.set(6, 0.03, 7.2)
      plate.rotation.x = -Math.PI / 2
      plate.rotation.z = Math.PI * 0.5
      return plate
    })(),
  )

  /* ── Lighting rig for the car ─────────────────────────────────────── */
  const fill = new THREE.HemisphereLight(0x53617f, 0x1a1a24, 0.5)
  group.add(fill)
  const keyFill = new THREE.SpotLight(0xffd9a8, 90, 32, 0.7, 0.7, 2)
  keyFill.position.set(-6, 9.6, 8.2)
  keyFill.target.position.set(0, 0.4, 0)
  group.add(keyFill, keyFill.target)
  // cool neon bounce from below the deck edge
  const bounce = new THREE.PointLight(0xff5f8a, 18, 24, 2)
  bounce.position.set(-6, 2.4, -14)
  group.add(bounce)
  void gravelMaterial
  void hazardMaterial
  void stonePavingMaterial
  void chainFence
  void trafficCone

  return {
    id: 'tokyo',
    group,
    background: sky,
    environment: sky,
    lighting: {
      key: { color: 0xffc98f, intensity: 300, position: [-7, 9, 9] },
      rim: { color: 0x6fa8ff, intensity: 3.1, position: [10, 6, -12] },
      hemi: { sky: 0x3c4a6e, ground: 0x141420, intensity: 0.6 },
      fog: { color: 0x141826, density: 0.019 },
      exposure: 1.05,
      environmentIntensity: 0.65,
      beamScale: 1.55,
      floorReflection: true,
      shadow: { far: 42, near: 2, angle: 0.9, penumbra: 0.75, focus: [0, 0.5, 0] },
    },
    facts: [
      { label: 'Route', value: 'Shuto C1 · inner loop' },
      { label: 'Air', value: '17 °C · heavy rain' },
      { label: 'Surface', value: 'Standing water' },
    ],
    update: (frame) => ticks.run(frame.time, frame.dt),
    dispose: () => {
      disposeGroup(group)
      sky.dispose()
    },
  }
}
