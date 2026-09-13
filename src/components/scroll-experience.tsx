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
 *   0.00–0.30  HERO → FRONT   elevated 3/4 →     hero copy fades out
 *                             nose (bg pans      front caption in/out
 *                             bridge → water)
 *   0.42–0.72  FRONT → MID →  arc around nose,   rear caption in/out
 *              REAR           down the far flank
 *                             (bg pans silos → road → port cranes)
 *   0.84–1.00  REAR → OUTRO   pull back wide      closing card fades in
 *
 * GROUNDING RULE (why every camera is raised + tilted down): the 3D car
 * stands on y = 0 while the photographic ground lives inside the panorama.
 * A LOW, LEVEL camera puts the photo's water/quay band behind the wheels
 * and the car reads as floating. A camera at ~1.1–2 u aiming DOWN at the
 * car lays the photo's near-field asphalt under the tires — exactly like
 * the approved outro framing. Keep every new keyframe compliant.
 *
 * The "pinned viewport" is a fixed full-viewport stage (canvas + UI
 * overlay) driven by an invisible 440vh scroll track — functionally a
 * ScrollTrigger pin, but perfectly jitter-free with Lenis on every browser.
 */

import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
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

/* 360° equirectangular panorama — night city across a lake (user-provided).
 * ONE texture drives BOTH the visible backdrop (scene.background) and the
 * image-based lighting (PMREM → scene.environment). */
const ENV_URL = '/environment/night_city_lake_360.jpg'
/** ✏️ Yaw of the panorama (rad). Places the skyline behind the hero camera,
 * the suspension bridge behind the rear shot and the port cranes behind the
 * front close-up. Background & environment rotations stay identical so the
 * paint reflections always match the visible backdrop. */
const ENV_ROTATION_Y = -0.19
/** ✏️ Pitch of the panorama (rad) — nudges the photographic ground plane up
 * under the car so the 3D floor (y = 0) visually coincides with the wet
 * asphalt in the photo. Match on both background & environment.
 * Raise it if the wheels still overlap the quay/water band in the photo;
 * lower it if the skyline towers start clipping the top of the frame. */
const BACKDROP_PITCH_X = 0.06

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
  /** ✏️ optional per-shot DESKTOP lens (vertical FOV, deg). WIDE lens +
   *  close camera = the "0.4× ultra-wide phone zoom" look: the car reads
   *  big in the frame while the 360° city stays clearly visible around it
   *  (narrow zoom crops the city away — never do that). Mobile keeps the
   *  already-wide FOV_MOBILE unless `fovMobile` overrides it. GSAP tweens
   *  this smoothly between shots. */
  fov?: number
  /** ✏️ optional portrait-only lens override (see `fov`). */
  fovMobile?: number
}

/* GROUNDING CHEAT-SHEET — how to keep any new keyframe believable:
 *   • camera height ≥ 1.1 u (2–3 u grounds best — see outro)
 *   • aim the target BELOW the car's mid (y ≈ 0.5–0.65) so the camera
 *     tilts down and the photo's asphalt fills the space under the tires
 *   • stay ≥ 4.5 u away so the wheels + contact shadow remain in frame
 *   • WIDE LENS RULE ("0.4× zoom"): when a shot moves CLOSE to the car,
 *     widen `fov` (60–66) instead of cropping tighter — a wide lens keeps
 *     the 360° city readable around the car; a narrow zoom kills it
 *   • the backdrop behind the car = the panorama direction OPPOSITE the
 *     camera (camera azimuth + 180°). Spread the camera's azimuth per shot
 *     to reveal different parts of the 360° photo as you scroll:
 *        camera azimuth ~145° → backdrop: bridge + skyline     (hero)
 *        camera azimuth ~38°  → backdrop: open water + silos   (front)
 *        camera azimuth ~208° → backdrop: skyline + port cranes (rear)
 *        camera azimuth ~134° → backdrop: bridge + skyline     (outro)
 */
