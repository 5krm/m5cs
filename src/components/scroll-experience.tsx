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
 * The "pinned viewport" is a fixed full-viewport stage (canvas + UI
 * overlay) driven by an invisible 440vh scroll track — functionally a
 * ScrollTrigger pin, but perfectly jitter-free with Lenis on every browser.
 */

import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'

/* ═════════════════ 1. MODEL ══════════════════════════════════════════ */

const MODEL_URL = '/models/bmw-m5-cs/scene.gltf' // CC-BY-4.0 · fvrenbld
const TARGET_LENGTH = 4.6 // car is normalized to this world length
const FLIP_MODEL = false // set true if a swapped model faces backwards

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

/* ═════ 3. PRESENTATION GARNISH (drift pose / sway / smoke) ═══════════ */

const BASE_YAW = -0.14 // parked "drift" angle of the car (rad)
const IDLE_SWAY = true // subtle breathing sway so the car feels alive
const SMOKE_ENABLED = true // rear-tire smoke puffs
const SMOKE_PER_SECOND = 220
const SMOKE_COUNT = 384

/* ══════════════════════════════════════════════════════════════════════
 * Canvas-generated textures — zero network dependencies
 * ══════════════════════════════════════════════════════════════════════ */

/** Soft radial sprite used by the smoke particles and light glows */
function makeSoftCircleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,0.7)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)')
  g.addColorStop(0.6, 'rgba(255,255,255,0.14)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
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

/** Circular pool of light on the floor under the car */
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
  anchorLeft: THREE.Object3D // rear tire contact patches (smoke emitters)
  anchorRight: THREE.Object3D
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

  // Smoke anchors at the rear tire contact patches (rear = −X)
  const anchorLeft = new THREE.Object3D()
  anchorLeft.position.set(-TARGET_LENGTH * 0.3, 0.16, TARGET_LENGTH * 0.155)
  const anchorRight = new THREE.Object3D()
  anchorRight.position.set(-TARGET_LENGTH * 0.3, 0.16, -TARGET_LENGTH * 0.155)
  car.add(anchorLeft, anchorRight)

  return { car, anchorLeft, anchorRight }
}

/* ══════════════════════════════════════════════════════════════════════
 * Tire smoke — pooled CPU particles + point-sprite shader
 * ══════════════════════════════════════════════════════════════════════ */

const SMOKE_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(0.1, -mv.z);
    // cap the sprite size and fade puffs that get right next to the
    // camera (close-up states park the lens near the rear wheels)
    gl_PointSize = min(aSize * uScale / dist, 300.0);
    vAlpha = aAlpha * smoothstep(0.7, 2.2, dist);
    gl_Position = projectionMatrix * mv;
  }
`

const SMOKE_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(0.84, 0.86, 0.9, a);
  }
`

type SmokeParticle = {
  life: number
  maxLife: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  size: number
}

