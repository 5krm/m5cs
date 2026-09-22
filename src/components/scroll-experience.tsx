'use client'

/**
 * ═════════════════════════════════════════════════════════════════════════
 * ScrollExperience — scroll-driven 3D camera inspection (gray BMW M5 CS)
 * ═════════════════════════════════════════════════════════════════════════
 * Stack: vanilla three.js · GSAP + ScrollTrigger (scrub 1.2) · Lenis
 *
 * Choreography (scrubbed 1:1 with scroll — reverses fluidly when scrolling
 * back up, because everything is one timeline driven by ScrollTrigger):
 *
 *   progress   camera move                          overlay
 *   ─────────────────────────────────────────────────────────────────────
 *   0.00–0.30  HERO → FRONT   wide drift pose →    hero copy fades out
 *                             low, tight nose      front caption in/out
 *   0.42–0.72  FRONT → REAR   sweep along flank    rear caption in/out
 *   0.84–1.00  REAR → OUTRO   pull back wide       closing card fades in
 *
 * Backdrop: a procedural 3D showroom — cyclorama wall with a warm horizon
 * glow, stage halo rings, distant light pillars, floor runway lines, a soft
 * light shaft under the central softbox, dark reflective floor (mirrored-car
 * double trick), canvas vignette — no image assets at all. No smoke, no sway,
 * no sprites: the car reads parked and grounded (cast shadow + fake-AO blob).
 *
 * Loading: the meshopt-compressed GLB (3.2 MB vs 12.7 MB) is fetched with
 * a stream reader so the branded overlay shows the REAL byte %, then
 * fades once the model parses (min 0.8 s hold so it never flashes).
 *
 * The "pinned viewport" is a fixed full-viewport stage (canvas + UI
 * overlay) driven by an invisible 440vh scroll track — functionally a
 * ScrollTrigger pin, but perfectly jitter-free with Lenis on every browser.
 */

import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'meshoptimizer/decoder'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'

/* ═════════════════ 1. MODEL ══════════════════════════════════════════ */

const MODEL_URL = '/models/bmw-m5-cs/scene.min.glb' // CC-BY-4.0 · fvrenbld — meshopt-compressed (3.2 MB)
const TARGET_LENGTH = 4.6 // car is normalized to this world length
const FLIP_MODEL = false // set true if a swapped model faces backwards

/** Showroom floor reflection — mirrored car double (desktop only) */
const FLOOR_REFLECTION = true

/* ═══════════ 2. CAMERA KEYFRAMES — ✏️ EDIT HERE ══════════════════════
 * World space: car sits at the origin, nose pointing +X, ~4.6 units long,
 * ~1.45 tall; the ground plane is y = 0.
 *
 *   pos[]    camera position [x, y, z]
 *   target[] lookAt target [x, y, z] — tracked via camera.lookAt() in the
 *            render loop so target tracking stays perfectly fluid
 *   mobileF  camera-distance multiplier on portrait screens (mobile also
 *            widens FOV 45 → 60, see FOV_*). The offset from pos → target
 *            is scaled by this factor, so the framing angle is preserved.
 */
type Vec3 = [number, number, number]
type CamKey = {
  pos: Vec3
  target: Vec3
  mobileF: number
  /** portrait only: multiplies the lateral (z) camera offset again so the
   *  close-ups read more head-on — keeps the car flank out of the frame */
  mobileHeadOn?: number
}

const KEYS = {
  /** 0% — wide drifting presentation, slightly high 3/4 iso */
  hero: { pos: [7.2, 2.9, 7.4], target: [0, 0.55, 0], mobileF: 1.35 },
  /** state 1 — dramatic low angle on the front bumper / headlights */
  front: { pos: [4.4, 0.5, 2.1], target: [2.0, 0.52, 0], mobileF: 2.15, mobileHeadOn: 0.45 },
  /** state 2 — rear taillights, diffuser and exhaust, same-side sweep */
  rear: { pos: [-4.3, 0.9, 2.2], target: [-1.9, 0.68, 0], mobileF: 2.0, mobileHeadOn: 0.45 },
  /** closing wide elevated rear 3/4 for the end card */
  outro: { pos: [-6.9, 3.1, 7.2], target: [0, 0.55, 0], mobileF: 1.35 },
} satisfies Record<string, CamKey>

const FOV_DESKTOP = 45
const FOV_MOBILE = 60

/* ═════ 3. PRESENTATION GARNISH (parked stance) ═══════════════════════ */

const BASE_YAW = -0.14 // parked "drift" angle of the car (rad)

/* ══════════════════════════════════════════════════════════════════════
 * Canvas-generated textures — zero network dependencies
 * ══════════════════════════════════════════════════════════════════════ */

/** Soft dark ellipse under the car — the fake-AO contact shadow */
function makeContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128)
  g.addColorStop(0, 'rgba(0,0,0,0.62)')
  g.addColorStop(0.5, 'rgba(0,0,0,0.34)')
  g.addColorStop(0.8, 'rgba(0,0,0,0.1)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Dark seamless studio vignette used as scene.background */
function makeStudioBackdropTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1024
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(512, 430, 60, 512, 512, 760)
  g.addColorStop(0, '#1d212b')
  g.addColorStop(0.5, '#101218')
  g.addColorStop(1, '#050608')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 1024, 1024)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Warm pool of showroom light on the floor under the car */
function makeFloorPoolTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
  g.addColorStop(0, 'rgba(255,244,224,0.9)')
  g.addColorStop(0.45, 'rgba(255,244,224,0.28)')
  g.addColorStop(1, 'rgba(255,244,224,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Cyclorama wall — "infinity cove" gradient with a warm glow band that
 *  sits on the floor line, so the void above the horizon reads as studio
 *  depth instead of empty black. Top row matches the fog color exactly so
 *  the wall dissolves seamlessly into the haze. */
function makeCycloramaTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 512
  const ctx = canvas.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, 512)
  g.addColorStop(0, '#050608') // ≡ fog color — seamless dissolve at the top
  g.addColorStop(0.55, '#0a0c11')
  g.addColorStop(0.8, '#12141b')
  g.addColorStop(0.9, '#1e1a15') // warm lift begins
  g.addColorStop(0.955, '#342a1a') // glow band peak (just above the floor)
  g.addColorStop(1, '#0b0c10') // dark base at the floor seam
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 1024, 512)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Soft vertical falloff for the fake volumetric light shaft */
function makeLightShaftTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  g.addColorStop(0, 'rgba(255,243,222,0.9)') // bright at the softbox
  g.addColorStop(0.55, 'rgba(255,238,214,0.32)')
  g.addColorStop(1, 'rgba(255,235,210,0)') // dissolves at the floor
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 256)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/* ══════════════════════════════════════════════════════════════════════
 * Car — load the real glTF, normalize + restyle it
 * ══════════════════════════════════════════════════════════════════════ */

/** glTF material names that carry the body paint / glass (fvrenbld model) */
const BODY_PAINT = new Set(['Bodyshell1Mtl', 'Bonnet0041Mtl', 'Bonnet1Mtl', 'Boot0041Mtl', 'DoorColor1Mtl'])
const GLASS = new Set(['Windowrf1Mtl'])

const satinGrayPaint = () =>
  new THREE.MeshPhysicalMaterial({
    color: '#868c93',
    metalness: 0.82,
    roughness: 0.34,
    clearcoat: 1,
    clearcoatRoughness: 0.18,
    envMapIntensity: 0.85,
  })

const darkGlass = () =>
  new THREE.MeshPhysicalMaterial({
    color: '#06080b',
    metalness: 0.55,
    roughness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.05,
  })

type CarRig = {
  car: THREE.Group
}

/**
 * Normalizes ANY car glTF so the camera keyframes above fit without
 * retuning: centers the footprint, grounds it at y = 0, scales the longest
 * horizontal span to TARGET_LENGTH, repaints body/glass, hides showroom
 * plates and enables shadows.
 */
function buildCarRig(source: THREE.Object3D): CarRig {
  const model = source.clone(true)

  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const scale = TARGET_LENGTH / Math.max(size.x, size.z)
  model.scale.setScalar(scale)
  model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale)
  if (FLIP_MODEL) model.rotation.y = Math.PI

  const gray = satinGrayPaint()
  const glass = darkGlass()
  const junk: THREE.Object3D[] = []
  model.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    obj.castShadow = true
    obj.receiveShadow = false
    const mats = Array.isArray(obj.material) ? [...obj.material] : [obj.material]
    let replaced = false
    for (let i = 0; i < mats.length; i++) {
      const name = mats[i]?.name ?? ''
      if (BODY_PAINT.has(name)) {
        mats[i] = gray
        replaced = true
      } else if (GLASS.has(name)) {
        mats[i] = glass
        replaced = true
      } else if (mats[i] && (mats[i] as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        ;(mats[i] as THREE.MeshStandardMaterial).envMapIntensity = 0.7
      }
    }
    if (replaced) obj.material = Array.isArray(obj.material) ? mats : mats[0]
    // hide giant flat plates (Sketchfab showroom floors)
    const b = new THREE.Box3().setFromObject(obj)
    if (b.max.y - b.min.y < 0.12 && b.max.x - b.min.x > 3 && b.max.z - b.min.z > 3) junk.push(obj)
  })
  junk.forEach((m) => (m.visible = false))

  const car = new THREE.Group()
  car.add(model)

  return { car }
}

/* ══════════════════════════════════════════════════════════════════════
 * Camera-rig math
 * ══════════════════════════════════════════════════════════════════════ */

type FlatKey = { px: number; py: number; pz: number; tx: number; ty: number; tz: number }

/** Flatten a keyframe; on portrait screens the pos→target offset is
 *  scaled by mobileF so the car never clips out of the narrow viewport. */
function flattenKey(k: CamKey, mobile: boolean): FlatKey {
  let [px, py, pz] = k.pos
  const [tx, ty, tz] = k.target
  if (mobile) {
    px = tx + (px - tx) * k.mobileF
    py = ty + (py - ty) * k.mobileF
    pz = tz + (pz - tz) * k.mobileF * (k.mobileHeadOn ?? 1)
  }
  return { px, py, pz, tx, ty, tz }
}