const KEYS = {
  /** 0% — BIG car with the city in the MIDDLE of the background. Camera
   *  pulled IN to d ≈ 4.6 (was 5.8) on a 60° wide lens (the approved
   *  "0.4× zoom" look) and LOWERED to 1.75 u with a NEAR-LEVEL aim
   *  (target y 1.45, pitch ≈ 4°): the photo horizon now sits at ~44% of
   *  the frame — skyline + bridge fill the middle band behind the roof —
   *  instead of hugging the top edge. Grounding is untouched because it
   *  depends on HEIGHT ÷ DISTANCE, not pitch: wheels project ~21° below
   *  the photo horizon = the open lot asphalt ≈ 4 m into the photo.
   *  ✏️ pos[1] (height): raise if wheels ever touch the quay band. */
  hero: { pos: [-3.76, 1.95, 2.65], target: [0, 1.42, 0], mobileF: 1.3, fov: 60 },
  /** state 1 — front 3/4 on the headlights, “0.4× ultra-wide” close-up:
   *  66° lens at d ≈ 4.9 keeps the whole nose + the silo/water district in
   *  frame (the old 45° bumper-zoom cropped the city out entirely).
   *  ✏️ pos[2] (z): bigger → more flank visible, smaller → head-on nose. */
  front: { pos: [5.0, 2.6, 3.85], target: [1.55, 0.42, 0.3], mobileF: 2.0, mobileHeadOn: 0.55, fov: 66 },
  /** state 1.5 — invisible WAYPOINTS that arc the camera around the nose
   *  and the right-rear corner. Without them the front→rear tween would
   *  drive the camera straight THROUGH the body. Wide lenses keep the city
   *  reading during the sweep.
   *  ✏️ keep |x| ≥ 4.5 or |z| ≥ 2.4 so the lens never clips the paint. */
  mid1: { pos: [5.2, 1.5, -2.7], target: [0.6, 0.5, 0], mobileF: 2.0, mobileHeadOn: 0.55, fov: 62 },
  mid2: { pos: [-1.7, 2.1, -4.7], target: [-0.5, 0.45, 0], mobileF: 1.9, mobileHeadOn: 0.6, fov: 64 },
  /** state 2 — rear taillights / diffuser / quad exhaust, 60° wide lens so
   *  the bridge + skyline stay clear above the decklid. Camera returns to
   *  the quay-left side because THAT is where the photo's railing is CLOSE
   *  and the lot asphalt runs right up to the car (the skyline-band
   *  azimuth has a 10 m-wide bright walkway that made every right-side
   *  variant read as hovering). The front→rear journey still sweeps the
   *  panorama ~245° (silos → road → cranes → skyline → bridge), so the
   *  scroll reveals the full 360° even though hero/rear share a district. */
  rear: { pos: [-6.3, 2.5, 3.35], target: [-1.8, 0.52, 0], mobileF: 1.8, mobileHeadOn: 0.5, fov: 60 },
  /** closing wide elevated rear 3/4 for the end card — the user-approved
   *  "parked in the lot" framing (high camera, asphalt all around). */
  outro: { pos: [-6.9, 3.1, 7.2], target: [0, 1.15, 0], mobileF: 1.35 },
} satisfies Record<string, CamKey>

const FOV_DESKTOP = 45
const FOV_MOBILE = 60

/* ═════ 3. PRESENTATION — fully parked, zero drift garnish ═══════════ */

const BASE_YAW = -0.14 // parked angle of the car (rad) — no sway, no smoke:
// a parked car must sit DEAD STILL on its contact patch or the micro-bob
// reads as "floating / just hit something" (user-reported).

/* ══════════════════════════════════════════════════════════════════════
 * Canvas-generated textures — zero network dependencies
 * ══════════════════════════════════════════════════════════════════════ */

/** Dark radial blob painted under the car — a fake ambient-occlusion
 *  contact patch. The photo asphalt under the car is often near-black, so
 *  the real cast shadow alone gives no grounding cue; this soft dark
 *  ellipse (which yaws with the car) anchors the wheels to the ground
 *  without reading as a podium (edges fade to fully transparent). */
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

/** Dark seamless studio vignette used as scene.background — REMOVED:
 * replaced by the 360° lakeside night panorama (ENV_URL). */

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
    envMapIntensity: 1.25, // picks up the night city glow + lake shimmer
  })

