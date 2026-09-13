'use client'

/**
 * ═════════════════════════════════════════════════════════════════════════
 * ScrollExperience — scroll-driven 3D camera inspection (gray BMW M5 CS)
 * ═════════════════════════════════════════════════════════════════════════
 * Stack: vanilla three.js · GSAP + ScrollTrigger (scrub 1.2) · Lenis
 * Environment: photographic 360° equirectangular studio panorama
 * ('studio_360.jpg') — scene.background AND scene.environment, so the
 * paint reflects the real overhead softbox and studio walls.
 *
 * Choreography (scrubbed 1:1 with scroll — reverses fluidly when scrolling
 * back up, because everything is one timeline driven by ScrollTrigger):
 *
 *   progress   camera move                          overlay
 *   ─────────────────────────────────────────────────────────────────────
 *   0.00–0.30  HERO → FRONT   wide drift pose →    hero copy fades out
 *                             bumper close-up      front caption in/out
 *   0.42–0.72  FRONT → REAR   orbit along flank    rear caption in/out
 *   0.84–1.00  REAR → OUTRO   pull back wide       closing card fades in
 *
 * The "pinned viewport" is a fixed full-viewport stage (canvas + UI
 * overlay) driven by an invisible 300vh scroll track — functionally a
 * ScrollTrigger pin, but perfectly jitter-free with Lenis on every browser.
 */

import { useEffect, useRef } from 'react'
import Image from 'next/image'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'

/* ═════════════════ 1. MODEL ══════════════════════════════════════════ */

const MODEL_URL = '/models/bmw-m5-cs/scene.gltf' // CC-BY-4.0 · fvrenbld
const TARGET_LENGTH = 4.6 // car is normalized to this world length
const FLIP_MODEL = false // set true if a swapped model faces backwards

/* 360° equirectangular studio panorama — photographic light studio with a
 * huge overhead softbox, black cyc walls and a marked concrete floor
 * (user-provided 'studio_360.jpg'). ONE texture drives BOTH the visible
 * backdrop (scene.background) and the image-based lighting (PMREM →
 * scene.environment), so the car body naturally reflects the softbox. */
const ENV_URL = '/textures/studio_360.jpg'
/** ✏️ Yaw of the panorama (rad). Rotates WHICH WALL sits behind each camera
 * shot: the softbox lives at the image's horizontal center (+X direction at
 * yaw = 0). Background & environment rotations stay identical so the paint
 * reflections always match the visible backdrop. */
const ENV_ROTATION_Y = 0
/** ✏️ Pitch of the panorama (rad) — positive lifts the photographic floor
 * to meet the 3D floor (y = 0) and pushes the ceiling softbox up toward the
 * top of frame (true overhead studio look). Match on both background &
 * environment. */
const BACKDROP_PITCH_X = 0.1

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
  /** 0% — LOW-ANGLE WIDE: the camera skims the studio floor so the car
   *  looms over the viewer in its parked drift stance; black cyc wall +
   *  glowing softbox fill the background. Raise pos.y for a higher 3/4. */
  hero: { pos: [-6.0, 0.78, 4.7], target: [0, 0.78, 0], mobileF: 1.35 },
  /** step 1 — translate + zoom into the front bumper / headlights
   *  (nose tip is at x ≈ +2.3; tuck pos closer for a tighter crop) */
  front: { pos: [3.55, 0.52, 1.5], target: [2.1, 0.5, 0.05], mobileF: 2.15, mobileHeadOn: 0.45 },
  /** step 2 — orbit around the flank to the rear diffuser, quad exhausts
   *  and taillights. Keep z positive on BOTH keys so the tween sweeps
   *  same-side; increase the |pos.x| gap for a wider orbit arc. */
  rear: { pos: [-3.95, 0.66, 1.75], target: [-2.0, 0.58, 0], mobileF: 2.0, mobileHeadOn: 0.45 },
  /** closing wide elevated rear 3/4 for the end card — lift pos.y and
   *  target.y together to raise the horizon in frame */
  outro: { pos: [-6.6, 2.6, 6.8], target: [0, 1.0, 0], mobileF: 1.35 },
} satisfies Record<string, CamKey>

