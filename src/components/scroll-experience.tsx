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
import { createStudioCove, studioPalette } from '@/lib/studio'
import { randomLocation } from '@/lib/locations/photographic'
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

  // Keep the painted body intact in every camera view.
  let cockpitActive = false

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
  // Ground-truth axle and track positions for the F90 M5 CS model:
  // Wheelbase: front axle at x = +1.47, rear axle at x = -1.27; track half-width = 0.74.
  // Proportional fallback scales if a differently-dimensioned model is used.
  if (Math.abs(size.x - 4.6) < 0.5) {
    return [
      [-1.27, 0.74],
      [-1.27, -0.74],
      [1.47, 0.74],
      [1.47, -0.74],
    ]
  }
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

type SectionId = (typeof NAV_ITEMS)[number]['id'] | 'specs'

async function readModelResponse(
  response: Response,
  reportProgress: (progress: number) => void,
): Promise<ArrayBuffer> {
  reportProgress(0.2)
  const buffer = await response.arrayBuffer()
  reportProgress(0.95)
  return buffer
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

  const [locationBusy, setLocationBusy] = useState(false)
  const [buildConfiguration, setBuildConfiguration] = useState<BuildConfiguration>(() =>
    ({ ...getInitialBuildConfiguration(), highBeams: false,
      sceneId: typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('scene')
        ? getInitialBuildConfiguration().sceneId : randomLocation() }),
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
  const [cockpitMode, setCockpitMode] = useState(false)
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
    setOrbitMode(false)
    toggleOrbitRef.current?.(false)
    setCockpitMode(false)
    toggleCockpitRef.current?.(false, 'road')
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
      lenisInstanceRef.current.scrollTo(target, { duration: 0.65 })
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
    renderer.toneMappingExposure = STUDIO_LIGHTING.exposure
    renderer.outputColorSpace = THREE.SRGBColorSpace

    /* ── Scene: local studio environment with a procedural fallback ──── */
    const scene = new THREE.Scene()
    const backdropColor = new THREE.Color(studioPalette(theme).background)
    scene.background = backdropColor
    scene.fog = new THREE.FogExp2(0xbdc1c3, 0) // thin enough for the cyclorama to read, thick enough to hide the floor rim

    // A small, locally hosted studio panorama gives the paint and glass
    // recognizable photographic reflections. Keep a procedural fallback for
    // offline loads and browsers that cannot decode the environment image.
    const pmrem = new THREE.PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    const envTex = pmrem.fromScene(room, 0.04).texture
    let studioEnvTarget: THREE.WebGLRenderTarget | null = null
    scene.environment = envTex
    scene.environmentIntensity = STUDIO_LIGHTING.environmentIntensity
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

    const key = new THREE.SpotLight(STUDIO_LIGHTING.key.color, STUDIO_LIGHTING.key.intensity)
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

    const rim = new THREE.DirectionalLight(STUDIO_LIGHTING.rim.color, STUDIO_LIGHTING.rim.intensity)
    rim.position.set(-8, 5, -6)
    scene.add(rim)

    const hemi = new THREE.HemisphereLight(STUDIO_LIGHTING.hemi.sky, STUDIO_LIGHTING.hemi.ground, STUDIO_LIGHTING.hemi.intensity)
    scene.add(hemi)

    /* The studio keeps only the surfaces needed to shape clean reflections. */
    const studio = new THREE.Group()
    scene.add(studio)

    const studioMaterial = new THREE.MeshStandardMaterial({
      color: studioPalette(theme).surface, roughness: 0.76, metalness: 0,
      envMapIntensity: 0.3, side: THREE.DoubleSide,
    })
    const studioCove = new THREE.Mesh(createStudioCove(), studioMaterial)
    studioCove.receiveShadow = true
    studio.add(studioCove)

    /* ── Car root + contact shadows + dynamic automotive projections ─ */
    const carGroup = new THREE.Group()
    carGroup.rotation.y = BASE_YAW
    scene.add(carGroup)

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
    let currentTheme: StudioTheme = theme
    let currentHighBeams = true
    let activeLocation: LocationScene | null = null
    const studioBackdrop = backdropColor
    const applyTheme = (t: StudioTheme, hb: boolean) => {
      currentTheme = t
      currentHighBeams = hb
      const palette = studioPalette(t)
      studioMaterial.color.set(palette.surface)
      studioBackdrop.set(palette.background)
      if (!activeLocation) {
        scene.background = studioBackdrop
        key.color.setHex(STUDIO_LIGHTING.key.color)
        rim.color.setHex(STUDIO_LIGHTING.rim.color)
      }
    }
    updateThemeRef.current = applyTheme

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
    const locationCache = new Map<SceneId, LocationScene>()
    const reflectionCache = new Map<LocationScene, THREE.WebGLRenderTarget>()
    let locationEnv: THREE.WebGLRenderTarget | null = null
    const applyEnvironment = (next: LocationScene | null) => {
      if (next?.environment) {
        try {
          locationEnv = reflectionCache.get(next) ?? pmrem.fromEquirectangular(next.environment as THREE.Texture)
          reflectionCache.set(next, locationEnv)
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
        setLocationBusy(false)
        requestedLocationId = null
        return
      }

      const mobile = window.innerWidth < 768
      let next: LocationScene | null = null
      try {
        setLocationBusy(true)
        // Allow the loading indicator to paint before procedural work begins.
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        if (disposed || requestId !== locationRequestSequence) return
        next = locationCache.get(id) ?? await buildLocationScene(id, { mobile })
        if (next && !locationCache.has(id)) await renderer.compileAsync(next.group, camera, scene)
      } catch (err) {
        if (next && !locationCache.has(id)) next.dispose()
        if (disposed || requestId !== locationRequestSequence) return
        requestedLocationId = null
        setLocationBusy(false)
        const fallbackId = activeLocation?.id ?? 'studio'
        setBuildConfiguration((current) => ({ ...current, sceneId: fallbackId }))
        console.warn('[scroll-experience] location build failed; keeping the current environment:', err)
        return
      }

      if (disposed || requestId !== locationRequestSequence) {
        if (next && !locationCache.has(id)) next.dispose()
        return
      }
      requestedLocationId = null
      setLocationBusy(false)
      setBuildConfiguration((current) => ({ ...current, sceneId: id }))
      if (next) { locationCache.delete(id); locationCache.set(id, next) }

      if (activeLocation) {
        scene.remove(activeLocation.group)
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
      // Keep at most two locations, including their baked reflections.
      while (locationCache.size > 2) {
        const oldest = locationCache.keys().next().value!
        const old = locationCache.get(oldest)!
        reflectionCache.get(old)?.dispose()
        reflectionCache.delete(old)
        old.dispose()
        locationCache.delete(oldest)
      }
      if (!instant) {
        gsap.fromTo(canvas, { opacity: 0.85 }, { opacity: 1, duration: 0.3, ease: 'power2.out' })
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
            const cachePromise = window.caches.open('bmw-m5-cs-cache-v2')
            const timeoutPromise = new Promise<null>((r) => setTimeout(() => r(null), 1200))
            const opened = await Promise.race([cachePromise, timeoutPromise])
            if (opened && 'match' in opened) {
              cache = opened
              const match = await Promise.race([cache.match(MODEL_URL), timeoutPromise])
              if (match && 'arrayBuffer' in match) {
                arrayBuffer = await match.arrayBuffer()
                reportProgress(0.94, 'Using the saved vehicle model')
              }
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
            const xrayProgress = 0
            xrayProgressRef.current = xrayProgress
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
      lenis?.raf(performance.now())
      applyCamera()
      activeLocation?.update?.({
        time,
        dt: frameDt,
        camera,
        scroll: scrollProgressRef.current,
      })

      // The X-ray reveal and the specification readout share the scroll clock.
      const xa = 0
      const nextShadowMode = xa <= 0.6
      if (nextShadowMode !== xrayShadowMode) {
        xrayShadowMode = nextShadowMode
        renderer.shadowMap.needsUpdate = true
      }

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
    gsap.ticker.lagSmoothing(500, 33)
    gsap.ticker.add(safeTick)

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
      if (activeLocation) scene.remove(activeLocation.group)
      for (const location of locationCache.values()) location.dispose()
      for (const reflection of reflectionCache.values()) reflection.dispose()
      locationCache.clear()
      reflectionCache.clear()
      locationEnv = null
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
        activeLocation = null
      }
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
      <div ref={trackRef} aria-hidden="true" className="h-[360vh]" />

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

      {locationBusy && <div role="status" className="location-status">{isArabic ? 'جارٍ تجهيز الموقع…' : 'Preparing location…'}</div>}
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

          <nav aria-label={copy.navigationLabel} className="camera-navigation">
            {NAV_ITEMS.map((item) => {
              const isActive = (activeSection === 'specs' ? 'xray' : activeSection) === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => scrollToSection(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  aria-pressed={isActive}
                  className="site-nav-link cursor-pointer text-[12px] font-medium"
                >
                  {isArabic ? ({overview:'كامل',performance:'أمام',design:'خلف',xray:'جانب'}[item.id]) : ({overview:'Overview',performance:'Front',design:'Rear',xray:'Side'}[item.id])}
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
              {isArabic ? 'التفاصيل' : 'Details'}
            </button>
          </div>
        </header>

        <div ref={heroLayerRef} aria-hidden="true" />
        <div ref={capFrontRef} aria-hidden="true" />
        <div ref={capRearRef} aria-hidden="true" />
        <div ref={xrayPanelRef} aria-hidden="true" />
        <div ref={endCardRef} aria-hidden="true" />
        <div className="scene-label"><span>{isArabic ? 'الموقع' : 'LOCATION'}</span><strong>{isArabic ? SCENES.find(s => s.id === sceneId)?.nameAr : SCENES.find(s => s.id === sceneId)?.name}</strong></div>

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
          locationBusy={locationBusy}
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 animate-in fade-in duration-200"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowBookingModal(false)
          }}
        >
          <div className="details-glass relative w-full max-w-[520px] rounded-2xl border border-white/20 p-6 shadow-2xl sm:p-8">
            <button
              type="button"
              onClick={() => setShowBookingModal(false)}
              data-dialog-initial-focus=""
              aria-label={copy.closeDriveInformation}
              className="absolute end-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white/55 transition-colors hover:bg-white/10 hover:text-white"
            >
              <span aria-hidden="true">×</span>
            </button>

            <h2 id="booking-title" className="m-0 text-2xl font-semibold">BMW M5 CS</h2>
            <p id="booking-description" className="mt-2 text-sm text-white/60">4.4L twin-turbo V8 · F90</p>
            <dl className="vehicle-facts">
              <div><dt>{isArabic ? 'القوة' : 'Power'}</dt><dd>627 hp</dd></div>
              <div><dt>{isArabic ? 'عزم الدوران' : 'Torque'}</dt><dd>750 Nm</dd></div>
              <div><dt>0–100 km/h</dt><dd>3.0 s</dd></div>
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