/* ══════════════════════════════════════════════════════════════════════
 * Overlay UI data (copied verbatim from the approved hero design)
 * ══════════════════════════════════════════════════════════════════════ */

const NAV_LINKS = ['Overview', 'Performance', 'Design', 'Specs'] as const

type StarDot = {
  top: string
  side: 'left' | 'right'
  offset: string
  size: number
  opacity: number
  glow?: string
}

const STAR_DOTS: StarDot[] = [
  { top: '14%', side: 'left', offset: '14%', size: 3, opacity: 0.5, glow: '0 0 6px 1px oklch(0.85 0.08 85 / 0.5)' },
  { top: '28%', side: 'right', offset: '18%', size: 2, opacity: 0.4, glow: '0 0 5px 1px oklch(0.85 0.08 85 / 0.4)' },
  { top: '49%', side: 'left', offset: '10%', size: 2, opacity: 0.35 },
  { top: '60%', side: 'right', offset: '12%', size: 3, opacity: 0.3, glow: '0 0 6px 1px oklch(0.85 0.08 85 / 0.35)' },
  { top: '21%', side: 'left', offset: '33%', size: 2, opacity: 0.3 },
  { top: '40%', side: 'right', offset: '33%', size: 2, opacity: 0.45 },
]

function starDotStyle(dot: StarDot): CSSProperties {
  return {
    top: dot.top,
    width: dot.size,
    height: dot.size,
    opacity: dot.opacity,
    boxShadow: dot.glow ?? 'none',
    ...(dot.side === 'left' ? { left: dot.offset } : { right: dot.offset }),
  }
}

/* ══════════════════════════════════════════════════════════════════════
 * Component
 * ══════════════════════════════════════════════════════════════════════ */