const FOV_DESKTOP = 45
const FOV_MOBILE = 60

/* ═════ 3. PRESENTATION GARNISH (drift pose / sway / smoke) ═══════════ */

const BASE_YAW = -0.14 // parked "drift" angle of the car (rad)
const IDLE_SWAY = true // subtle breathing sway so the car feels alive
const SMOKE_ENABLED = true // rear-tire smoke puffs
const SMOKE_PER_SECOND = 105 // thin studio haze — heavy smoke floods the close-ups
const SMOKE_COUNT = 240

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

/** Canvas-drawn dark vignette (old flat-spotlight backdrop) — REMOVED:
 * replaced by the photographic 360° studio panorama (ENV_URL above). */

/* ══════════════════════════════════════════════════════════════════════
 * Car — load the real glTF, normalize + restyle it
 * ══════════════════════════════════════════════════════════════════════ */

/** glTF material names that carry the body paint / glass (fvrenbld model) */
const BODY_PAINT = new Set(['Bodyshell1Mtl', 'Bonnet0041Mtl', 'Bonnet1Mtl', 'Boot0041Mtl', 'DoorColor1Mtl'])
const GLASS = new Set(['Windowrf1Mtl'])

const satinGrayPaint = () =>
  new THREE.MeshPhysicalMaterial({
    color: '#868c93',
    metalness: 0.7, // a touch of dielectric body color so the paint reads on dark walls
    roughness: 0.34,
    clearcoat: 1,
    clearcoatRoughness: 0.18,
    envMapIntensity: 1.55, // picks up the softbox highlight streak + bright concrete floor bounce
  })