const darkGlass = () =>
  new THREE.MeshPhysicalMaterial({
    color: '#06080b',
    metalness: 0.55,
    roughness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.3,
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

type FlatKey = { px: number; py: number; pz: number; tx: number; ty: number; tz: number; fo: number }

/** Flatten a keyframe; on portrait screens the pos→target offset is
 *  scaled by mobileF so the car never clips out of the narrow viewport.
 *  `fo` resolves the per-shot lens — the ultra-wide `fov` values are a
 *  DESKTOP concern (desktop default 45° is narrow); portrait already uses
 *  the wide FOV_MOBILE, so only an explicit `fovMobile` overrides it. */
function flattenKey(k: CamKey, mobile: boolean): FlatKey {
  let [px, py, pz] = k.pos
  const [tx, ty, tz] = k.target
  if (mobile) {
    px = tx + (px - tx) * k.mobileF
    py = ty + (py - ty) * k.mobileF
    pz = tz + (pz - tz) * k.mobileF * (k.mobileHeadOn ?? 1)
  }
  const fo = mobile ? (k.fovMobile ?? FOV_MOBILE) : (k.fov ?? FOV_DESKTOP)
  return { px, py, pz, tx, ty, tz, fo }
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
    renderer.toneMappingExposure = 1.15 // lifts the night IBL without clipping the city lights
    renderer.outputColorSpace = THREE.SRGBColorSpace

    /* ── Scene: lakeside night city — 360° equirect panorama ─────
     * The SAME texture is the visible backdrop and the IBL source
     * (PMREM pre-filter), so the metallic paint reflects exactly the
     * skyline / lake / bridges you see behind the car. */
    const scene = new THREE.Scene()
    renderer.setClearColor(0x04050a, 1) // fallback until the panorama streams in

    scene.backgroundRotation.set(BACKDROP_PITCH_X, ENV_ROTATION_Y, 0)
    scene.environmentRotation.set(BACKDROP_PITCH_X, ENV_ROTATION_Y, 0) // keep reflections aligned

    const pmrem = new THREE.PMREMGenerator(renderer)
    let lakeTex: THREE.Texture | null = null
    let lakeEnvRT: THREE.WebGLRenderTarget | null = null

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
        lakeTex = tex
        scene.background = tex
        scene.backgroundIntensity = 1.0
        lakeEnvRT = pmrem.fromEquirectangular(tex) // roughness-aware reflections
        scene.environment = lakeEnvRT.texture
      },
      undefined,
      (error) => console.warn('[scroll-experience] panorama failed to load:', error),
    )

    /* ── Camera ────────────────────────────────────────────────────── */
    const camera = new THREE.PerspectiveCamera(FOV_DESKTOP, window.innerWidth / window.innerHeight, 0.1, 160)

    /* ── Lights ────────────────────────────────────────────────────── */
    const key = new THREE.SpotLight(0xdfe9ff, 340) // cool night floodlight — casts the contact shadows
    key.position.set(3, 14, 4) // steep angle → tight shadow that hugs the tires
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

    const rim = new THREE.DirectionalLight(0x9fc0ee, 2.4) // moonlit edge light
    rim.position.set(-8, 5, -6)
    scene.add(rim)

    scene.add(new THREE.HemisphereLight(0x27364e, 0x0a0c10, 0.5)) // night sky / asphalt bounce

    /* ── Floor — invisible shadow-catcher ───────────────────────────
     * GROUNDING comes from CAMERA GEOMETRY, not from a visible 3D floor:
     * every keyframe is raised (~1.4–2.2 u) and aimed DOWN at the car so
     * the wheels land BELOW the photo's quay-railing line, on the lot
     * asphalt painted in the panorama. This transparent catcher then adds
     * the real cast shadow that welds the tires to that asphalt.
     * (A visible 3D asphalt disc was tried and removed — it always reads
     * as a podium pasted over the photo's parking lines.)
     * ✏️ If any shot still floats: raise that keyframe's pos[1] and/or
     * lower its target[1] — do NOT grow this catcher into a visible disc. */
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(7, 64),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.62 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)

    /* ── Car root + fake-AO contact blob (model streams in async) ──── */
    const carGroup = new THREE.Group()
    carGroup.rotation.y = BASE_YAW
    scene.add(carGroup)

    // Soft dark ellipse under the footprint (yaws with the car) — the
    // visual anchor that kills the "car is in the air" read on dark asphalt.
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

    /* ── Camera rig state — animated by GSAP, applied every frame ──── */
    const cam: FlatKey = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, fo: FOV_DESKTOP }
    const applyCamera = () => {
      camera.position.set(cam.px, cam.py, cam.pz)
      camera.lookAt(cam.tx, cam.ty, cam.tz) // target tracked every frame
      if (camera.fov !== cam.fo) {
        camera.fov = cam.fo // per-shot lens (tweened by GSAP)
        camera.updateProjectionMatrix()
      }
    }

    /* ── GSAP ScrollTrigger choreography ─────────────────────────────
     * One master timeline, scrubbed by scroll. Positions are expressed in
     * normalized progress units (the whole timeline lasts 1.0).        */
    const buildTimeline = (mobile: boolean) => {
      const K = {
        hero: flattenKey(KEYS.hero, mobile),
        front: flattenKey(KEYS.front, mobile),
        mid1: flattenKey(KEYS.mid1, mobile),
        mid2: flattenKey(KEYS.mid2, mobile),
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

      /* Act II — FRONT → MID1 → MID2 → REAR (0.42 → 0.72): three tweens
       * around the nose and the right-rear corner (never through the body).
       * The sweeping reposition pans the 360° backdrop ~245°: silo district
       * → tree-lined road → port cranes → skyline → back to the bridge. */
      tl.to(cam, { ...K.mid1, duration: 0.1 }, 0.42)
      tl.to(cam, { ...K.mid2, duration: 0.1 }, 0.52)
      tl.to(cam, { ...K.rear, duration: 0.1 }, 0.62)
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
      contactTex.dispose()
      lakeTex?.dispose()
      lakeEnvRT?.dispose()
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
        Invisible scroll track — its height (440vh) is the scroll distance
        ScrollTrigger scrubs the camera timeline through. Fully reversible.
      */}
      <div ref={trackRef} aria-hidden="true" className="h-[440vh]" />

      {/* Fixed 3D stage */}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="3D BMW M5 CS lakeside night inspection — scroll to explore the car"
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
            Illuminated M Laserlights and widened kidneys against the harbour glow.
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
            Blacked-out taillights and quad pipes against the glowing bridge line.
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