function createSmokeSystem(softTex: THREE.Texture) {
  const particles: SmokeParticle[] = Array.from({ length: SMOKE_COUNT }, () => ({
    life: 0,
    maxLife: 1,
    x: 0,
    y: -50,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    size: 1,
  }))
  const position = new Float32Array(SMOKE_COUNT * 3)
  const aSize = new Float32Array(SMOKE_COUNT)
  const aAlpha = new Float32Array(SMOKE_COUNT)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1))
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(aAlpha, 1))

  const material = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 }, uMap: { value: softTex } },
    vertexShader: SMOKE_VERTEX,
    fragmentShader: SMOKE_FRAGMENT,
    transparent: true,
    depthWrite: false,
  })

  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  points.renderOrder = 5

  const state = { cursor: 0, spawnAcc: 0 }

  /** dt seconds · emitters are the two rear-tire anchor world positions */
  function update(dt: number, left: THREE.Vector3, right: THREE.Vector3, spawn: boolean) {
    state.spawnAcc += dt * (spawn ? SMOKE_PER_SECOND : 0)
    while (state.spawnAcc >= 1) {
      state.spawnAcc -= 1
      state.cursor = (state.cursor + 1) % SMOKE_COUNT
      const p = particles[state.cursor]
      const src = state.cursor % 2 === 0 ? left : right
      p.life = 0.0001
      p.maxLife = 1.8 + Math.random() * 1.0
      p.x = src.x + (Math.random() - 0.5) * 0.24
      p.y = 0.12 + Math.random() * 0.08
      p.z = src.z + (Math.random() - 0.5) * 0.24
      // drift backwards (−X) and outward away from the centerline
      p.vx = -(0.5 + Math.random() * 0.7)
      p.vz = Math.sign(src.z || 1) * (0.6 + Math.random() * 0.8) + (Math.random() - 0.5) * 0.5
      p.vy = 0.18 + Math.random() * 0.3
      p.size = 0.5 + Math.random() * 0.4
    }

    for (let i = 0; i < SMOKE_COUNT; i++) {
      const p = particles[i]
      if (p.life > 0) {
        p.life += dt
        if (p.life >= p.maxLife) {
          p.life = 0
        } else {
          const drag = Math.exp(-1.1 * dt)
          p.vx *= drag
          p.vz *= drag
          p.vy = p.vy * Math.exp(-0.7 * dt) + 0.14 * dt
          p.x += p.vx * dt
          p.y += p.vy * dt
          p.z += p.vz * dt
        }
      }
      const t = p.life > 0 ? p.life / p.maxLife : 0
      position[i * 3] = p.x
      position[i * 3 + 1] = p.life > 0 ? p.y : -50
      position[i * 3 + 2] = p.z
      aSize[i] = p.size + t * 2.8
      aAlpha[i] = p.life > 0 ? Math.min(t * 6, 1) * Math.pow(1 - t, 1.1) * 0.4 : 0
    }
    geometry.attributes.position.needsUpdate = true
    geometry.attributes.aSize.needsUpdate = true
    geometry.attributes.aAlpha.needsUpdate = true
  }

  function dispose() {
    geometry.dispose()
    material.dispose()
  }

  return { points, material, update, dispose }
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