export default function ScrollExperience() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const heroLayerRef = useRef<HTMLDivElement>(null)
  const capFrontRef = useRef<HTMLDivElement>(null)
  const capRearRef = useRef<HTMLDivElement>(null)
  const endCardRef = useRef<HTMLDivElement>(null)
  /* Loading overlay — progress is written via refs (no re-render per chunk) */
  const loaderRef = useRef<HTMLDivElement>(null)
  const loaderBarRef = useRef<HTMLDivElement>(null)
  const loaderPctRef = useRef<HTMLSpanElement>(null)
  const loaderMsgRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const track = trackRef.current
    const heroLayer = heroLayerRef.current
    const capFront = capFrontRef.current
    const capRear = capRearRef.current
    const endCard = endCardRef.current
    const loaderEl = loaderRef.current
    const loaderBar = loaderBarRef.current
    const loaderPct = loaderPctRef.current
    const loaderMsg = loaderMsgRef.current
    if (
      !canvas ||
      !track ||
      !heroLayer ||
      !capFront ||
      !capRear ||
      !endCard ||
      !loaderEl ||
      !loaderBar ||
      !loaderPct ||
      !loaderMsg
    )
      return

    let disposed = false
    gsap.registerPlugin(ScrollTrigger)

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    /* ── Renderer ──────────────────────────────────────────────────── */
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)) // perf cap
    renderer.setSize(window.innerWidth, window.innerHeight, false)
    renderer.shadowMap.enabled = true
    // three r186 removed PCFSoftShadowMap — PCFShadowMap is the supported
    // filtered shadow path (renders soft contacts with a 2K map)
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    renderer.outputColorSpace = THREE.SRGBColorSpace

    /* ── Scene: procedural 3D showroom (vignette + fog, no images) ──── */
    const scene = new THREE.Scene()
    const backdropTex = makeStudioBackdropTexture()
    scene.background = backdropTex
    scene.fog = new THREE.FogExp2(0x050608, 0.018) // thin enough for the cyclorama to read, thick enough to hide the floor rim

    // Studio reflections via a self-contained PMREM environment (no HDR
    // download) — this is what puts the softbox highlights in the paint.
    const pmrem = new THREE.PMREMGenerator(renderer)
    const envScene = new RoomEnvironment()
    const envTex = pmrem.fromScene(envScene, 0.04).texture
    scene.environment = envTex
    ;(envScene as unknown as { dispose?: () => void }).dispose?.()

    /* ── Camera ────────────────────────────────────────────────────── */
    const camera = new THREE.PerspectiveCamera(FOV_DESKTOP, window.innerWidth / window.innerHeight, 0.1, 160)

    /* ── Lights — three-point studio rig ───────────────────────────── */
    const key = new THREE.SpotLight(0xfff1dd, 380) // warm keylight — casts the contact shadow
    key.position.set(7, 9, 5)
    key.angle = 0.55
    key.penumbra = 0.55
    key.decay = 2
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.bias = -0.0002
    key.shadow.normalBias = 0.02
    key.shadow.camera.near = 3
    key.shadow.camera.far = 30
    key.target.position.set(0, 0.5, 0)
    scene.add(key, key.target)

    const rim = new THREE.DirectionalLight(0xbfd0e8, 1.6) // cool rim separation
    rim.position.set(-8, 5, -6)
    scene.add(rim)

    scene.add(new THREE.HemisphereLight(0x39404e, 0x0b0c10, 0.38)) // studio ambience

    /* ── Overhead softbox light strips (visible studio architecture) ──
     * Pure-emissive slabs; the paint's actual highlights come from the
     * PMREM RoomEnvironment. These read as the studio in the background
     * and fade into the fog with distance. Desktop only — on portrait
     * phones the wider FOV catches them as odd slashes across the sky. */
    if (window.innerWidth >= 768) {
      const stripMat = new THREE.MeshBasicMaterial({ color: 0xd8dee9, side: THREE.DoubleSide })
      for (const [sx, sz, sw] of [
        [0, -3.4, 13],
        [0, 0, 15],
        [0, 3.4, 13],
      ] as const) {
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(sw, 0.72), stripMat)
        strip.position.set(sx, 5.35, sz)
        strip.rotation.x = Math.PI / 2 // face down toward the car
        scene.add(strip)
      }
    }

    /* ── Cyclorama — 360° infinity wall at r = 46 ────────────────────
     * Replaces the empty black void behind the horizon with a photo-studio
     * cove: near-black up top, warm glow band landing on the floor line.
     * The thinner fog lets its gradient read while still hiding the floor
     * rim (the wall occludes everything beyond r = 46 anyway). */
    const cyclorama = new THREE.Mesh(
      new THREE.CylinderGeometry(46, 46, 24, 72, 1, true),
      new THREE.MeshBasicMaterial({ map: makeCycloramaTexture(), side: THREE.BackSide }),
    )
    cyclorama.position.y = 12 // base sits exactly on y = 0
    scene.add(cyclorama)

    /* ── Distant light pillars — parallax anchors for the flank sweep ─ */
    const pillarMat = new THREE.MeshBasicMaterial({ color: 0xe8ecf2, transparent: true, opacity: 0.4 })
    for (const [px, pz, ph] of [
      [-14, -11, 7.5],
      [-20, -4, 8],
      [-9, -18, 6.5],
      [16.5, -13, 4.5],
      [29, -7, 4.5],
    ] as const) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.09, ph, 0.09), pillarMat)
      pillar.position.set(px, ph / 2, pz)
      scene.add(pillar)
    }

    /* ── Floor runway lines — design language for the bare slab ────── */
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffe9c4, transparent: true, opacity: 0.26, depthWrite: false })
    const tickMat = new THREE.MeshBasicMaterial({ color: 0xffe9c4, transparent: true, opacity: 0.13, depthWrite: false })
    for (const lz of [-3.6, 3.6]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(46, 0.07), lineMat)
      line.rotation.x = -Math.PI / 2
      line.position.set(0, 0.008, lz)
      line.renderOrder = 1
      scene.add(line)
      for (const tx of [-14, -7, 7, 14]) {
        const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 1.4), tickMat)
        tick.rotation.x = -Math.PI / 2
        tick.position.set(tx, 0.008, lz)
        tick.renderOrder = 1
        scene.add(tick)
      }
    }

    /* ── Stage halo rings + light shaft (desktop wide shots only) ────
     * A pair of emissive rings hanging in the -x/-z quadrant: the hero
     * camera looks straight through the car at them, and the front
     * close-up catches them behind the nose — the launch-stage look.
     * Portrait FOV catches them as clutter, so they stay desktop-only. */
    if (window.innerWidth >= 768) {
      const ringMatA = new THREE.MeshBasicMaterial({ color: 0xfff0d8, transparent: true, opacity: 0.5 })
      const ringA = new THREE.Mesh(new THREE.TorusGeometry(5.4, 0.055, 12, 140), ringMatA)
      ringA.position.set(-13, 3.2, -13)
      ringA.lookAt(0, 1.8, 0) // face the car → reads as a halo from the hero cam
      scene.add(ringA)

      const ringB = new THREE.Mesh(
        new THREE.TorusGeometry(7.6, 0.04, 12, 140),
        new THREE.MeshBasicMaterial({ color: 0xfff0d8, transparent: true, opacity: 0.2 }),
      )
      ringB.position.set(-17, 4.2, -17)
      ringB.lookAt(0, 1.8, 0)
      scene.add(ringB)

      /* Fake volumetric shaft under the central softbox — additive cone
       * that dissolves before the floor. Both close-up cameras sit just
       * outside its footprint (r = 3.8), so it never washes the lens. */
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 3.8, 5.3, 48, 1, true),
        new THREE.MeshBasicMaterial({
          map: makeLightShaftTexture(),
          transparent: true,
          opacity: 0.09,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
        }),
      )
      shaft.position.set(0, 2.68, 0) // top kisses the central strip at y = 5.33
      shaft.renderOrder = 2
      scene.add(shaft)
    }

    /* ── Floor — dark showroom slab with a reflection window ─────────
     * The mirrored car double (added with the model, desktop only) sits
     * just below y = 0; this semi-transparent floor blends it back at
     * ~16% strength — the classic configurator mirror-floor look — while
     * still receiving the real cast shadow. ✏️ If a shot floats, raise
     * that key's pos[1] / lower its target[1]; keep the floor opaque-ish. */
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(90, 72),
      new THREE.MeshStandardMaterial({
        color: 0x06070b,
        roughness: 0.32,
        metalness: 0.55,
        envMapIntensity: 0.4,
        transparent: true,
        opacity: 0.84,
      }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)

    const poolTex = makeFloorPoolTexture()
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12),
      new THREE.MeshBasicMaterial({
        map: poolTex,
        transparent: true,
        opacity: 0.09,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    pool.rotation.x = -Math.PI / 2
    pool.position.y = 0.01
    scene.add(pool)

    /* ── Car root + fake-AO contact blob (model streams in async) ──── */
    const carGroup = new THREE.Group()
    carGroup.rotation.y = BASE_YAW
    scene.add(carGroup)

    // Soft dark ellipse under the footprint (yaws with the car) — the
    // visual anchor that welds the tires to the rooftop asphalt.
    const contactTex = makeContactShadowTexture()
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(TARGET_LENGTH * 1.16, TARGET_LENGTH * 0.52),
      new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false, opacity: 0.72 }),
    )
    contact.rotation.x = -Math.PI / 2
    contact.position.y = 0.012 // above the shadow catcher, below the tires
    contact.renderOrder = 1
    carGroup.add(contact)

    let carRig: CarRig | null = null

    /* ── Model streaming — REAL progress % into the loading overlay ──
     * GLTFLoader.load()'s onProgress is unreliable (Content-Length is lost
     * on some CDNs), so we fetch the GLB ourselves, count bytes against the
     * header (falling back to an asymptotic trickle), hand the buffer to
     * GLTFLoader.parse with the MeshoptDecoder, then fade the overlay.
     * The car settle-in doubles as the reveal beat after the fade. */
    const t0 = performance.now()
    const setProgress = (fraction: number) => {
      const pct = Math.min(100, Math.round(fraction * 100))
      loaderBar.style.width = `${pct}%`
      loaderPct.textContent = String(pct) // JSX renders the trailing "%"
    }

    ;(async () => {
      try {
        const res = await fetch(MODEL_URL)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const total = Number(res.headers.get('content-length') ?? 0)
        const chunks: Uint8Array[] = []
        let loaded = 0
        if (res.body && total > 0) {
          const reader = res.body.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            chunks.push(value)
            loaded += value.length
            if (!disposed) setProgress(loaded / total)
          }
        } else if (res.body) {
          // No length header: stream what we can, trickle the visual % so
          // the bar never lies about being stuck at a wrong 100%.
          const reader = res.body.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            chunks.push(value)
            loaded += value.length
            if (!disposed) setProgress((1 - Math.exp(-loaded / (1.2 * 1024 * 1024))) * 0.9)
          }
        }

        const buffer = new Uint8Array(loaded)
        let offset = 0
        for (const c of chunks) {
          buffer.set(c, offset)
          offset += c.length
        }

        const loader = new GLTFLoader()
        loader.setMeshoptDecoder(MeshoptDecoder) // EXT_meshopt_compression
        const gltf = await loader.parseAsync(buffer.buffer, '')
        if (disposed) return

        carRig = buildCarRig(gltf.scene)
        carRig.car.position.y = -0.12
        carGroup.add(carRig.car)

        // Mirrored double just below y = 0 — shows through the semi-
        // transparent floor as a soft showroom reflection (desktop only;
        // the doubled vertex load isn't worth it on phones).
        if (FLOOR_REFLECTION && window.innerWidth >= 768) {
          const mirrorRig = buildCarRig(gltf.scene)
          mirrorRig.car.scale.y = -1
          mirrorRig.car.traverse((obj) => {
            if (!(obj instanceof THREE.Mesh)) return
            obj.castShadow = false
            obj.receiveShadow = false
            const mats = Array.isArray(obj.material)
              ? obj.material.map((m) => m.clone())
              : [obj.material.clone()]
            for (const m of mats) {
              const std = m as THREE.MeshStandardMaterial
              std.side = THREE.DoubleSide // negative scale flips winding
              std.envMapIntensity = Math.min(0.5, (std.envMapIntensity ?? 1) * 0.6)
            }
            obj.material = Array.isArray(obj.material) ? mats : mats[0]
          })
          carGroup.add(mirrorRig.car)
        }

        // Hold the overlay ≥0.8 s so fast connections see a deliberate
        // beat, not a flash; then fade it and let the car settle in.
        const elapsed = performance.now() - t0
        const hold = Math.max(0, 800 - elapsed)
        window.setTimeout(() => {
          if (disposed) return
          gsap.to(loaderEl, {
            autoAlpha: 0,
            duration: prefersReduced ? 0.01 : 0.7,
            ease: 'power1.inOut',
            onComplete: () => {
              loaderEl.style.display = 'none'
            },
          })
          gsap.to(carRig!.car.position, { y: 0, duration: 0.9, ease: 'power2.out' })
        }, hold)
      } catch (err) {
        console.warn('[scroll-experience] car model failed to load:', err)
        if (disposed) return
        loaderMsg.textContent = 'The 3D model could not be loaded — please check your connection and refresh.'
        loaderBar.style.backgroundColor = '#a3222c'
      }
    })()

    /* ── Camera rig state — animated by GSAP, applied every frame ──── */
    const cam: FlatKey = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 }
    const applyCamera = () => {
      camera.position.set(cam.px, cam.py, cam.pz)
      camera.lookAt(cam.tx, cam.ty, cam.tz) // target tracked every frame
    }

    /* ── GSAP ScrollTrigger choreography ─────────────────────────────
     * One master timeline, scrubbed by scroll. Positions are expressed in
     * normalized progress units (the whole timeline lasts 1.0).        */
    const buildTimeline = (mobile: boolean) => {
      const K = {
        hero: flattenKey(KEYS.hero, mobile),
        front: flattenKey(KEYS.front, mobile),
        rear: flattenKey(KEYS.rear, mobile),
        outro: flattenKey(KEYS.outro, mobile),
      }
      // hard-reset the rig to the hero pose so scrubbing always starts
      // from a known state (and fully rewinds when scrolling back up)
      Object.assign(cam, K.hero)
      applyCamera()

      const tl = gsap.timeline({
        defaults: { ease: 'power2.inOut' },
        scrollTrigger: {
          trigger: track,
          start: 'top top',
          end: 'bottom bottom',
          scrub: prefersReduced ? true : 1.2, // momentum catch-up
        },
      })

      /* Act I — HERO → FRONT (0 → 0.30) */
      tl.to(cam, { ...K.front, duration: 0.3 }, 0)
      tl.to(heroLayer, { autoAlpha: 0, y: -42, duration: 0.11, ease: 'power1.in' }, 0.02)
      tl.fromTo(capFront, { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.09, ease: 'power2.out' }, 0.17)
      tl.to(capFront, { autoAlpha: 0, y: -22, duration: 0.08, ease: 'power1.in' }, 0.36)

      /* dwell on the front bumper (0.30 → 0.42) — no camera tweens */

      /* Act II — FRONT → REAR (0.42 → 0.72) */
      tl.to(cam, { ...K.rear, duration: 0.3 }, 0.42)
      tl.fromTo(capRear, { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.09, ease: 'power2.out' }, 0.58)
      tl.to(capRear, { autoAlpha: 0, y: -22, duration: 0.08, ease: 'power1.in' }, 0.78)

      /* dwell on the rear (0.72 → 0.84) */

      /* Act III — REAR → OUTRO (0.84 → 1.00) + closing card */
      tl.to(cam, { ...K.outro, duration: 0.16 }, 0.84)
      tl.fromTo(endCard, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.1, ease: 'power2.out' }, 0.9)

      return tl
    }

    /* Breakpoint-aware setup: FOV + keyframe distances change between
     * desktop (16:9) and portrait mobile. gsap.matchMedia rebuilds the
     * timeline automatically when crossing 768px and cleans up on
     * unmount. Resizes within a breakpoint only need ScrollTrigger
     *.refresh() (handled in onResize below). */
    const mm = gsap.matchMedia()
    mm.add(
      {
        isDesktop: '(min-width: 768px)',
        isMobile: '(max-width: 767px)',
      },
      (ctx) => {
        const mobile = ctx.conditions?.isMobile === true
        camera.fov = mobile ? FOV_MOBILE : FOV_DESKTOP
        camera.updateProjectionMatrix()
        buildTimeline(mobile)
      },
    )

    /* ── Lenis momentum scrolling + a single GSAP ticker for everything ── */
    let lenis: Lenis | null = null
    if (!prefersReduced) {
      lenis = new Lenis({ duration: 1.15, smoothWheel: true })
      lenis.on('scroll', ScrollTrigger.update)
    }

    const tick = (time: number) => {
      lenis?.raf(time * 1000)
      applyCamera()
      renderer.render(scene, camera)
    }
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)

    /* ── Resize: reproject the camera, resize the renderer, refresh
     *    ScrollTrigger (debounced so mobile address-bar resize storms
     *    don't thrash the layout measurements) ──────────────────────── */
    let refreshTimer = 0
    const onResize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 150)
    }
    window.addEventListener('resize', onResize)

    /* ── Teardown — no memory leaks ────────────────────────────────── */
    return () => {
      disposed = true
      window.removeEventListener('resize', onResize)
      window.clearTimeout(refreshTimer)
      mm.revert() // kills the ScrollTriggers/tweens created per breakpoint
      ScrollTrigger.getAll().forEach((st) => st.kill()) // safety net
      gsap.ticker.remove(tick)
      lenis?.destroy()
      scene.traverse((obj) => {
        const o = obj as THREE.Mesh
        if (o.geometry) o.geometry.dispose()
        const m = o.material as THREE.Material | THREE.Material[] | undefined
        const disposeMat = (mat: THREE.Material) => {
          const withMap = mat as THREE.Material & { map?: THREE.Texture | null }
          withMap.map?.dispose()
          mat.dispose()
        }
        if (Array.isArray(m)) m.forEach(disposeMat)
        else if (m) disposeMat(m)
      })
      backdropTex.dispose()
      poolTex.dispose()
      envTex.dispose()
      pmrem.dispose()
      renderer.forceContextLoss()
      renderer.dispose()
    }
  }, [])

  /* ═══════════════════ Overlay markup (fixed stage) ═══════════════════ */

  return (
    <main className="relative w-full bg-[#050608] text-[#f2efe7]">
      {/*
        Invisible scroll track — its height (440vh) is the scroll distance
        ScrollTrigger scrubs the camera timeline through. Fully reversible.
      */}
      <div ref={trackRef} aria-hidden="true" className="h-[440vh]" />

      {/* Fixed 3D stage */}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="3D BMW M5 CS studio inspection — scroll to explore the car"
        className="fixed inset-0 z-0 block h-full w-full"
      />

      {/* Fixed UI overlay */}
      <div className="pointer-events-none fixed inset-0 z-10">
        {/* ── Navbar (persists through the whole sequence) ── */}
        <header className="pointer-events-auto flex flex-wrap items-center justify-between gap-4 px-[clamp(20px,5.5vw,80px)] py-[clamp(16px,3vw,32px)]">
          <a href="#" aria-label="BMW M5 CS — home" className="text-[#f5f2ea] hover:text-[#f5f2ea]">
            <svg
              width="129"
              height="36"
              viewBox="0 0 161 45"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
              focusable="false"
            >
              {/* BMW roundel */}
              <circle cx="22.5" cy="22.5" r="21.5" fill="#0b0d10" />
              <circle cx="22.5" cy="22.5" r="21.25" stroke="rgba(255,255,255,0.35)" strokeWidth="0.5" />
              <circle cx="22.5" cy="22.5" r="15.2" fill="#f2f4f6" />
              <path d="M22.5 7.3A15.2 15.2 0 0 0 7.3 22.5L22.5 22.5Z" fill="#1C69D4" />
              <path d="M37.7 22.5A15.2 15.2 0 0 1 22.5 37.7L22.5 22.5Z" fill="#1C69D4" />
              <defs>
                <path id="bmw-arc" d="M11.2 11.2A16 16 0 0 1 33.8 11.2" fill="none" />
              </defs>
              <text fontSize="5.2" fontWeight="700" fill="#f5f2ea" letterSpacing="2">
                <textPath href="#bmw-arc" startOffset="50%" textAnchor="middle">
                  BMW
                </textPath>
              </text>
              {/* M tricolor stripes */}
              <path d="M51 12.5L56.5 12.5L49 32.5L43.5 32.5Z" fill="#009ADA" />
              <path d="M61.5 12.5L67 12.5L59.5 32.5L54 32.5Z" fill="#2B3990" />
              <path d="M72 12.5L77.5 12.5L70 32.5L64.5 32.5Z" fill="#E4002B" />
              {/* M5 CS wordmark */}
              <text
                x="84"
                y="31"
                fontSize="21"
                fontWeight="800"
                fontStyle="italic"
                letterSpacing="0.5"
                fill="currentColor"
              >
                M5 CS
              </text>
            </svg>
          </a>

          <nav aria-label="Primary" className="flex flex-wrap items-center gap-[clamp(16px,2.8vw,40px)]">
            {NAV_LINKS.map((label) => (
              <a
                key={label}
                href="#"
                className="text-[13px] font-normal tracking-[0.02em] text-white transition-colors hover:text-white/80"
              >
                {label}
              </a>
            ))}
            <a href="#" className="signin-btn">
              Book a Drive
            </a>
          </nav>
        </header>

        {/* ── Hero layer — fades out as the camera leaves the hero state ── */}
        <div ref={heroLayerRef} className="absolute inset-0 flex flex-col">
          {STAR_DOTS.map((dot) => (
            <span
              key={`${dot.top}-${dot.side}-${dot.offset}`}
              aria-hidden="true"
              className="pointer-events-none absolute rounded-full bg-[#e8ddc4]"
              style={starDotStyle(dot)}
            />
          ))}

          <section className="mt-auto flex flex-col items-center px-[clamp(20px,8vw,120px)] pb-[clamp(56px,9vh,90px)] text-center">
            <div aria-hidden="true" className="mb-[clamp(20px,3vh,32px)] flex items-center gap-4">
              <span className="h-px w-12 bg-[linear-gradient(90deg,transparent,#FFB733)]" />
              <span className="text-[18px] leading-none text-[#FFB733]">✦</span>
              <span className="h-px w-12 bg-[linear-gradient(90deg,#FFB733,transparent)]" />
            </div>

            <h1 className="m-0 mb-5 whitespace-nowrap text-[clamp(22px,5.5vw,44px)] font-semibold leading-[1.12] tracking-[-0.02em] text-[#f7f4ec]">
              Engineered for <span className="text-white">the Apex</span>
            </h1>

            <p className="m-0 mb-9 text-[15px] font-normal leading-[1.7] text-white/75">
              The most powerful BMW 5 Series of all time — a 627 hp twin-turbo V8{' '}
              <br className="hidden sm:inline" aria-hidden="true" />
              stripped of 70 kg and sharpened on the Nürburgring.
            </p>

            <a href="#" className="cta-btn pointer-events-auto">
              Explore the M5 CS
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M4 12h15" />
                <path d="M13.5 5.5 20 12l-6.5 6.5" />
              </svg>
            </a>
          </section>
        </div>

        {/* ── Stage caption: FRONT (right side on desktop) ── */}
        <div
          ref={capFrontRef}
          style={{ opacity: 0 }}
          className="absolute inset-x-5 bottom-28 max-w-[340px] [text-shadow:0_1px_14px_rgba(0,0,0,0.55)] sm:inset-x-auto sm:bottom-auto sm:right-[clamp(24px,7vw,110px)] sm:top-[38%] sm:text-right"
        >
          <p className="m-0 text-[11px] font-medium uppercase tracking-[0.32em] text-[#e8ddc4]/80">01 — Front Fascia</p>
          <h2 className="m-0 mt-2 text-[clamp(20px,3vw,32px)] font-semibold tracking-[-0.01em] text-[#f7f4ec]">
            Laserlight &amp; Kidney Grille
          </h2>
          <p className="m-0 mt-2 text-[13px] leading-relaxed text-white/55">
            Illuminated M Laserlights, widened kidneys and a carbon front splitter.
          </p>
        </div>

        {/* ── Stage caption: REAR (left side on desktop) ── */}
        <div
          ref={capRearRef}
          style={{ opacity: 0 }}
          className="absolute inset-x-5 bottom-28 max-w-[340px] [text-shadow:0_1px_14px_rgba(0,0,0,0.55)] sm:inset-x-auto sm:bottom-auto sm:left-[clamp(24px,7vw,110px)] sm:top-[38%]"
        >
          <p className="m-0 text-[11px] font-medium uppercase tracking-[0.32em] text-[#e8ddc4]/80">02 — Rear Profile</p>
          <h2 className="m-0 mt-2 text-[clamp(20px,3vw,32px)] font-semibold tracking-[-0.01em] text-[#f7f4ec]">
            Diffuser &amp; Quad Exhaust
          </h2>
          <p className="m-0 mt-2 text-[13px] leading-relaxed text-white/55">
            Blacked-out taillights over a carbon diffuser and quad tailpipes.
          </p>
        </div>

        {/* ── Closing card ── */}
        <div
          ref={endCardRef}
          style={{ opacity: 0 }}
          className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center"
        >
          <p className="m-0 text-[11px] font-medium uppercase tracking-[0.4em] text-[#e8ddc4]/80">BMW M5 CS</p>
          <h2 className="m-0 mt-4 text-[clamp(24px,4.5vw,40px)] font-semibold tracking-[-0.02em] text-[#f7f4ec]">
            The most powerful M5 ever built.
          </h2>
          <a href="#" className="cta-btn pointer-events-auto mt-8">
            Reserve Yours
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M4 12h15" />
              <path d="M13.5 5.5 20 12l-6.5 6.5" />
            </svg>
          </a>
        </div>

        {/* CC-BY-4.0 license attribution (required by the model author) */}
        <p className="absolute bottom-2 left-4 m-0 text-[10px] leading-none text-white/25">
          BMW M5 CS (F90) model by fvrenbld · CC-BY-4.0
        </p>
      </div>

      {/* ── Loading overlay — real fetch % of the meshopt GLB, then fades ── */}
      <div
        ref={loaderRef}
        role="status"
        aria-live="polite"
        className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#050608] px-6 text-center"
      >
        <div aria-hidden="true" className="mb-5 flex items-center gap-2.5">
          <svg width="34" height="34" viewBox="0 0 45 45" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="22.5" cy="22.5" r="21.5" fill="#0b0d10" />
            <circle cx="22.5" cy="22.5" r="21.25" stroke="rgba(255,255,255,0.35)" strokeWidth="0.5" />
            <circle cx="22.5" cy="22.5" r="15.2" fill="#f2f4f6" />
            <path d="M22.5 7.3A15.2 15.2 0 0 0 7.3 22.5L22.5 22.5Z" fill="#1C69D4" />
            <path d="M37.7 22.5A15.2 15.2 0 0 1 22.5 37.7L22.5 22.5Z" fill="#1C69D4" />
          </svg>
          <svg width="24" height="16" viewBox="0 0 32 21" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5.5 0h5.5L5.5 21H0Z" fill="#009ADA" />
            <path d="M16 0h5.5L16 21h-5.5Z" fill="#2B3990" />
            <path d="M26.5 0H32L26.5 21H21Z" fill="#E4002B" />
          </svg>
          <span className="text-[20px] font-extrabold italic leading-none tracking-[0.01em] text-[#f5f2ea]">M5 CS</span>
        </div>
        <p ref={loaderMsgRef} className="m-0 mb-6 text-[12px] uppercase tracking-[0.3em] text-white/60">
          Preparing your M5 CS
        </p>
        <div className="relative h-[3px] w-60 overflow-hidden rounded-full bg-white/10">
          <div
            ref={loaderBarRef}
            className="absolute inset-y-0 left-0 w-0 rounded-full bg-[#FFB733] transition-[width] duration-200 ease-out"
          />
        </div>
        <p className="m-0 mt-3 text-[12px] font-medium tabular-nums text-[#e8ddc4]">
          <span ref={loaderPctRef}>0</span>%
        </p>
      </div>
    </main>
  )
}
