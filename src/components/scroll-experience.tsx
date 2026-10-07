'use client'

/**
 * ═════════════════════════════════════════════════════════════════════════
 * ScrollExperience — scroll-driven 3D inspection of the BMW M5 CS
 * ═════════════════════════════════════════════════════════════════════════
 * Stack: Three.js · GSAP/ScrollTrigger · Lenis
 *
 * The fixed canvas follows an invisible 560vh scroll track. GSAP scrubs one
 * reversible camera timeline through the hero, front, rear, engineering,
 * and closing views; the compact specification readout follows the same
 * scroll progress as the chassis reveal.
 *
 * The studio uses a local environment panorama for reflections, with a
 * procedural fallback, plus restrained softboxes, a neutral cyclorama,
 * subtle floor grain, and contact shadows. The stage keeps the vehicle as
 * the focal point and avoids extra geometry that does not aid inspection.
 *
 * The meshopt-compressed model is streamed with real byte progress, then
 * cached locally when CacheStorage is available. Pixel ratio and shadow-map
 * work are bounded for mobile and constrained devices.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'meshoptimizer/decoder'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import {
  StudioTheme,
  PaintFinish,
  WheelFinish,
  CaliperColor,
  SceneId,
  MMode,
  PAINT_CONFIGS,
  WHEEL_CONFIGS,
  CALIPER_CONFIGS,
  SCENES,
  SPEC_STATS,
  COCKPIT_CALLOUTS,
} from '@/types/configurator'
import type { BuildConfiguration } from '@/lib/build-config'
import {
  BUILD_STORAGE_KEY,
  DEFAULT_BUILD_CONFIGURATION,
  getInitialBuildConfiguration,
  serializeBuildConfiguration,
} from '@/lib/build-config'
import ConfiguratorDock from '@/components/configurator-dock'
import CockpitOverlay from '@/components/cockpit-overlay'
import { useLocale } from '@/components/locale-provider'
import { getSiteCopy } from '@/lib/site-copy'
import { detectWebGL } from '@/lib/webgl-support'
import { buildLocationScene, STUDIO_LIGHTING, type LocationLighting, type LocationScene } from '@/lib/locations'

export type { StudioTheme, PaintFinish, WheelFinish, CaliperColor }
export { PAINT_CONFIGS, WHEEL_CONFIGS, CALIPER_CONFIGS }

/* ═════════════════ 1. MODEL ══════════════════════════════════════════ */

const MODEL_URL = '/models/bmw-m5-cs/scene.min.glb' // CC-BY-4.0 · fvrenbld — meshopt-compressed (3.2 MB)
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
  /** portrait only: a completely separate pose (used when scaling the
   *  desktop offset would not frame the subject sensibly) */
  mobile?: { pos: Vec3; target: Vec3 }
}

const KEYS = {
  /** 0% — wide drifting presentation, slightly high 3/4 iso */
  hero: { pos: [7.2, 2.9, 7.4], target: [0, 0.55, 0], mobileF: 1.35 },
  /** state 1 — dramatic low angle on the front bumper / headlights */
  front: { pos: [4.4, 0.5, 2.1], target: [2.0, 0.52, 0], mobileF: 2.15, mobileHeadOn: 0.45 },
  /** state 2 — rear taillights, diffuser and exhaust, same-side sweep */
  rear: { pos: [-4.3, 0.9, 2.2], target: [-1.9, 0.68, 0], mobileF: 2.0, mobileHeadOn: 0.45 },
  /** state 3 — X-ray: elevated broadside so the whole chassis fits the frame
   *  while the spec panel sits on the right */
  xray: {
    pos: [-0.1, 2.0, 7.9],
    target: [0.95, 0.6, 0],
    mobileF: 1.55,
    // portrait: broadside from further out, car pushed into the top half
    // so the spec strip along the bottom never covers it
    mobile: { pos: [0.3, 2.4, 10.2], target: [0.2, -0.9, 0] },
  },
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

/** One wheel's contact patch — darker and tighter than the body blob */
function makeWheelShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64)
  g.addColorStop(0, 'rgba(0,0,0,0.9)')
  g.addColorStop(0.4, 'rgba(0,0,0,0.55)')
  g.addColorStop(0.75, 'rgba(0,0,0,0.18)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Dark seamless studio vignette used as scene.background */
function makeStudioBackdropTexture(theme: StudioTheme = 'apex'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1024
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(512, 430, 40, 512, 512, 780)
  if (theme === 'm') {
    g.addColorStop(0, '#10162a')
    g.addColorStop(0.48, '#0b0f1c')
    g.addColorStop(1, '#03050a')
  } else if (theme === 'night') {
    g.addColorStop(0, '#0a1524')
    g.addColorStop(0.48, '#060c16')
    g.addColorStop(1, '#020408')
  } else {
    g.addColorStop(0, '#202430')
    g.addColorStop(0.48, '#11131a')
    g.addColorStop(1, '#050608')
  }
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 1024, 1024)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Neutral cyclorama gradient: a quiet background for the car, not a graphic backdrop. */
function makeCycloramaTexture(theme: StudioTheme = 'apex'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 512
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height)

  gradient.addColorStop(0, '#050609')
  gradient.addColorStop(0.52, theme === 'night' ? '#090e14' : '#0b0e12')
  gradient.addColorStop(0.82, theme === 'm' ? '#121821' : theme === 'night' ? '#10151c' : '#17191b')
  gradient.addColorStop(1, '#0c0e11')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Subtle, seamless concrete grain for the studio floor. */
function makeStudioFloorTextures(): { color: THREE.CanvasTexture; roughness: THREE.CanvasTexture } {
  const size = 512
  const colorCanvas = document.createElement('canvas')
  const roughnessCanvas = document.createElement('canvas')
  colorCanvas.width = colorCanvas.height = size
  roughnessCanvas.width = roughnessCanvas.height = size
  const colorCtx = colorCanvas.getContext('2d')!
  const roughnessCtx = roughnessCanvas.getContext('2d')!
  const colorData = colorCtx.createImageData(size, size)
  const roughnessData = roughnessCtx.createImageData(size, size)
  let seed = 0x4d354353
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const broadGrain = (Math.sin(x * 0.035) + Math.sin(y * 0.029) + Math.sin((x + y) * 0.018)) * 1.1
      const grain = (random() - 0.5) * 5 + broadGrain
      colorData.data[i] = Math.max(0, 23 + grain)
      colorData.data[i + 1] = Math.max(0, 25 + grain)
      colorData.data[i + 2] = Math.max(0, 29 + grain)
      colorData.data[i + 3] = 255

      const roughness = 226 + (random() - 0.5) * 26 + Math.abs(broadGrain) * 2
      roughnessData.data[i] = roughness
      roughnessData.data[i + 1] = roughness
      roughnessData.data[i + 2] = roughness
      roughnessData.data[i + 3] = 255
    }
  }

  colorCtx.putImageData(colorData, 0, 0)
  roughnessCtx.putImageData(roughnessData, 0, 0)

  const color = new THREE.CanvasTexture(colorCanvas)
  color.colorSpace = THREE.SRGBColorSpace
  color.wrapS = color.wrapT = THREE.RepeatWrapping
  color.repeat.set(18, 18)

  const roughness = new THREE.CanvasTexture(roughnessCanvas)
  roughness.wrapS = roughness.wrapT = THREE.RepeatWrapping
  roughness.repeat.set(18, 18)
  return { color, roughness }
}