const NAV_LINKS = ['How It Works', 'Tributes', 'Pricing', 'Support'] as const

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

  useEffect(() => {
    const canvas = canvasRef.current
    const track = trackRef.current
    const heroLayer = heroLayerRef.current
    const capFront = capFrontRef.current
    const capRear = capRearRef.current
    const endCard = endCardRef.current
    if (!canvas || !track || !heroLayer || !capFront || !capRear || !endCard) return

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

    /* ── Scene: dark automotive studio (vignette backdrop + fog) ───── */
    const scene = new THREE.Scene()
    const backdropTex = makeStudioBackdropTexture()
    scene.background = backdropTex
    scene.fog = new THREE.FogExp2(0x050608, 0.04)

    // Studio reflections via a self-contained PMREM environment (no HDR
    // download); individual materials tune envMapIntensity.
    const pmrem = new THREE.PMREMGenerator(renderer)
    const envScene = new RoomEnvironment()
    const envTex = pmrem.fromScene(envScene, 0.04).texture
    scene.environment = envTex
    ;(envScene as unknown as { dispose?: () => void }).dispose?.()

    /* ── Camera ────────────────────────────────────────────────────── */
    const camera = new THREE.PerspectiveCamera(FOV_DESKTOP, window.innerWidth / window.innerHeight, 0.1, 160)

    /* ── Lights ────────────────────────────────────────────────────── */
    const key = new THREE.SpotLight(0xfff1dd, 380)
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

    const rim = new THREE.DirectionalLight(0xbfd0e8, 1.6)
    rim.position.set(-8, 5, -6)
    scene.add(rim)

    scene.add(new THREE.HemisphereLight(0x39404e, 0x0b0c10, 0.38))

    /* ── Floor + pool of light ─────────────────────────────────────── */
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(90, 72),
      new THREE.MeshStandardMaterial({ color: 0x08090d, roughness: 0.5, metalness: 0.25, envMapIntensity: 0.1 }),
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
        opacity: 0.035,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    pool.rotation.x = -Math.PI / 2
    pool.position.y = 0.01
    scene.add(pool)

    /* ── Car root + light glows (model streams in asynchronously) ──── */
    const carGroup = new THREE.Group()
    carGroup.rotation.y = BASE_YAW
    scene.add(carGroup)

    const softTex = makeSoftCircleTexture()
    const addGlow = (x: number, y: number, z: number, color: number, opacity: number, size: number) => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: softTex,
          color,
          transparent: true,
          opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      )
      sprite.position.set(x, y, z)
      sprite.scale.setScalar(size)
      carGroup.add(sprite)
    }
    addGlow(2.08, 0.58, 0.55, 0xc7d6ef, 0.35, 0.55) // headlights
    addGlow(2.08, 0.58, -0.55, 0xc7d6ef, 0.35, 0.55)
    addGlow(-2.12, 0.62, 0.55, 0xff4d4d, 0.24, 0.5) // taillights
    addGlow(-2.12, 0.62, -0.55, 0xff4d4d, 0.24, 0.5)

    let carRig: CarRig | null = null
    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => {
        if (disposed) return
        carRig = buildCarRig(gltf.scene)
        // gentle settle-in entrance once the model has parsed
        carRig.car.position.y = -0.12
        carGroup.add(carRig.car)
        gsap.to(carRig.car.position, { y: 0, duration: 0.9, ease: 'power2.out' })
      },
      undefined,
      (error) => {
        console.warn('[scroll-experience] car model failed to load:', error)
      },
    )

    /* ── Smoke ─────────────────────────────────────────────────────── */
    const smoke = createSmokeSystem(softTex)
    scene.add(smoke.points)

    const drawSize = new THREE.Vector2()
    const updatePointScale = () => {
      renderer.getDrawingBufferSize(drawSize)
      const fovRad = (camera.fov * Math.PI) / 180
      const s = (drawSize.y * 0.5) / Math.tan(fovRad / 2)
      smoke.material.uniforms.uScale.value = Number.isFinite(s) ? s : 800
    }
    updatePointScale()

    /* ── Camera rig state — animated by GSAP, applied every frame ──── */
    const cam: FlatKey = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 }
    const applyCamera = () => {
      camera.position.set(cam.px, cam.py, cam.pz)
      camera.lookAt(cam.tx, cam.ty, cam.tz) // target tracked every frame
    }

    /* ── Per-frame world updates (sway, smoke) ─────────────────────── */
    const anchorL = new THREE.Vector3()
    const anchorR = new THREE.Vector3()
    const updateWorld = (t: number, dt: number) => {
      const sway = prefersReduced || !IDLE_SWAY ? 0 : 1
      carGroup.rotation.y = BASE_YAW + sway * Math.sin(t * 0.42) * 0.05
      carGroup.rotation.x = sway * (Math.sin(t * 2.9) * 0.008 - 0.006)
      carGroup.rotation.z = sway * Math.sin(t * 2.1) * 0.009
      carGroup.position.y = sway * Math.abs(Math.sin(t * 4.7)) * 0.014
      if (carRig && SMOKE_ENABLED && !prefersReduced) {
        smoke.update(dt, carRig.anchorLeft.getWorldPosition(anchorL), carRig.anchorRight.getWorldPosition(anchorR), true)
      }
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
        updatePointScale()
        buildTimeline(mobile)
      },
    )

    /* ── Lenis momentum scrolling + a single GSAP ticker for everything ── */
    let lenis: Lenis | null = null
    if (!prefersReduced) {
      lenis = new Lenis({ duration: 1.15, smoothWheel: true })
      lenis.on('scroll', ScrollTrigger.update)
    }

    const tick = (time: number, deltaMS: number) => {
      lenis?.raf(time * 1000)
      updateWorld(time, Math.min(deltaMS / 1000, 0.05))
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
      updatePointScale()
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
      smoke.dispose()
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
      softTex.dispose()
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
          <a href="#" aria-label="NeuroLink — home" className="text-[#f5f2ea] hover:text-[#f5f2ea]">
            <svg
              width="129"
              height="36"
              viewBox="0 0 161 45"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
              focusable="false"
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M31.949 14.4493C36.3622 19.7088 35.7552 27.386 30.7224 31.609C28.6651 33.3352 26.1803 34.2304 23.6536 34.332C22.8012 34.3662 22.1381 35.085 22.1724 35.9373C22.2065 36.7897 22.9253 37.4529 23.7777 37.4186C26.956 37.2909 30.1034 36.1609 32.708 33.9754C39.1103 28.6033 39.7721 18.9667 34.3154 12.4637C28.8588 5.96073 19.2537 4.93901 12.8514 10.3112C10.2468 12.4967 8.58745 15.4 7.90978 18.508C7.72799 19.3414 8.25624 20.1644 9.0898 20.3461C9.92324 20.5279 10.7462 19.9996 10.9279 19.1661C11.4667 16.6954 12.7798 14.4038 14.837 12.6776C19.8698 8.45456 27.5358 9.18983 31.949 14.4493ZM25.3365 25.6158C26.9702 24.245 27.1833 21.8093 25.8125 20.1756C24.4416 18.542 22.006 18.3289 20.3723 19.6997C18.7387 21.0705 18.5256 23.5062 19.8964 25.1398C21.2672 26.7735 23.7028 26.9866 25.3365 25.6158ZM26.6852 27.2503C29.2017 25.3016 29.6692 21.5171 27.5433 18.7718C25.4175 16.0264 21.6364 15.5317 19.1199 17.4803C17.957 18.3809 17.2378 19.6567 17.0014 21.0484C17.0051 21.1214 17.0037 21.1955 16.9969 21.2704C16.9189 22.1198 16.1671 22.7453 15.3177 22.6673C13.8978 22.5371 12.4666 22.9126 11.2925 23.8218C8.77601 25.7704 8.30857 29.5549 10.4344 32.3003C12.5603 35.0456 16.3413 35.5403 18.8578 33.5917C20.0208 32.6912 20.74 31.4153 20.9763 30.0236C20.9726 29.9506 20.974 29.8765 20.9809 29.8017C21.0588 28.9522 21.8106 28.3267 22.66 28.4047C24.0799 28.535 25.5111 28.1594 26.6852 27.2503ZM23.8052 31.4988C25.4883 31.3861 27.1509 30.7967 28.5766 29.6927C32.535 26.6275 33.0827 20.8798 29.9858 16.8804C26.8889 12.8811 21.1871 11.9726 17.2286 15.0378C15.6945 16.2258 14.6685 17.8285 14.1726 19.5733C12.4894 19.6859 10.8268 20.2754 9.40117 21.3793C5.44273 24.4445 4.89505 30.1922 7.99195 34.1916C11.0888 38.1909 16.7907 39.0994 20.7491 36.0342C22.2832 34.8463 23.3093 33.2435 23.8052 31.4988Z"
                fill="currentColor"
              />
              <path
                d="M53.4883 31.3584V14.4482H56.207L64.4453 26.2959H64.5156V14.4482H67.5156V31.3584H64.8203L56.5586 19.4639H56.5V31.3584H53.4883ZM75.6719 31.6045C71.9453 31.6045 69.6953 29.1318 69.6953 25.1826V25.1709C69.6953 21.2568 71.9805 18.6787 75.5312 18.6787C79.082 18.6787 81.2852 21.1748 81.2852 24.9248V25.8623H72.5898C72.6367 28.042 73.832 29.3311 75.7305 29.3311C77.1836 29.3311 78.1328 28.5576 78.4141 27.7256L78.4375 27.6436H81.168L81.1328 27.7725C80.7461 29.6826 78.918 31.6045 75.6719 31.6045ZM75.5664 20.9639C74.0195 20.9639 72.8594 22.0068 72.625 23.917H78.4492C78.2383 21.9482 77.1133 20.9639 75.5664 20.9639ZM87.4023 31.6045C84.6719 31.6045 83.1133 29.8467 83.1133 26.9639V18.9365H86.0312V26.3896C86.0312 28.1475 86.8516 29.1436 88.5156 29.1436C90.1914 29.1436 91.2578 27.9365 91.2578 26.1318V18.9365H94.1758V31.3584H91.2578V29.4131H91.1992C90.5547 30.7373 89.2773 31.6045 87.4023 31.6045ZM96.5781 31.3584V18.9365H99.4961V21.0811H99.5547C99.9414 19.5811 100.973 18.6787 102.402 18.6787C102.766 18.6787 103.105 18.7373 103.328 18.7959V21.4326C103.082 21.3389 102.637 21.2686 102.145 21.2686C100.492 21.2686 99.4961 22.3115 99.4961 24.1514V31.3584H96.5781ZM109.855 31.6045C106.199 31.6045 103.844 29.167 103.844 25.1475V25.124C103.844 21.1396 106.234 18.6787 109.844 18.6787C113.465 18.6787 115.867 21.1162 115.867 25.124V25.1475C115.867 29.1787 113.5 31.6045 109.855 31.6045ZM109.867 29.249C111.707 29.249 112.891 27.749 112.891 25.1475V25.124C112.891 22.5342 111.695 21.0459 109.844 21.0459C108.027 21.0459 106.82 22.5459 106.82 25.124V25.1475C106.82 27.7607 108.004 29.249 109.867 29.249ZM118.035 31.3584V14.4482H121.059V28.8154H128.734V31.3584H118.035ZM132.156 17.1553C131.242 17.1553 130.527 16.4287 130.527 15.5615C130.527 14.6709 131.242 13.9561 132.156 13.9561C133.07 13.9561 133.773 14.6709 133.773 15.5615C133.773 16.4287 133.07 17.1553 132.156 17.1553ZM130.691 31.3584V18.9365H133.609V31.3584H130.691ZM136.094 31.3584V18.9365H139.012V20.8818H139.07C139.715 19.5459 140.98 18.6787 142.867 18.6787C145.598 18.6787 147.156 20.4365 147.156 23.3193V31.3584H144.238V23.9053C144.238 22.1357 143.418 21.1396 141.754 21.1396C140.078 21.1396 139.012 22.3584 139.012 24.1514V31.3584H136.094ZM149.629 31.3584V14.4482H152.547V24.0928H152.605L157.246 18.9365H160.621L155.699 24.2803L160.82 31.3584H157.457L153.531 26.0146L152.547 27.0459V31.3584H149.629Z"
                fill="currentColor"
              />
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
              Sign In
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
              Where Memories <span className="text-white">Live Forever</span>
            </h1>

            <p className="m-0 mb-9 text-[15px] font-normal leading-[1.7] text-white/75">
              Create a beautiful memorial to share their story, photos, cherished{' '}
              <br className="hidden sm:inline" aria-hidden="true" />
              moments, and celebrate their life together.
            </p>

            <a href="#" className="cta-btn pointer-events-auto">
              Create Memorial
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
          <p className="m-0 text-[11px] font-medium uppercase tracking-[0.4em] text-[#e8ddc4]/80">NeuroLink</p>
          <h2 className="m-0 mt-4 text-[clamp(24px,4.5vw,40px)] font-semibold tracking-[-0.02em] text-[#f7f4ec]">
            Every angle. Remembered forever.
          </h2>
          <a href="#" className="cta-btn pointer-events-auto mt-8">
            Create Memorial
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
    </main>
  )
}