const darkGlass = () =>
  new THREE.MeshPhysicalMaterial({
    color: '#06080b',
    metalness: 0.55,
    roughness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.5,
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
        ;(mats[i] as THREE.MeshStandardMaterial).envMapIntensity = 0.9
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
    gl_PointSize = min(aSize * uScale / dist, 190.0);
    vAlpha = aAlpha * smoothstep(0.7, 2.2, dist);
    gl_Position = projectionMatrix * mv;
  }
`

const SMOKE_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  void main() {
    float a = texture2D(uMap, gl_PointCoord).a * vAlpha * 0.7; // studio-soft
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
      p.size = 0.35 + Math.random() * 0.3
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
      aSize[i] = p.size + t * 2.0
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

const NAV_LINKS = ['Overview', 'Performance', 'Design', 'Specs'] as const

/* (hero star-dot decorations removed — they belonged to the night-sky
 * backdrop; the photographic studio needs no synthetic starlight) */

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
    renderer.toneMappingExposure = 1.05 // ACES + modest exposure keeps the softbox whites short of clipping
    renderer.outputColorSpace = THREE.SRGBColorSpace

    /* ── Scene: photographic studio — 360° equirect panorama ───────
     * The SAME texture is the visible backdrop and the IBL source
     * (PMREM pre-filter), so the metallic paint reflects exactly the
     * softbox / walls / floor you see behind the car. */
    const scene = new THREE.Scene()
    renderer.setClearColor(0x0a0b0d, 1) // fallback until the panorama streams in

    scene.backgroundRotation.set(BACKDROP_PITCH_X, ENV_ROTATION_Y, 0)
    scene.environmentRotation.set(BACKDROP_PITCH_X, ENV_ROTATION_Y, 0) // keep reflections aligned

    const pmrem = new THREE.PMREMGenerator(renderer)
    let studioTex: THREE.Texture | null = null
    let studioEnvRT: THREE.WebGLRenderTarget | null = null

    new THREE.TextureLoader().load(
      ENV_URL,
      (tex) => {
        if (disposed) {
          tex.dispose()
          return
        }
        tex.mapping = THREE.EquirectangularReflectionMapping // 2:1 photo → skybox + IBL
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
        studioTex = tex
        scene.background = tex
        scene.backgroundIntensity = 1.0
        studioEnvRT = pmrem.fromEquirectangular(tex) // roughness-aware reflections
        scene.environment = studioEnvRT.texture
      },
      undefined,
      (error) => console.warn('[scroll-experience] studio panorama failed to load:', error),
    )

    /* ── Camera ────────────────────────────────────────────────────── */
    const camera = new THREE.PerspectiveCamera(FOV_DESKTOP, window.innerWidth / window.innerHeight, 0.1, 160)

    /* ── Lights ────────────────────────────────────────────────────── */
    const key = new THREE.SpotLight(0xf5f8ff, 190) // overhead "softbox" key — casts the contact shadows
    key.position.set(0.4, 9, 1.2) // almost directly above → shadow pools straight under the tires
    key.angle = 0.75
    key.penumbra = 0.9
    key.decay = 2
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.bias = -0.0002
    key.shadow.normalBias = 0.02
    key.shadow.camera.near = 3
    key.shadow.camera.far = 30
    key.target.position.set(0, 0.5, 0)
    scene.add(key, key.target)

    const rim = new THREE.DirectionalLight(0xe8edf4, 1.1) // soft neutral fill so the flanks don't go pure black
    rim.position.set(-7, 4, -5)
    scene.add(rim)

    scene.add(new THREE.HemisphereLight(0x3d434b, 0x131518, 0.5)) // studio wall/floor bounce

    /* ── Floor (invisible ShadowMaterial shadow-catcher) ─────────────────────────────────────── */
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(60, 72),
      // Invisible shadow-catcher ONLY — the concrete floor is PART of the
      // 360° panorama. Opacity 0.4 keeps the photo floor's sheen visible
      // through the shadow so the tires look planted on the studio floor.
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.4 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)

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
    addGlow(2.08, 0.58, 0.55, 0xcfe0ff, 0.5, 0.7) // headlights — Laserlight glare
    addGlow(2.08, 0.58, -0.55, 0xcfe0ff, 0.5, 0.7)
    addGlow(-2.12, 0.62, 0.55, 0xff3b3b, 0.38, 0.62) // taillights
    addGlow(-2.12, 0.62, -0.55, 0xff3b3b, 0.38, 0.62)

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
      softTex.dispose()
      studioTex?.dispose()
      studioEnvRT?.dispose()
      scene.background = null
      scene.environment = null
      pmrem.dispose()
      renderer.forceContextLoss()
      renderer.dispose()
    }
  }, [])

  /* ═══════════════════ Overlay markup (fixed stage) ═══════════════════ */

  return (
    <main className="relative w-full bg-[#050608] text-[#f2efe7]">
      {/*
        Invisible scroll track — its height (300vh) is the scroll distance
        ScrollTrigger scrubs the camera timeline through (the canvas itself
        stays fixed = functional pin). Fully reversible.
      */}
      <div ref={trackRef} aria-hidden="true" className="h-[300vh]" />

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
          <a
            href="#"
            aria-label="BMW M5 CS — home"
            className="flex items-center gap-2.5 text-[#f5f2ea] hover:text-[#f5f2ea]"
          >
            {/* Official BMW roundel (user-provided asset) */}
            <Image
              src="/bmw-roundel.png"
              alt=""
              width={36}
              height={36}
              priority
              draggable={false}
              className="block h-9 w-9"
            />
            <svg
              width="24"
              height="16"
              viewBox="0 0 32 21"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
              focusable="false"
            >
              {/* M tricolor stripes */}
              <path d="M5.5 0h5.5L5.5 21H0Z" fill="#009ADA" />
              <path d="M16 0h5.5L16 21h-5.5Z" fill="#2B3990" />
              <path d="M26.5 0H32L26.5 21H21Z" fill="#E4002B" />
            </svg>
            {/* M5 CS wordmark */}
            <span className="text-[21px] font-extrabold italic leading-none tracking-[0.01em]">
              M5 CS
            </span>
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
            Illuminated M Laserlights and widened kidneys under the overhead softbox.
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
            Blacked-out taillights and quad pipes beneath the studio key light.
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
    </main>
  )
}