/** Forward laserlight beam projection cast on floor */
function makeHeadlightProjectionTexture(theme: StudioTheme = 'apex'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(80, 128, 10, 260, 128, 240)
  const col =
    theme === 'night'
      ? '160, 215, 255'
      : theme === 'm'
      ? '0, 170, 255'
      : '255, 235, 195'
  g.addColorStop(0, `rgba(${col}, 0.65)`)
  g.addColorStop(0.35, `rgba(${col}, 0.25)`)
  g.addColorStop(0.7, `rgba(${col}, 0.06)`)
  g.addColorStop(1, `rgba(${col}, 0)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 512, 256)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Rear diffuser crimson glow pool cast on floor */
function makeTaillightProjectionTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(432, 128, 10, 252, 128, 240)
  g.addColorStop(0, 'rgba(235, 20, 40, 0.55)')
  g.addColorStop(0.38, 'rgba(200, 15, 30, 0.22)')
  g.addColorStop(0.75, 'rgba(140, 10, 20, 0.05)')
  g.addColorStop(1, 'rgba(80, 0, 10, 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 512, 256)
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

const darkGlass = () =>
  new THREE.MeshPhysicalMaterial({
    color: '#06080b',
    metalness: 0.55,
    roughness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    envMapIntensity: 0.82,
  })

type CarRig = {
  car: THREE.Group
  paintMaterials: THREE.MeshPhysicalMaterial[]
  setHoodOpen: (open: boolean) => void
  setDoorOpen: (open: boolean) => void
  setWheelFinish: (finish: WheelFinish) => void
  setCaliperColor: (color: CaliperColor) => void
  setPaintColor: (paint: PaintFinish) => void
  /** 0 = normal paint, 1 = full wireframe X-ray (body shell fades to a
   *  translucent blue-print, drivetrain + chassis stay lit) */
  setXray: (amount: number) => void
  /** cockpit mode: hides the body shell / glass that would sit between the
   *  driver's-eye camera and the interior, and paints the cluster red */
  setCockpit: (active: boolean, mode: MMode) => void
  /** driver's-eye position in car-local space */
  cockpitEye: THREE.Vector3
}

/* Materials that belong to the drivetrain / chassis — they stay solid during
 * the X-ray so the car reads as "skin removed", not "car removed". */
const XRAY_KEEP = /^(Engineblock|Chassis|Meshesrotor|Hubr|Meshestires|Misca0021|RoundedRectangle|60galFuelTank)/
/* Interior + cabin materials — solid during X-ray, and the ONLY meshes left
 * fully visible while sitting in the cockpit. */
const CABIN = /^(Interior|Seats|Steeringwheel|Needle|Miscdash|Miscseatbelts|Meshpart|Part|VehicleMobilePhoneHolder|LicensePlate1Mtl|Misca1Mtl|Miscb1Mtl|Miscdoorr1Mtl)/
/* Dashboard cluster / dials — get an emissive M-mode tint in the cockpit */
const CLUSTER = /^(Needle|Miscdash)/
/* Dash clutter shipped with the source model (a cartoon figurine and a
 * phone cradle + its bracket parts) — not M5 CS equipment, always hidden. */
const CLUTTER = /^(Minion|VehicleMobilePhoneHolder|Meshpart|Part1Mtl)/
/* Anything tiny (< 20 cm) perched on the dash top at the phone-mount spot
 * (car-local x≈0.55, y≈1.0) is part of that same clutter — caught by
 * position so renamed sub-parts never slip through. */
const CLUTTER_ZONE = { x: [0.42, 0.72], y: [0.9, 1.12], z: [-0.3, -0.05], maxSize: 0.2 }

function makeCarbonFiberTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#101215'
  ctx.fillRect(0, 0, 128, 128)

  // A fine 2×2 twill weave rather than the large checker pattern that made
  // the roof read like a tiled graphic. The low contrast keeps it convincing
  // at the scale of the bodywork and lets the clear coat do the work.
  const cell = 8
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 16; col++) {
      const x = col * cell
      const y = row * cell
      const vertical = ((col + row * 3) % 4) < 2
      const shade = (col + row) % 3 === 0 ? '#24272b' : '#1b1e22'
      const grad = vertical
        ? ctx.createLinearGradient(x, y, x + cell, y)
        : ctx.createLinearGradient(x, y, x, y + cell)
      grad.addColorStop(0, '#111316')
      grad.addColorStop(0.45, shade)
      grad.addColorStop(0.72, '#202327')
      grad.addColorStop(1, '#111316')
      ctx.fillStyle = grad
      ctx.fillRect(x, y, cell, cell)
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      if (vertical) {
        ctx.moveTo(x + 2, y)
        ctx.lineTo(x + 2, y + cell)
      } else {
        ctx.moveTo(x, y + 2)
        ctx.lineTo(x + cell, y + 2)
      }
      ctx.stroke()
    }
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(24, 24)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function inClutterZone(mesh: THREE.Mesh): boolean {
  // mesh is already scaled/positioned inside the normalized model group
  const b = new THREE.Box3().setFromObject(mesh)
  const size = b.getSize(new THREE.Vector3())
  if (Math.max(size.x, size.y, size.z) > CLUTTER_ZONE.maxSize) return false
  const c = b.getCenter(new THREE.Vector3())
  const Z = CLUTTER_ZONE
  return c.x > Z.x[0] && c.x < Z.x[1] && c.y > Z.y[0] && c.y < Z.y[1] && c.z > Z.z[0] && c.z < Z.z[1]
}

/**
 * Normalizes car glTF, creates articulation pivots for hood and doors,
 * and sets up materials for wheels, carbon-ceramic calipers, and carbon fiber.
 */
function buildCarRig(
  source: THREE.Object3D,
  initialPaint: PaintFinish = 'brands-hatch-grey',
  initialWheel: WheelFinish = 'gold-bronze',
  initialCaliper: CaliperColor = 'red'
): CarRig {
  const model = source.clone(true)

  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const scale = TARGET_LENGTH / Math.max(size.x, size.z)
  model.scale.setScalar(scale)
  model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale)
  if (FLIP_MODEL) model.rotation.y = Math.PI

  const car = new THREE.Group()
  car.add(model)
  car.updateMatrixWorld(true)

  const paintMaterials: THREE.MeshPhysicalMaterial[] = []
  const cfg = PAINT_CONFIGS[initialPaint]
  const basePaint = new THREE.MeshPhysicalMaterial({
    color: cfg.hex,
    metalness: cfg.metalness,
    roughness: cfg.roughness,
    clearcoat: cfg.clearcoat,
    clearcoatRoughness: 0.24,
    envMapIntensity: 0.72,
  })

  // Carbon fiber weave material
  const carbonTex = makeCarbonFiberTexture()
  const carbonMat = new THREE.MeshPhysicalMaterial({
    map: carbonTex,
    color: '#15171b',
    roughness: 0.28,
    metalness: 0.35,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.1,
  })

  // Custom wheels material
  const wheelCfg = WHEEL_CONFIGS[initialWheel]
  const wheelMat = new THREE.MeshStandardMaterial({
    color: wheelCfg.hex,
    metalness: wheelCfg.metalness,
    roughness: wheelCfg.roughness,
    envMapIntensity: 0.95,
  })

  // Custom brake calipers material
  const caliperCfg = CALIPER_CONFIGS[initialCaliper]
  const caliperMat = new THREE.MeshStandardMaterial({
    color: caliperCfg.hex,
    metalness: caliperCfg.metalness,
    roughness: caliperCfg.roughness,
    envMapIntensity: 0.9,
  })

  const glass = darkGlass()
  const junk: THREE.Object3D[] = []
  const bonnetMeshes: THREE.Mesh[] = []
  /** every mesh + the material it wears in the normal (non X-ray) state */
  const allMeshes: Array<{ mesh: THREE.Mesh; kind: 'shell' | 'keep' | 'cabin' | 'glass' }> = []

  model.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    obj.castShadow = true
    obj.receiveShadow = false
    {
      const firstMat = Array.isArray(obj.material) ? obj.material[0] : obj.material
      const n = firstMat?.name ?? ''
      if (CLUTTER.test(n) || inClutterZone(obj)) {
        obj.visible = false
        return
      }
      const kind: 'shell' | 'keep' | 'cabin' | 'glass' = GLASS.has(n)
        ? 'glass'
        : XRAY_KEEP.test(n)
        ? 'keep'
        : CABIN.test(n)
        ? 'cabin'
        : 'shell'
      allMeshes.push({ mesh: obj, kind })
    }

    // Identify interactive parts
    if (obj.name === 'Object_4' || obj.name === 'Object_5') {
      bonnetMeshes.push(obj)
    } else if (obj.name === 'Object_73' || obj.name === 'Object_80' || obj.name === 'Object_66') {
      obj.material = wheelMat
      return
    } else if (obj.name === 'Object_74') {
      obj.material = caliperMat
      return
    } else if (obj.name === 'Object_44') {
      // Carbon fiber roof
      obj.material = carbonMat
      return
    }

    const mats = Array.isArray(obj.material) ? [...obj.material] : [obj.material]
    let replaced = false
    for (let i = 0; i < mats.length; i++) {
      const name = mats[i]?.name ?? ''
      if (BODY_PAINT.has(name)) {
        const mat = basePaint.clone()
        mats[i] = mat
        paintMaterials.push(mat)
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

  /* ── X-ray: body shell → translucent wire "blueprint" ─────────────── */
  const xrayWire = new THREE.MeshBasicMaterial({
    color: 0x7fd3ff,
    wireframe: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  })
  const xrayGhost = new THREE.MeshBasicMaterial({
    color: 0x1f6fa8,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
  })
  const keepEmissive = new THREE.Color(0xff7a2a)
  const keepMats = new Set<THREE.MeshStandardMaterial>()
  const originalEmissive = new Map<THREE.MeshStandardMaterial, { c: THREE.Color; i: number }>()
  for (const { mesh, kind } of allMeshes) {
    if (kind !== 'keep') continue
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial
      if (!std.isMeshStandardMaterial) continue
      if (!keepMats.has(std)) {
        keepMats.add(std)
        originalEmissive.set(std, { c: std.emissive.clone(), i: std.emissiveIntensity })
      }
    }
  }
  const shellOriginal = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
  /** shell meshes get a second, wireframe copy drawn over the (fading) paint */
  const wireClones: THREE.Mesh[] = []
  for (const { mesh, kind } of allMeshes) {
    if (kind !== 'shell' && kind !== 'glass') continue
    shellOriginal.set(mesh, mesh.material)
    const clone = new THREE.Mesh(mesh.geometry, xrayWire)
    clone.visible = false
    clone.renderOrder = 5
    clone.castShadow = false
    clone.frustumCulled = mesh.frustumCulled
    mesh.add(clone) // inherits the exact transform
    wireClones.push(clone)
  }
  let xrayLevel = 0
  let cockpitActive = false
  const setXray = (amount: number) => {
    const a = Math.min(1, Math.max(0, amount))
    if (Math.abs(a - xrayLevel) < 0.002) return
    xrayLevel = a
    const on = a > 0.001
    xrayWire.opacity = 0.42 * a
    xrayGhost.opacity = 0.08 * a
    for (const clone of wireClones) clone.visible = on
    for (const { mesh, kind } of allMeshes) {
      if (kind === 'shell' || kind === 'glass') {
        if (cockpitActive) continue
        // paint fades out over the first 60 % of the scan, wire fades in
        const orig = shellOriginal.get(mesh)!
        if (a > 0.6) {
          mesh.material = xrayGhost
          mesh.castShadow = false
        } else {
          mesh.material = orig
          mesh.castShadow = true
          const mats = Array.isArray(orig) ? orig : [orig]
          for (const m of mats) {
            m.transparent = a > 0
            m.opacity = 1 - a / 0.6
            m.depthWrite = a === 0
            m.needsUpdate = false
          }
        }
      }
    }
    for (const std of keepMats) {
      const o = originalEmissive.get(std)!
      std.emissive.copy(o.c).lerp(keepEmissive, a)
      std.emissiveIntensity = o.i + a * 0.55
    }
  }

  /* ── Cockpit: hide the shell so the camera can sit inside ─────────── */
  const clusterMats = new Set<THREE.MeshStandardMaterial>()
  const clusterOriginal = new Map<THREE.MeshStandardMaterial, { c: THREE.Color; i: number }>()
  for (const { mesh } of allMeshes) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial
      if (!std.isMeshStandardMaterial || !CLUSTER.test(std.name ?? '')) continue
      if (!clusterMats.has(std)) {
        clusterMats.add(std)
        clusterOriginal.set(std, { c: std.emissive.clone(), i: std.emissiveIntensity })
      }
    }
  }
  const M_TINT: Record<MMode, { color: number; intensity: number }> = {
    road: { color: 0x6fb4ff, intensity: 0.28 },
    m1: { color: 0xe01818, intensity: 0.6 },
    m2: { color: 0xff5a00, intensity: 0.7 },
  }
  const setCockpit = (active: boolean, mode: MMode) => {
    cockpitActive = active
    for (const { mesh, kind } of allMeshes) {
      if (kind === 'shell' || kind === 'glass') {
        // in the cockpit the roof/pillars/glass are culled from the inside
        // via FrontSide, so the interior stays framed by real bodywork
        mesh.visible = true
        if (kind === 'glass') mesh.visible = !active
      }
    }
    for (const std of clusterMats) {
      const o = clusterOriginal.get(std)!
      if (active) {
        std.emissive.setHex(M_TINT[mode].color)
        std.emissiveIntensity = M_TINT[mode].intensity
      } else {
        std.emissive.copy(o.c)
        std.emissiveIntensity = o.i
      }
    }
  }

  // Driver's eye — measured offline from the decoded GLB: steering wheel rim
  // centre (0.37, 0.77, −0.36), seat back at x≈−0.15. Eye sits behind the
  // wheel at head height on the driver side.
  const cockpitEye = new THREE.Vector3(-0.06, 1.0, -0.36)

  const setHoodOpen = (_open: boolean) => {}
  const setDoorOpen = (_open: boolean) => {}

  const setWheelFinish = (finish: WheelFinish) => {
    const wCfg = WHEEL_CONFIGS[finish]
    wheelMat.color.set(wCfg.hex)
    wheelMat.metalness = wCfg.metalness
    wheelMat.roughness = wCfg.roughness
    wheelMat.needsUpdate = true
  }

  const setCaliperColor = (color: CaliperColor) => {
    const cCfg = CALIPER_CONFIGS[color]
    caliperMat.color.set(cCfg.hex)
    caliperMat.metalness = cCfg.metalness
    caliperMat.roughness = cCfg.roughness
    caliperMat.needsUpdate = true
  }

  const setPaintColor = (p: PaintFinish) => {
    const pCfg = PAINT_CONFIGS[p]
    basePaint.color.set(pCfg.hex)
    basePaint.metalness = pCfg.metalness
    basePaint.roughness = pCfg.roughness
    basePaint.clearcoat = pCfg.clearcoat
    paintMaterials.forEach((m) => {
      m.color.set(pCfg.hex)
      m.metalness = pCfg.metalness
      m.roughness = pCfg.roughness
      m.clearcoat = pCfg.clearcoat
    })
    bonnetMeshes.forEach((mesh) => {
      mesh.material = basePaint
    })
  }

  return {
    car,
    paintMaterials,
    setHoodOpen,
    setDoorOpen,
    setWheelFinish,
    setCaliperColor,
    setPaintColor,
    setXray,
    setCockpit,
    cockpitEye,
  }
}

/**
 * Finds the four wheel-hub XZ positions from the model's own geometry.
 * Vertices that actually touch the ground (y < 6 % of the car height) are
 * almost exclusively tire contact patches; clustered by XZ quadrant their
 * mean IS the hub. This survives merged / misleadingly named meshes — this
 * M5 packs several tires into one "Meshestires" mesh and puts wheel covers
 * under a "door" material — which per-mesh box heuristics do not. Validated
 * offline against the decoded GLB: hubs land within 2 cm of the true axle
 * centers. Falls back to M5 CS proportions when a quadrant comes up empty.
 * Call with the rig STILL UNPARENTED so world space == rig-local space.
 */
function detectWheelHubs(root: THREE.Object3D, size: THREE.Vector3): Array<[number, number]> {
  root.updateMatrixWorld(true)
  const yMax = size.y * 0.06
  const quads = [0, 1, 2, 3].map(() => ({ x: 0, z: 0, n: 0 }))
  const v = new THREE.Vector3()
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.visible) return
    const attr = obj.geometry.getAttribute('position')
    if (!attr) return
    for (let i = 0; i < attr.count; i++) {
      v.fromBufferAttribute(attr, i)
      obj.localToWorld(v)
      if (v.y > yMax) continue
      const q = (v.x > 0 ? 1 : 0) + (v.z > 0 ? 2 : 0)
      const bucket = quads[q]
      bucket.x += v.x
      bucket.z += v.z
      bucket.n++
    }
  })
  const hubs = quads.map((b) => (b.n > 0 ? ([b.x / b.n, b.z / b.n] as [number, number]) : null))
  if (hubs.every((h) => h !== null)) return hubs as Array<[number, number]>
  // Fallback — normalized M5 CS proportions (axles ≈ ±0.30 L, track ≈ ±0.38 W)
  return [
    [-0.3 * size.x, 0.38 * size.z],
    [-0.3 * size.x, -0.38 * size.z],
    [0.3 * size.x, 0.38 * size.z],
    [0.3 * size.x, -0.38 * size.z],
  ]
}

/* ══════════════════════════════════════════════════════════════════════
 * Camera-rig math
 * ══════════════════════════════════════════════════════════════════════ */

type FlatKey = { px: number; py: number; pz: number; tx: number; ty: number; tz: number }

/** 0 → 1 "scan" amount over the X-ray dwell. The camera parks on the
 *  broadside at P.xrayIn; the wireframe reveal + spec counters run from
 *  there to P.xrayScanEnd and hold until the outro pull-back begins
 *  (fading back out over the first part of the outro). */
function xrayAmount(p: number): number {
  const inT = (p - P.xrayIn) / (P.xrayScanEnd - P.xrayIn)
  const outT = (p - P.outroStart) / 0.06
  const a = Math.min(1, Math.max(0, inT))
  const b = 1 - Math.min(1, Math.max(0, outT))
  return Math.min(a, b)
}

/** Flatten a keyframe; on portrait screens the pos→target offset is
 *  scaled by mobileF so the car never clips out of the narrow viewport. */
function flattenKey(k: CamKey, mobile: boolean): FlatKey {
  if (mobile && k.mobile) {
    const [px, py, pz] = k.mobile.pos
    const [tx, ty, tz] = k.mobile.target
    return { px, py, pz, tx, ty, tz }
  }
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
 * Overlay Navigation & Stage Anchors
 * ══════════════════════════════════════════════════════════════════════ */

const NAV_ITEMS = [
  { id: 'overview', labelKey: 'overview' },
  { id: 'performance', labelKey: 'performance' },
  { id: 'design', labelKey: 'design' },
  { id: 'xray', labelKey: 'engineering' },
  { id: 'specs', labelKey: 'specifications' },
] as const

/* ── Scroll-progress map (must match buildTimeline below) ─────────────── */
const P = {
  frontIn: 0.24, // camera reaches the front pose
  rearStart: 0.34,
  rearIn: 0.56,
  xrayStart: 0.66,
  xrayIn: 0.78, // camera parked on the broadside — scan begins
  xrayScanEnd: 0.88, // wireframe fully revealed, counters at 100 %
  outroStart: 0.88,
  outroIn: 1.0,
} as const

type SectionId = (typeof NAV_ITEMS)[number]['id']

async function readModelResponse(
  response: Response,
  reportProgress: (progress: number) => void,
): Promise<ArrayBuffer> {
  if (!response.body) {
    const buffer = await response.arrayBuffer()
    reportProgress(0.94)
    return buffer
  }

  const total = Number(response.headers.get('content-length')) || 0
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value)
    loaded += value.byteLength
    const progress = total > 0
      ? Math.min(0.94, (loaded / total) * 0.94)
      : Math.min(0.9, 0.08 + (1 - Math.exp(-loaded / 420_000)) * 0.82)
    reportProgress(progress)
  }

  const bytes = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  reportProgress(0.94)
  return bytes.buffer
}

/* ══════════════════════════════════════════════════════════════════════
 * Component
 * ══════════════════════════════════════════════════════════════════════ */

export default function ScrollExperience() {
  const { locale, isArabic, toggleLocale } = useLocale()
  const copy = getSiteCopy(locale)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const heroLayerRef = useRef<HTMLDivElement>(null)
  const capFrontRef = useRef<HTMLDivElement>(null)
  const capRearRef = useRef<HTMLDivElement>(null)
  const xrayPanelRef = useRef<HTMLDivElement>(null)
  const endCardRef = useRef<HTMLDivElement>(null)
  const xrayProgressRef = useRef(0)

  const [buildConfiguration, setBuildConfiguration] = useState<BuildConfiguration>(() =>
    getInitialBuildConfiguration(),
  )
  const { theme, highBeams, paint, wheelFinish, caliperColor, sceneId } = buildConfiguration
  const [hoodOpen, setHoodOpen] = useState(false)
  const [doorOpen, setDoorOpen] = useState(false)
  const [orbitMode, setOrbitMode] = useState(false)
  const [activeSection, setActiveSection] = useState<SectionId>('overview')
  const activeSectionRef = useRef<SectionId>('overview')
  const [showBookingModal, setShowBookingModal] = useState(false)
  const bookingDialogRef = useRef<HTMLDivElement>(null)
  const bookingTriggerRef = useRef<HTMLButtonElement>(null)
  const [shareMessage, setShareMessage] = useState('')
  const [modelStatus, setModelStatus] = useState<{ phase: 'loading' | 'ready' | 'error'; progress: number; message?: string }>({
    phase: 'loading',
    progress: 0,
  })
  const initialSceneRef = useRef<SceneId>(sceneId)
  const lastRenderedXrayProgressRef = useRef(-1)
  const [cockpitMode, setCockpitMode] = useState(false)
  const [xrayValues, setXrayValues] = useState<number[]>(() => SPEC_STATS.map(() => 0))
  /** Set when the 3D stage cannot start (no WebGL, or init threw). Renders a
   *  readable fallback instead of letting the error unmount the whole app.
   *
   *  WebGL is probed in the lazy initialiser (i.e. during render, not in an
   *  effect) so we never even mount the canvas on a device that cannot drive
   *  it — `new THREE.WebGLRenderer()` throws in that case, and an uncaught
   *  throw inside the init effect tears down the whole React root. */
  const [stageError, setStageError] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null // SSR: let the client decide
    const support = detectWebGL()
    if (support.ok) return null
    console.error('[scroll-experience] WebGL unavailable:', support.reason)
    return support.reason
  })

  const scrollProgressRef = useRef(0)
  const lenisInstanceRef = useRef<Lenis | null>(null)
  const updateThemeRef = useRef<((theme: StudioTheme, highBeams: boolean) => void) | null>(null)
  const updatePaintRef = useRef<((p: PaintFinish) => void) | null>(null)
  const updateWheelRef = useRef<((w: WheelFinish) => void) | null>(null)
  const updateCaliperRef = useRef<((c: CaliperColor) => void) | null>(null)
  const toggleHoodRef = useRef<((open: boolean) => void) | null>(null)
  const toggleDoorRef = useRef<((open: boolean) => void) | null>(null)
  const toggleOrbitRef = useRef<((active: boolean) => void) | null>(null)
  const setSceneRef = useRef<((id: SceneId) => void) | null>(null)
  const toggleCockpitRef = useRef<((active: boolean, mode: MMode) => void) | null>(null)
  const shareTimerRef = useRef<number | null>(null)
  const mouseRef = useRef({ x: 0, y: 0, targetX: 0, targetY: 0 })

  const scrollToSection = useCallback((section: SectionId) => {
    const track = trackRef.current
    if (!track) return
    const maxScroll = track.offsetHeight - window.innerHeight
    let target = 0
    if (section === 'overview') target = 0
    else if (section === 'performance') target = maxScroll * 0.27
    else if (section === 'design') target = maxScroll * 0.59
    else if (section === 'xray') target = maxScroll * 0.79
    else if (section === 'specs') target = maxScroll * 0.85

    if (lenisInstanceRef.current) {
      lenisInstanceRef.current.scrollTo(target, { duration: 1.2 })
    } else {
      window.scrollTo({ top: target, behavior: 'smooth' })
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(BUILD_STORAGE_KEY, JSON.stringify(buildConfiguration))
    } catch {
      // Storage may be unavailable in private browsing; the in-memory build still works.
    }
  }, [buildConfiguration])

  useEffect(() => () => {
    if (shareTimerRef.current !== null) window.clearTimeout(shareTimerRef.current)
  }, [])

  useEffect(() => {
    if (!showBookingModal) return

    const dialog = bookingDialogRef.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const focusableElements = () =>
      Array.from(dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter(
        (element) => element.offsetParent !== null,
      )

    dialog?.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus()
    document.body.style.overflow = 'hidden'
    lenisInstanceRef.current?.stop()

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setShowBookingModal(false)
        return
      }
      if (event.key !== 'Tab') return

      const elements = focusableElements()
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (!first || !last) {
        event.preventDefault()
        dialog?.focus()
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleDialogKeyDown)
    return () => {
      document.removeEventListener('keydown', handleDialogKeyDown)
      document.body.style.overflow = previousOverflow
      lenisInstanceRef.current?.start()
      bookingTriggerRef.current?.focus()
    }
  }, [showBookingModal])

  const handleThemeChange = useCallback((newTheme: StudioTheme) => {
    setBuildConfiguration((current) => ({ ...current, theme: newTheme }))
    updateThemeRef.current?.(newTheme, buildConfiguration.highBeams)
  }, [buildConfiguration.highBeams])

  const toggleHighBeams = useCallback(() => {
    setBuildConfiguration((current) => {
      const next = !current.highBeams
      updateThemeRef.current?.(current.theme, next)
      return { ...current, highBeams: next }
    })
  }, [])

  const handlePaintChange = useCallback((finish: PaintFinish) => {
    setBuildConfiguration((current) => ({ ...current, paint: finish }))
    updatePaintRef.current?.(finish)
  }, [])

  const handleWheelChange = useCallback((finish: WheelFinish) => {
    setBuildConfiguration((current) => ({ ...current, wheelFinish: finish }))
    updateWheelRef.current?.(finish)
  }, [])

  const handleCaliperChange = useCallback((color: CaliperColor) => {
    setBuildConfiguration((current) => ({ ...current, caliperColor: color }))
    updateCaliperRef.current?.(color)
  }, [])

  const handleToggleHood = useCallback(() => {
    setHoodOpen((prev) => {
      const next = !prev
      toggleHoodRef.current?.(next)
      return next
    })
  }, [])

  const handleToggleDoor = useCallback(() => {
    setDoorOpen((prev) => {
      const next = !prev
      toggleDoorRef.current?.(next)
      return next
    })
  }, [])

  const handleOrbitToggle = useCallback(() => {
    setCockpitMode(false)
    toggleCockpitRef.current?.(false, 'road')
    setOrbitMode((prev) => {
      const next = !prev
      toggleOrbitRef.current?.(next)
      return next
    })
  }, [])

  const handleSceneChange = useCallback((id: SceneId) => {
    setBuildConfiguration((current) => ({ ...current, sceneId: id }))
    setSceneRef.current?.(id)
  }, [])

  const handleShareBuild = useCallback(async () => {
    const url = new URL(window.location.href)
    url.search = serializeBuildConfiguration(buildConfiguration)
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)

    try {
      await navigator.clipboard.writeText(url.toString())
      setShareMessage(copy.buildLinkCopied)
    } catch {
      setShareMessage(copy.buildLinkReady)
    }

    if (shareTimerRef.current !== null) window.clearTimeout(shareTimerRef.current)
    shareTimerRef.current = window.setTimeout(() => setShareMessage(''), 2200)
  }, [buildConfiguration, copy.buildLinkCopied, copy.buildLinkReady])

  const handleResetBuild = useCallback(() => {
    setBuildConfiguration({ ...DEFAULT_BUILD_CONFIGURATION })
    updateThemeRef.current?.(DEFAULT_BUILD_CONFIGURATION.theme, DEFAULT_BUILD_CONFIGURATION.highBeams)
    updatePaintRef.current?.(DEFAULT_BUILD_CONFIGURATION.paint)
    updateWheelRef.current?.(DEFAULT_BUILD_CONFIGURATION.wheelFinish)
    updateCaliperRef.current?.(DEFAULT_BUILD_CONFIGURATION.caliperColor)
    setSceneRef.current?.(DEFAULT_BUILD_CONFIGURATION.sceneId)
    setOrbitMode(false)
    toggleOrbitRef.current?.(false)
    setCockpitMode(false)
    toggleCockpitRef.current?.(false, 'road')
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.hash}`)
  }, [])

  const handleCockpitToggle = useCallback(() => {
    setCockpitMode((prev) => {
      const next = !prev
      if (next) {
        setOrbitMode(false)
        toggleOrbitRef.current?.(false)
      }
      toggleCockpitRef.current?.(next, 'road')
      return next
    })
  }, [])

  const updateXrayReadout = (progress: number) => {
    const previous = lastRenderedXrayProgressRef.current
    if (progress > 0.001 && progress < 0.999 && Math.abs(progress - previous) < 0.04) return
    if (progress <= 0.001 && previous <= 0.001) return
    if (progress >= 0.999 && previous >= 0.999) return

    lastRenderedXrayProgressRef.current = progress
    setXrayValues(
      SPEC_STATS.map((stat, index) => {
        const start = index * 0.08
        const t = Math.min(1, Math.max(0, (progress - start) / (1 - start)))
        if (t >= 0.9) return stat.value
        const eased = 1 - Math.pow(1 - t, 3)
        return stat.value * eased
      }),
    )
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const track = trackRef.current
    const heroLayer = heroLayerRef.current
    const capFront = capFrontRef.current
    const capRear = capRearRef.current
    const endCard = endCardRef.current
    const xrayPanel = xrayPanelRef.current
    if (
      !canvas ||
      !track ||
      !heroLayer ||
      !capFront ||
      !capRear ||
      !endCard ||
      !xrayPanel
    )
      return

    /* ── Fail-safe boot ────────────────────────────────────────────────
     * Everything below (WebGLRenderer, PMREM, procedural scene build,
     * GSAP/Lenis wiring) runs synchronously inside this effect. A throw here
     * used to propagate out of the effect, which makes React unmount the
     * entire root: the page went blank and the "Loading M5 CS Experience"
     * splash in app/page.tsx never got replaced.
     *
     * WebGL itself is probed during render (see `stageError` above), so by
     * the time we get here a context is obtainable. Everything else still
     * runs inside try/catch and surfaces a readable fallback rather than
     * taking the page down with it.
     * ------------------------------------------------------------------ */
    let teardown: (() => void) | null = null

    try {
      teardown = (() => {
    let disposed = false
    let modelRequestController: AbortController | null = null
    gsap.registerPlugin(ScrollTrigger)

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
    const cores = nav.hardwareConcurrency ?? 4
    const memory = nav.deviceMemory ?? 4
    const lowEndDevice = memory <= 2 || cores <= 2 || nav.connection?.saveData === true
    const constrainedDevice = lowEndDevice || memory <= 4 || cores <= 4
    const getPixelRatio = () =>
      Math.min(
        window.devicePixelRatio || 1,
        lowEndDevice ? 1.05 : window.innerWidth < 768 ? 1.25 : constrainedDevice ? 1.35 : 1.6,
      )

    /* ── Renderer ──────────────────────────────────────────────────── */
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(getPixelRatio())
    renderer.setSize(window.innerWidth, window.innerHeight, false)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.autoUpdate = false
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.95
    renderer.outputColorSpace = THREE.SRGBColorSpace

    /* ── Scene: local studio environment with a procedural fallback ──── */
    const scene = new THREE.Scene()
    const backdropTex = makeStudioBackdropTexture()
    scene.background = backdropTex
    scene.fog = new THREE.FogExp2(0x050608, 0.018) // thin enough for the cyclorama to read, thick enough to hide the floor rim

    // A small, locally hosted studio panorama gives the paint and glass
    // recognizable photographic reflections. Keep a procedural fallback for
    // offline loads and browsers that cannot decode the environment image.
    const pmrem = new THREE.PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    const envTex = pmrem.fromScene(room, 0.04).texture
    let studioEnvTarget: THREE.WebGLRenderTarget | null = null
    scene.environment = envTex
    ;(room as unknown as { dispose?: () => void }).dispose?.()
    new THREE.TextureLoader().load(
      '/textures/studio_360.jpg',
        (texture) => {
          if (disposed) {
            texture.dispose()
            return
          }
          texture.mapping = THREE.EquirectangularReflectionMapping
        texture.colorSpace = THREE.SRGBColorSpace
        try {
          const target = pmrem.fromEquirectangular(texture)
          texture.dispose()
          if (disposed) {
            target.dispose()
            return
          }
          studioEnvTarget = target
          if (!activeLocation) scene.environment = target.texture
        } catch (error) {
          texture.dispose()
          console.warn('[scroll-experience] studio environment could not be prepared:', error)
        }
      },
      undefined,
      () => console.warn('[scroll-experience] studio environment image could not be loaded'),
    )

    /* ── Camera and restrained studio light rig ─────────────────────── */
    const camera = new THREE.PerspectiveCamera(FOV_DESKTOP, window.innerWidth / window.innerHeight, 0.1, 160)

    const key = new THREE.SpotLight(0xfff2e4, 190)
    key.position.set(7, 9, 5)
    key.angle = 0.58
    key.penumbra = 0.65
    key.decay = 2
    key.castShadow = true
    const shadowMapSize = lowEndDevice || window.innerWidth < 768 ? 1024 : constrainedDevice ? 1280 : 1536
    key.shadow.mapSize.set(shadowMapSize, shadowMapSize)
    key.shadow.radius = 3
    key.shadow.bias = -0.0002
    key.shadow.normalBias = 0.02
    key.shadow.camera.near = 3
    key.shadow.camera.far = 30
    key.target.position.set(0, 0.5, 0)
    scene.add(key, key.target)

    const rim = new THREE.DirectionalLight(0xc5d0dd, 1.15)
    rim.position.set(-8, 5, -6)
    scene.add(rim)

    const hemi = new THREE.HemisphereLight(0x4a5260, 0x101216, 0.48)
    scene.add(hemi)

    /* The studio keeps only the surfaces needed to shape clean reflections. */
    const studio = new THREE.Group()
    scene.add(studio)

    const canopy = new THREE.Group()
    canopy.position.y = 5.4
    studio.add(canopy)
    const diffuserMat = new THREE.MeshBasicMaterial({ color: 0xf2f1ec, side: THREE.DoubleSide })
    for (const [z, width] of [[0, 2.0], [-2.6, 0.75], [2.6, 0.75]] as const) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(14, width), diffuserMat)
      panel.rotation.x = Math.PI / 2
      panel.position.z = z
      canopy.add(panel)
    }

    /* ── Cyclorama — neutral, continuous studio backdrop ─────────────── */
    const cyclorama = new THREE.Mesh(
      new THREE.CylinderGeometry(46, 46, 24, 72, 1, true),
      new THREE.MeshBasicMaterial({ map: makeCycloramaTexture('apex'), side: THREE.BackSide }),
    )
    cyclorama.position.y = 12
    studio.add(cyclorama)

    /* ── Studio floor: dark sealed concrete, not a decorative calibration grid ── */
    const floorTextures = makeStudioFloorTextures()
    floorTextures.color.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    floorTextures.roughness.anisotropy = floorTextures.color.anisotropy
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(90, 96),
      new THREE.MeshStandardMaterial({
        map: floorTextures.color,
        roughnessMap: floorTextures.roughness,
        roughness: 0.78,
        metalness: 0.08,
        envMapIntensity: 0.2,
      }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    studio.add(floor)

    /* ── Car root + contact shadows + dynamic automotive projections ─ */
    const carGroup = new THREE.Group()
    carGroup.rotation.y = BASE_YAW
    scene.add(carGroup)

    // Forward Laserlight floor beam projection
    const headlightTex = makeHeadlightProjectionTexture('apex')
    const headlightBeam = new THREE.Mesh(
      new THREE.PlaneGeometry(7.5, 4.4),
      new THREE.MeshBasicMaterial({
        map: headlightTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.82,
      }),
    )
    headlightBeam.rotation.x = -Math.PI / 2
    headlightBeam.position.set(4.6, 0.014, 0)
    headlightBeam.renderOrder = 2
    carGroup.add(headlightBeam)

    // Rear diffuser crimson glow pool
    const taillightTex = makeTaillightProjectionTexture()
    const taillightBeam = new THREE.Mesh(
      new THREE.PlaneGeometry(6.2, 3.8),
      new THREE.MeshBasicMaterial({
        map: taillightTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.72,
      }),
    )
    taillightBeam.rotation.x = -Math.PI / 2
    taillightBeam.position.set(-4.2, 0.014, 0)
    taillightBeam.renderOrder = 2
    carGroup.add(taillightBeam)

    // Body AO contact shadow
    const contactTex = makeContactShadowTexture()
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(TARGET_LENGTH * 1.22, TARGET_LENGTH * 0.56),
      new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false, opacity: 0.52 }),
    )
    contact.rotation.x = -Math.PI / 2
    contact.position.y = 0.014
    contact.renderOrder = 1
    carGroup.add(contact)

    /* ── Real-Time Theme Transition Handler ────────────────────────── */
    let currentTheme: StudioTheme = 'apex'
    let currentHighBeams = true
    let activeLocation: LocationScene | null = null
    let studioBackdrop: THREE.Texture = backdropTex
    const applyTheme = (t: StudioTheme, hb: boolean) => {
      currentTheme = t
      currentHighBeams = hb
      studioBackdrop.dispose()
      const newBackdrop = makeStudioBackdropTexture(t)
      studioBackdrop = newBackdrop
      if (!activeLocation) scene.background = newBackdrop

      const curCyMap = (cyclorama.material as THREE.MeshBasicMaterial).map
      curCyMap?.dispose()
      ;(cyclorama.material as THREE.MeshBasicMaterial).map = makeCycloramaTexture(t)
      ;(cyclorama.material as THREE.MeshBasicMaterial).needsUpdate = true

      if (t === 'm') {
        diffuserMat.color.setHex(0xe4ebf4)
      } else if (t === 'night') {
        diffuserMat.color.setHex(0xdbe3eb)
      } else {
        diffuserMat.color.setHex(0xf2f1ec)
      }
      if (!activeLocation) {
        if (t === 'm') {
          key.color.setHex(0xeaf5ff)
          rim.color.setHex(0x009ada)
        } else if (t === 'night') {
          key.color.setHex(0xd0e6ff)
          rim.color.setHex(0x2860a8)
        } else {
          key.color.setHex(0xfff1dd)
          rim.color.setHex(0xbfd0e8)
        }
      }

      headlightBeam.material.map?.dispose()
      headlightBeam.material.map = makeHeadlightProjectionTexture(t)
      headlightBeam.material.needsUpdate = true
      applyBeams()
    }
    updateThemeRef.current = applyTheme

    const applyBeams = () => {
      const scale = activeLocation ? activeLocation.lighting.beamScale : 1
      headlightBeam.material.opacity = (currentHighBeams ? 0.85 : 0.15) * scale
      taillightBeam.material.opacity = (currentHighBeams ? 0.75 : 0.15) * scale
    }

    /* ── Location switcher ─────────────────────────────────────────────
     * The car, its contact shadows and the shared 3-light rig stay; the
     * studio group is hidden and a procedural environment takes its place.
     * Light colours / intensities / fog / exposure are tweened so the swap
     * reads as a cut-with-crossfade rather than a hard pop. */
    const lightTweens: gsap.core.Tween[] = []
    const applyLighting = (L: LocationLighting, instant = false) => {
      for (const tw of lightTweens) tw.kill()
      lightTweens.length = 0
      const fog = scene.fog as THREE.FogExp2
      const kc = new THREE.Color(L.key.color)
      const rc = new THREE.Color(L.rim.color)
      const hs = new THREE.Color(L.hemi.sky)
      const hg = new THREE.Color(L.hemi.ground)
      const fc = new THREE.Color(L.fog.color)
      if (instant) {
        key.color.copy(kc)
        key.intensity = L.key.intensity
        key.position.set(L.key.position[0], L.key.position[1], L.key.position[2])
        rim.color.copy(rc)
        rim.intensity = L.rim.intensity
        rim.position.set(L.rim.position[0], L.rim.position[1], L.rim.position[2])
        hemi.color.copy(hs)
        hemi.groundColor.copy(hg)
        hemi.intensity = L.hemi.intensity
        fog.color.copy(fc)
        fog.density = L.fog.density
        renderer.toneMappingExposure = L.exposure
        scene.environmentIntensity = L.environmentIntensity
        if (L.shadow) {
          if (L.shadow.angle !== undefined) key.angle = L.shadow.angle
          if (L.shadow.penumbra !== undefined) key.penumbra = L.shadow.penumbra
          if (L.shadow.near !== undefined) key.shadow.camera.near = L.shadow.near
          if (L.shadow.far !== undefined) key.shadow.camera.far = L.shadow.far
          if (L.shadow.mapSize) key.shadow.mapSize.set(L.shadow.mapSize, L.shadow.mapSize)
          key.shadow.camera.updateProjectionMatrix()
        }
        renderer.shadowMap.needsUpdate = true
        return
      }
      if (L.shadow) {
        // outdoor locations need a wider, longer shadow frustum than the cove
        if (L.shadow.angle !== undefined) key.angle = L.shadow.angle
        if (L.shadow.penumbra !== undefined) key.penumbra = L.shadow.penumbra
        if (L.shadow.near !== undefined) key.shadow.camera.near = L.shadow.near
        if (L.shadow.far !== undefined) key.shadow.camera.far = L.shadow.far
        if (L.shadow.mapSize) key.shadow.mapSize.set(L.shadow.mapSize, L.shadow.mapSize)
        key.shadow.camera.updateProjectionMatrix()
      }
      const d = 0.9
      const ease = 'power2.inOut'
      lightTweens.push(
        gsap.to(key.color, { r: kc.r, g: kc.g, b: kc.b, duration: d, ease }),
        gsap.to(key, { intensity: L.key.intensity, duration: d, ease }),
        gsap.to(key.position, {
          x: L.key.position[0], y: L.key.position[1], z: L.key.position[2], duration: d, ease,
          onUpdate: () => { renderer.shadowMap.needsUpdate = true },
        }),
        gsap.to(rim.color, { r: rc.r, g: rc.g, b: rc.b, duration: d, ease }),
        gsap.to(rim, { intensity: L.rim.intensity, duration: d, ease }),
        gsap.to(rim.position, { x: L.rim.position[0], y: L.rim.position[1], z: L.rim.position[2], duration: d, ease }),
        gsap.to(hemi.color, { r: hs.r, g: hs.g, b: hs.b, duration: d, ease }),
        gsap.to(hemi.groundColor, { r: hg.r, g: hg.g, b: hg.b, duration: d, ease }),
        gsap.to(hemi, { intensity: L.hemi.intensity, duration: d, ease }),
        gsap.to(fog.color, { r: fc.r, g: fc.g, b: fc.b, duration: d, ease }),
        gsap.to(fog, { density: L.fog.density, duration: d, ease }),
        gsap.to(renderer, { toneMappingExposure: L.exposure, duration: d, ease }),
        gsap.to(scene, { environmentIntensity: L.environmentIntensity, duration: d, ease }),
      )
    }
    /* Locations ship an equirectangular sky. Baking it into scene.environment
     * means paint, glass and water reflect the place the car is parked in
     * instead of the neutral studio probe — the cheapest "this is a real
     * location" trick in the whole project. */
    let locationEnv: THREE.WebGLRenderTarget | null = null
    const applyEnvironment = (next: LocationScene | null) => {
      if (locationEnv) {
        // the whole target goes, not just its texture — a bare texture dispose
        // leaves the render target behind on every location switch
        locationEnv.dispose()
        locationEnv = null
      }
      if (next?.environment) {
        try {
          locationEnv = pmrem.fromEquirectangular(next.environment as THREE.Texture)
          scene.environment = locationEnv.texture
        } catch {
          scene.environment = studioEnvTarget?.texture ?? envTex
        }
      } else {
        scene.environment = studioEnvTarget?.texture ?? envTex
      }
    }

    let locationRequestSequence = 0
    let requestedLocationId: SceneId | null = null
    const setLocation = async (id: SceneId, instant = false) => {
      if (requestedLocationId === id) return
      // Clicking the currently active location cancels an in-flight swap.
      const requestId = ++locationRequestSequence
      requestedLocationId = id
      if ((activeLocation?.id ?? 'studio') === id) {
        requestedLocationId = null
        return
      }

      const mobile = window.innerWidth < 768
      let next: LocationScene | null = null
      try {
        next = await buildLocationScene(id, { mobile })
      } catch (err) {
        if (disposed || requestId !== locationRequestSequence) return
        requestedLocationId = null
        const fallbackId = activeLocation?.id ?? 'studio'
        setBuildConfiguration((current) => ({ ...current, sceneId: fallbackId }))
        console.warn('[scroll-experience] location build failed; keeping the current environment:', err)
        return
      }

      if (disposed || requestId !== locationRequestSequence) {
        next?.dispose()
        return
      }
      requestedLocationId = null

      if (activeLocation) {
        scene.remove(activeLocation.group)
        activeLocation.dispose()
        activeLocation = null
      }
      activeLocation = next
      studio.visible = !next
      if (next) {
        scene.add(next.group)
        scene.background = next.background
        applyEnvironment(next)
        applyLighting(next.lighting, instant)
      } else {
        scene.background = studioBackdrop
        applyEnvironment(null)
        applyLighting(STUDIO_LIGHTING, instant)
        applyTheme(currentTheme, currentHighBeams)
      }
      applyBeams()
      if (!instant) {
        gsap.fromTo(canvas, { opacity: 0.15 }, { opacity: 1, duration: 0.7, ease: 'power2.out' })
      }
    }
    setSceneRef.current = (id: SceneId) => setLocation(id, false)

    // Restore a saved/shared location after the default studio has mounted.
    const initialLocation = initialSceneRef.current
    if (initialLocation !== 'studio') {
      void setLocation(initialLocation, true)
    }

    let carRig: CarRig | null = null
    let xrayShadowMode = true

    const cockpitState = {
      active: false,
      mode: 'road' as MMode,
      /** 0 → 1 transition (outside → seated) */
      t: 0,
      yaw: 0.08, // look slightly right toward the centre console
      pitch: -0.08,
      targetYaw: 0.08,
      targetPitch: -0.08,
      isDragging: false,
      lastX: 0,
      lastY: 0,
      // world-space snapshot of where the camera was when we got in
      fromPos: new THREE.Vector3(),
      fromLook: new THREE.Vector3(),
      // through-the-window waypoint (world space)
      via: new THREE.Vector3(),
    }

    const applyPaint = (finish: PaintFinish) => {
      const cfg = PAINT_CONFIGS[finish]
      if (carRig) {
        for (const mat of carRig.paintMaterials) {
          mat.color.set(cfg.hex)
          mat.roughness = cfg.roughness
          mat.metalness = cfg.metalness
          mat.clearcoat = cfg.clearcoat
          mat.needsUpdate = true
        }
      }
    }
    updatePaintRef.current = applyPaint

    /* ── Stream the GLB and report actual download progress ────────── */
    ;(async () => {
      const controller = new AbortController()
      modelRequestController = controller

      const reportProgress = (progress: number, message: string) => {
        if (disposed) return
        setModelStatus({ phase: 'loading', progress: Math.min(0.99, Math.max(0, progress)), message })
      }

      try {
        let arrayBuffer: ArrayBuffer | null = null
        let cache: Cache | null = null

        if ('caches' in window) {
          try {
            cache = await window.caches.open('bmw-m5-cs-cache-v2')
            const match = await cache.match(MODEL_URL)
            if (match) {
              arrayBuffer = await match.arrayBuffer()
              reportProgress(0.94, 'Using the saved vehicle model')
            }
          } catch {
            // CacheStorage is an optimization, never a requirement.
            cache = null
          }
        }

        if (!arrayBuffer) {
          const response = await fetch(MODEL_URL, { signal: controller.signal })
          if (!response.ok) throw new Error(`Vehicle model request failed (HTTP ${response.status}).`)
          if (cache) void cache.put(MODEL_URL, response.clone()).catch(() => {})
          arrayBuffer = await readModelResponse(response, (progress) => {
            reportProgress(progress, 'Downloading vehicle geometry')
          })
        }

        if (disposed) return
        reportProgress(0.96, 'Preparing 3D materials')

        const loader = new GLTFLoader()
        loader.setMeshoptDecoder(MeshoptDecoder)
        const gltf = await loader.parseAsync(arrayBuffer, '')
        if (disposed) return
        reportProgress(0.98, 'Fitting the car to the studio')

        carRig = buildCarRig(gltf.scene, paint, wheelFinish, caliperColor)

        updatePaintRef.current = (newPaint: PaintFinish) => {
          carRig?.setPaintColor(newPaint)
        }
        updateWheelRef.current = (newWheel: WheelFinish) => {
          carRig?.setWheelFinish(newWheel)
        }
        updateCaliperRef.current = (newCaliper: CaliperColor) => {
          carRig?.setCaliperColor(newCaliper)
        }
        toggleHoodRef.current = (open: boolean) => {
          carRig?.setHoodOpen(open)
        }
        toggleDoorRef.current = (open: boolean) => {
          carRig?.setDoorOpen(open)
        }

        // Measure + detect BEFORE parenting: Box3.setFromObject() works in
        // WORLD space, so measuring inside the yawed carGroup bakes BASE_YAW
        // into the footprint. Rig unparented ⇒ world == rig-local space.
        const footprint = new THREE.Box3().setFromObject(carRig.car)
        const carSize = footprint.getSize(new THREE.Vector3())
        const hubs = detectWheelHubs(carRig.car, carSize)

        carRig.car.position.y = 0
        carGroup.add(carRig.car)
        contact.geometry.dispose()
        contact.geometry = new THREE.PlaneGeometry(carSize.x * 1.02, carSize.z * 1.18)

        const wheelTex = makeWheelShadowTexture()
        const wheelShadowMat = new THREE.MeshBasicMaterial({
          map: wheelTex,
          transparent: true,
          depthWrite: false,
          opacity: 0.78,
        })
        for (const [wx, wz] of hubs) {
          const patch = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), wheelShadowMat)
          patch.rotation.x = -Math.PI / 2
          patch.position.set(wx, 0.011, wz)
          patch.renderOrder = 1
          carGroup.add(patch)
        }

        carRig.setXray(xrayProgressRef.current)
        if (cockpitState.active) carRig.setCockpit(true, cockpitState.mode)
        renderer.shadowMap.needsUpdate = true
        setModelStatus({ phase: 'ready', progress: 1 })
      } catch (err) {
        if (disposed || controller.signal.aborted) return
        const message = err instanceof Error ? err.message : 'The vehicle model could not be prepared.'
        console.warn('[scroll-experience] car model failed to load:', err)
        setModelStatus({ phase: 'error', progress: 0, message })
      }
    })()

    /* ── Camera rig state — animated by GSAP or Orbit Drag ─────────── */
    const cam: FlatKey = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 }
    let frameDt = 1 / 60 // seconds since last tick (set in tick)

    let isOrbitActive = false

    const orbitState = {
      theta: Math.PI * 0.28,
      phi: Math.PI * 0.38,
      radius: 7.2,
      targetRadius: 7.2,
      targetTheta: Math.PI * 0.28,
      targetPhi: Math.PI * 0.38,
      isDragging: false,
      lastX: 0,
      lastY: 0,
    }

    /* ── Cockpit ("Get in") — camera flies through the driver's window to
     *    the eye point, then drag looks around from a fixed head position ── */
    let cockpitTween: gsap.core.Tween | null = null
    const calloutEls = new Map<string, HTMLElement>()
    for (const c of COCKPIT_CALLOUTS) {
      const el = document.getElementById(`cockpit-callout-${c.id}`)
      if (el) calloutEls.set(c.id, el)
    }
    let calloutsShown = false
    const cockpitEyeWorld = new THREE.Vector3()
    const cockpitLookWorld = new THREE.Vector3()
    const tmpV = new THREE.Vector3()
    const tmpA = new THREE.Vector3()
    const tmpB = new THREE.Vector3()
    const curveOut = new THREE.Vector3()

    toggleCockpitRef.current = (active: boolean, mode: MMode) => {
      cockpitState.mode = mode
      if (active === cockpitState.active) {
        if (active) carRig?.setCockpit(true, mode)
        return
      }
      cockpitState.active = active
      cockpitTween?.kill()
      if (active) {
        cockpitState.fromPos.copy(camera.position)
        camera.getWorldDirection(tmpV)
        cockpitState.fromLook.copy(camera.position).addScaledVector(tmpV, 4)
        // driver's door waypoint: 1.6 m out from the B-pillar on the driver side
        cockpitState.via.set(0.15, 1.15, -2.3).applyAxisAngle(new THREE.Vector3(0, 1, 0), BASE_YAW)
        cockpitState.targetYaw = 0.08
        cockpitState.targetPitch = -0.08
        cockpitState.yaw = 0.55 // start looking toward the wheel as we slide in
        cockpitState.pitch = -0.2
        carRig?.setCockpit(true, mode)
        camera.near = 0.03
        camera.updateProjectionMatrix()
        cockpitTween = gsap.to(cockpitState, { t: 1, duration: 1.7, ease: 'power3.inOut' })
      } else {
        cockpitTween = gsap.to(cockpitState, {
          t: 0,
          duration: 1.2,
          ease: 'power3.inOut',
          onComplete: () => {
            carRig?.setCockpit(false, mode)
            camera.near = 0.1
            camera.updateProjectionMatrix()
          },
        })
      }
    }

    toggleOrbitRef.current = (active: boolean) => {
      isOrbitActive = active
      if (active) {
        const dx = camera.position.x
        const dy = camera.position.y - 0.6
        const dz = camera.position.z
        orbitState.radius = Math.max(4.0, Math.min(12.0, Math.sqrt(dx * dx + dy * dy + dz * dz)))
        orbitState.targetRadius = orbitState.radius
        orbitState.theta = Math.atan2(dx, dz)
        orbitState.targetTheta = orbitState.theta
        orbitState.phi = Math.acos(Math.max(-0.95, Math.min(0.95, dy / orbitState.radius)))
        orbitState.targetPhi = orbitState.phi
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      if (cockpitState.active) {
        cockpitState.isDragging = true
        cockpitState.lastX = e.clientX
        cockpitState.lastY = e.clientY
        return
      }
      if (!isOrbitActive) return
      orbitState.isDragging = true
      orbitState.lastX = e.clientX
      orbitState.lastY = e.clientY
    }

    const onPointerMove = (e: PointerEvent) => {
      if (cockpitState.active && cockpitState.isDragging) {
        const dx = e.clientX - cockpitState.lastX
        const dy = e.clientY - cockpitState.lastY
        // drag right → look right (natural "turn your head" mapping)
        cockpitState.targetYaw = Math.max(-1.2, Math.min(1.35, cockpitState.targetYaw + dx * 0.0042))
        cockpitState.targetPitch = Math.max(-0.7, Math.min(0.45, cockpitState.targetPitch - dy * 0.0036))
        cockpitState.lastX = e.clientX
        cockpitState.lastY = e.clientY
        return
      }
      if (isOrbitActive && orbitState.isDragging) {
        const dx = e.clientX - orbitState.lastX
        const dy = e.clientY - orbitState.lastY
        orbitState.targetTheta -= dx * 0.007
        orbitState.targetPhi = Math.max(0.12, Math.min(Math.PI / 2 - 0.04, orbitState.targetPhi - dy * 0.006))
        orbitState.lastX = e.clientX
        orbitState.lastY = e.clientY
      }
    }

    const onPointerUp = () => {
      orbitState.isDragging = false
      cockpitState.isDragging = false
    }

    const onWheel = (e: WheelEvent) => {
      if (!isOrbitActive) return
      orbitState.targetRadius = Math.max(3.8, Math.min(13.5, orbitState.targetRadius + e.deltaY * 0.006))
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('wheel', onWheel, { passive: true })

    const applyCamera = () => {
      if (cockpitState.active || cockpitState.t > 0.0005) {
        // eye + look in world space (car-local → yawed carGroup)
        const eye = carRig?.cockpitEye ?? tmpA.set(-0.18, 1.02, -0.36)
        cockpitEyeWorld.copy(eye).applyAxisAngle(tmpB.set(0, 1, 0), BASE_YAW)
        const k = 1 - Math.exp(-frameDt * 7) // ≈ 0.11 per frame at 60 fps, fps-independent
        cockpitState.yaw += (cockpitState.targetYaw - cockpitState.yaw) * k
        cockpitState.pitch += (cockpitState.targetPitch - cockpitState.pitch) * k
        // forward = +X in car space; yaw rotates toward −Z (right) for positive
        const cy = Math.cos(cockpitState.pitch)
        tmpV.set(Math.cos(cockpitState.yaw) * cy, Math.sin(cockpitState.pitch), -Math.sin(cockpitState.yaw) * cy)
        tmpV.applyAxisAngle(tmpB.set(0, 1, 0), BASE_YAW)
        cockpitLookWorld.copy(cockpitEyeWorld).addScaledVector(tmpV, 3)

        const t = cockpitState.t
        // quadratic bezier from the outside pose, through the driver's
        // window, into the seat — keeps the camera from cutting through the roof
        const u = 1 - t
        curveOut
          .copy(cockpitState.fromPos)
          .multiplyScalar(u * u)
          .addScaledVector(cockpitState.via, 2 * u * t)
          .addScaledVector(cockpitEyeWorld, t * t)
        tmpA.copy(cockpitState.fromLook).lerp(cockpitLookWorld, t * t * (3 - 2 * t))
        camera.position.copy(curveOut)
        camera.lookAt(tmpA)
        // FOV widens a touch inside so the dash + door card both fit
        const baseFov = window.innerWidth < 768 ? FOV_MOBILE : FOV_DESKTOP
        const fov = baseFov + (72 - baseFov) * t
        if (Math.abs(camera.fov - fov) > 0.05) {
          camera.fov = fov
          camera.updateProjectionMatrix()
        }
        return
      }
      if (isOrbitActive) {
        orbitState.theta += (orbitState.targetTheta - orbitState.theta) * 0.08
        orbitState.phi += (orbitState.targetPhi - orbitState.phi) * 0.08
        orbitState.radius += (orbitState.targetRadius - orbitState.radius) * 0.08

        const px = orbitState.radius * Math.sin(orbitState.phi) * Math.sin(orbitState.theta)
        const py = 0.6 + orbitState.radius * Math.cos(orbitState.phi)
        const pz = orbitState.radius * Math.sin(orbitState.phi) * Math.cos(orbitState.theta)

        camera.position.set(px, py, pz)
        camera.lookAt(0, 0.6, 0)
      } else {
        const m = mouseRef.current
        m.x += (m.targetX - m.x) * 0.05
        m.y += (m.targetY - m.y) * 0.05

        const pOffsetX = m.x * 0.28
        const pOffsetY = -m.y * 0.16
        const pOffsetZ = m.x * 0.18

        camera.position.set(cam.px + pOffsetX, cam.py + pOffsetY, cam.pz + pOffsetZ)
        camera.lookAt(cam.tx + pOffsetX * 0.25, cam.ty + pOffsetY * 0.15, cam.tz)
      }
    }

    const onMouseMove = (e: MouseEvent) => {
      mouseRef.current.targetX = (e.clientX / window.innerWidth - 0.5) * 2
      mouseRef.current.targetY = (e.clientY / window.innerHeight - 0.5) * 2
    }
    window.addEventListener('mousemove', onMouseMove)

    /* ── GSAP ScrollTrigger choreography ─────────────────────────────
     * One master timeline, scrubbed by scroll. Positions are expressed in
     * normalized progress units (the whole timeline lasts 1.0).        */
    const buildTimeline = (mobile: boolean) => {
      const K = {
        hero: flattenKey(KEYS.hero, mobile),
        front: flattenKey(KEYS.front, mobile),
        rear: flattenKey(KEYS.rear, mobile),
        xray: flattenKey(KEYS.xray, mobile),
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
          onUpdate: (self) => {
            const p = self.progress
            scrollProgressRef.current = p
            const nextSection: SectionId =
              p < 0.17 ? 'overview' : p < 0.45 ? 'performance' : p < 0.7 ? 'design' : p < 0.82 ? 'xray' : 'specs'
            if (nextSection !== activeSectionRef.current) {
              activeSectionRef.current = nextSection
              setActiveSection(nextSection)
            }
            const xrayProgress = xrayAmount(p)
            xrayProgressRef.current = xrayProgress
            updateXrayReadout(xrayProgress)
          },
        },
      })

      /* Act I — HERO → FRONT (0 → 0.24) */
      tl.to(cam, { ...K.front, duration: P.frontIn }, 0)
      tl.to(heroLayer, { autoAlpha: 0, y: -36, duration: 0.1, ease: 'power1.in' }, 0.02)
      tl.fromTo(capFront, { autoAlpha: 0, y: 32, scale: 0.98 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.07, ease: 'power2.out' }, 0.12)
      tl.to(capFront, { autoAlpha: 0, y: -24, scale: 0.98, duration: 0.06, ease: 'power1.in' }, 0.31)

      /* dwell on the front bumper (0.24 → 0.34) — no camera tweens */

      /* Act II — FRONT → REAR (0.34 → 0.56) */
      tl.to(cam, { ...K.rear, duration: P.rearIn - P.rearStart }, P.rearStart)
      tl.fromTo(capRear, { autoAlpha: 0, y: 32, scale: 0.98 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.07, ease: 'power2.out' }, 0.44)
      tl.to(capRear, { autoAlpha: 0, y: -24, scale: 0.98, duration: 0.06, ease: 'power1.in' }, 0.62)

      /* dwell on the rear (0.56 → 0.66) */

      /* Act III — REAR → X-RAY (0.66 → 0.78): rise to the broadside, then
       * the scan runs 0.78 → 0.88 (driven per-frame from xrayAmount so the
       * three.js material swap and the DOM counters share one clock) */
      tl.to(cam, { ...K.xray, duration: P.xrayIn - P.xrayStart }, P.xrayStart)
      tl.fromTo(
        xrayPanel,
        { autoAlpha: 0, x: 40 },
        { autoAlpha: 1, x: 0, duration: 0.05, ease: 'power2.out' },
        P.xrayIn - 0.01,
      )
      tl.to(xrayPanel, { autoAlpha: 0, x: 24, duration: 0.05, ease: 'power1.in' }, P.outroStart + 0.02)

      /* Act IV — X-RAY → OUTRO (0.88 → 1.00) + closing card */
      tl.to(cam, { ...K.outro, duration: P.outroIn - P.outroStart }, P.outroStart)
      tl.fromTo(endCard, { autoAlpha: 0, y: 28, scale: 0.98 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.08, ease: 'power2.out' }, 0.92)

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
      lenisInstanceRef.current = lenis
    }

    const tick = (time: number, deltaMs: number) => {
      if (document.visibilityState === 'hidden') return
      frameDt = Math.min(0.1, Math.max(0.001, deltaMs / 1000))
      lenis?.raf(time * 1000)
      applyCamera()
      activeLocation?.update?.({
        time,
        dt: frameDt,
        camera,
        scroll: scrollProgressRef.current,
      })

      // The X-ray reveal and the specification readout share the scroll clock.
      const xa = cockpitState.active ? 0 : xrayProgressRef.current
      const nextShadowMode = xa <= 0.6
      if (nextShadowMode !== xrayShadowMode) {
        xrayShadowMode = nextShadowMode
        renderer.shadowMap.needsUpdate = true
      }
      carRig?.setXray(xa)

      // Cockpit call-outs: project car-local anchors to CSS pixels. Only
      // the ones in front of the camera and inside the frame are shown.
      if (cockpitState.t > 0.5) {
        const w = window.innerWidth
        const h = window.innerHeight
        for (const c of COCKPIT_CALLOUTS) {
          const el = calloutEls.get(c.id)
          if (!el) continue
          tmpV.set(c.localPos[0], c.localPos[1], c.localPos[2]).applyAxisAngle(tmpB.set(0, 1, 0), BASE_YAW)
          tmpV.project(camera)
          const inFront = tmpV.z < 1
          const x = (tmpV.x * 0.5 + 0.5) * w
          const y = (-tmpV.y * 0.5 + 0.5) * h
          const inside = inFront && x > 24 && x < w - 220 && y > 120 && y < h - 150
          const fade = Math.max(0, Math.min(1, (cockpitState.t - 0.7) / 0.3))
          el.style.opacity = inside ? String(fade) : '0'
          el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
        }
      } else if (calloutsShown) {
        for (const el of calloutEls.values()) el.style.opacity = '0'
      }
      calloutsShown = cockpitState.t > 0.5

      renderer.render(scene, camera)
    }
    /* A throw inside the render loop would otherwise repeat every single
     * frame — GSAP keeps calling the callback, so one lost WebGL context
     * turns into an endless error flood and a frozen picture. Guard it:
     * the first failure unhooks the loop and shows the fallback panel. */
    const safeTick = (time: number, deltaMs: number) => {
      try {
        tick(time, deltaMs)
      } catch (err) {
        console.error('[scroll-experience] render loop stopped:', err)
        gsap.ticker.remove(safeTick)
        const message =
          err instanceof Error ? err.message : 'The 3D render loop stopped unexpectedly.'
        queueMicrotask(() => setStageError(message))
      }
    }
    gsap.ticker.fps(60)
    gsap.ticker.add(safeTick)
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
      renderer.setPixelRatio(getPixelRatio())
      renderer.setSize(w, h, false)
      renderer.shadowMap.needsUpdate = true
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 150)
    }
    window.addEventListener('resize', onResize)

    /* ── Teardown — no memory leaks ────────────────────────────────── */
    return () => {
      disposed = true
      locationRequestSequence += 1
      requestedLocationId = null
      modelRequestController?.abort()
      lenisInstanceRef.current = null
      canvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('mousemove', onMouseMove)
      window.clearTimeout(refreshTimer)
      mm.revert() // kills the ScrollTriggers/tweens created per breakpoint
      ScrollTrigger.getAll().forEach((st) => st.kill()) // safety net
      gsap.ticker.remove(safeTick)
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
      for (const tw of lightTweens) tw.kill()
      cockpitTween?.kill()
      if (activeLocation) {
        scene.remove(activeLocation.group)
        activeLocation.dispose()
        activeLocation = null
      }
      if (locationEnv) {
        locationEnv.dispose()
        locationEnv = null
      }
      studioBackdrop.dispose()
      floorTextures.color.dispose()
      floorTextures.roughness.dispose()
      studioEnvTarget?.dispose()
      studioEnvTarget = null
      envTex.dispose()
      pmrem.dispose()
      renderer.forceContextLoss()
      renderer.dispose()
    }
      })()
    } catch (err) {
      // The 3D stage failed to boot. Keep the React tree alive so the user
      // gets the fallback panel (and the real reason) instead of a dead page.
      console.error('[scroll-experience] 3D stage failed to initialise:', err)
      // Scheduled rather than called inline: this runs during the effect
      // commit, and a synchronous setState here would cascade an extra render
      // pass before the current one has settled.
      const message =
        err instanceof Error ? err.message : 'The 3D stage could not be initialised.'
      queueMicrotask(() => setStageError(message))
      try {
        teardown?.()
      } catch {
        /* already broken — nothing useful to do */
      }
      teardown = null
    }

    return () => {
      try {
        teardown?.()
      } catch (err) {
        console.warn('[scroll-experience] teardown failed:', err)
      }
    }
  }, [])

  const localizeModelMessage = (message?: string) => {
    if (!isArabic) return message ?? 'Loading vehicle geometry'
    const messages: Record<string, string> = {
      'Using the saved vehicle model': 'جارٍ استخدام نموذج السيارة المحفوظ',
      'Downloading vehicle geometry': 'جارٍ تنزيل بيانات السيارة',
      'Preparing 3D materials': 'جارٍ تجهيز المواد ثلاثية الأبعاد',
      'Fitting the car to the studio': 'جارٍ ضبط السيارة في الاستوديو',
    }
    return message ? messages[message] ?? message : 'جارٍ تحميل بيانات السيارة'
  }

  /* ═══════════════ Fallback when the 3D stage cannot boot ═════════════ */

  if (stageError) {
    return (
      <main className="flex min-h-screen w-full items-center justify-center bg-[#090b0e] px-6 text-[#f1f2f3]">
        <div className="w-full max-w-[560px] text-center">
          <img src="/bmw-logo.svg" alt="BMW" width={52} height={52} className="mx-auto mb-7 h-[52px] w-[52px] object-contain" />
          <p className="stage-eyebrow m-0">BMW M5 CS · F90</p>
          <h1 className="m-0 mt-3 text-[clamp(24px,5vw,38px)] font-semibold leading-tight text-white">{copy.fallbackTitle}</h1>
          <p className="m-0 mt-4 text-[14px] leading-[1.75] text-white/65">{copy.fallbackDescription}</p>

          <div className="mt-8 border border-white/15 bg-white/[0.035] p-5 text-start">
            <p className="m-0 text-[12px] font-medium text-white/85">WebGL</p>
            <p className="m-0 mt-2 text-[13px] leading-relaxed text-white/60">{stageError}</p>
            <p className="m-0 mt-3 text-[12px] leading-relaxed text-white/45">{copy.enableWebGL}</p>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {SPEC_STATS.slice(0, 3).map((stat) => (
              <div key={stat.id} className="border border-white/10 px-4 py-3 text-start">
                <p className="m-0 text-[17px] font-semibold tabular-nums text-white">
                  {stat.value.toLocaleString(locale === 'ar' ? 'ar' : 'en')}
                  <span className="ms-1 text-[11px] font-normal text-white/50">{stat.unit}</span>
                </p>
                <p className="m-0 mt-1 text-[10px] text-white/50">{isArabic ? stat.labelAr : stat.label}</p>
              </div>
            ))}
          </div>

          <button type="button" onClick={() => window.location.reload()} className="editorial-cta mt-8 cursor-pointer">
            {copy.retry}
          </button>
        </div>
      </main>
    )
  }

  /* ═══════════════════ Overlay markup (fixed stage) ═══════════════════ */

  return (
    <main
      className="relative w-full bg-[#090b0e] text-[#f1f2f3]"
      data-locale={locale}
      lang={locale}
      dir={isArabic ? 'rtl' : 'ltr'}
      data-immersive={orbitMode || cockpitMode ? 'true' : undefined}
    >
      {/*
        Invisible scroll track — its height (560vh) is the scroll distance
        ScrollTrigger scrubs the camera timeline through. Fully reversible.
      */}
      <div ref={trackRef} aria-hidden="true" className="h-[560vh]" />

      {/* Fixed 3D stage */}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={copy.heroTitle}
        className="fixed inset-0 z-0 block h-full w-full"
      />

      {modelStatus.phase !== 'ready' && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center p-5" aria-live="polite">
          <div className="pointer-events-auto w-full max-w-[350px] border border-white/15 bg-[#090b0e] p-5 text-white">
            <p className="stage-eyebrow m-0">BMW M5 CS · F90</p>
            <h2 className="m-0 mt-2 text-[16px] font-semibold">
              {modelStatus.phase === 'loading' ? copy.loadingModel : copy.modelUnavailable}
            </h2>
            {modelStatus.phase === 'loading' ? (
              <>
                <div className="mt-4 flex items-center justify-between gap-3 text-[11px] text-white/60">
                  <span>{localizeModelMessage(modelStatus.message)}</span>
                  <span className="font-mono tabular-nums">{Math.round(modelStatus.progress * 100)}%</span>
                </div>
                <div
                  role="progressbar"
                  aria-label={copy.loadingExperience}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(modelStatus.progress * 100)}
                  className="mt-2 h-1 overflow-hidden bg-white/10"
                >
                  <div className="h-full bg-[#d7193f] transition-[width] duration-200" style={{ width: `${Math.max(3, modelStatus.progress * 100)}%` }} />
                </div>
              </>
            ) : (
              <>
                <p className="m-0 mt-2 text-[12px] leading-relaxed text-white/60">{modelStatus.message}</p>
                <button type="button" onClick={() => window.location.reload()} className="editorial-cta mt-4 min-h-9 px-4 text-[11px]">
                  {copy.retryLoading}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Fixed UI overlay */}
      <div className="pointer-events-none fixed inset-0 z-10">
        <header className="site-header pointer-events-auto fixed inset-x-0 top-0 z-30 flex items-center justify-between px-[clamp(20px,5vw,64px)] py-3">
          <button
            type="button"
            onClick={() => scrollToSection('overview')}
            aria-label={copy.heroTitle}
            className="flex items-center gap-3 text-left"
          >
            <img src="/bmw-logo.svg" alt="BMW" width={34} height={34} className="h-[34px] w-[34px] object-contain" />
            <span className="text-[15px] font-semibold tracking-[0.08em] text-white">M5 CS</span>
          </button>

          <nav aria-label={copy.navigationLabel} className="hidden items-center gap-7 md:flex">
            {NAV_ITEMS.map((item) => {
              const isActive = activeSection === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => scrollToSection(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className="site-nav-link cursor-pointer text-[12px] font-medium"
                >
                  {copy.navigation[item.labelKey]}
                </button>
              )
            })}
          </nav>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleLocale}
              aria-label={isArabic ? copy.switchToEnglish : copy.switchToArabic}
              className="locale-switch px-2.5 py-1.5 text-[11px] font-medium"
            >
              {isArabic ? <span lang="en">EN</span> : <span lang="ar">عربي</span>}
            </button>
            <button
              ref={bookingTriggerRef}
              type="button"
              onClick={() => setShowBookingModal(true)}
              className="border-b border-white/50 px-1 py-1.5 text-[12px] font-medium text-white/85 transition-colors hover:border-white hover:text-white"
            >
              {copy.driveInformation}
            </button>
          </div>
        </header>

        {/* Hero copy */}
        <div
          ref={heroLayerRef}
          data-scroll-copy=""
          className={`absolute inset-0 flex flex-col justify-end transition-opacity duration-300 ${
            orbitMode || cockpitMode ? 'pointer-events-none opacity-0' : ''
          }`}
        >
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%] bg-gradient-to-t from-[#090b0e]/75 via-[#090b0e]/20 to-transparent" />
          <section className="relative mb-[112px] flex w-full max-w-[540px] flex-col items-start px-[clamp(22px,7vw,96px)] text-start sm:mb-[112px]">
            <p className="stage-eyebrow m-0">{copy.heroEyebrow}</p>
            <h1 className="m-0 mt-3 text-[clamp(36px,6.1vw,70px)] font-semibold leading-[0.98] tracking-[-0.04em] text-white">
              {copy.heroTitle}
            </h1>
            <p className="m-0 mt-4 max-w-[440px] text-[14px] leading-[1.75] text-white/70 sm:text-[15px]">
              {copy.heroDescription}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3 text-[11px] font-medium text-white/80">
              {copy.heroSpecs.map((fact, index) => (
                <span key={fact} className={index === 0 ? '' : 'border-s border-white/25 ps-3'}>
                  {fact}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => scrollToSection('performance')}
              className="editorial-cta pointer-events-auto mt-6 cursor-pointer"
            >
              <span>{copy.heroAction}</span>
              <svg className="directional-arrow" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 12h15" />
                <path d="M13.5 5.5 20 12l-6.5 6.5" />
              </svg>
            </button>
            <a
              href="https://sketchfab.com/3d-models/bmw-m5-cs-f90-8f74fb3420e24213aaeea33dc99450a3"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 text-[10px] text-white/45 underline decoration-white/20 underline-offset-4 transition-colors hover:text-white/75"
            >
              {copy.modelCredit}
            </a>
          </section>
        </div>

        {/* ── Stage caption: FRONT (right side on desktop) ── */}
        <div
          ref={capFrontRef}
          data-scroll-copy=""
          style={{ opacity: 0 }}
          className={`stage-caption-front absolute inset-x-5 bottom-28 max-w-[340px] transition-opacity duration-300 sm:inset-x-auto sm:bottom-auto sm:right-[clamp(24px,7vw,110px)] sm:top-[38%] sm:text-right ${
            orbitMode || cockpitMode ? 'pointer-events-none opacity-0' : ''
          }`}
        >
          <p className="stage-eyebrow m-0">{copy.frontEyebrow}</p>
          <h2 className="m-0 mt-2 text-[clamp(20px,3vw,32px)] font-semibold text-white">{copy.frontTitle}</h2>
          <p className="m-0 mt-2 text-[13px] leading-relaxed text-white/60">{copy.frontDescription}</p>
        </div>

        {/* ── Stage caption: REAR (left side on desktop) ── */}
        <div
          ref={capRearRef}
          data-scroll-copy=""
          style={{ opacity: 0 }}
          className={`stage-caption-rear absolute inset-x-5 bottom-28 max-w-[340px] transition-opacity duration-300 sm:inset-x-auto sm:bottom-auto sm:left-[clamp(24px,7vw,110px)] sm:top-[38%] ${
            orbitMode || cockpitMode ? 'pointer-events-none opacity-0' : ''
          }`}
        >
          <p className="stage-eyebrow m-0">{copy.rearEyebrow}</p>
          <h2 className="m-0 mt-2 text-[clamp(20px,3vw,32px)] font-semibold text-white">{copy.rearTitle}</h2>
          <p className="m-0 mt-2 text-[13px] leading-relaxed text-white/60">{copy.rearDescription}</p>
        </div>

        {/* Engineering detail */}
        <div
          ref={xrayPanelRef}
          data-scroll-copy=""
          style={{ opacity: 0 }}
          className={`xray-panel-position absolute inset-x-4 bottom-[96px] sm:inset-x-auto sm:bottom-auto sm:right-[clamp(20px,5vw,72px)] sm:top-1/2 sm:w-[340px] sm:-translate-y-1/2 transition-opacity duration-300 ${
            orbitMode || cockpitMode ? 'pointer-events-none opacity-0' : ''
          }`}
        >
          <div className="xray-panel border border-white/18 bg-[#090b0e]/95 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="stage-eyebrow m-0">{copy.engineeringEyebrow}</p>
              <span className="text-[10px] text-white/50">{copy.engineeringStatus}</span>
            </div>
            <h2 className="m-0 text-[clamp(17px,2.4vw,23px)] font-semibold leading-tight text-white">
              {copy.engineeringTitle}
            </h2>
            <p className="m-0 mt-2 mb-4 hidden text-[12px] leading-relaxed text-white/55 sm:block">
              {copy.engineeringDescription}
            </p>
            <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-1 sm:gap-y-2.5">
              {SPEC_STATS.map((stat, index) => {
                const value = xrayValues[index] ?? 0
                const numberLocale = isArabic ? 'ar' : 'en'
                const shown = value.toLocaleString(numberLocale, {
                  minimumFractionDigits: stat.decimals ?? 0,
                  maximumFractionDigits: stat.decimals ?? 0,
                })
                const percentage = stat.value > 0 ? Math.min(1, value / stat.value) : 0
                return (
                  <div key={stat.id} className="min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="m-0 truncate text-[10px] text-white/50">{isArabic ? stat.labelAr : stat.label}</dt>
                      <dd className="m-0 whitespace-nowrap font-mono text-[15px] font-semibold tabular-nums text-white sm:text-[16px]">
                        {shown}<span className="ms-1 text-[10px] font-normal text-white/55">{stat.unit}</span>
                      </dd>
                    </div>
                    <div className="mt-1 h-px w-full bg-white/10">
                      <div className="h-px bg-[#d7193f] transition-[width] duration-100" style={{ width: `${percentage * stat.bar * 100}%` }} />
                    </div>
                  </div>
                )
              })}
            </dl>
          </div>
        </div>

        {/* ── Closing card ── */}
        <div
          ref={endCardRef}
          data-scroll-copy=""
          style={{ opacity: 0 }}
          className={`absolute inset-0 flex flex-col items-center justify-center px-6 text-center transition-opacity duration-300 ${
            orbitMode || cockpitMode ? 'opacity-0 pointer-events-none' : ''
          }`}
        >
          <p className="stage-eyebrow m-0">{copy.closingEyebrow}</p>
          <h2 className="m-0 mt-4 text-[clamp(26px,4.5vw,42px)] font-semibold text-white">{copy.closingTitle}</h2>
          <button
            type="button"
            onClick={() => void handleShareBuild()}
            className="editorial-cta pointer-events-auto mt-7 cursor-pointer"
          >
            <span>{shareMessage || copy.shareBuild}</span>
            <svg
              className="directional-arrow"
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
          </button>
        </div>

        {/* ── Advanced Studio & Vehicle Configurator Dock ── */}
        <ConfiguratorDock
          theme={theme}
          onThemeChange={handleThemeChange}
          highBeams={highBeams}
          onToggleHighBeams={toggleHighBeams}
          paint={paint}
          onPaintChange={handlePaintChange}
          wheelFinish={wheelFinish}
          onWheelChange={handleWheelChange}
          caliperColor={caliperColor}
          onCaliperChange={handleCaliperChange}
          onShare={handleShareBuild}
          onReset={handleResetBuild}
          shareMessage={shareMessage}
          orbitMode={orbitMode}
          onToggleOrbit={handleOrbitToggle}
          sceneId={sceneId}
          onSceneChange={handleSceneChange}
          cockpitMode={cockpitMode}
          onToggleCockpit={handleCockpitToggle}
        />

        {/* ── Cockpit HUD — exit + callouts ── */}
        <CockpitOverlay
          active={cockpitMode}
          onExit={handleCockpitToggle}
          callouts={COCKPIT_CALLOUTS}
        />
      </div>

      {/* ── Honest demo hand-off: no pretend booking confirmation ── */}
      {showBookingModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="booking-title"
          aria-describedby="booking-description"
          tabIndex={-1}
          ref={bookingDialogRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/82 p-4 animate-in fade-in duration-200"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowBookingModal(false)
          }}
        >
          <div className="relative w-full max-w-[520px] rounded-md border border-white/15 bg-[#0c0f16] p-6 shadow-2xl sm:p-8">
            <button
              type="button"
              onClick={() => setShowBookingModal(false)}
              data-dialog-initial-focus=""
              aria-label={copy.closeDriveInformation}
              className="absolute end-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white/55 transition-colors hover:bg-white/10 hover:text-white"
            >
              <span aria-hidden="true">×</span>
            </button>

            <p className="stage-eyebrow m-0 text-[#e8b766]">{copy.driveEyebrow}</p>
            <h2 id="booking-title" className="m-0 mt-3 max-w-[390px] text-[clamp(24px,4vw,32px)] font-semibold leading-tight text-white">
              {copy.driveTitle}
            </h2>
            <p id="booking-description" className="m-0 mt-4 text-[13px] leading-relaxed text-white/65">
              {copy.driveDescription}
            </p>

            <dl className="m-0 mt-6 grid grid-cols-2 gap-3 border border-white/10 bg-white/[0.035] p-4">
              <div>
                <dt className="text-[9px] uppercase tracking-[0.16em] text-white/40">{copy.paint}</dt>
                <dd className="m-0 mt-1 text-[12px] font-medium text-white/90">{isArabic ? PAINT_CONFIGS[paint].nameAr : PAINT_CONFIGS[paint].name}</dd>
              </div>
              <div>
                <dt className="text-[9px] uppercase tracking-[0.16em] text-white/40">{copy.wheels}</dt>
                <dd className="m-0 mt-1 text-[12px] font-medium text-white/90">{isArabic ? WHEEL_CONFIGS[wheelFinish].nameAr : WHEEL_CONFIGS[wheelFinish].name}</dd>
              </div>
              <div>
                <dt className="text-[9px] uppercase tracking-[0.16em] text-white/40">{copy.brakes}</dt>
                <dd className="m-0 mt-1 text-[12px] font-medium text-white/90">{isArabic ? CALIPER_CONFIGS[caliperColor].nameAr : CALIPER_CONFIGS[caliperColor].name}</dd>
              </div>
              <div>
                <dt className="text-[9px] uppercase tracking-[0.16em] text-white/40">{copy.location}</dt>
                <dd className="m-0 mt-1 text-[12px] font-medium text-white/90">
                  {isArabic
                    ? SCENES.find((scene) => scene.id === sceneId)?.nameAr
                    : SCENES.find((scene) => scene.id === sceneId)?.name}
                </dd>
              </div>
            </dl>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowBookingModal(false)}
                className="border border-white/20 px-5 py-2.5 text-[12px] font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white"
              >
                {copy.backToExperience}
              </button>
              <button
                type="button"
                onClick={() => void handleShareBuild()}
                className="bg-white px-5 py-2.5 text-[12px] font-semibold text-black transition-colors hover:bg-white/85"
              >
                {shareMessage || copy.copyBuildLink}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
